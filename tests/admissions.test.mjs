import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateAdmissions, admissionSnapshot, saveAdmissionConfig, openAdmission, placeAdmissionOrder, createAdmissionOrder, admissionAction, admissionMessage } from '../server/admissions.mjs';
import { ClubStore } from '../server/club.mjs';

function fixture() {
  const users = [
    { id: 'admin', name: '管理员', role: 'admin' },
    { id: 'examiner', name: '本游戏考官', role: 'examiner', games: ['测试游戏'] },
    { id: 'replacement', name: '替补考官', role: 'examiner', games: ['测试游戏'] },
    { id: 'otherExaminer', name: '其他游戏考官', role: 'examiner', games: ['其他游戏'] },
    { id: 'buyer', name: '申请人', role: 'user', customerId: 'wallet', games: ['未经考核游戏'], balanceCents: 0, memberVersion: 3 },
    { id: 'stranger', name: '其他用户', role: 'user', customerId: 'other-wallet' },
    { id: 'service', name: '客服', role: 'service' },
    { id: 'escort', name: '已有打手', role: 'escort' },
  ].map(user => ({ active: true, online: false, games: [], realNameVerification: { status: 'verified' }, ...user }));
  const data = { users, levels: [{ id: 'gold', name: '金牌', shareBps: 7000 }, { id: 'star', name: '明星', shareBps: 8500 }], catalogGames: [{ name: '测试游戏', state: '上架' }, { name: '其他游戏', state: '上架' }], customers: [{ id: 'wallet', name: '申请人', balanceCents: 10000, active: true }, { id: 'other-wallet', name: '其他用户', balanceCents: 10000, active: true }], ledger: [], orders: [] };
  migrateAdmissions(data);
  const actor = id => users.find(user => user.id === id);
  const configure = (overrides = {}) => saveAdmissionConfig(data, actor('admin'), { game: '测试游戏', enabled: true, feeCents: 2000, description: '预约实战考核，技术和沟通综合评分，未通过不自动退款。', levelId: 'gold', examinerIds: ['examiner', 'replacement'], version: data.admissionSettings[0]?.version || 0, ...overrides });
  const apply = () => openAdmission(data, actor('buyer'), { game: '测试游戏', examinerId: 'examiner' });
  const currentApplication = id => data.admissionApplications.find(item => item.id === id);
  const currentOrder = id => data.admissionOrders.find(item => item.id === id);
  const order = application => createAdmissionOrder(data, actor('buyer'), application.id, { version: currentApplication(application.id).version, configVersion: data.admissionSettings[0]?.version, appointmentAt: new Date(Date.now() + 86400000).toISOString() });
  const action = (who, order, action, input = {}) => admissionAction(data, actor(who), order.id, { version: currentOrder(order.id).version, action, ...input });
  const pay = order => action('buyer', order, 'pay', { acceptTerms: true, configVersion: currentOrder(order.id).configVersion });
  const paid = () => { configure(); const application = apply(); const created = order(application); pay(created); return { application, order: currentOrder(created.id) }; };
  const review = (order, result = 'pass') => action('examiner', order, 'review', { result, score: 85, notes: '技术和沟通均达到当前考核要求', evidence: '录像编号 T-001：完整实战及语音表现' });
  return { data, actor, configure, apply, order, currentApplication, currentOrder, action, pay, paid, review };
}

const orderInput = (overrides = {}) => ({ game: '测试游戏', configVersion: 1, acceptStandards: true, requestId: 'test-order-request-0001', ...overrides });

test('confirming standards creates an unpaid order and selects an eligible examiner without a booking', () => {
  const f = fixture(); f.configure();
  const before = structuredClone(f.data);
  for (const input of [{ acceptStandards: false }, { configVersion: 0 }, { requestId: '' }, { game: '其他游戏' }]) {
    assert.throws(() => placeAdmissionOrder(f.data, f.actor('buyer'), orderInput(input)));
    assert.deepEqual(f.data, before);
  }
  const order = placeAdmissionOrder(f.data, f.actor('buyer'), orderInput({ examinerId: 'otherExaminer', feeCents: 1, appointmentAt: 'invalid' }));
  assert.equal(order.examinerId, 'examiner');
  assert.equal(order.appointmentAt, null);
  assert.equal(order.status, 'unpaid');
  assert.equal(order.feeCents, 2000);
  assert.equal(order.description, f.data.admissionSettings[0].description);
  assert.ok(order.standardsAcceptedAt);
  assert.equal(f.data.customers[0].balanceCents, 10000);
  assert.equal(f.data.ledger.length, 0);
  assert.equal(f.data.admissionConversations[0].examinerId, order.examinerId);
  assert.equal(placeAdmissionOrder(f.data, f.actor('buyer'), orderInput()).id, order.id);
  assert.equal(placeAdmissionOrder(f.data, f.actor('buyer'), orderInput({ requestId: 'another-request-0001' })).id, order.id);
  assert.equal(f.data.admissionOrders.length, 1);
  const second = placeAdmissionOrder(f.data, f.actor('stranger'), orderInput());
  assert.equal(second.examinerId, 'replacement');
  assert.equal(admissionSnapshot(f.data, f.actor('examiner')).orders.length, 1);
});

