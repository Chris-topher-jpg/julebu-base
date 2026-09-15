import { randomUUID } from 'node:crypto';
import { isRealNameVerified } from './real-name.mjs';
import { catalogList } from './game-catalog.mjs';
import { MIN_WITHDRAWAL_DEPOSIT_CENTS } from './membership.mjs';

const fail = (condition, message, status = 400) => {
  if (!condition) throw Object.assign(new Error(message), { status });
};
const now = () => new Date().toISOString();
const terminal = new Set(['passed', 'failed', 'cancelled', 'refunded']);
const applicants = new Set(['user', 'member']);
const text = (value, label, max = 2000) => {
  fail(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max, `${label}不能为空且最多 ${max} 个字符`);
  return value.trim();
};
const version = (record, input) => fail(Number.isSafeInteger(input.version) && input.version === record.version, '内容已更新，请刷新后重试', 409);

export function migrateAdmissions(data) {
  let changed = false;
  for (const key of ['admissionApplications', 'admissionOrders', 'admissionConversations', 'admissionSettings']) {
    if (!Array.isArray(data[key])) { data[key] = []; changed = true; }
  }
  return changed;
}

function actorOf(data, actor) {
  const current = data.users.find(user => user.id === actor?.id);
  fail(current?.active, '账号不存在或已停用', 403);
  return current;
}
function applicant(user) {
  fail(applicants.has(user.role) && !user.escortFrozen, '当前身份不能申请成为打手', 403);
}
function admin(user) { fail(user.role === 'admin', '仅管理员可执行此操作', 403); }
function availableGame(data, name) {
  const game = catalogList(data).find(item => item.name === name || item.id === name);
  fail(game && !['下架', '停用', '禁用'].includes(game.state), '该游戏暂未开放考核', 409);
  return game.name;
}
const settingOf = (data, game) => data.admissionSettings?.find(setting => setting.game === game);
function examinerEligible(user, game) {
  return Boolean(user?.active && user.role === 'examiner' && !user.escortFrozen && (!(user.games || []).length || user.games.includes(game)));
}
function availableExaminers(data, game, config = settingOf(data, game)) {
  return data.users.filter(user => examinerEligible(user, game) && (!config?.examinerIds?.length || config.examinerIds.includes(user.id)));
}
function requireExaminer(data, application, actor) {
  fail(actor.id !== application.userId && (actor.role === 'admin' || actor.id === application.examinerId && examinerEligible(actor, application.game)), '只有指定考官或管理员可处理此考核', 403);
}
function canRead(application, actor) {
  return actor.role === 'admin' || actor.id === application.userId || actor.role === 'examiner' && actor.id === application.examinerId;
}
function applicationOf(data, actor, id) {
  const application = data.admissionApplications.find(item => item.id === id);
  fail(application && canRead(application, actor), '考核申请不存在或无权访问', 404);
  return application;
}
function feeConfig(data, game, examinerId, allowWaiting = false) {
  availableGame(data, game);
  const config = settingOf(data, game);
  fail(config?.enabled && Number.isSafeInteger(config.feeCents) && config.feeCents > 0 && config.description && config.levelId, '该游戏尚未开放考核，请选择其他游戏或稍后再试', 409);
  fail(Array.isArray(config.examinerIds) && config.examinerIds.length && (allowWaiting || availableExaminers(data, game, config).some(user => user.id === examinerId)), '当前没有可收费考核的指定考官，请联系管理员安排', 409);
  const level = data.levels.find(item => item.id === config.levelId);
  fail(level && Number.isInteger(level.shareBps) && level.shareBps >= 0 && level.shareBps <= 10000, '考核授予等级已失效，请联系管理员', 409);
  return { config, level };
}

function selectExaminer(data, game) {
  const workload = id => data.admissionApplications.filter(item => item.examinerId === id && !terminal.has(item.status)).length;
  const lastAssigned = id => Math.max(0, ...data.admissionApplications.filter(item => item.examinerId === id).map(item => Date.parse(item.assignedAt || item.createdAt) || 0));
  return availableExaminers(data, game).sort((a, b) => workload(a.id) - workload(b.id) || lastAssigned(a.id) - lastAssigned(b.id) || a.id.localeCompare(b.id))[0];
}