test('orders with no active examiner wait for admin dispatch and can be cancelled with a full refund', () => {
  const f = fixture(); f.configure();
  f.actor('examiner').active = false; f.actor('replacement').active = false;
  const config = admissionSnapshot(f.data, f.actor('buyer')).games[0];
  assert.equal(config.orderable, true); assert.equal(config.payable, false);
  const order = placeAdmissionOrder(f.data, f.actor('buyer'), orderInput());
  assert.equal(order.examinerId, null);
  assert.equal(f.data.admissionConversations[0].examinerId, null);
  assert.equal(admissionSnapshot(f.data, f.actor('otherExaminer')).orders.length, 0);
  f.pay(order);
  assert.throws(() => f.action('admin', order, 'schedule', { confirmed: true, appointmentAt: new Date(Date.now() + 86400000).toISOString() }), { status: 409 });
  f.action('buyer', order, 'cancel', { reason: '取消待安排的订单' });
  assert.equal(f.data.customers[0].balanceCents, 10000);
  assert.equal(placeAdmissionOrder(f.data, f.actor('buyer'), orderInput()).id, order.id);
  assert.equal(f.data.admissionOrders.length, 1);
});

test('assigned examiner contacts and schedules before assessment; reassignment revokes access and resets booking', () => {
  const f = fixture(); f.configure();
  const order = placeAdmissionOrder(f.data, f.actor('buyer'), orderInput());
  f.pay(order);
  assert.throws(() => f.action('examiner', order, 'start'), { status: 409 });
  const app = f.currentApplication(order.applicationId);
  admissionMessage(f.data, f.actor('examiner'), app.conversationId, { text: '你好，请确认方便考核的时间。' });
  assert.ok(f.currentOrder(order.id).contactedAt);
  const time = new Date(Date.now() + 86400000).toISOString();
  assert.throws(() => f.action('buyer', order, 'schedule', { confirmed: true, appointmentAt: time }), { status: 403 });
  assert.throws(() => f.action('replacement', order, 'schedule', { confirmed: true, appointmentAt: time }), { status: 404 });
  assert.throws(() => f.action('examiner', order, 'schedule', { confirmed: false, appointmentAt: time }), { status: 400 });
  assert.throws(() => f.action('examiner', order, 'schedule', { confirmed: true, appointmentAt: new Date(Date.now() - 1).toISOString() }), { status: 400 });
  f.action('examiner', order, 'schedule', { confirmed: true, appointmentAt: time });
  assert.equal(f.currentOrder(order.id).appointmentAt, time);
  admissionAction(f.data, f.actor('admin'), app.id, { action: 'reassign', version: app.version, examinerId: 'replacement', reason: '考官调整' });
  assert.equal(f.currentOrder(order.id).appointmentAt, null);
  assert.equal(f.currentOrder(order.id).contactedAt, null);
  assert.throws(() => admissionMessage(f.data, f.actor('examiner'), app.conversationId, { text: '旧考官' }), { status: 404 });
  f.action('replacement', order, 'schedule', { confirmed: true, appointmentAt: time });
  f.action('replacement', order, 'start');
  f.action('replacement', order, 'review', { result: 'pass', score: 90, notes: '达到标准', evidence: '录像 A-1' });
  assert.equal(f.actor('buyer').role, 'escort');
});

test('existing consultations convert to order-first flow without losing messages', () => {
  const f = fixture(); f.configure(); const app = f.apply();
  admissionMessage(f.data, f.actor('buyer'), app.conversationId, { text: '已有咨询' });
  const order = placeAdmissionOrder(f.data, f.actor('buyer'), orderInput());
  assert.equal(order.applicationId, app.id);
  assert.equal(order.flow, 'orderFirst');
  assert.equal(f.data.admissionApplications.length, 1);
  assert.equal(f.data.admissionConversations[0].messages[0].text, '已有咨询');
});