function appointmentTime(value) {
  fail(typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) > Date.now() && Date.parse(value) < Date.now() + 90 * 86400000, '请选择未来 90 天内的考核预约时间');
  return new Date(value).toISOString();
}
function appendHistory(application, actor, action, detail = '') {
  application.history.push({ action, detail, by: actor.name, actorId: actor.id, at: now() });
  application.updatedAt = now();
  application.version += 1;
}
function orderOf(data, application, id) {
  const order = data.admissionOrders.find(item => item.id === id && item.applicationId === application.id);
  fail(order, '考核订单不存在', 404);
  return order;
}
function customerOf(data, userId, order) {
  const user = data.users.find(item => item.id === userId);
  const customer = data.customers.find(item => item.id === (order?.customerId || user?.customerId));
  fail(customer && Number.isSafeInteger(customer.balanceCents) && customer.balanceCents >= 0, '余额账户异常，请联系管理员', 409);
  return customer;
}
function ledger(data, actor, customer, order, deltaCents, label) {
  (data.ledger ||= []).unshift({ id: randomUUID(), userId: null, customerId: customer.id, account: customer.name, deltaCents, afterCents: customer.balanceCents, source: order.id, admissionOrderId: order.id, label, at: now(), by: actor.name });
}
function refund(data, actor, application, order, reason) {
  fail(order.status !== 'passed', '已授予资格的考核不能直接退款，请另行处理资格与争议', 409);
  if (order.status === 'refunded') return;
  if (order.paidAt) {
    const customer = customerOf(data, application.userId, order);
    fail(Number.isSafeInteger(customer.balanceCents + order.feeCents), '退款后余额超出允许范围', 409);
    fail(!data.ledger.some(item => item.admissionOrderId === order.id && item.label === '考核退款'), '退款记录异常，请联系管理员核对', 409);
    customer.balanceCents += order.feeCents;
    ledger(data, actor, customer, order, order.feeCents, '考核退款');
    order.refundedCents = order.feeCents;
    order.refundedAt = now();
    order.status = 'refunded';
  } else order.status = 'cancelled';
  order.cancelReason = reason;
  if (order.dispute?.status === 'pending') order.dispute = { ...order.dispute, status: 'resolved', decision: 'refund', reviewNote: reason, resolvedAt: now(), resolvedBy: actor.id };
  order.updatedAt = now();
  order.version += 1;
  application.status = order.status;
  application.closedAt = now();
  appendHistory(application, actor, order.paidAt ? '考核全额退款' : '取消考核订单', reason);
}

export function admissionSnapshot(data, actor) {
  actor = actorOf(data, actor);
  const settings = data.admissionSettings || [];
  const applications = (data.admissionApplications || []).filter(item => canRead(item, actor));
  const ids = new Set(applications.map(item => item.id));
  const games = catalogList(data).filter(item => !['下架', '停用', '禁用'].includes(item.state)).map(game => {
    const config = settings.find(item => item.game === game.name);
    const examiners = availableExaminers(data, game.name, config).map(user => ({ id: user.id, name: user.name, games: user.games || [] }));
    const level = data.levels.find(item => item.id === config?.levelId);
    const orderable = Boolean(config?.enabled && Number.isSafeInteger(config.feeCents) && config.feeCents > 0 && config.description && level && Number.isInteger(level.shareBps) && level.shareBps >= 0 && level.shareBps <= 10000 && config.examinerIds?.length);
    return { game: game.name, name: game.name, version: config?.version || 0, enabled: Boolean(config?.enabled), feeCents: config?.feeCents ?? null, description: config?.description || '', instructions: config?.description || '', levelId: config?.levelId || '', levelName: level?.name || '', examinerIds: config?.examinerIds || [], examiners, orderable, payable: orderable && Boolean(examiners.length) };
  });
  const customer = data.customers.find(item => item.id === actor.customerId);
  return structuredClone({ withdrawalMinDepositCents: MIN_WITHDRAWAL_DEPOSIT_CENTS, canApply: applicants.has(actor.role) && !actor.escortFrozen, eligible: applicants.has(actor.role) && !actor.escortFrozen, role: actor.role, userId: actor.id, balanceCents: customer?.balanceCents || 0, walletBalanceCents: customer?.balanceCents || 0, verified: isRealNameVerified(actor), realNameVerified: isRealNameVerified(actor), games, config: games, configs: games, settings: games, levels: data.levels.map(({ id, name, shareBps }) => ({ id, name, ...(actor.role === 'admin' ? { shareBps } : {}) })), examiners: actor.role === 'admin' ? data.users.filter(item => item.role === 'examiner').map(({ id, name, active, games }) => ({ id, name, active, games })) : [], applications, orders: (data.admissionOrders || []).filter(item => ids.has(item.applicationId)), conversations: (data.admissionConversations || []).filter(item => ids.has(item.applicationId)) });
}