test('unconfigured admissions allow private empty consultations but cannot charge', () => {
  const f = fixture();
  assert.equal(f.data.admissionSettings.length, 0);
  f.actor('buyer').realNameVerification.status = 'unverified';
  const application = f.apply();
  assert.equal(f.data.admissionConversations[0].messages.length, 0);
  assert.equal(f.data.admissionConversations[0].type, 'assessment');
  assert.equal(admissionSnapshot(f.data, f.actor('buyer')).games[0].payable, false);
  assert.throws(() => f.order(application), { status: 409 });
  assert.equal(f.data.customers[0].balanceCents, 10000);
  assert.equal(f.data.admissionOrders.length, 0);
  const repeated = f.apply();
  assert.equal(repeated.id, application.id);
  assert.equal(f.data.admissionApplications.length, 1);
});

test('configuration needs admin, cents, real level, assigned available examiner, and exact version', () => {
  const f = fixture();
  assert.throws(() => saveAdmissionConfig(f.data, f.actor('examiner'), {}), { status: 403 });
  for (const input of [{ feeCents: 1.1 }, { feeCents: 0 }, { feeCents: -1 }, { feeCents: 1e15 }, { examinerIds: [] }, { examinerIds: ['otherExaminer'] }, { levelId: 'invented' }, { description: '' }]) assert.throws(() => f.configure(input), { status: 400 });
  assert.equal(f.data.admissionSettings.length, 0);
  f.configure();
  assert.throws(() => f.configure({ version: 0 }), { status: 409 });
  assert.equal(admissionSnapshot(f.data, f.actor('buyer')).games[0].payable, true);
});

test('only eligible applicants may apply and active applications cannot be duplicated across games', () => {
  const f = fixture();
  for (const role of ['service', 'admin', 'examiner', 'escort']) assert.throws(() => openAdmission(f.data, f.actor(role), { game: '测试游戏', examinerId: 'examiner' }), { status: 403 });
  f.actor('buyer').escortFrozen = true;
  assert.throws(() => f.apply(), { status: 403 });
  f.actor('buyer').escortFrozen = false;
  f.apply();
  assert.throws(() => openAdmission(f.data, f.actor('buyer'), { game: '其他游戏', examinerId: 'otherExaminer' }), { status: 409 });
  assert.throws(() => openAdmission(f.data, f.actor('stranger'), { game: '测试游戏', examinerId: 'otherExaminer' }), { status: 409 });
});

test('private messages and data are visible only to applicant, assigned examiner and admin', () => {
  const f = fixture(); const application = f.apply();
  admissionMessage(f.data, f.actor('buyer'), application.conversationId, { text: '预约咨询私人内容' });
  for (const id of ['service', 'stranger', 'replacement', 'otherExaminer']) {
    const view = admissionSnapshot(f.data, f.actor(id));
    assert.equal(view.applications.length, 0);
    assert.equal(view.conversations.length, 0);
    assert.throws(() => admissionMessage(f.data, f.actor(id), application.conversationId, { text: '越权' }), { status: 404 });
    assert.throws(() => createAdmissionOrder(f.data, f.actor(id), application.id, {}), { status: 404 });
  }
  for (const id of ['buyer', 'examiner', 'admin']) assert.equal(admissionSnapshot(f.data, f.actor(id)).conversations[0].messages[0].text, '预约咨询私人内容');
  // A returned projection must never permit direct changes to stored state.
  const view = admissionSnapshot(f.data, f.actor('buyer'));
  view.conversations[0].messages[0].text = 'tampered';
  assert.equal(f.data.admissionConversations[0].messages[0].text, '预约咨询私人内容');
});

test('orders lock server price and grading standards; changed quotes require a fresh order', () => {
  const f = fixture(); f.configure(); const application = f.apply();
  const created = createAdmissionOrder(f.data, f.actor('buyer'), application.id, { version: application.version, configVersion: 1, feeCents: 1, levelId: 'star', description: 'fake', status: 'passed', appointmentAt: new Date(Date.now() + 3600000).toISOString() });
  assert.equal(created.feeCents, 2000); assert.equal(created.levelId, 'gold'); assert.equal(created.status, 'unpaid');
  f.configure({ feeCents: 3000 });
  assert.equal(f.currentOrder(created.id).feeCents, 2000);
  assert.throws(() => f.pay(created), { status: 409 });
  assert.equal(f.data.customers[0].balanceCents, 10000);
  assert.equal(f.data.ledger.length, 0);
});