export function saveAdmissionConfig(data, actor, input = {}) {
  actor = actorOf(data, actor); admin(actor);
  migrateAdmissions(data);
  const game = availableGame(data, input.game || input.gameId);
  const previous = settingOf(data, game);
  fail(Number.isSafeInteger(input.version) && input.version === (previous?.version || 0), '考核配置已更新，请刷新后重试', 409);
  fail(typeof input.enabled === 'boolean', '请选择是否开放付费考核');
  fail(input.feeCents === null && !input.enabled || Number.isSafeInteger(input.feeCents) && input.feeCents > 0 && input.feeCents <= 10000000, '考核费必须为 0.01 至 100000 元之间的整数分');
  const description = input.enabled ? text(input.description ?? input.instructions, '考核说明', 4000) : String(input.description ?? input.instructions ?? '').trim();
  fail(description.length <= 4000, '考核说明最多 4000 个字符');
  const level = data.levels.find(item => item.id === input.levelId);
  fail(level || !input.enabled && !input.levelId, '请选择有效的授予等级');
  fail(Array.isArray(input.examinerIds) && input.examinerIds.every(id => typeof id === 'string'), '请选择指定考官');
  const examinerIds = [...new Set(input.examinerIds)];
  fail(examinerIds.every(id => examinerEligible(data.users.find(user => user.id === id), game)), '指定考官不存在、已停用或不具备该游戏考核范围');
  fail(!input.enabled || examinerIds.length > 0, '开放收费前必须指定至少一位考官');
  const config = { game, enabled: input.enabled, feeCents: input.feeCents, description, levelId: level?.id || '', examinerIds, version: (previous?.version || 0) + 1, updatedAt: now(), updatedBy: actor.id };
  if (previous) Object.assign(previous, config); else data.admissionSettings.push(config);
  return structuredClone(config);
}

export function openAdmission(data, actor, input = {}) {
  actor = actorOf(data, actor); applicant(actor);
  migrateAdmissions(data);
  const game = availableGame(data, input.game || input.gameId);
  const existing = data.admissionApplications.find(item => item.userId === actor.id && (!terminal.has(item.status) || data.admissionOrders.some(order => order.applicationId === item.id && order.dispute?.status === 'pending')));
  if (existing) {
    fail(existing.game === game && (!input.examinerId || existing.examinerId === input.examinerId), '已有进行中的考核申请，请先完成或取消后再申请', 409);
    return structuredClone(existing);
  }
  const examiner = availableExaminers(data, game).find(user => user.id === input.examinerId);
  fail(examiner && examiner.id !== actor.id, '当前考官不可接待，请选择可用考官', 409);
  const application = { id: `AA${randomUUID()}`, userId: actor.id, userName: actor.name, memberNo: actor.memberNo || '', game, examinerId: examiner.id, examinerName: examiner.name, status: 'consulting', orderId: null, createdAt: now(), updatedAt: now(), version: 1, history: [] };
  const conversation = { id: `AC${randomUUID()}`, type: 'assessment', applicationId: application.id, userId: actor.id, examinerId: examiner.id, game, messages: [], createdAt: now(), updatedAt: now(), version: 1 };
  application.conversationId = conversation.id;
  data.admissionApplications.unshift(application);
  data.admissionConversations.unshift(conversation);
  return structuredClone(application);
}