test('wallet payment enforces owner, verification, consent, balance and version; repeated payment charges once', () => {
  const f = fixture(); f.configure(); const application = f.apply(); const order = f.order(application);
  assert.throws(() => f.action('examiner', order, 'pay', { acceptTerms: true, configVersion: 1 }), { status: 403 });
  f.actor('buyer').realNameVerification.status = 'pending';
  assert.throws(() => f.pay(order), { status: 403 });
  f.actor('buyer').realNameVerification.status = 'verified';
  assert.throws(() => f.action('buyer', order, 'pay', { acceptTerms: false, configVersion: 1 }), { status: 400 });
  assert.throws(() => f.action('buyer', order, 'pay', { version: 0, acceptTerms: true, configVersion: 1 }), { status: 409 });
  f.data.customers[0].balanceCents = 1000;
  assert.throws(() => f.pay(order), { status: 409 });
  f.data.customers[0].balanceCents = 10000;
  f.pay(order);
  const replay = admissionAction(f.data, f.actor('buyer'), order.id, { action: 'pay', version: 1, acceptTerms: true, configVersion: 1 });
  assert.equal(replay.status, 'pending');
  assert.equal(f.data.customers[0].balanceCents, 8000);
  assert.equal(f.actor('buyer').balanceCents, 0);
  assert.equal(f.data.ledger.length, 1);
  assert.equal(f.data.ledger[0].customerId, 'wallet');
  assert.equal(f.data.ledger[0].userId, null);
  assert.equal(f.data.ledger[0].label, '考核支付');
  assert.equal(f.data.orders.length, 0);
});

test('cancel unpaid order does not refund uncollected money and can be repeated', () => {
  const f = fixture(); f.configure(); const application = f.apply(); const order = f.order(application);
  f.action('buyer', order, 'cancel', { reason: '改约' });
  f.action('buyer', order, 'cancel', { reason: '重复请求', version: 1 });
  assert.equal(f.currentOrder(order.id).status, 'cancelled');
  assert.equal(f.data.customers[0].balanceCents, 10000);
  assert.equal(f.data.ledger.length, 0);
  assert.throws(() => f.pay(order), { status: 409 });
  assert.notEqual(f.apply().id, application.id);
});

test('paid pre-start cancellation refunds original customer wallet exactly once', () => {
  const f = fixture(); const { application, order } = f.paid();
  f.action('buyer', order, 'cancel', { reason: '无法参加' });
  f.action('buyer', order, 'cancel', { version: 1, reason: 'duplicate' });
  f.action('admin', order, 'refund', { version: 1, reason: 'duplicate' });
  assert.equal(f.data.customers[0].balanceCents, 10000);
  assert.equal(f.currentOrder(order.id).refundedCents, 2000);
  assert.equal(f.data.ledger.filter(item => item.label === '考核退款').length, 1);
  assert.equal(f.data.ledger.reduce((sum, entry) => sum + entry.deltaCents, 0), 0);
  assert.equal(f.currentApplication(application.id).status, 'refunded');
  f.pay(order);
  assert.equal(f.data.customers[0].balanceCents, 10000);
  assert.notEqual(f.apply().id, application.id);
});

test('only assigned examiner can start after payment; disabled examiner can be reassigned without payment', () => {
  const f = fixture(); f.configure(); const application = f.apply(); const created = f.order(application);
  assert.throws(() => f.action('examiner', created, 'start'), { status: 409 });
  f.pay(created);
  assert.throws(() => f.action('buyer', created, 'start'), { status: 403 });
  assert.throws(() => f.action('replacement', created, 'start'), { status: 404 });
  f.actor('examiner').active = false;
  assert.throws(() => f.action('admin', created, 'start'), { status: 409 });
  admissionAction(f.data, f.actor('admin'), application.id, { action: 'reassign', version: f.currentApplication(application.id).version, examinerId: 'replacement', reason: '原考官停用，安排接替' });
  f.action('replacement', created, 'start');
  assert.equal(f.currentOrder(created.id).status, 'inProgress');
  assert.equal(f.data.customers[0].balanceCents, 8000);
  assert.equal(f.data.ledger.length, 1);
  f.actor('examiner').active = true;
  assert.equal(admissionSnapshot(f.data, f.actor('examiner')).applications.length, 0);
});

test('review requires started paid order, score and evidence; stale review cannot grant twice', () => {
  const f = fixture(); const { order } = f.paid();
  assert.throws(() => f.review(order), { status: 409 });
  f.action('examiner', order, 'start');
  for (const input of [{ score: 101 }, { score: 85.5 }, { evidence: '' }, { notes: '' }, { result: 'automatic' }]) assert.throws(() => f.action('examiner', order, 'review', { result: 'pass', score: 85, evidence: '录像', notes: '通过理由', ...input }), { status: 400 });
  f.review(order, 'recheck');
  assert.equal(f.actor('buyer').role, 'user');
  const previousVersion = f.currentOrder(order.id).version;
  f.review(order);
  assert.equal(f.actor('buyer').role, 'escort');
  assert.deepEqual(f.actor('buyer').games, ['测试游戏']);
  assert.equal(f.actor('buyer').levelId, 'gold');
  assert.equal(f.actor('buyer').shareBps, 7000);
  assert.equal(f.actor('buyer').online, false);
  assert.equal(f.actor('buyer').memberVersion, 4);
  assert.throws(() => f.action('examiner', order, 'review', { version: previousVersion, result: 'pass', score: 85, evidence: '录像', notes: '重复' }), { status: 409 });
  assert.equal(f.actor('buyer').memberVersion, 4);
  assert.throws(() => f.action('admin', order, 'refund', { reason: '不可直接撤销已授予资格' }), { status: 409 });
  assert.equal(admissionSnapshot(f.data, f.actor('buyer')).applications.length, 1);
  assert.equal(admissionSnapshot(f.data, f.actor('buyer')).canApply, false);
});

test('approval cannot promote staff, disabled/frozen people, or an applicant whose identity became unverified', () => {
  for (const change of [user => user.role = 'service', user => user.active = false, user => user.escortFrozen = true, user => user.realNameVerification.status = 'rejected']) {
    const f = fixture(); const { order } = f.paid(); f.action('examiner', order, 'start'); change(f.actor('buyer'));
    assert.throws(() => f.review(order), error => [403, 409].includes(error.status));
    assert.notEqual(f.actor('buyer').role, 'escort');
    assert.equal(f.currentOrder(order.id).status, 'inProgress');
    assert.equal(f.currentOrder(order.id).reviews.length, 0);
  }
});

test('in-progress cancellation uses admin dispute review and refunds once without granting qualification', () => {
  const f = fixture(); const { order } = f.paid(); f.action('examiner', order, 'start');
  assert.throws(() => f.action('buyer', order, 'cancel', { reason: '想退款' }), { status: 409 });
  assert.throws(() => f.action('examiner', order, 'refund', { reason: '越权' }), { status: 403 });
  f.action('buyer', order, 'dispute', { reason: '考官未按约定内容考核，申请退款' });
  assert.throws(() => f.review(order), { status: 409 });
  f.action('admin', order, 'resolveDispute', { decision: 'refund', reason: '核实未完成约定考核，退款' });
  assert.equal(f.currentOrder(order.id).status, 'refunded');
  assert.equal(f.currentOrder(order.id).dispute.status, 'resolved');
  assert.equal(f.data.customers[0].balanceCents, 10000);
  assert.equal(f.actor('buyer').role, 'user');
  f.action('admin', order, 'refund', { reason: '重复' });
  assert.equal(f.data.ledger.length, 2);
});

test('failed assessment stays paid and permits a fresh application, with admin-controlled appeal', () => {
  const f = fixture(); const { application, order } = f.paid(); f.action('examiner', order, 'start'); f.review(order, 'fail');
  assert.equal(f.data.customers[0].balanceCents, 8000);
  assert.equal(f.actor('buyer').role, 'user');
  f.action('buyer', order, 'dispute', { reason: '申请复核评分证据' });
  f.action('admin', order, 'resolveDispute', { decision: 'recheck', reason: '核实评分需复核' });
  assert.equal(f.currentApplication(application.id).status, 'recheck');
  f.review(order, 'fail');
  assert.notEqual(f.apply().id, application.id);
  assert.equal(f.data.ledger.filter(entry => entry.label === '考核支付').length, 1);
});

test('forged actor role and inactive sessions cannot bypass authorization', () => {
  const f = fixture();
  assert.throws(() => saveAdmissionConfig(f.data, { id: 'buyer', role: 'admin', active: true }, {}), { status: 403 });
  assert.throws(() => admissionSnapshot(f.data, { id: 'nonexistent', role: 'admin' }), { status: 403 });
  f.actor('buyer').active = false;
  assert.throws(() => admissionSnapshot(f.data, { id: 'buyer' }), { status: 403 });
});