// Confirmation creates the order and dispatches its examiner in one transaction.
// Booking is agreed with that examiner afterwards, independently of payment.
export function placeAdmissionOrder(data, actor, input = {}) {
  actor = actorOf(data, actor); applicant(actor); migrateAdmissions(data);
  const game = availableGame(data, input.game || input.gameId);
  fail(input.acceptStandards === true, '请先确认所选游戏的考核标准和费用');
  fail(typeof input.requestId === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(input.requestId), '提交标识无效，请刷新后重试');
  const repeated = data.admissionOrders.find(item => item.userId === actor.id && item.clientRequestId === input.requestId);
  if (repeated) { fail(repeated.game === game, '提交内容已变化，请重新确认', 409); return structuredClone(repeated); }
  let application = data.admissionApplications.find(item => item.userId === actor.id && (!terminal.has(item.status) || data.admissionOrders.some(order => order.applicationId === item.id && order.dispute?.status === 'pending')));
  if (application) {
    fail(application.game === game, '已有进行中的考核订单，请先完成或取消后再申请', 409);
    if (application.orderId) return structuredClone(orderOf(data, application, application.orderId));
    fail(application.status === 'consulting', '当前申请不可下单', 409);
  }
  const { config, level } = feeConfig(data, game, null, true);
  fail(input.configVersion === config.version, '考核费用或标准已变更，请刷新确认后再下单', 409);
  const customer = customerOf(data, actor.id);
  const examiner = application && availableExaminers(data, game).find(item => item.id === application.examinerId) || selectExaminer(data, game);
  const at = now();
  if (!application) {
    application = { id: `AA${randomUUID()}`, userId: actor.id, userName: actor.name, memberNo: actor.memberNo || '', game, status: 'unpaid', createdAt: at, updatedAt: at, version: 1, history: [] };
    const conversation = { id: `AC${randomUUID()}`, type: 'assessment', applicationId: application.id, userId: actor.id, examinerId: examiner?.id || null, game, messages: [], createdAt: at, updatedAt: at, version: 1 };
    application.conversationId = conversation.id;
    data.admissionApplications.unshift(application);
    data.admissionConversations.unshift(conversation);
  }
  Object.assign(application, { examinerId: examiner?.id || null, examinerName: examiner?.name || '', assignedAt: examiner ? at : null, status: 'unpaid' });
  const conversation = data.admissionConversations.find(item => item.id === application.conversationId);
  if (conversation && conversation.examinerId !== application.examinerId) { conversation.examinerId = application.examinerId; conversation.version += 1; }
  const order = { id: `AO${randomUUID()}`, applicationId: application.id, userId: actor.id, userName: actor.name, customerId: customer.id, game, examinerId: application.examinerId, examinerName: application.examinerName, assignedAt: application.assignedAt, flow: 'orderFirst', clientRequestId: input.requestId, standardsAcceptedAt: at, status: 'unpaid', feeCents: config.feeCents, amountCents: config.feeCents, description: config.description, levelId: level.id, levelName: level.name, shareBps: level.shareBps, configVersion: config.version, appointmentAt: null, createdAt: at, updatedAt: at, version: 1, reviews: [], refundedCents: 0 };
  data.admissionOrders.unshift(order);
  application.orderId = order.id;
  appendHistory(application, actor, '确认标准并创建考核订单');
  appendHistory(application, { id: 'system', name: '系统' }, examiner ? '自动分配考官' : '等待分配考官', examiner ? `${examiner.name} 将联系申请人确认考核时间。` : '已通知管理员安排该游戏的考官。');
  return structuredClone(order);
}

export function admissionMessage(data, actor, id, input = {}) {
  actor = actorOf(data, actor); migrateAdmissions(data);
  const conversation = data.admissionConversations.find(item => item.id === id);
  fail(conversation, '考核会话不存在', 404);
  const application = applicationOf(data, actor, conversation.applicationId);
  fail(actor.id === application.userId || actor.role === 'admin' || examinerEligible(actor, application.game), '当前考官不可发送消息', 403);
  const message = { id: randomUUID(), text: text(input.text, '消息'), authorId: actor.id, author: actor.name, at: now() };
  conversation.messages.push(message);
  conversation.updatedAt = message.at;
  conversation.version += 1;
  const order = data.admissionOrders.find(item => item.id === application.orderId);
  if (order?.flow === 'orderFirst' && actor.id === application.examinerId && !order.contactedAt && !terminal.has(order.status)) {
    order.contactedAt = message.at; order.updatedAt = message.at; order.version += 1;
    appendHistory(application, actor, '考官已联系申请人');
  }
  return structuredClone(conversation);
}

export function createAdmissionOrder(data, actor, id, input = {}) {
  actor = actorOf(data, actor); migrateAdmissions(data);
  const application = applicationOf(data, actor, id);
  const target = data.users.find(user => user.id === application.userId);
  fail(target?.active, '申请账号已停用', 409); applicant(target);
  if (actor.id !== application.userId) requireExaminer(data, application, actor);
  if (application.orderId) {
    const existing = orderOf(data, application, application.orderId);
    if (existing.status === 'unpaid') return structuredClone(existing);
    fail(false, '此申请已有考核订单，请刷新后查看', 409);
  }
  version(application, input);
  fail(application.status === 'consulting', '当前申请状态不可创建订单', 409);
  const { config, level } = feeConfig(data, application.game, application.examinerId);
  fail(input.configVersion === config.version, '考核费用或标准已变更，请刷新确认后再下单', 409);
  fail(typeof input.appointmentAt === 'string' && Number.isFinite(Date.parse(input.appointmentAt)) && Date.parse(input.appointmentAt) > Date.now() && Date.parse(input.appointmentAt) < Date.now() + 90 * 86400000, '请选择未来 90 天内的考核预约时间');
  const appointmentAt = new Date(input.appointmentAt).toISOString();
  const customer = customerOf(data, application.userId);
  const order = { id: `AO${randomUUID()}`, applicationId: id, userId: application.userId, userName: target.name, customerId: customer.id, game: application.game, examinerId: application.examinerId, examinerName: application.examinerName, status: 'unpaid', feeCents: config.feeCents, amountCents: config.feeCents, description: config.description, levelId: level.id, levelName: level.name, shareBps: level.shareBps, configVersion: config.version, appointmentAt, createdAt: now(), updatedAt: now(), version: 1, reviews: [], refundedCents: 0 };
  data.admissionOrders.unshift(order);
  application.orderId = order.id;
  application.status = 'unpaid';
  appendHistory(application, actor, '创建考核订单');
  return structuredClone(order);
}