test('database transaction integration rejects stale racing payments and refunds without double ledger entries', t => {
  const store = new ClubStore(':memory:');
  t.after(() => store.close());
  store.transaction({ id: 'admin' }, 'profile:update', '测试准备', data => {
    const buyer = data.users.find(user => user.id === 'demo-user');
    buyer.realNameVerification = { status: 'verified' };
    data.customers.find(item => item.id === buyer.customerId).balanceCents = 10000;
  });
  store.admissionMutation({ id: 'admin' }, 'config', null, { game: '三角洲行动', enabled: true, feeCents: 2000, description: '实战考核，未通过不自动退款', levelId: 'gold', examinerIds: ['demo-examiner'], version: 0 });
  const application = store.admissionMutation({ id: 'demo-user' }, 'apply', null, { game: '三角洲行动', examinerId: 'demo-examiner' });
  const order = store.admissionMutation({ id: 'demo-user' }, 'order', application.id, { version: application.version, configVersion: 1, appointmentAt: new Date(Date.now() + 86400000).toISOString() });
  const payment = { action: 'pay', version: order.version, configVersion: order.configVersion, acceptedTerms: true };
  for (let i = 0; i < 3; i++) store.admissionMutation({ id: 'demo-user' }, 'action', order.id, payment);
  assert.equal(store.admissions({ id: 'demo-user' }).balanceCents, 8000);
  assert.equal(store.read().ledger.filter(entry => entry.admissionOrderId === order.id && entry.label === '考核支付').length, 1);
  const paidOrder = store.admissions({ id: 'demo-user' }).orders[0];
  const cancel = { action: 'cancel', version: paidOrder.version, reason: '时间冲突，取消' };
  for (let i = 0; i < 3; i++) store.admissionMutation({ id: 'demo-user' }, 'action', order.id, cancel);
  assert.equal(store.admissions({ id: 'demo-user' }).balanceCents, 10000);
  assert.equal(store.read().ledger.filter(entry => entry.admissionOrderId === order.id).length, 2);
  assert.equal(store.admissions({ id: 'demo-service' }).orders.length, 0);
  assert.equal(store.admissions({ id: 'demo-service' }).conversations.length, 0);
});

test('open appeal blocks a duplicate active application and uses canonical UI action aliases', () => {
  const f = fixture(); const { application, order } = f.paid(); f.action('examiner', order, 'start');
  f.action('examiner', order, 'review', { result: 'failed', score: 50, notes: '沟通未达要求', evidence: '实战录像 T-002' });
  f.action('buyer', order, 'requestReview', { reason: '请重新核对录像' });
  assert.equal(f.apply().id, application.id);
  assert.throws(() => openAdmission(f.data, f.actor('buyer'), { game: '其他游戏', examinerId: 'otherExaminer' }), { status: 409 });
  f.action('admin', order, 'resolveReview', { decision: 'recheck', reason: '重新核查' });
  assert.equal(f.currentOrder(order.id).status, 'recheck');
});

test('direct admin refund resolves pending dispute and releases the active application lock', () => {
  const f = fixture(); const { application, order } = f.paid(); f.action('examiner', order, 'start');
  f.action('buyer', order, 'requestReview', { reason: '考核过程不符合说明' });
  f.action('admin', order, 'refund', { reason: '确认异常，全额退费' });
  assert.equal(f.currentOrder(order.id).dispute.status, 'resolved');
  assert.equal(f.currentOrder(order.id).dispute.decision, 'refund');
  assert.equal(f.currentOrder(order.id).dispute.reviewNote, '确认异常，全额退费');
  assert.notEqual(f.apply().id, application.id);
});

test('new attempt prevents reopening an old failed order until new attempt is closed', () => {
  const f = fixture(); const { order } = f.paid(); f.action('examiner', order, 'start'); f.review(order, 'fail');
  const retry = f.apply();
  assert.throws(() => f.action('buyer', order, 'requestReview', { reason: '复核旧申请' }), { status: 409 });
  admissionAction(f.data, f.actor('buyer'), retry.id, { action: 'close', version: retry.version, reason: '先复核原申请' });
  f.action('buyer', order, 'requestReview', { reason: '复核旧申请' });
  assert.equal(f.currentOrder(order.id).dispute.status, 'pending');
});