export function admissionAction(data, actor, id, input = {}) {
  actor = actorOf(data, actor); migrateAdmissions(data);
  const referencedOrder = data.admissionOrders.find(item => item.id === id);
  const application = applicationOf(data, actor, referencedOrder?.applicationId || id);
  const order = application.orderId ? orderOf(data, application, application.orderId) : null;
  const action = ({ requestReview: 'dispute', resolveReview: 'resolveDispute', close: 'cancel' })[input.action] || input.action;
  if (action === 'message') return admissionMessage(data, actor, application.conversationId, input);
  if (action === 'reassign') {
    admin(actor); version(application, input);
    fail(!terminal.has(application.status), '已结束的申请不能转派', 409);
    const reason = text(input.reason, '转派原因');
    const examiner = availableExaminers(data, application.game).find(user => user.id === input.examinerId);
    fail(examiner && examiner.id !== application.userId, '请选择有权考核该游戏的可用考官', 409);
    fail(examiner.id !== application.examinerId, '该考官已负责此订单', 409);
    application.examinerId = examiner.id; application.examinerName = examiner.name; application.assignedAt = now();
    const conversation = data.admissionConversations.find(item => item.id === application.conversationId);
    if (conversation) { conversation.examinerId = examiner.id; conversation.version += 1; }
    if (order) { order.examinerId = examiner.id; order.examinerName = examiner.name; order.assignedAt = application.assignedAt; if (order.flow === 'orderFirst' && ['unpaid', 'pending'].includes(order.status)) { order.appointmentAt = null; order.contactedAt = null; } order.version += 1; order.updatedAt = now(); }
    appendHistory(application, actor, '重新分派考官', reason);
    return structuredClone(application);
  }
  if (action === 'cancel' && !order) {
    fail(actor.id === application.userId || actor.role === 'admin', '无权取消此申请', 403);
    if (application.status === 'cancelled') return structuredClone(application);
    version(application, input);
    fail(application.status === 'consulting', '当前状态不能取消', 409);
    application.status = 'cancelled'; application.closedAt = now();
    appendHistory(application, actor, '取消考核申请', text(input.reason, '取消原因'));
    return structuredClone(application);
  }
  fail(order, '请先创建考核订单', 409);
  if (action === 'pay') {
    fail(actor.id === application.userId, '仅申请人本人可以支付', 403);
    if (order.paidAt) return structuredClone(order);
    applicant(actor); fail(isRealNameVerified(actor), '请先完成实名认证并等待审核通过', 403);
    version(order, input);
    fail(order.status === 'unpaid', '此订单不可支付', 409);
    fail(input.acceptTerms === true || input.acceptedTerms === true, '请确认考核费用、标准及未通过不自动退款的约定');
    fail(input.configVersion === order.configVersion, '请刷新并确认考核订单费用和标准', 409);
    const { config } = feeConfig(data, application.game, application.examinerId, order.flow === 'orderFirst');
    fail(config.version === order.configVersion, '考核配置已变更，请取消旧订单后重新申请', 409);
    fail(order.flow === 'orderFirst' || Date.parse(order.appointmentAt) > Date.now(), '预约时间已过，请取消后重新预约', 409);
    fail(actor.customerId === order.customerId, '付款账户已变化，请取消旧订单后重新申请', 409);
    const customer = customerOf(data, actor.id, order);
    fail(customer.active !== false, '余额账户已停用', 409);
    fail(customer.balanceCents >= order.feeCents, '账户余额不足，请先充值', 409);
    fail(!data.ledger.some(item => item.admissionOrderId === order.id && item.label === '考核支付'), '支付记录异常，请联系管理员核对', 409);
    customer.balanceCents -= order.feeCents;
    ledger(data, actor, customer, order, -order.feeCents, '考核支付');
    Object.assign(order, { status: 'pending', paidAt: now(), termsAcceptedAt: now(), paymentSource: 'wallet' });
    application.status = 'pending';
    appendHistory(application, actor, '余额支付考核费');
  } else if (action === 'schedule') {
    requireExaminer(data, application, actor); version(order, input);
    fail(['unpaid', 'pending'].includes(order.status), '仅待支付或待考核的订单可安排时间', 409);
    fail(examinerEligible(data.users.find(item => item.id === application.examinerId), application.game), '请先分配可用考官', 409);
    fail(input.confirmed === true, '请先与申请人确认考核时间');
    const appointmentAt = appointmentTime(input.appointmentAt);
    order.appointmentAt = appointmentAt; order.scheduledBy = actor.id; order.scheduledAt = now();
    appendHistory(application, actor, '确认考核时间', new Date(appointmentAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) + '（北京时间）');
  } else if (action === 'cancel' || action === 'refund') {
    fail(actor.id === application.userId || actor.role === 'admin', '无权退款或取消此订单', 403);
    if (['refunded', 'cancelled'].includes(order.status)) return structuredClone(order);
    if (action === 'refund') admin(actor);
    version(order, input);
    fail(actor.role === 'admin' ? ['unpaid', 'pending', 'inProgress', 'recheck', 'failed'].includes(order.status) : ['unpaid', 'pending'].includes(order.status), '考核已经开始，请提交争议由管理员处理', 409);
    refund(data, actor, application, order, text(input.reason, '取消或退款原因'));
    return structuredClone(order);
  } else if (action === 'dispute') {
    fail(actor.id === application.userId, '仅申请人可以提交争议', 403);
    if (order.dispute?.status === 'pending') return structuredClone(order);
    version(order, input);
    fail(['inProgress', 'recheck', 'failed'].includes(order.status), '当前状态无需提交争议', 409);
    fail(!data.admissionApplications.some(item => item.userId === application.userId && item.id !== application.id && !terminal.has(item.status)), '已有新的进行中申请，请先完成或取消后再申请历史考核复核', 409);
    order.dispute = { status: 'pending', reason: text(input.reason, '争议原因'), createdAt: now() };
    appendHistory(application, actor, '申请考核争议复核', order.dispute.reason);
  } else if (action === 'resolveDispute') {
    admin(actor); version(order, input);
    fail(order.dispute?.status === 'pending', '没有待处理的考核争议', 409);
    fail(['refund', 'reject', 'recheck'].includes(input.decision), '请选择争议处理结果');
    const reason = text(input.reason, '争议处理说明');
    if (input.decision === 'refund') {
      refund(data, actor, application, order, reason);
    } else if (input.decision === 'recheck') {
      fail(['inProgress', 'recheck', 'failed'].includes(order.status), '当前状态不能安排复核', 409);
      fail(!data.admissionApplications.some(item => item.userId === application.userId && item.id !== application.id && !terminal.has(item.status)), '申请人已有其他进行中的考核，请先处理后再复核', 409);
      order.status = 'recheck'; application.status = 'recheck'; delete application.closedAt;
      appendHistory(application, actor, '争议转考核复核', reason);
    } else appendHistory(application, actor, '驳回考核争议', reason);
    order.dispute = { ...order.dispute, status: 'resolved', decision: input.decision, reviewNote: reason, resolvedAt: now(), resolvedBy: actor.id };
  } else if (action === 'start') {
    requireExaminer(data, application, actor); version(order, input);
    fail(order.status === 'pending' && order.paidAt, '只有已支付待考核的订单可以开始考核', 409);
    fail(!order.dispute || order.dispute.status !== 'pending', '请先处理待审核的考核争议', 409);
    fail(examinerEligible(data.users.find(item => item.id === application.examinerId), application.game), '指定考官已停用，请管理员重新分派', 409);
    fail(Number.isFinite(Date.parse(order.appointmentAt)), '请先联系申请人并确认考核时间', 409);
    order.status = 'inProgress'; order.startedAt = now(); application.status = 'inProgress';
    appendHistory(application, actor, '开始考核');
  } else if (action === 'review') {
    requireExaminer(data, application, actor); version(order, input);
    fail(['inProgress', 'recheck'].includes(order.status) && order.paidAt && order.startedAt, '请先支付并开始考核，再提交结果', 409);
    fail(order.dispute?.status !== 'pending', '该订单正在争议处理中，请管理员先处理', 409);
    const reviewResult = ({ passed: 'pass', failed: 'fail' })[input.result] || input.result;
    fail(['pass', 'fail', 'recheck'].includes(reviewResult), '请选择通过、不通过或待复核');
    fail(Number.isInteger(input.score) && input.score >= 0 && input.score <= 100, '评分必须是 0 至 100 的整数');
    const notes = text(input.notes ?? input.reason, '考核结论说明');
    const evidence = text(input.evidence, '考核证据', 4000);
    if (reviewResult === 'pass') {
      const target = data.users.find(user => user.id === application.userId);
      fail(target?.active && !target.escortFrozen && applicants.has(target.role), '申请人身份或账号状态已变化，不能授予打手资格', 409);
      fail(target.id !== actor.id, '不允许审核自己的申请', 403);
      fail(isRealNameVerified(target), '申请人必须通过实名认证后才能取得打手资格', 403);
      fail(data.levels.some(item => item.id === order.levelId), '订单授予等级已失效，请管理员处理', 409);
      availableGame(data, application.game);
      Object.assign(target, { role: 'escort', games: [application.game], levelId: order.levelId, shareBps: order.shareBps, online: false, memberVersion: (target.memberVersion || 0) + 1 });
      // New qualifications use the club's normal game/level commission rules.
      delete target.commissionBps;
      order.grantedAt = now(); order.grantedBy = actor.id;
    }
    const result = { result: reviewResult, score: input.score, notes, evidence, examinerId: actor.id, examinerName: actor.name, at: now() };
    order.reviews.push(result); order.result = result;
    order.status = reviewResult === 'pass' ? 'passed' : reviewResult === 'fail' ? 'failed' : 'recheck';
    application.status = order.status;
    if (terminal.has(order.status)) application.closedAt = now();
    appendHistory(application, actor, reviewResult === 'pass' ? '考核通过并授予打手资格' : reviewResult === 'fail' ? '考核不通过' : '考核待复核', notes);
  } else fail(false, '不支持的考核操作');
  order.updatedAt = now(); order.version += 1;
  return structuredClone(order);
}
