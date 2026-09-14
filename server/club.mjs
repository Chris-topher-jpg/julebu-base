import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as seed from './seed.mjs';
import { personalContext, walletPayment, serviceOccupiesMember, settleOrder, reverseRefundEarnings } from './flow.mjs';
import { FOUR_HOURS, clubDay, metrics, dailyBusinessMetrics, dateRange, trend, ranking, analyticsOptions } from './analytics.mjs';
import { defaultLevels, defaultLevelPrices, priceOf, levelOf, meetsLevel, rateOf, hasOpenOrders, profileConflicts, migrateMembership, memberRecord, lockEarnings } from './membership.mjs';
import { isClubMember, attachCustomer, migrateIdentity, personalData } from './identity.mjs';
import { recordNotifications, notificationFeed } from './notifications.mjs';
import { conversationType, canManageConversation, escortConversation, escortUnread } from './conversations.mjs';
import { catalogList, catalogNames, visibleProducts } from './game-catalog.mjs';
import { buyerSelectionRequired, recruitmentOpen, matchesOrder, escortOrderView } from './order-matching.mjs';
import { realNameVerification, isRealNameVerified, requireRealName, migrateRealName, submitRealName, realNameRequests, reviewRealName } from './real-name.mjs';

export const roles = {
  user: { label: '用户', tone: 'blue', pages: ['overview', 'memberProfile', 'memberHome', 'placeOrder', 'memberOrders', 'memberAfterSales', 'memberWallet', 'realName'], permissions: ['profile:update', 'order:create', 'order:confirm', 'refund:create', 'conversation:create', 'topup:create'] },
  admin: { label: '最高负责人', tone: 'purple', pages: ['overview', 'clubConfig', 'auditLog', 'memberManagement', 'clubMembers', 'clubEscorts', 'serviceManagement', 'examinerManagement', 'afterSales', 'financeManagement', 'financeList', 'commissionConfig', 'orderManagement', 'orderList', 'transferOrders', 'dispatchOrders', 'userManagement', 'orders', 'dispatch', 'conversations', 'escorts', 'catalog', 'topups', 'flows', 'settlements', 'accounts'], permissions: ['profile:update', 'analytics:view', 'order:view', 'order:create', 'order:dispatch', 'order:review', 'refund:manage', 'conversation:manage', 'finance:manage', 'account:manage', 'assessment:view', 'assessment:manage'] },
  service: { label: '俱乐部客服', tone: 'orange', pages: ['overview', 'orders', 'conversations', 'dispatch'], permissions: ['profile:update', 'order:view', 'order:create', 'order:dispatch', 'order:review', 'conversation:manage'] },
  examiner: { label: '俱乐部考官', tone: 'blue', pages: ['overview', 'examinerCandidates'], permissions: ['profile:update', 'member:skills:view', 'assessment:view', 'assessment:manage'] },
  afterSales: { label: '俱乐部售后', tone: 'pink', pages: ['overview', 'orders', 'conversations'], permissions: ['profile:update', 'order:view', 'order:review', 'refund:manage', 'conversation:manage'] },
  finance: { label: '俱乐部财务', tone: 'purple', pages: ['overview', 'topups', 'flows', 'settlements'], permissions: ['profile:update', 'finance:manage', 'refund:manage'] },
  member: { label: '普通成员', tone: 'navy', pages: ['overview','memberProfile','memberHome','placeOrder','memberOrders','memberAfterSales','memberWallet','realName'], permissions: ['profile:update','order:create','order:confirm','refund:create','conversation:create','topup:create'] },
  escort: { label: '打手', tone: 'green', pages: ['overview', 'availableOrders', 'myOrders', 'myEarnings', 'conversations'], permissions: ['profile:update', 'order:accept', 'order:serve', 'withdrawal:create', 'conversation:manage'] },
};
roles.admin.pages.push('realNameReviews');
export function requireThat(condition, message, status = 400) {
  if (!condition) throw Object.assign(new Error(message), { status });
}
const now = () => new Date().toISOString();
const cents = value => Math.round(Number(String(value).replace(/[^\d.]/g, '')) * 100);
const amount = value => `¥ ${(value / 100).toFixed(2)}`;
// Delta Force offers one or two escorts per order. The two-escort service
// charges each escort's hourly rate, while the standard service charges one.
const escortCountOf = product => Number(product?.escortCount) === 2 || product?.name === '2陪1' ? 2 : 1;
const hashToken = token => createHash('sha256').update(token).digest('hex');
function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
function checkPassword(password, hash) {
  if (typeof password !== 'string' || password.length > 128) return false;
  if (typeof hash !== 'string') return false;
  const [salt, key] = hash.split(':');
  // Treat malformed persisted hashes as an authentication failure instead of
  // allowing timingSafeEqual to throw and turn a login attempt into HTTP 500.
  if (!salt || !key || !/^[0-9a-f]+$/i.test(key) || key.length % 2 !== 0) return false;
  let expected;
  try { expected = Buffer.from(passwordHash(password, salt).split(':')[1], 'hex'); } catch { return false; }
  const actual = Buffer.from(key, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function migrateDeltaProducts(data) {
  if (data.deploymentMode === 'production') return false;
  let changed = false;
  const delta = (data.products ||= []).filter(product => product.game === '三角洲行动');
  const standard = delta.find(product => product.name === '1陪1/1陪2') || delta.find(product => !['2陪1'].includes(product.name));
  if (standard) {
    if (standard.name !== '1陪1/1陪2') { standard.name = '1陪1/1陪2'; changed = true; }
    if (standard.escortCount !== 1 || standard.participantMin !== 1 || standard.participantMax !== 1) { Object.assign(standard, { escortCount: 1, participantMin: 1, participantMax: 1 }); changed = true; }
    if (!standard.note || standard.note === '按陪玩等级定价') { standard.note = '一位陪玩服务一至两位客户，按陪玩等级定价'; changed = true; }
  }
  if (!delta.some(product => product.name === '2陪1')) {
    data.products.push({ id: `product-${randomUUID()}`, name: '2陪1', game: '三角洲行动', unit: '小时', price: '¥ 116.00', priceCents: 11600, note: '两位陪玩同时服务一位客户，按两位陪玩费用计价', state: '启用', tone: 'green', escortCount: 2, participantMin: 2, participantMax: 2, version: 1 });
    changed = true;
  }
  const dual = data.products.find(product => product.game === '三角洲行动' && product.name === '2陪1');
  if (dual && (dual.escortCount !== 2 || dual.participantMin !== 2 || dual.participantMax !== 2)) { Object.assign(dual, { escortCount: 2, participantMin: 2, participantMax: 2 }); changed = true; }
  return changed;
}
function textInput(value, label, max = 100) {
  requireThat(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max, `${label}不能为空且最多 ${max} 个字符`);
  return value.trim();
}
const publicUser = user => ({ id: user.id, memberNo: user.memberNo, memberVersion: user.memberVersion, username: user.username, name: user.name, role: user.role, roleLabel: roles[user.role].label, tone: roles[user.role].tone, active: user.active, online: user.online, games: user.games, shareBps: user.shareBps, levelId: user.levelId, escortFrozen: Boolean(user.escortFrozen), examiner: Boolean(user.examiner), avatar: user.avatar || '', bio: user.bio || '', profileTags: Array.isArray(user.profileTags) ? user.profileTags : [], realNameVerification: realNameVerification(user) });
const publicConversation = chat => ({ ...chat, type:conversationType(chat), unread:chat.staffUnread ?? chat.unread ?? 0, slaOverdue: chat.state !== '已结束' && chat.slaDueAt ? Date.parse(chat.slaDueAt) <= Date.now() : false });
function managementConversation(data, chat) {
  const author = chat.userId ? data.users.find(user => user.id === chat.userId) : undefined;
  const order = chat.orderId ? data.orders.find(candidate => candidate.id === chat.orderId) : undefined;
  // Names are not identities: an unlinked consultation must stay unlinked,
  // even if this customer (or a namesake) already has other orders.
  const customerId = chat.customerId || author?.customerId || order?.customerId;
  const customer = customerId ? data.customers.find(candidate => candidate.id === customerId) : undefined;
  const account = customer ? data.users.find(user => user.customerId === customer.id) : (!chat.customerId ? author : undefined);
  return {
    ...publicConversation(chat),
    peer: {
      customerId: customer?.id || '', userId: account?.id || '',
      customerNo: account?.memberNo || customer?.customerNo || '',
      name: account?.name || customer?.name || chat.boss || '',
      username: account?.username || customer?.username || '', phone: customer?.phone || '',
    },
  };
}
export const can = (user, permission) => roles[user.role]?.permissions.includes(permission);
function permit(user, permission) { requireThat(can(user, permission), '你的职责没有此操作权限', 403); }

// Stable demo identities used for end-to-end testing. These accounts are
// intentionally separate from the original fixture accounts so existing
// sessions and test data remain untouched. All demo accounts use the same
// easy-to-remember password documented in README.md.
const demoAccounts = [
  { id: 'demo-admin', username: 'demo_admin', name: '测试管理员', role: 'admin', demoPassword: 'Test1234!' },
  { id: 'demo-service', username: 'demo_service', name: '测试客服', role: 'service', demoPassword: 'Test1234!' },
  { id: 'demo-finance', username: 'demo_finance', name: '测试财务', role: 'finance', demoPassword: 'Test1234!' },
  { id: 'demo-examiner', username: 'demo_examiner', name: '测试考官', role: 'examiner', demoPassword: 'Test1234!' },
  { id: 'demo-aftersales', username: 'demo_aftersales', name: '测试售后', role: 'afterSales', demoPassword: 'Test1234!' },
  { id: 'demo-escort', username: 'demo_escort', name: '测试陪玩', role: 'escort', games: ['王者荣耀', '和平精英'], online: true, shareBps: 7000, depositCents: 100000, demoPassword: 'Test1234!' },
  { id: 'demo-user', username: 'demo_user', name: '测试用户', role: 'user', balanceCents: 100000, demoPassword: 'Test1234!' },
];

function initialState() {
  const logins = ['escort', 'xiaoman', 'ajiu', 'qiqi', 'taotao'];
  const users = [
    { id: 'admin', username: 'admin', name: '杨澄', role: 'admin' },
    { id: 'service', username: 'service', name: '小林', role: 'service' },
    { id: 'finance', username: 'finance', name: '周财务', role: 'finance' },
    { id: 'examiner', username: 'examiner', name: '阿泽', role: 'examiner' },
    { id: 'afterSales', username: 'afterSales', name: '小许', role: 'afterSales' },
    { id: 'member-demo', externalUserId: 'customer-3', memberNo: 'U100003', username: 'member', name: '林先生', role: 'member' },
    { id: 'user-demo', username: 'user', name: '新用户', role: 'user', balanceCents: 100000 },
    ...demoAccounts,
    ...seed.escorts.map((e, i) => ({ id: logins[i], username: logins[i], name: e.name, role: 'escort', games: e.games.split(' · '), shareBps: parseInt(e.share) * 100 || 7000, online: ['在线', '陪玩中'].includes(e.state), active: e.state !== '待审核', depositCents: 100000, balanceCents: cents(e.balance) })),
  ].map(u => {
    const password = u.demoPassword || (['admin', 'service', 'finance', 'examiner', 'afterSales', 'escort', 'member', 'user'].includes(u.username) ? '123456' : randomBytes(24).toString('hex'));
    const { demoPassword, ...safeUser } = u;
    return { active: true, online: false, games: [], balanceCents: 0, frozenBalanceCents: 0, depositCents: 0, shareBps: 0, ...safeUser, passwordHash: passwordHash(password) };
  });
  const games = [...seed.games, { name: 'Apex', category: 'FPS', multiplier: '1.00x', min: 1, max: 3, state: '上架', tone: 'green' }, { name: '三角洲行动', category: 'FPS', multiplier: '1.00x', min: 1, max: 3, state: '上架', tone: 'green' }].map(g => ({ ...g, multiplierBps: Math.round(parseFloat(g.multiplier) * 10000), ...(Number.isInteger(g.commissionBps) ? { commissionBps: g.commissionBps } : {}) }));
    const products = [...seed.products,
      { name: '1陪1/1陪2', game: '三角洲行动', unit: '小时', price: '¥ 58', note: '一位陪玩服务一至两位客户，按陪玩等级定价', state: '启用', tone: 'green', escortCount: 1, participantMin: 1, participantMax: 1 },
      { name: '2陪1', game: '三角洲行动', unit: '小时', price: '¥ 116', note: '两位陪玩同时服务一位客户，按两位陪玩费用计价', state: '启用', tone: 'green', escortCount: 2, participantMin: 2, participantMax: 2 },
    ].map((p, i) => ({ ...p, id: `product-${i + 1}`, priceCents: cents(p.price) }));
  const time = Date.now();
  const orders = seed.orders.map((o, i) => {
    const names = o.escort.split(' / ');
    const participants = users.filter(u => names.includes(u.name)).map(u => {
      const finished = ['已完成', '待结算'].includes(o.status) || (o.status === '陪玩中' && u.id !== 'escort');
      return { userId: u.id, name: u.name, shareBps: names.length > 1 ? 3500 : u.shareBps, accepted: true, finished, evidence: finished ? '已完成约定服务，等待客服复核。' : '' };
    });
    return { id: o.id, boss: o.boss, game: o.game, product: o.product, hours: parseFloat(o.quantity), amountCents: cents(o.amount), pay: o.pay, status: o.status === '待结算' ? '待验收' : o.status, participants, requirement: '开麦沟通，按约定完成服务', createdAt: new Date(time - (i + 1) * 900000).toISOString(), startedAt: o.status === '陪玩中' ? new Date(time - 3600000).toISOString() : null, version: 1, tone: o.tone, history: [{ action: '示例订单导入', by: '系统', at: now() }] };
  });
  for (const [id, game, product, hours, price, boss, requirement] of [
    ['PO20240618035', '王者荣耀', '排位赛陪玩', 3, 20400, '赵女士', '带麦，辅助位'],
    ['PO20240618038', '和平精英', '开黑陪玩', 2, 11600, '陈先生', '娱乐开黑，耐心沟通'],
  ]) orders.push({ id, game, product, hours, amountCents: price, boss, requirement, pay: '线下已收款', status: '待接单', participants: [], version: 1, createdAt: now(), history: [{ action: '示例订单导入', by: '系统', at: now() }] });
  const assessments = (seed.assessments || []).map(item => {
    const target = users.find(u => u.name === item.member);
    const at = new Date(time - (item.id.endsWith('2') ? 3600000 : 7200000)).toISOString();
    return { id: item.id, memberId: target?.id || '', memberNo: target?.memberNo || '', memberName: item.member, type: item.type, game: item.game || '', levelId: target?.levelId || null, status: item.result ? '已完成' : '待考核', result: item.result || null, score: item.score ?? null, wins: item.wins ?? null, losses: item.losses ?? null, kills: item.kills ?? null, deaths: item.deaths ?? null, mvp: item.mvp ?? null, performance: { wins: item.wins ?? null, losses: item.losses ?? null, kills: item.kills ?? null, deaths: item.deaths ?? null, mvp: item.mvp ?? null }, evidence: '', note: item.note || '', examinerId: 'examiner', examinerName: '阿泽', createdAt: at, updatedAt: at, version: 1 };
  });
  return {
    deploymentMode: 'demo', users, games, catalogGames: games.filter(game => game.name === '三角洲行动'), products, orders, assessments, revision: 1, catalogScopeVersion: 1, levelPrices: { ...defaultLevelPrices }, levelPriceVersion: 1, audit: [], withdrawals: [], ledger: [],
    customers: [
      { id: 'customer-1', customerNo: 'U100001', username: 'zhouzhiyuan', phone: '138****0001', name: '周致远', balanceCents: 46000, active: true },
      { id: 'customer-2', customerNo: 'U100002', username: 'shenjiahe', phone: '139****0002', name: '沈嘉禾', balanceCents: 32000, active: true },
      { id: 'customer-3', customerNo: 'U100003', username: 'lin先生', phone: '136****0003', name: '林先生', balanceCents: 382000, active: true },
    ],
    topups: seed.topups.map(t => ({ ...t, amountCents: cents(t.amount) })),
    settlements: seed.settlements,
    conversations: seed.conversations.map((c, i) => ({ ...c, id: `chat-${i + 1}`, slaDueAt: new Date(time + (i === 0 ? -3600000 : 7200000)).toISOString(), notes: [], messages: [{ text: c.last, author: c.boss, at: now() }] })),
    refunds: seed.orders.filter(o => o.status === '退款审核').map((o, i) => ({ id: `RF${String(i + 1).padStart(6, '0')}`, orderId: o.id, customer: o.boss, amountCents: cents(o.amount), reason: '客户申请退款，等待售后审核', status: '待审核', originalStatus: '已完成', requestedAt: now(), channel: o.pay === '余额支付' ? '余额原路' : '线下人工' })),
  };
}

function productionState(bootstrapAdmin = {}) {
  const username = textInput(bootstrapAdmin.username, '初始管理员账号', 30);
  requireThat(/^[a-zA-Z0-9_]{3,30}$/.test(username), '初始管理员账号需为 3–30 位英文、数字或下划线');
  const password = textInput(bootstrapAdmin.password, '初始管理员密码', 128);
  requireThat(password.length >= 12 && /[a-z]/i.test(password) && /\d/.test(password) && /[^a-z0-9]/i.test(password), '生产环境初始管理员密码至少 12 位，并包含字母、数字和符号');
  requireThat(!['123456', 'Test1234!'].includes(password), '生产环境不能使用演示密码');
  const admin = { id: randomUUID(), username, name: textInput(bootstrapAdmin.name || '管理员', '管理员名称', 30), passwordHash: passwordHash(password), role: 'admin', active: true, online: false, games: [], memberNo: '81000001', memberVersion: 1, balanceCents: 0, frozenBalanceCents: 0, depositCents: 0, shareBps: 0, levelId: null, escortFrozen: false };
  const data = {
    deploymentMode: 'production', users: [admin], games: [], catalogGames: [], products: [], orders: [], assessments: [], customers: [],
    topups: [], settlements: [], conversations: [], refunds: [], notifications: [], audit: [], withdrawals: [], ledger: [],
    revision: 1, catalogScopeVersion: 1, membershipVersion: 5, identityVersion: 1,
    levels: structuredClone(defaultLevels), levelPrices: { ...defaultLevelPrices }, levelPriceVersion: 1, gameLevelConfigs: {},
  };
  attachCustomer(data, admin);
  return data;
}

export class ClubStore {
  constructor(path, { production = false, bootstrapAdmin } = {}) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    try {
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS club (id INTEGER PRIMARY KEY CHECK (id=1), data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL);');
    this.db.exec('BEGIN IMMEDIATE');
    if (!this.db.prepare('SELECT id FROM club').get()) this.db.prepare('INSERT INTO club VALUES (1, ?)').run(JSON.stringify(production ? productionState(bootstrapAdmin) : initialState()));
    const data = this.read();
    requireThat(!production || data.deploymentMode === 'production', '生产环境不能使用演示或旧版数据库，请配置全新的 CLUB_DATABASE 并初始化管理员', 503);
    const productionData = data.deploymentMode === 'production';
    let migrated = false;
    if (!productionData && data.catalogScopeVersion !== 1) {
      const delta = data.games?.find(game => game.name === '三角洲行动') || { name: '三角洲行动', category: 'FPS', multiplier: '1.00x', multiplierBps: 10000, min: 1, max: 3, state: '上架', tone: 'green', version: 1 };
      if (!data.games?.some(game => game.name === delta.name)) data.games = [...(data.games || []), delta];
      data.catalogGames = [delta];
      if (!(data.products || []).some(product => product.game === '三角洲行动')) data.products = [...(data.products || []), { id: `product-${randomUUID()}`, name: '三角洲行动陪玩', game: '三角洲行动', unit: '小时', price: '¥ 58.00', priceCents: 5800, note: '按陪玩等级定价', state: '启用', tone: 'green', version: 1 }];
      data.catalogScopeVersion = 1;
      migrated = true;
    }
    if (!productionData && !(data.products || []).some(product => product.game === '三角洲行动')) {
      data.products = [...(data.products || []), { id: `product-${randomUUID()}`, name: '三角洲行动陪玩', game: '三角洲行动', unit: '小时', price: '¥ 58.00', priceCents: 5800, note: '按陪玩等级定价', state: '启用', tone: 'green', version: 1 }];
      migrated = true;
    }
    if (migrateDeltaProducts(data)) migrated = true;
    const demoStaff = [
      { id: 'finance', username: 'finance', name: '周财务', role: 'finance' },
      { id: 'examiner', username: 'examiner', name: '阿泽', role: 'examiner' },
      { id: 'afterSales', username: 'afterSales', name: '小许', role: 'afterSales' },
      { id: 'member-demo', externalUserId: 'customer-3', memberNo: 'U100003', username: 'member', name: '林先生', role: 'member' },
      { id: 'user-demo', username: 'user', name: '新用户', role: 'user' },
      ...demoAccounts,
    ];
    for (const staff of productionData ? [] : demoStaff) {
      if (data.users.some(user => user.username === staff.username)) continue;
      const memberNo = String(Math.max(81000000, ...data.users.map(user => Number(user.memberNo) || 0)) + 1);
      const added = { ...staff, memberNo: staff.memberNo || memberNo, memberVersion: 0, passwordHash: passwordHash(staff.demoPassword || '123456'), active: true, online: Boolean(staff.online), games: staff.games || [], balanceCents: staff.balanceCents ?? (staff.role === 'user' ? 100000 : 0), frozenBalanceCents: 0, depositCents: staff.depositCents || 0, shareBps: staff.shareBps || 0 };
      delete added.demoPassword;
      data.users.push(added);
      attachCustomer(data, added);
      migrated = true;
    }
    if (!Array.isArray(data.refunds)) {
      data.refunds = data.orders.filter(o => o.status === '退款审核').map((o, i) => ({ id: `RF${String(i + 1).padStart(6, '0')}`, orderId: o.id, customer: o.boss, amountCents: Number(o.amountCents || 0), reason: '客户申请退款，等待售后审核', status: '待审核', originalStatus: '已完成', requestedAt: now(), channel: o.pay === '余额支付' ? '余额原路' : '线下人工' }));
      migrated = true;
    }
    if (!Array.isArray(data.assessments)) { data.assessments = []; migrated = true; }
    if (!Array.isArray(data.conversations)) { data.conversations = []; migrated = true; }
    if (!Array.isArray(data.notifications)) { data.notifications = []; migrated = true; }
    let classifiedConversations = false;
    for (const chat of data.conversations) {
      if (!['support', 'consultation'].includes(chat.type)) {
        const sample = !productionData && seed.conversations.find((item, index) => chat.id === `chat-${index + 1}` && chat.boss === item.boss);
        chat.type = sample?.type || conversationType(chat);
        classifiedConversations = true; migrated = true;
      }
      if (!chat.slaDueAt) { const base = Date.parse(chat.createdAt || chat.at || ''); chat.slaDueAt = new Date((Number.isFinite(base) ? base : Date.now()) + 2 * 3600000).toISOString(); migrated = true; }
    }
    if (classifiedConversations) data.revision++;
    if (migrated) this.db.prepare('UPDATE club SET data=? WHERE id=1').run(JSON.stringify(data));
    if (migrateMembership(data)) this.db.prepare('UPDATE club SET data=? WHERE id=1').run(JSON.stringify(data));
    const deltaConfig = data.gameLevelConfigs?.['三角洲行动'];
    if (!productionData && (!data.gameLevelConfigs || !deltaConfig)) {
      data.gameLevelConfigs = { ...(data.gameLevelConfigs || {}), '三角洲行动': { levels: data.levels.map(level => ({ ...level, priceCents: priceOf(data, level.id) })), version: data.levelPriceVersion || 1 } };
      this.db.prepare('UPDATE club SET data=? WHERE id=1').run(JSON.stringify(data));
    }
    if (migrateIdentity(data)) this.db.prepare('UPDATE club SET data=? WHERE id=1').run(JSON.stringify(data));
    if (migrateRealName(data)) this.db.prepare('UPDATE club SET data=? WHERE id=1').run(JSON.stringify(data));
    this.db.exec('CREATE TABLE IF NOT EXISTS analytics_cache (key TEXT PRIMARY KEY, data TEXT NOT NULL)');
    this.db.exec('COMMIT');
    this.dummyHash = passwordHash(randomBytes(24).toString('hex'));
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      this.db.close();
      throw error;
    }
  }
  read() { return JSON.parse(this.db.prepare('SELECT data FROM club WHERE id=1').get().data); }
  close() { this.db.close(); }
  transaction(user, permission, action, work, personal = false) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const data = this.read();
      const actual = data.users.find(u => u.id === user.id && u.active);
      requireThat(actual, '账号已停用，请重新登录', 401);
      if (personal) requireThat(['order:create','order:confirm','refund:create','conversation:create','topup:create'].includes(permission), '个人工作区不支持此操作', 403);
      const actor = personal ? { ...actual, role:'user' } : actual;
      permit(actor, permission);
      const before = structuredClone(data);
      const result = work(data, actor);
      recordNotifications(data, before, actor);
      data.revision++;
      data.audit.unshift({ id: randomUUID(), action, by: actor.name, at: now() });
      this.db.prepare('UPDATE club SET data=? WHERE id=1').run(JSON.stringify(data));
      this.db.exec('COMMIT');
      return result;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  #createLoginSession(data, user, action) {
    const token = randomBytes(32).toString('hex');
    const wasOnline = Boolean(user.online);
    this.db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
    this.db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(hashToken(token), user.id, Date.now() + 8 * 3600000);
    user.online = user.role !== 'escort' || isRealNameVerified(user);
    if (wasOnline !== user.online) {
      data.revision++;
      data.audit.unshift({ id: randomUUID(), action, by: user.name, at: now() });
      this.db.prepare('UPDATE club SET data=? WHERE id=1').run(JSON.stringify(data));
    }
    return { token, user: publicUser(user) };
  }
  login(username, password) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const data = this.read();
      const normalized = String(username || '').replace(/\s+/g, '');
      const user = data.users.find(u => u.username === username) || data.users.find(u => {
        const customer = data.customers.find(c => c.id === u.customerId || c.id === u.externalUserId);
        return customer?.phone && String(customer.phone).replace(/\s+/g, '') === normalized;
      });
      const valid = checkPassword(password, user?.passwordHash || this.dummyHash);
      requireThat(valid && user?.active, '账号或密码不正确，或账号已停用', 401);
      const result = this.#createLoginSession(data, user, '登录并上线');
      this.db.exec('COMMIT');
      return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  // The HTTP caller must consume a valid challenge before issuing this session.
  loginUser(userId, verifiedPhone) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const data = this.read();
      const accounts = data.users.filter(candidate => candidate.loginPhoneVerified === true && candidate.loginPhone === verifiedPhone);
      const user = accounts.length === 1 ? accounts[0] : null;
      requireThat(typeof verifiedPhone === 'string' && /^1[3-9]\d{9}$/.test(verifiedPhone) && user?.id === userId && user.active, '手机号绑定已变化，请重新登录', 401);
      const result = this.#createLoginSession(data, user, '验证码登录并上线');
      this.db.exec('COMMIT');
      return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  session(token) {
    const session = this.db.prepare('SELECT user_id FROM sessions WHERE token=? AND expires>?').get(hashToken(token || ''), Date.now());
    return session && this.read().users.find(u => u.id === session.user_id && u.active);
  }
  logout(token) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const tokenHash = hashToken(token || '');
      const session = this.db.prepare('SELECT user_id FROM sessions WHERE token=?').get(tokenHash);
      if (!session) { this.db.exec('COMMIT'); return; }
      this.db.prepare('DELETE FROM sessions WHERE token=?').run(tokenHash);
      const remaining = this.db.prepare('SELECT 1 FROM sessions WHERE user_id=? AND expires>? LIMIT 1').get(session.user_id, Date.now());
      const data = this.read();
      const user = data.users.find(candidate => candidate.id === session.user_id);
      if (user && !remaining && user.online) {
        user.online = false;
        data.revision++;
        data.audit.unshift({ id: randomUUID(), action: '退出并离线', by: user.name, at: now() });
        this.db.prepare('UPDATE club SET data=? WHERE id=1').run(JSON.stringify(data));
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  register(input) {
    const username = textInput(input.username, '登录账号', 30);
    requireThat(/^[a-zA-Z0-9_]{3,30}$/.test(username), '账号需为 3–30 位英文、数字或下划线，也可使用手机号');
    const name = textInput(input.name || username, '昵称', 30);
    const password = textInput(input.password, '密码', 128);
    requireThat(password.length >= 8, '新账号密码至少 8 位');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const data = this.read();
      requireThat(!data.users.some(u => u.username === username), '该账号已注册，请直接登录', 409);
      const before = structuredClone(data);
      const memberNo = String(Math.max(81000000, ...data.users.map(u => Number(u.memberNo) || 0)) + 1);
      const user = { id: randomUUID(), memberNo, memberVersion: 0, username, name, passwordHash: passwordHash(password), role: 'user', active: true, online: false, games: [], balanceCents: 0, frozenBalanceCents: 0, depositCents: 0, shareBps: 0 };
      data.users.push(user); attachCustomer(data, user);
      recordNotifications(data, before, user); data.revision++;
      this.db.prepare('UPDATE club SET data=? WHERE id=1').run(JSON.stringify(data));
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return this.login(username, password);
  }
  personal(user) {
    const data = this.read();
    const actor = data.users.find(u => u.id === user.id && u.active);
    requireThat(actor, '账号已停用', 401);
    return personalData(data, actor, roles);
  }
  realNameStatus(user) {
    const actor = this.read().users.find(candidate => candidate.id === user.id && candidate.active);
    requireThat(actor, '账号已停用', 401);
    return realNameVerification(actor);
  }
  submitRealName(user, input) {
    return this.transaction(user, 'profile:update', '提交实名认证申请', (data, actor) => submitRealName(data, actor, input));
  }
  realNameRequests(user) {
    const data = this.read();
    const actor = data.users.find(candidate => candidate.id === user.id && candidate.active);
    requireThat(actor, '账号已停用', 401);
    requireThat(actor.role === 'admin', '只有最高负责人可以查看实名认证申请', 403);
    return { requests: realNameRequests(data) };
  }
  realNameRequest(user, requestId) {
    const data = this.read();
    const actor = data.users.find(candidate => candidate.id === user.id && candidate.active);
    requireThat(actor, '账号已停用', 401);
    requireThat(actor.role === 'admin', '只有最高负责人可以查看实名认证申请', 403);
    const request = (data.realNameRequests || []).find(record => record.requestId === requestId || record.userId === requestId);
    requireThat(request, '实名认证申请不存在', 404);
    return { ...realNameRequests(data).find(record => record.requestId === request.requestId), realName: request.realName };
  }
  reviewRealName(user, requestId, input) {
    return this.transaction(user, 'account:manage', `审核实名认证 ${requestId}`, (data, actor) => reviewRealName(data, actor, requestId, input));
  }
  /**
   * Return a role-scoped workspace only when the shared club revision has
   * advanced since the caller's last snapshot.  Every role reads from the
   * same SQLite document, so this gives browser clients a cheap polling
   * primitive without exposing another user's data or requiring a socket.
   */
  sync(user, since = 0, context = 'management') {
    const data = this.read();
    const actor = data.users.find(u => u.id === user.id && u.active);
    requireThat(actor, '账号已停用', 401);
    const revision = Number(data.revision) || 0;
    const previous = Number(since);
    requireThat((typeof since === 'number' || typeof since === 'string' && /^\d+$/.test(since)) && Number.isSafeInteger(previous) && previous >= 0, '同步版本无效');
    requireThat(['personal', 'management'].includes(context), '同步工作区无效');
    const notifications = notificationFeed(data, actor, roles);
    if (previous === revision) return { changed: false, revision, userId: actor.id, notifications };
    const workspace = context === 'personal' ? personalData(data, actor, roles) : this.workspace(actor);
    return { changed: true, revision, userId: actor.id, workspace, notifications };
  }
  notifications(user) {
    const data = this.read();
    const actor = data.users.find(item => item.id === user.id && item.active);
    requireThat(actor, '账号已停用', 401);
    return notificationFeed(data, actor, roles);
  }
  readNotifications(user, input = {}) {
    requireThat(Array.isArray(input.ids) && input.ids.length > 0 && input.ids.length <= 500 && input.ids.every(id => typeof id === 'string' && id.length > 0 && id.length <= 100), '请选择要标为已读的通知');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const data = this.read();
      const actor = data.users.find(item => item.id === user.id && item.active);
      requireThat(actor, '账号已停用', 401);
      const selected = [...new Set(input.ids)].map(id => (data.notifications || []).find(item => item.id === id));
      requireThat(selected.every(item => item && item.recipientId === actor.id), '只能标记自己的通知', 403);
      if (selected.some(item => !item.readAt)) {
        const readAt = now();
        selected.forEach(item => { item.readAt ||= readAt; });
        data.revision++;
        this.db.prepare('UPDATE club SET data=? WHERE id=1').run(JSON.stringify(data));
      }
      this.db.exec('COMMIT');
      return { ...notificationFeed(data, actor, roles), revision: data.revision };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  totalSnapshot(at = Date.now()) {
    const cache = this.db.prepare('SELECT data FROM analytics_cache WHERE key=?').get('totals');
    const saved = cache && JSON.parse(cache.data);
    if (saved && at >= Date.parse(saved.asOf) && at < Date.parse(saved.nextUpdateAt)) return saved;
    const result = { ...metrics(this.read(), undefined, at), asOf: new Date(at).toISOString(), nextUpdateAt: new Date(at + FOUR_HOURS).toISOString() };
    this.db.prepare('INSERT OR REPLACE INTO analytics_cache VALUES (?, ?)').run('totals', JSON.stringify(result));
    return result;
  }
  analytics(user, section, input = {}) {
    const data = this.read();
    const actor = data.users.find(u => u.id === user.id && u.active);
    requireThat(actor, '登录已失效', 401); permit(actor, 'analytics:view');
    const at = Date.now();
    if (section === 'summary') {
      const day = input.day || clubDay(at); const range = dateRange(day, day);
      return { totals: this.totalSnapshot(at), daily: { ...metrics(data, range, at), ...dailyBusinessMetrics(data, range, at), day, asOf: new Date(at).toISOString() }, today: clubDay(at), options: analyticsOptions(data) };
    }
    if (section === 'trend') return trend(data, input, at);
    if (section === 'rankings' || section === 'details') return ranking(data, input, at, section === 'details');
    requireThat(false, '统计接口不存在', 404);
  }
  workspace(user) {
    const data = this.read();
    const games = catalogList(data);
    const names = new Set(games.map(game => game.name));
    for (const order of data.orders) {
      const game = data.games.find(game => game.name === order.game);
      order.participantMin ??= game?.min || 1;
      order.participantMax ??= game?.max || 1;
    }
    const visibleUser = candidate => ({ ...publicUser(candidate), games: (candidate.games || []).filter(game => names.has(game)) });
    const visibleMember = candidate => {
      const member = memberRecord(data, candidate, publicUser);
      return { ...member, games: (candidate.games || []).filter(game => names.has(game)), commissionByGame: Object.fromEntries(Object.entries(member.commissionByGame).filter(([game]) => names.has(game))) };
    };
    user = data.users.find(u => u.id === user.id && u.active);
    requireThat(user, '账号已停用', 401);
    if (user.role === 'user') {
      const personal = personalData(data, user, roles);
      // The personal directory needs service fields only. Do not expose an
      // escort's login account, commission, member version, or verification
      // timestamps to another customer through the shared workspace.
      const directoryMembers = data.users
        .filter(candidate => candidate.role === 'escort' && candidate.active && !candidate.escortFrozen && isRealNameVerified(candidate))
        .map(candidate => ({
          id: candidate.id, memberNo: candidate.memberNo, name: candidate.name,
          games: (candidate.games || []).filter(game => names.has(game)),
          levelId: candidate.levelId, levelName: levelOf(data, candidate.levelId)?.name || '',
          online: Boolean(candidate.online), avatar: candidate.avatar || '', bio: candidate.bio || '',
          profileTags: Array.isArray(candidate.profileTags) ? candidate.profileTags : [],
        }));
      return {
        ...personal,
        games,
        catalogGames: games,
        gameLevelConfigs: Object.fromEntries(Object.entries(data.gameLevelConfigs || {}).filter(([name]) => names.has(name))),
        levels: data.levels.map(level => ({ ...level, priceCents: priceOf(data, level.id) })),
        products: visibleProducts(data),
        members: directoryMembers,
        clubName: '星河游戏俱乐部',
      };
    }
    requireThat(isClubMember(user), '你尚未加入俱乐部，无法进入后台', 403);
    const mine = data.orders.filter(o => o.participants.some(p => p.userId === user.id)).map(o => escortOrderView(data, o, user));
    const available = data.orders.filter(o => recruitmentOpen(o) && matchesOrder(data, o, user)).map(o => {
      const rate = Math.floor(rateOf(data, user, o.game) / (o.participantMin || 1));
      return { ...escortOrderView(data, o, user), expectedShareBps: rate, expectedIncomeCents: Math.round((o.amountCents-(o.refundedCents||0)) * rate / 10000) };
    });
    const gameLevelConfigs = Object.fromEntries(Object.entries(data.gameLevelConfigs || {}).map(([name, config]) => [name, { ...config, levels: (config.levels || []).map(level => ({ ...level, priceCents: level.priceCents ?? config.prices?.[level.id] })) }]));
    const common = { user: visibleUser(user), role: roles[user.role], levels: data.levels.map(level => ({ ...level, priceCents: priceOf(data, level.id) })), levelPrices: data.levelPrices, levelPriceVersion: data.levelPriceVersion || 1, gameLevelConfigs: Object.fromEntries(Object.entries(gameLevelConfigs).filter(([name]) => names.has(name))), games, catalogGames: games, revision: data.revision, clubName: '星河游戏俱乐部' };
    if (user.role === 'escort') return { ...common, user: { ...visibleUser(user), commissionByGame: Object.fromEntries((user.games || []).filter(game => names.has(game)).map(game => [game, rateOf(data, user, game)])) }, orders: mine, availableOrders: available.filter(order => names.has(order.game)), conversations: data.conversations.filter(chat => canManageConversation(user, chat)).map(chat => escortConversation(chat)), wallet: { balanceCents: user.balanceCents, depositCents: user.depositCents, frozenCents: (user.frozenBalanceCents || 0) + data.withdrawals.filter(w => w.userId === user.id && ['待审核','待线下打款'].includes(w.status)).reduce((a, w) => a + w.amountCents, 0) }, ledger: data.ledger.filter(l => l.userId === user.id), withdrawals: data.withdrawals.filter(w => w.userId === user.id) };
    if (user.role === 'member') { const personal=personalData(data,user,roles); return { ...personal, user:{...personal.user,role:'member',roleLabel:roles.member.label}, role:roles.member }; }
    if (user.role === 'finance') return { ...common, topups: data.topups, ledger: data.ledger, withdrawals: data.withdrawals, settlements: data.settlements, refunds: data.refunds };
    if (user.role === 'examiner') {
      const members = data.users.filter(u => ['escort', 'member'].includes(u.role)).map(u => {
        const records = data.assessments.filter(item => item.memberId === u.id);
        const latest = records[0];
        return { id: u.id, memberNo: u.memberNo, name: u.name, active: u.active, role: u.role, games: (u.games || []).filter(game => names.has(game)), levelId: u.levelId, levelName: levelOf(data, u.levelId)?.name || '', latestAssessment: latest ? { id: latest.id, type: latest.type, status: latest.status, result: latest.result, score: latest.score, game: latest.game, updatedAt: latest.updatedAt } : null, assessmentCount: records.length };
      });
      return { ...common, levels: data.levels.map(({ id, name, rank }) => ({ id, name, rank })), members, assessments: data.assessments, assessmentRecords: data.assessments, qualityChecks: data.assessments.filter(item => item.type === '质检'), entryAssessments: data.assessments.filter(item => item.type === '入店考核') };
    }
    if (user.role === 'afterSales') {
      const conversations = data.conversations.filter(chat => canManageConversation(user, chat)).map(chat => managementConversation(data, chat));
      return { ...common, orders: data.orders, conversations, refunds: data.refunds };
    }
    const users = data.customers.map((customer, index) => {
      const customerOrders = data.orders.filter(order => order.customerId === customer.id);
      const completed = customerOrders.filter(order => order.status === '已完成');
      const id = customer.id || `customer-${index + 1}`;
      const customerNo = customer.customerNo || `U${String(100001 + index).padStart(6, '0')}`;
      const account = data.users.find(candidate => candidate.customerId === id);
      const member = isClubMember(account) ? account : null;
      return { ...customer, id, customerNo: account?.memberNo || customerNo, userId: account?.id || '', registered: Boolean(account), realNameVerification: realNameVerification(account), username: account?.username || customer.username || customerNo, phone: customer.phone || '', active: account ? account.active : customer.active !== false, orderCount: customerOrders.length, completedOrderCount: completed.length, totalSpentCents: customerOrders.reduce((sum, order) => sum + Number(order.amountCents || 0), 0), joinedClub: Boolean(member), clubMemberId: member?.id || '', memberRole: member?.role || '', memberRoleLabel: member ? roles[member.role]?.label || '' : '' };
    });
    const response = { ...common, orders: data.orders, games, products: visibleProducts(data), conversations: data.conversations.filter(chat => canManageConversation(user, chat)).map(chat => managementConversation(data, chat)), refunds: data.refunds, members: data.users.filter(u => u.role === 'escort').map(visibleUser), customers: data.customers };
    if (user.role === 'admin') Object.assign(response, { accounts: data.users.map(visibleMember), members: data.users.filter(u => u.role === 'escort').map(visibleMember), roleOptions: Object.entries(roles).map(([id, r]) => ({ id, label: r.label, pages: r.pages, permissions: r.permissions })), topups: data.topups, ledger: data.ledger, withdrawals: data.withdrawals, settlements: data.settlements, refunds: data.refunds, assessments: data.assessments, assessmentRecords: data.assessments, qualityChecks: data.assessments.filter(item => item.type === '质检'), entryAssessments: data.assessments.filter(item => item.type === '入店考核'), audit: data.audit.slice(0, 30), users });
    if (user.role === 'admin') {
      response.realNameRequests = realNameRequests(data);
      response.accounts = response.accounts.filter(isClubMember);
      response.roleOptions = response.roleOptions.filter(role => role.id !== 'user');
      response.staffGroups = Object.fromEntries(['service', 'examiner', 'afterSales'].map(role => [role, response.accounts.filter(u => u.role === role)]));
    }
    return response;
  }
  assignable(data, order, user) {
    return user?.active && !user.escortFrozen && user.online && user.role === 'escort' && isRealNameVerified(user)
      && !(order.excludedEscortIds || []).includes(user.id)
      && (!order.preferredEscortId || order.preferredEscortId === user.id)
      && user.games.includes(order.game) && meetsLevel(data, user, order)
      && data.games.some(g => g.name === order.game);
  }
  addApplicants(data, order, ids, actor) {
    requireThat(Array.isArray(ids) && ids.length > 0 && ids.length <= 100 && ids.every(id => typeof id === 'string') && new Set(ids).size === ids.length, '请选择 1–100 位不同的候选打手');
    const members = ids.map(id => data.users.find(user => user.id === id));
    requireThat(members.every(member => matchesOrder(data, order, member) && member.online), '成员必须已启用、未冻结、在线、支持此游戏，且等级不低于订单等级');
    order.applications ||= [];
    const added = members.filter(member => !order.applications.some(item => item.userId === member.id));
    requireThat(added.length, '所选打手已在候选名单中', 409);
    for (const member of added) order.applications.push({ userId: member.id, name: member.name, levelId: member.levelId, levelName: levelOf(data, member.levelId).name, source: actor.role === 'escort' ? 'self' : 'service', appliedAt: now() });
  }
  createOrder(user, input) {
    return this.transaction(user, 'order:create', '创建订单', (data, actor) => {
      if (actor.role === 'user') requireRealName(data.users.find(candidate => candidate.id === actor.id));
      let requestFingerprint;
      if (input.requestId !== undefined) {
        requireThat(typeof input.requestId === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(input.requestId), '下单请求无效，请重新打开下单窗口');
        const requestFields = ['productId', 'hours', 'boss', 'pay', 'levelId', 'orderMode', 'preferredEscortId', 'appointmentAt', 'tags', 'region', 'voice', 'requirement', 'customerId', 'expectedUnitPriceCents'];
        requestFingerprint = createHash('sha256').update(JSON.stringify(Object.fromEntries(requestFields.map(key => [key, input[key]])))).digest('hex');
        const previous = (data.orderRequests || []).find(request => request.userId === actor.id && request.personal === (actor.role === 'user') && request.requestId === input.requestId);
        if (previous) {
          requireThat(previous.fingerprint === requestFingerprint, '该下单请求已经提交，请重新确认订单', 409);
          const existing = data.orders.find(order => order.id === previous.orderId);
          requireThat(existing, '原订单不存在，请联系客服核对', 409);
          return existing;
        }
      }
      const product = data.products.find(p => p.id === input.productId);
      requireThat(product?.state === '启用' && catalogList(data).find(g => g.name === product.game)?.state === '上架', '游戏维护中或商品不可售');
      const hours = Number(input.hours);
      requireThat(Number.isInteger(hours) && hours >= 1 && hours <= 24, '服务时长应为 1–24 小时，按 1 小时递增');
      const boss = textInput(input.boss, '老板称呼', 30);
      requireThat(['余额支付', '在线支付', '线下已收款'].includes(input.pay), '请选择支付方式');
      const level = levelOf(data, input.levelId ?? 'gold');
      requireThat(level, '请选择有效的订单等级');
      const gamePrice = data.gameLevelConfigs?.[product.game]?.levels?.find(item => item.id === level.id)?.priceCents;
      const baseUnitPriceCents = Number.isSafeInteger(gamePrice) ? gamePrice : (product.game === '三角洲行动' ? priceOf(data, level.id) : product.priceCents);
      const escortCount = product.game === '三角洲行动' ? escortCountOf(product) : 1;
      const unitPriceCents = baseUnitPriceCents * escortCount;
      requireThat(Number.isSafeInteger(unitPriceCents) && unitPriceCents > 0, '服务价格配置无效，请联系客服处理', 409);
      const game = data.games.find(item => item.name === product.game);
      const participantMin = product.participantMin ?? (product.game === '三角洲行动' ? escortCount : (game?.min || 1));
      const participantMax = product.participantMax ?? (product.game === '三角洲行动' ? escortCount : (game?.max || participantMin));
      requireThat(game && Number.isInteger(participantMin) && Number.isInteger(participantMax) && participantMin >= 1 && participantMin <= participantMax && participantMax <= 10, '服务人数配置无效，请联系客服处理', 409);
      if (input.expectedUnitPriceCents !== undefined) {
        requireThat(Number.isSafeInteger(input.expectedUnitPriceCents) && input.expectedUnitPriceCents > 0, '确认价格无效，请重新选择服务');
        requireThat(input.expectedUnitPriceCents === unitPriceCents, '服务价格已更新，请返回重新确认后再下单', 409);
      }
      const total = Math.round(unitPriceCents * hours);
      requireThat(Number.isSafeInteger(total) && total > 0, '订单金额无效，请重新确认服务', 409);
      const orderMode = input.orderMode === undefined ? 'quick' : String(input.orderMode);
      requireThat(['quick', 'filter', 'designated'].includes(orderMode), '服务方式无效');
      const preferredEscortId = input.preferredEscortId ? String(input.preferredEscortId).trim() : '';
      if (orderMode === 'designated') requireThat(preferredEscortId, '指定打手下单时必须选择打手');
      requireThat(!preferredEscortId || orderMode === 'designated', '仅指定打手模式可以选择指定成员');
        if (preferredEscortId) {
          requireThat(escortCount === 1 && participantMin === 1, '该服务需要多人配合，请选择客服安排');
          const preferred = data.users.find(candidate => candidate.id === preferredEscortId && candidate.role === 'escort');
          requireThat(preferred?.active, '指定打手不存在或已停用', 404);
          requireRealName(preferred);
          requireThat(!preferred.escortFrozen, '指定打手暂不可接单，请选择其他成员');
          requireThat(preferred.games.includes(product.game), '指定打手暂不支持该游戏', 400);
          requireThat(meetsLevel(data, preferred, { levelId: level.id }), '指定打手等级不满足订单要求');
      }
      let appointmentAt = null;
      if (input.appointmentAt) {
        const rawAppointment = String(input.appointmentAt).trim();
        // datetime-local values have no timezone; interpret them in the
        // club's business timezone (Asia/Hong_Kong, UTC+08:00).
        const zonedAppointment = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(rawAppointment) ? rawAppointment : `${rawAppointment}+08:00`;
        const timestamp = Date.parse(zonedAppointment);
        requireThat(Number.isFinite(timestamp), '预约时间格式无效');
        requireThat(timestamp >= Date.now() - 5 * 60 * 1000, '预约时间不能早于当前时间');
        appointmentAt = new Date(timestamp).toISOString();
      }
        const tags = input.tags === undefined ? [product.name.slice(0, 30)] : Array.isArray(input.tags) ? input.tags : String(input.tags).split(/[,，]/).map(t=>t.trim()).filter(Boolean);
      requireThat(tags.length <= 8 && tags.every(t=>typeof t === 'string' && t.trim().length > 0 && t.length <= 30), 'Tag 最多 8 个，每个最多 30 个字符');
      requireThat(actor.role !== 'user' || input.pay === '在线支付', '顾客订单请使用在线支付');
      const order = { id: `PO${Date.now()}${randomBytes(2).toString('hex').toUpperCase()}`, boss, game: product.game, tags: [...new Set(tags)], product: product.name, productId: product.id, hours, unitPriceCents, amountCents: total, pay: input.pay, paymentStatus: '已支付', orderMode, preferredEscortId: preferredEscortId || null, region: input.region ? textInput(input.region, '区服', 80) : '', voice: input.voice ? textInput(input.voice, '语音方式', 40) : '', appointmentAt, requirement: textInput(input.requirement, '服务要求', 300), status: '待接单', participants: [], applications: [], version: 1, createdAt: now(), history: [{ action: '创建订单', by: actor.name, at: now() }] };
      Object.assign(order, { levelId: level.id, levelName: level.name, participantMin, participantMax });
      const matches = data.customers.filter(c => c.name === boss);
        requireThat(actor.role === 'user' || input.customerId || matches.length <= 1, '存在同名用户，请选择用户 ID');
      let customer = actor.role === 'user' ? data.customers.find(c => c.id === actor.customerId) : (input.customerId ? data.customers.find(c => c.id === input.customerId) : matches[0]);
      if (actor.role === 'user') requireThat(customer && customer.name === boss, '顾客信息不匹配');
      if (input.customerId) requireThat(customer && customer.name === boss, '用户 ID 与昵称不匹配');
      if (customer) requireThat(customer.active !== false, '用户账号已停用，无法创建订单', 409);
      const buyer = customer && data.users.find(account => account.customerId === customer.id);
      requireThat(buyer?.active, '请先选择已注册并完成实名认证的下单用户', 403);
      requireRealName(buyer);
      if (customer) order.customerId = customer.id;
      order.selectionRequired = actor.role === 'user' || Boolean(customer && data.users.some(account => account.customerId === customer.id));
      if (input.pay === '余额支付' || input.pay === '在线支付') {
        requireThat(customer && customer.balanceCents >= total, '老板余额不足，请先审核充值或选择已收款');
        customer.balanceCents -= total;
        data.ledger.unshift({ id: randomUUID(), userId: null, customerId: customer.id, account: boss, deltaCents: -total, afterCents: customer.balanceCents, source: order.id, label: '订单消费', at: now(), by: actor.name });
      }
      data.orders.unshift(order);
      if (requestFingerprint) (data.orderRequests ||= []).push({ userId: actor.id, personal: actor.role === 'user', requestId: input.requestId, fingerprint: requestFingerprint, orderId: order.id });
      return order;
    }, personalContext(user,input));
  }
  orderAction(user, id, action, input) {
    const permissions = { dispatch: 'order:dispatch', transfer: 'order:dispatch', apply: 'order:accept', selectApplicant: 'order:confirm', accept: 'order:accept', reject: 'order:accept', start: 'order:serve', finish: 'order:serve', approve: personalContext(user,input) ? 'order:confirm' : 'order:review', return: 'order:review' };
    requireThat(permissions[action], '未知订单操作', 404);
    return this.transaction(user, permissions[action], `订单 ${id} · ${action}`, (data, actor) => {
      const order = data.orders.find(o => o.id === id);
      requireThat(order, '订单不存在', 404);
      requireThat(order.version === input.version, '订单已被更新，请刷新后重试', 409);
      if (actor.role === 'user') requireThat(order.customerId === actor.customerId, '只能处理自己的订单', 403);
      if (['apply', 'accept', 'start', 'selectApplicant'].includes(action)) requireRealName(data.users.find(candidate => candidate.id === actor.id));
      let participant = order.participants.find(p => p.userId === actor.id);
      if (['start', 'finish', 'reject'].includes(action)) requireThat(participant, '只能处理分配给自己的订单', 403);
      if (action === 'apply' || action === 'accept' && recruitmentOpen(order) && buyerSelectionRequired(order)) {
        requireThat(actor.role === 'escort', '只有打手可以报名订单', 403);
        requireThat(order.status === '待接单' && !order.participants.length, '该订单已不在报名阶段', 409);
        this.addApplicants(data, order, [actor.id], actor);
        order.history.push({ action: '打手报名', by: actor.name, at: now() });
        order.version++;
        return escortOrderView(data, order, actor);
      }
      if (action === 'dispatch' && buyerSelectionRequired(order)) {
        requireThat(recruitmentOpen(order), '订单已结束招募，不能继续添加候选打手', 409);
        this.addApplicants(data, order, input.memberIds, actor);
        order.history.push({ action: '客服推荐打手', by: actor.name, at: now() });
        order.version++;
        return order;
      }
      if (action === 'selectApplicant') {
        requireThat(actor.role === 'user', '只有下单用户可以选择报名打手', 403);
        requireThat(order.customerId === actor.customerId, '只能选择自己的订单', 403);
        requireThat(order.status === '待接单' && !order.participants.length, '该订单已不在选择阶段', 409);
        const ids = input.memberIds || (input.userId ? [input.userId] : []);
        requireThat(Array.isArray(ids) && ids.length > 0 && new Set(ids).size === ids.length, '请选择报名打手');
        const applications = (order.applications || []).filter(item => ids.includes(item.userId));
        requireThat(applications.length === ids.length, '只能选择已报名的打手', 409);
        const game = data.games.find(g => g.name === order.game);
        requireThat(game && ids.length >= (order.participantMin ?? game.min) && ids.length <= (order.participantMax ?? game.max), '请选择符合人数要求的打手');
        const members = ids.map(memberId => data.users.find(member => member.id === memberId));
        requireThat(members.every(member => matchesOrder(data, order, member) && member.online), '候选打手当前已不满足接单要求，请重新选择', 409);
        order.participants = members.map(member => ({ userId: member.id, name: member.name, levelId: member.levelId, levelName: levelOf(data, member.levelId).name, baseShareBps: rateOf(data, member, order.game), shareBps: Math.floor(rateOf(data, member, order.game) / members.length), accepted: false, finished: false, evidence: '' }));
        requireThat(order.participants.reduce((sum, item) => sum + item.shareBps, 0) <= 10000, '陪玩分成合计超过 100%，请重新选择');
        lockEarnings(order.amountCents-(order.refundedCents||0), order.participants);
        order.selectedBy = actor.id;
        order.selectedAt = now();
        order.status = '待确认';
        order.history.push({ action: '老板选择打手', by: actor.name, at: now(), note: members.map(member => member.name).join(' / ') });
        order.version++;
        return personalData(data, actor, roles).orders.find(item => item.id === order.id);
      }
      if (action === 'transfer') {
        requireThat(['待确认', '待服务', '陪玩中'].includes(order.status), '当前订单状态不支持转单', 409);
        const reason = textInput(input.reason, '转单原因', 200);
        const ids = input.memberIds;
        requireThat(Array.isArray(ids) && new Set(ids).size === ids.length, '请正确选择陪玩成员');
        if (order.orderMode === 'designated') requireThat(ids.length === 1 && ids[0] === order.preferredEscortId, '指定打手订单只能分配给指定成员');
        const game = data.games.find(g => g.name === order.game);
        requireThat(game && ids.length >= (order.participantMin ?? game.min) && ids.length <= (order.participantMax ?? game.max), '游戏不可接单或陪玩人数超出游戏限制');
        const members = ids.map(id => data.users.find(u => u.id === id));
        requireThat(members.every(m => this.assignable(data, order, m)), '成员必须已启用、未冻结、在线、支持此游戏，且等级不低于订单等级');
        const previous = order.participants.map(p => p.name).join(' / ') || '待分配';
        if (buyerSelectionRequired(order)) {
          order.applications = [];
          this.addApplicants(data, order, ids, actor);
          order.participants = [];
          order.status = '待接单'; order.startedAt = null;
          order.selectedAt = null; order.selectedBy = null;
          order.history.push({ action: '转单待老板选择', by: actor.name, at: now(), note: `${previous}；${reason}` });
          order.version++;
          return order;
        }
        requireThat(!members.some(m=>serviceOccupiesMember(data,m.id,order.id) || data.orders.some(other=>other.id!==order.id && ['待确认','待服务'].includes(other.status) && other.participants.some(p=>p.userId===m.id && !p.finished))), '成员已有未完成服务，暂不可转派',409);
        const participants = members.map(m => ({ userId: m.id, name: m.name, levelId: m.levelId, levelName: levelOf(data, m.levelId).name, baseShareBps: rateOf(data, m, order.game), shareBps: Math.floor(rateOf(data, m, order.game) / members.length), accepted: false, finished: false, evidence: '' }));
        requireThat(participants.reduce((a, p) => a + p.shareBps, 0) <= 10000, '陪玩分成合计超过 100%，请调整成员或分成配置');
        lockEarnings(order.amountCents-(order.refundedCents||0), participants);
        order.participants = participants;
        order.status = '待确认'; order.startedAt = null;
        order.history.push({ action: '转单', by: actor.name, at: now(), note: `${previous} → ${participants.map(p => p.name).join(' / ')}；${reason}` });
        order.version++;
        return order;
      } else if (action === 'dispatch' || (action === 'accept' && order.status === '待接单')) {
        requireThat(order.status === '待接单' && !order.participants.length, '订单已被接走，不能重复分配', 409);
        const ids = action === 'accept' ? [actor.id] : input.memberIds;
        requireThat(Array.isArray(ids) && new Set(ids).size === ids.length, '请正确选择陪玩成员');
        if (order.orderMode === 'designated') requireThat(ids.length === 1 && ids[0] === order.preferredEscortId, '指定打手订单只能分配给指定成员');
        const game = data.games.find(g => g.name === order.game);
        requireThat(game && ids.length >= (order.participantMin ?? game.min) && ids.length <= (order.participantMax ?? game.max), '游戏不可接单或陪玩人数超出游戏限制');
        const members = ids.map(id => data.users.find(u => u.id === id));
        requireThat(members.every(m => this.assignable(data, order, m)), '成员必须已启用、未冻结、在线、支持此游戏，且等级不低于订单等级');
        const participants = members.map(m => ({ userId: m.id, name: m.name, levelId: m.levelId, levelName: levelOf(data, m.levelId).name, baseShareBps: rateOf(data, m, order.game), shareBps: Math.floor(rateOf(data, m, order.game) / members.length), accepted: action === 'accept', finished: false, evidence: '' }));
        requireThat(participants.reduce((a, p) => a + p.shareBps, 0) <= 10000, '陪玩分成合计超过 100%，请调整成员或分成配置');
        lockEarnings(order.amountCents-(order.refundedCents||0), participants);
        order.participants = participants;
        order.applications = [];
        order.status = action === 'accept' ? '待服务' : '待确认';
      } else if (action === 'accept') {
        requireThat(participant, '只能确认派给自己的订单', 403);
        requireThat(order.status === '待确认' && !participant.accepted, '该订单已确认', 409);
        requireThat(this.assignable(data, order, actor), '当前状态、游戏技能或等级不符合接单要求');
        participant.accepted = true;
        if (order.participants.every(p => p.accepted)) order.status = '待服务';
      } else if (action === 'reject') {
        requireThat(['待确认', '待服务'].includes(order.status), '开始服务后不能退回派单池', 409);
        textInput(input.reason, '退回原因', 200);
        order.participants = [];
        order.applications = [];
        order.excludedEscortIds = [...new Set([...(order.excludedEscortIds || []), actor.id])];
        // A designated escort who declines cannot remain the sole required
        // candidate: preferredEscortId plus excludedEscortIds would make the
        // order impossible to fulfil. Reopen it as a normal buyer-selection
        // order while retaining the exclusion so the same escort is not
        // immediately offered again.
        if (order.orderMode === 'designated' && order.preferredEscortId === actor.id) {
          order.orderMode = 'quick';
          order.preferredEscortId = null;
          order.selectionRequired = true;
        }
        order.selectedAt = null; order.selectedBy = null;
        order.status = '待接单';
      } else if (action === 'start') {
        requireThat(order.status === '待服务', '请先完成接单确认', 409);
        requireThat(order.participants.every(p => this.assignable(data, order, data.users.find(u => u.id === p.userId))), '成员状态、游戏技能或等级不符合要求，暂不能开始');
        requireThat(!order.participants.some(p => serviceOccupiesMember(data,p.userId,id)), '成员仍有正在服务或售后暂停的订单，请处理后再开始', 409);
        order.status = '陪玩中'; order.startedAt = now();
      } else if (action === 'finish') {
        requireThat(order.status === '陪玩中' && !participant.finished, '订单尚未开始或已经提交完单', 409);
        participant.evidence = textInput(input.evidence, '完单说明', 500);
        requireThat(participant.evidence.length >= 5, '请填写至少 5 个字符的完单说明');
        participant.finished = true;
        if (order.participants.every(p => p.finished)) order.status = '待验收';
      } else if (action === 'return') {
        requireThat(order.status === '待验收', '只有待验收订单可以退回', 409);
        textInput(input.reason, '退回原因', 200);
        requireThat(!order.participants.some(p => serviceOccupiesMember(data,p.userId,order.id)), '成员正在服务其他订单或处理服务中售后，请完成后再退回补充服务', 409);
        order.participants.forEach(p => { p.finished = false; });
        order.status = '陪玩中';
      } else if (action === 'approve') {
        requireThat(order.status === '待验收' && order.participants.length && order.participants.every(p => p.finished), '只有已提交完单的订单可以验收', 409);
        settleOrder(data,order,actor);
      }
      order.version++;
      const labels = { dispatch: '客服派单', accept: '确认接单', reject: '退回派单池', start: '开始服务', finish: '提交完单', approve: '验收通过并入账', return: '退回补充服务' };
      order.history.push({ action: labels[action], by: actor.name, at: now(), note: input.reason || input.evidence || '' });
      return actor.role === 'escort' ? escortOrderView(data, order, actor) : order;
    }, personalContext(user,input));
  }
  conversationAction(user, id, input) {
    const personal=personalContext(user,input);
    return this.transaction(user,personal?'conversation:create':'conversation:manage','更新客服会话',(data,actor)=>{
      const chat=data.conversations.find(c=>c.id===id);requireThat(chat,'会话不存在',404);
      if(personal){
        requireThat(chat.customerId===actor.customerId || chat.userId===actor.id,'无权访问该会话',403);
        requireThat(!input.note && !input.state,'个人用户不能修改内部跟进',403);chat.customerUnread=0;
      }else{
        requireThat(canManageConversation(actor,chat),'无权访问该会话',403);
        if (actor.role === 'escort') {
          requireThat(input.note === undefined && input.state === undefined,'陪玩不能修改内部跟进或会话状态',403);
          chat.escortUnread=0;
        } else {
          if(input.note)(chat.notes||=[]).push({text:textInput(input.note,'跟进记录',1000),author:actor.name,at:now()});
          if(input.state){requireThat(['处理中','已结束'].includes(input.state),'会话状态无效');chat.state=input.state;chat.slaDueAt=input.state==='已结束'?null:new Date(Date.now()+7200000).toISOString();}
          chat.staffUnread=0;chat.unread=0;
        }
      }
      return personal ? this.personalConversation(chat) : actor.role === 'escort' ? escortConversation(chat) : managementConversation(data,chat);
    },personal);
  }
  personalConversation(chat) {
    return {id:chat.id,type:conversationType(chat),orderId:chat.orderId||null,escortId:chat.escortId||null,escortName:chat.escortName||'',channel:chat.channel,state:chat.state,last:chat.last,unread:chat.customerUnread||0,createdAt:chat.createdAt,updatedAt:chat.updatedAt,messages:chat.messages||[]};
  }
  conversationMessage(user,id,input) {
    const personal=personalContext(user,input);
    return this.transaction(user,personal?'conversation:create':'conversation:manage','发送会话消息',(data,actor)=>{
      const chat=data.conversations.find(c=>c.id===id);requireThat(chat,'会话不存在',404);
      if(personal)requireThat(chat.customerId===actor.customerId || chat.userId===actor.id,'无权访问该会话',403);
      else requireThat(canManageConversation(actor,chat),'无权访问该会话',403);
      const text=textInput(input.message,'消息内容',1000);
      const unreadBefore=escortUnread(chat);
      (chat.messages||=[]).push({text,author:actor.name,authorId:actor.id,at:now()});chat.last=text;chat.updatedAt=now();
      if(personal){chat.staffUnread=(chat.staffUnread??chat.unread??0)+1;chat.customerUnread=0;}
      else if(actor.role==='escort'){chat.customerUnread=(chat.customerUnread||0)+1;chat.staffUnread=(chat.staffUnread??chat.unread??0)+1;}
      else {chat.customerUnread=(chat.customerUnread||0)+1;chat.staffUnread=0;}
      if(conversationType(chat)==='consultation' && chat.escortId)chat.escortUnread=actor.role==='escort' && !personal?0:unreadBefore+1;
      chat.unread=chat.staffUnread;
      if(chat.state==='已结束'){chat.state='处理中';chat.slaDueAt=new Date(Date.now()+7200000).toISOString();}
      return personal ? this.personalConversation(chat) : actor.role === 'escort' ? escortConversation(chat) : managementConversation(data,chat);
    },personal);
  }
  conversationCreate(user,input) {
    return this.transaction(user,'conversation:create','创建服务咨询会话',(data,actor)=>{
      const escortName=input.escortName?textInput(String(input.escortName),'陪玩名称',60):'';
      requireThat(input.type==null || ['support','consultation'].includes(input.type),'会话类型无效');
      const supportNames=['俱乐部客服','在线客服','售后服务'];
      const support=input.type==='support' || (input.type!=='consultation' && (input.orderId!=null || escortName==='售后服务'));
      const platform=support || (!input.escortId && supportNames.includes(escortName)) || (input.type==='consultation' && !input.escortId && !escortName);
      if(platform){
        requireThat(!input.escortId && (!escortName || supportNames.includes(escortName)), '平台咨询不能指定陪玩');
        const orderId=input.orderId==null?null:textInput(input.orderId,'订单编号',100);
        const order=orderId?data.orders.find(candidate=>candidate.id===orderId && candidate.customerId===actor.customerId):null;
        requireThat(!orderId || order,'订单不存在或无权访问',404);
        const type=support?'support':'consultation';
        const contactName=support?'在线客服':'俱乐部客服';
        const matching=data.conversations.filter(chat=>chat.customerId===actor.customerId && (chat.orderId||null)===orderId && conversationType(chat)===type && (!chat.escortId || supportNames.includes(chat.escortName)));
        const existing=matching.find(chat=>chat.state!=='已结束') || matching[0];
        // Opening a contact is idempotent. Follow-up text goes through the
        // message endpoint, so repeated clicks cannot flood the support queue.
        if(existing && existing.state!=='已结束')return this.personalConversation(existing);
        const message=textInput(input.message || (support ? (order?`你好，我想咨询订单 ${order.id} 的售后问题。`:'你好，我想咨询非订单售后问题。') : '你好，我想咨询陪玩服务，请客服协助。'),'消息内容',1000);
        const timestamp=now();
        if(existing){
          existing.type=type;existing.escortId=null;existing.escortName=contactName;existing.channel='在线客服';
          existing.state='处理中';existing.slaDueAt=new Date(Date.now()+7200000).toISOString();
          (existing.messages||=[]).push({text:message,author:actor.name,authorId:actor.id,at:timestamp});
          existing.last=message;existing.updatedAt=timestamp;existing.staffUnread=(existing.staffUnread??existing.unread??0)+1;existing.unread=existing.staffUnread;
          return this.personalConversation(existing);
        }
        const chat={id:'chat-'+randomUUID(),type,customerId:actor.customerId,userId:actor.id,orderId,escortId:null,escortName:contactName,boss:actor.name,channel:'在线客服',state:'处理中',last:message,unread:1,staffUnread:1,customerUnread:0,createdAt:timestamp,updatedAt:timestamp,slaDueAt:new Date(Date.now()+7200000).toISOString(),notes:[],messages:[{text:message,author:actor.name,authorId:actor.id,at:timestamp}]};
        data.conversations.unshift(chat);return this.personalConversation(chat);
      }
      const message=textInput(input.message||'你好，想咨询一下陪玩服务。','消息内容',1000);
      const escort=data.users.find(u=>u.role==='escort' && u.active && (u.id===input.escortId || u.name===escortName));
      const contact=escort || (escortName?{id:'showcase-'+Buffer.from(escortName).toString('hex').slice(0,24),name:escortName}:null);
      requireThat(contact,'陪玩不存在或已停用',404);
      const existing=data.conversations.find(c=>c.customerId===actor.customerId && !c.orderId && conversationType(c)==='consultation' && c.escortId===contact.id && c.state!=='已结束');
      if(existing){existing.escortUnread=escortUnread(existing)+1;(existing.messages||=[]).push({text:message,author:actor.name,authorId:actor.id,at:now()});existing.last=message;existing.updatedAt=now();existing.staffUnread=(existing.staffUnread??existing.unread??0)+1;existing.unread=existing.staffUnread;return this.personalConversation(existing);}
      const chat={id:'chat-'+randomUUID(),type:'consultation',customerId:actor.customerId,userId:actor.id,escortId:contact.id,escortName:contact.name,boss:actor.name,channel:'站内信',state:'处理中',last:message,unread:1,staffUnread:1,escortUnread:1,customerUnread:0,createdAt:now(),updatedAt:now(),slaDueAt:new Date(Date.now()+7200000).toISOString(),notes:[],messages:[{text:message,author:actor.name,authorId:actor.id,at:now()}]};
      data.conversations.unshift(chat);return this.personalConversation(chat);
    },true);
  }
  withdrawal(user, input) {
    return this.transaction(user, 'withdrawal:create', '申请提现', (data, actor) => {
      requireRealName(actor);
      requireThat(actor.depositCents >= 100000, '押金不足，需达到 ¥1,000 后才可提现');
      const value = String(input.amount);
      requireThat(/^\d+(\.\d{1,2})?$/.test(value), '请输入最多两位小数的金额');
      const total = Math.round(Number(value) * 100);
      requireThat(Number.isSafeInteger(total) && total >= 100 && total <= actor.balanceCents, '提现至少 ¥1，且不能超过可提现余额');
      requireThat(!data.withdrawals.some(w => w.userId === actor.id && ['待审核', '待线下打款'].includes(w.status)), '已有待处理提现，请等待审核或打款完成', 409);
      requireThat(!data.refunds.some(refund => ['待审核', '待线下退款'].includes(refund.status) && data.orders.some(order => order.id === refund.orderId && (order.settledAt || data.ledger.some(entry => entry.source === order.id && entry.label === '订单分成')) && order.participants.some(participant => participant.userId === actor.id))), '存在已结算订单的售后申请，请先完成退款处理再提现', 409);
      const withdrawal = { id: `TX${Date.now()}${randomBytes(6).toString('hex').toUpperCase()}`, userId: actor.id, name: actor.name, amountCents: total, status: '待审核', at: now() };
      actor.balanceCents -= total;
      data.withdrawals.unshift(withdrawal);
      data.ledger.unshift({ id: randomUUID(), userId: actor.id, account: actor.name, deltaCents: -total, afterCents: actor.balanceCents, source: withdrawal.id, label: '提现冻结', by: actor.name, at: now() });
      return withdrawal;
    });
  }
  reviewWithdrawal(user, id, input) {
    return this.transaction(user, 'finance:manage', '复核提现', (data, actor) => {
      const item = data.withdrawals.find(w => w.id === id);
      requireThat(item, '提现申请不存在', 404);
      requireThat(['approve', 'reject', 'markPaid'].includes(input.action), '审核动作无效');
      requireThat(input.action === 'markPaid' ? item.status === '待线下打款' : input.action === 'reject' ? ['待审核', '待线下打款'].includes(item.status) : item.status === '待审核', '该申请已经处理', 409);
      const member = data.users.find(u => u.id === item.userId);
      requireThat(member, '提现成员不存在，请先核对账户', 409);
      requireThat(Number.isSafeInteger(item.amountCents) && item.amountCents > 0 && Number.isSafeInteger(member.balanceCents), '提现金额或成员余额无效，请先核对账户', 409);
      if (input.action !== 'reject') {
        requireRealName(member);
        requireThat(member.active && member.depositCents >= 100000, '成员已停用或押金不足，请先处理');
        requireThat(!data.refunds.some(refund => ['待审核', '待线下退款'].includes(refund.status) && data.orders.some(order => order.id === refund.orderId && (order.settledAt || data.ledger.some(entry => entry.source === order.id && entry.label === '订单分成')) && order.participants.some(participant => participant.userId === member.id))), '该成员有已结算订单正在售后，请先驳回提现释放余额并处理退款', 409);
      }
      if (input.action === 'approve') {
        item.status = '待线下打款'; item.approvedAt = now(); item.approvedBy = actor.name;
      } else if (input.action === 'markPaid') {
        const payoutRef = textInput(input.payoutRef, '打款流水号', 80);
        const key = payoutRef.normalize('NFKC').toUpperCase();
        requireThat(![...data.withdrawals, ...data.refunds].some(record => record.id !== id && record.payoutRef?.trim().normalize('NFKC').toUpperCase() === key), '该打款流水号已经登记，请核对后再操作', 409);
        item.paidAt = now(); item.paidBy = actor.name; item.payoutRef = payoutRef; item.status = '已打款';
        data.ledger.unshift({ id: randomUUID(), userId: member.id, account: member.name, deltaCents: 0, externalAmountCents: -item.amountCents, afterCents: member.balanceCents, source: id, label: '提现打款', payoutRef, by: actor.name, at: now() });
      } else {
        requireThat(Number.isSafeInteger(member.balanceCents + item.amountCents), '返还后余额无效，请先核对账户', 409);
        item.reason = textInput(input.reason, '驳回原因', 200); item.status = '已驳回'; member.balanceCents += item.amountCents;
        data.ledger.unshift({ id: randomUUID(), userId: member.id, account: member.name, deltaCents: item.amountCents, afterCents: member.balanceCents, source: id, label: '提现退回', by: actor.name, at: now() });
      }
      item.reviewedAt = now(); item.reviewedBy = actor.name;
      if (input.action !== 'reject' && input.reason) item.reviewNote = textInput(input.reason, '审核说明', 200);
      return item;
    });
  }
  createTopup(user, input) {
    return this.transaction(user, 'topup:create', '提交充值申请', (data, actor) => {
      requireRealName(data.users.find(candidate => candidate.id === actor.id));
      const customer = data.customers.find(item => item.id === actor.customerId);
      requireThat(customer && customer.active !== false, '用户资料不可用，无法提交充值申请', 409);
      const amountCents = input.amountCents;
      requireThat(Number.isSafeInteger(amountCents) && amountCents >= 100 && amountCents <= 100000000, '充值金额应为 1–1,000,000 元的整数分');
      requireThat(typeof input.requestId === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(input.requestId), '充值请求无效，请重新打开充值窗口');
      const note = input.note == null || input.note === '' ? '' : textInput(input.note, '充值备注', 200);
      const paymentChannel = input.paymentChannel == null || input.paymentChannel === '' ? '' : textInput(input.paymentChannel, '付款渠道', 30);
      const receiptReference = input.receiptReference == null || input.receiptReference === '' ? '' : textInput(input.receiptReference, '交易单号', 100);
      const previous = data.topups.find(item => item.customerId === customer.id && item.requestId === input.requestId);
      if (previous) {
        requireThat(previous.amountCents === amountCents && previous.note === note && (previous.requestPaymentChannel ?? previous.paymentChannel ?? '') === paymentChannel && (previous.requestReceiptReference ?? previous.receiptReference ?? '') === receiptReference, '该充值请求已经提交，请重新打开充值窗口', 409);
        return previous;
      }
      if (receiptReference) {
        const key = receiptReference.normalize('NFKC').toUpperCase();
        requireThat(!data.topups.some(item => item.state !== '已驳回' && item.receiptReference?.trim().normalize('NFKC').toUpperCase() === key), '该交易单号已有充值申请，请勿重复提交', 409);
      }
      const id = `CZ${Date.now()}${randomBytes(2).toString('hex').toUpperCase()}`;
      const item = { id, user: customer.name, customerId: customer.id, amountCents, amount: amount(amountCents), before: amount(customer.balanceCents), after: '待审核后计算', state: '待审核', proof: '待核验', note, paymentChannel, receiptReference, requestPaymentChannel: paymentChannel, requestReceiptReference: receiptReference, requestId: input.requestId, requestedAt: now() };
      data.topups.unshift(item);
      return item;
    }, true);
  }
  topupAction(user, id, input) {
    return this.transaction(user, 'finance:manage', '充值审核', (data, actor) => {
      const item = data.topups.find(t => t.id === id);
      requireThat(item, '充值申请不存在', 404);
      requireThat(item.state === '待审核', '充值申请已处理', 409);
      requireThat(['approve', 'reject'].includes(input.action), '审核动作无效');
      const reason = textInput(input.reason, input.action === 'approve' ? '凭证核验说明' : '驳回原因', 200);
      if (input.action === 'approve') {
        const receiptReference = textInput(input.receiptReference || item.receiptReference, '实际收款交易单号', 100);
        const key = receiptReference.normalize('NFKC').toUpperCase();
        requireThat(!data.topups.some(other => other.id !== id && other.state === '已通过' && other.receiptReference?.trim().normalize('NFKC').toUpperCase() === key), '该交易单号已经入账，请勿重复充值', 409);
        requireThat(!data.ledger.some(entry => entry.source === id && entry.label === '充值入账'), '该充值已经入账，请核对记录', 409);
        const matches = data.customers.filter(c => c.name === item.user);
        requireThat(item.customerId || matches.length <= 1, '存在同名用户，充值申请需关联用户 ID');
        const customer = item.customerId ? data.customers.find(c => c.id === item.customerId) : matches[0];
        requireThat(customer, '找不到充值用户，请先核对申请归属', 409);
        requireRealName(data.users.find(account => account.customerId === customer.id));
        requireThat(customer.active !== false, '充值用户已停用，无法入账', 409);
        requireThat(Number.isSafeInteger(item.amountCents) && item.amountCents > 0 && Number.isSafeInteger(customer.balanceCents) && Number.isSafeInteger(customer.balanceCents + item.amountCents), '充值金额或余额无效，无法入账', 409);
        item.customerId = customer.id; item.receiptReference = receiptReference;
        if (input.paymentChannel) item.paymentChannel = textInput(input.paymentChannel, '付款渠道', 30);
        item.before = amount(customer.balanceCents); customer.balanceCents += item.amountCents; item.after = amount(customer.balanceCents);
        item.state = '已通过'; item.proof = '已核验';
        data.ledger.unshift({ id: randomUUID(), userId: null, customerId: customer.id, account: customer.name, deltaCents: item.amountCents, afterCents: customer.balanceCents, source: id, label: '充值入账', receiptReference, by: actor.name, at: now() });
      } else { item.state = '已驳回'; item.proof = reason; }
      item.reviewNote = reason; item.reviewedAt = now(); item.reviewedBy = actor.name;
      return item;
    });
  }
  createRefund(user, input) {
    return this.transaction(user, personalContext(user,input) ? 'refund:create' : can(user, 'refund:manage') || can(user, 'refund:create') ? (can(user, 'refund:manage') ? 'refund:manage' : 'refund:create') : 'order:review', '创建退款申请', (data, actor) => {
      const order = data.orders.find(o => o.id === input.orderId);
      requireThat(order, '订单不存在', 404);
      if (actor.role === 'user') requireThat(order.customerId === actor.customerId, '只能申请自己的订单退款', 403);
      requireThat(['待接单', '待确认', '待服务', '陪玩中', '已完成', '待验收'].includes(order.status), '当前订单不可申请退款', 409);
      requireThat(!['未支付', '待支付'].includes(order.paymentStatus), '订单尚未支付，不能申请退款', 409);
      const value = input.amountCents;
      const refunded = Number(order.refundedCents || 0);
      requireThat(Number.isSafeInteger(value) && value > 0 && value <= order.amountCents - refunded, '退款金额不能超过订单可退余额');
      requireThat(!data.refunds.some(r => r.orderId === order.id && ['待审核', '待线下退款'].includes(r.status)), '该订单已有待处理退款', 409);
      const item = { id: `RF${Date.now()}${randomBytes(2).toString('hex').toUpperCase()}`, orderId: order.id, customer: order.boss, amountCents: value, reason: textInput(input.reason, '退款原因', 200), status: '待审核', originalStatus: order.status, requestedAt: now(), requestedBy: actor.name, channel: walletPayment(order) ? '余额原路' : '线下人工' };
      data.refunds.unshift(item); order.status = '退款审核'; order.version++; order.history.push({ action: '创建退款申请', by: actor.name, at: now(), note: item.reason });
      return item;
    }, personalContext(user,input));
  }
  reviewRefund(user, id, input) {
    return this.transaction(user, 'refund:manage', '复核退款申请', (data, actor) => {
      const item = data.refunds.find(r => r.id === id);
      requireThat(item, '退款申请不存在', 404);
      requireThat(['approve', 'reject', 'markPaid'].includes(input.action), '审核动作无效');
      requireThat(input.action === 'markPaid' ? item.status === '待线下退款' : input.action === 'reject' ? ['待审核', '待线下退款'].includes(item.status) : item.status === '待审核', '退款申请已经处理', 409);
      if (input.action === 'markPaid') permit(actor, 'finance:manage');
      const order = data.orders.find(o => o.id === item.orderId);
      requireThat(order, '关联订单不存在', 409);
      requireThat(order.status === '退款审核', '订单状态已变化，请刷新并核对售后记录', 409);
      const wallet = walletPayment(order);
      if (input.action === 'reject') {
        item.status = '已驳回'; item.reviewNote = textInput(input.reason, '驳回原因', 200); order.status = item.originalStatus || '已完成';
      } else {
        const customer = data.customers.find(c => c.id === order.customerId);
        requireThat(Number.isSafeInteger(item.amountCents) && item.amountCents > 0 && item.amountCents <= order.amountCents - (order.refundedCents || 0), '退款金额超过剩余可退金额', 409);
        if (input.action === 'approve' && !wallet) {
          reverseRefundEarnings(data, order, item, actor, { validateOnly: true });
          item.status = '待线下退款'; item.approvedAt = now(); item.approvedBy = actor.name;
          item.reviewNote = input.reason ? textInput(input.reason, '审核说明', 200) : '';
          item.reviewedAt = now(); item.reviewedBy = actor.name;
          order.version++; order.history.push({ action: '退款审核通过，等待线下退款', by: actor.name, at: now(), note: `${amount(item.amountCents)} · ${item.channel}` });
          return item;
        }
        if (!wallet) {
          const payoutRef = textInput(input.payoutRef, '退款打款流水号', 80);
          const key = payoutRef.normalize('NFKC').toUpperCase();
          requireThat(![...data.withdrawals, ...data.refunds].some(record => record.id !== id && record.payoutRef?.trim().normalize('NFKC').toUpperCase() === key), '该打款流水号已经登记，请核对后再操作', 409);
          item.payoutRef = payoutRef;
        }
        requireThat(!data.ledger.some(entry => entry.source === id && ['订单退款', '线下订单退款'].includes(entry.label)), '该退款已经入账，请核对记录', 409);
        reverseRefundEarnings(data,order,item,actor);
        if (wallet) {
          requireThat(customer, '找不到原支付用户，无法原路退款', 409);
          requireThat(Number.isSafeInteger(customer.balanceCents) && Number.isSafeInteger(customer.balanceCents + item.amountCents), '退款后余额无效，请先核对账户', 409);
          customer.balanceCents += item.amountCents;
          data.ledger.unshift({ id: randomUUID(), userId: null, customerId: customer.id, account: customer.name, deltaCents: item.amountCents, afterCents: customer.balanceCents, source: item.id, label: '订单退款', by: actor.name, at: now() });
        } else {
          data.ledger.unshift({ id: randomUUID(), userId: null, customerId: order.customerId || null, account: order.boss, deltaCents: 0, externalAmountCents: -item.amountCents, afterCents: customer?.balanceCents ?? null, source: item.id, orderId: order.id, label: '线下订单退款', payoutRef: item.payoutRef, by: actor.name, at: now() });
        }
        order.refundedCents = Number(order.refundedCents || 0) + item.amountCents;
        order.status = order.refundedCents >= order.amountCents ? '已退款' : (item.originalStatus || '已完成');
        if (!order.settledAt && !data.ledger.some(l=>l.source===order.id && l.label==='订单分成')) lockEarnings(order.amountCents-order.refundedCents, order.participants);
        item.status = wallet ? '已通过' : '已退款'; item.approvedAt ||= now(); item.approvedBy ||= actor.name; item.paidAt = now(); item.paidBy = actor.name;
        if (input.reason) item.reviewNote = textInput(input.reason, '审核说明', 200);
        order.history.push({ action: wallet ? '退款审核通过' : '线下退款已打款', by: actor.name, at: now(), note: `${amount(item.amountCents)} · ${item.channel}${item.payoutRef ? ` · ${item.payoutRef}` : ''}` });
      }
      item.reviewedAt = now(); item.reviewedBy = actor.name;
      order.version++;
      if(input.action==='reject')order.history.push({action:'退款申请驳回',by:actor.name,at:now(),note:item.reviewNote});
      return item;
    });
  }
  auditList(user, input = {}) {
    const data = this.read();
    const actor = data.users.find(u => u.id === user.id && u.active);
    requireThat(actor, '登录已失效', 401); permit(actor, 'account:manage');
    const query = String(input.query || '').trim().toLowerCase();
    requireThat(query.length <= 100, '审计检索条件过长');
    return data.audit.filter(item => !query || [item.action, item.by, item.at].some(value => String(value || '').toLowerCase().includes(query))).slice(0, 200);
  }
  setOnline(user, input) {
    return this.transaction(user, 'profile:update', '更新在线状态', (data, actor) => {
      requireThat(typeof input.online === 'boolean', '在线状态无效');
      if (input.online && actor.role === 'escort') requireRealName(actor);
      actor.online = input.online;
      return publicUser(actor);
    });
  }
  updateProfile(user, input) {
    return this.transaction(user, 'profile:update', '更新个人主页', (data, actor) => {
      const payload = input && typeof input === 'object' ? input : {};
      const name = textInput(payload.name, '昵称', 30);
      const avatar = typeof payload.avatar === 'string' ? payload.avatar.trim() : '';
      const preset = /^\/src\/escort-(0[1-9]|1[0-4])\.jpg$/.test(avatar);
      const dataUrlMatch = avatar.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/);
      if (avatar) {
        requireThat(avatar.length <= 90000, '头像数据过大');
        requireThat(preset || Boolean(dataUrlMatch), '头像格式无效');
        if (dataUrlMatch) {
          let bytes;
          try { bytes = Buffer.from(dataUrlMatch[1], 'base64'); } catch { bytes = null; }
          requireThat(bytes && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff, '头像必须是有效的 JPEG 图片');
        }
      }
      const bio = typeof payload.bio === 'string' ? payload.bio.trim() : '';
      requireThat(bio.length <= 240, '个人介绍最多 240 个字符');
      requireThat(payload.tags === undefined || Array.isArray(payload.tags), '个人标签格式无效');
      const tags = Array.isArray(payload.tags) ? [...new Set(payload.tags.map(tag => {
        requireThat(typeof tag === 'string', '个人标签格式无效');
        return tag.trim();
      }).filter(Boolean))].slice(0, 8) : [];
      requireThat(tags.every(tag => tag.length <= 24), '个人标签过长');
      Object.assign(actor, { name, avatar, bio, profileTags: tags });
      // Keep the linked customer display name in sync. Historical orders retain
      // their original boss/name snapshots because they are stored separately.
      if (actor.customerId) {
        const customer = data.customers.find(item => item.id === actor.customerId);
        if (customer) customer.name = name;
      }
      return publicUser(actor);
    });
  }
  examinerAction(user, id, input) {
    return this.transaction(user, 'account:manage', '更新考官资格', data => {
      const target = data.users.find(u=>u.id===id && u.role==='escort');
      requireThat(target, '陪玩成员不存在', 404);
      requireThat(typeof input.examiner === 'boolean', '考官资格无效');
      requireThat(!input.examiner || (target.active && target.games.length > 0), '只有已启用且配置游戏技能的成员才能设置为考官');
      target.examiner = input.examiner;
      return publicUser(target);
    });
  }
  createAssessment(user, input = {}) {
    return this.transaction(user, 'assessment:manage', '创建考核记录', (data, actor) => {
      const memberId = String(input.memberId || input.userId || input.escortId || '').trim();
      const target = data.users.find(u => u.id === memberId || u.memberNo === memberId);
      requireThat(target && ['member', 'escort'].includes(target.role), '请选择有效的待考核成员', 404);
      const rawType = input.type || input.kind || (target.role === 'escort' ? '质检' : '入店考核');
      const type = ({ entry: '入店考核', admission: '入店考核', quality: '质检', qc: '质检' })[String(rawType).toLowerCase()] || rawType;
      requireThat(['入店考核', '质检'].includes(type), '考核类型无效');
      requireThat(type === '入店考核' || target.active, '成员账号已停用，无法进行质检', 400);
      requireThat(type === '入店考核' ? target.role === 'member' || input.allowEscort === true : target.role === 'escort', '考核类型与成员身份不匹配');
      const game = input.game ? String(input.game).trim() : '';
      if (game) requireThat(catalogNames(data).has(game), '请选择有效的游戏');
      const stats = input.stats && typeof input.stats === 'object' ? input.stats : {};
      const number = (value, label, max = 1000000) => { if (value === undefined || value === null || value === '') return null; const n = Number(value); requireThat(Number.isFinite(n) && n >= 0 && n <= max, `${label}无效`); return n; };
      const score = number(input.score, '评分', 100);
      if (input.status !== undefined) requireThat(['待考核', '进行中', '已完成', '已取消'].includes(input.status), '考核状态无效');
      const record = {
        id: `EX${Date.now()}${randomBytes(2).toString('hex').toUpperCase()}`,
        memberId: target.id, memberNo: target.memberNo, memberName: target.name, type, game,
        levelId: input.levelId || target.levelId || null,
        status: input.result ? '已完成' : (input.status || '待考核'),
        result: input.result || null, score,
        wins: number(input.wins ?? stats.wins, '胜场'), losses: number(input.losses ?? stats.losses, '败场'),
        kills: number(input.kills ?? stats.kills, '击杀'), deaths: number(input.deaths ?? stats.deaths, '死亡'),
        mvp: number(input.mvp ?? stats.mvp, 'MVP次数'),
        evidence: input.evidence ? textInput(String(input.evidence), '战绩凭证', 1000) : '',
        note: input.note || input.notes ? textInput(String(input.note || input.notes), '考核备注', 1000) : '',
        scheduledAt: input.scheduledAt ? String(input.scheduledAt) : null,
        orderId: input.orderId ? String(input.orderId) : null,
        examinerId: actor.id, examinerName: actor.name, createdAt: now(), updatedAt: now(), version: 1,
      };
      record.performance = { wins: record.wins, losses: record.losses, kills: record.kills, deaths: record.deaths, mvp: record.mvp };
      requireThat(!record.result || ['通过', '不通过', '待复核'].includes(record.result), '考核结果无效');
      data.assessments.unshift(record);
      return record;
    });
  }
  updateAssessment(user, id, input = {}) {
    return this.transaction(user, 'assessment:manage', '更新考核结果', (data, actor) => {
      const record = data.assessments.find(item => item.id === id);
      requireThat(record, '考核记录不存在', 404);
      if (input.version !== undefined) requireThat(Number(input.version) === Number(record.version), '考核记录已更新，请刷新后重试', 409);
      if (input.game !== undefined) { const game = String(input.game).trim(); requireThat(!game || catalogNames(data).has(game), '请选择有效的游戏'); record.game = game; }
      if (input.levelId !== undefined) { requireThat(!input.levelId || levelOf(data, input.levelId), '请选择有效的陪玩等级'); record.levelId = input.levelId || null; }
      for (const [key, label, max] of [['score', '评分', 100], ['wins', '胜场', 1000000], ['losses', '败场', 1000000], ['kills', '击杀', 1000000], ['deaths', '死亡', 1000000], ['mvp', 'MVP次数', 1000000]]) {
        if (input[key] !== undefined) { const n = Number(input[key]); requireThat(Number.isFinite(n) && n >= 0 && n <= max, `${label}无效`); record[key] = n; }
      }
      if (input.stats && typeof input.stats === 'object') for (const key of ['wins', 'losses', 'kills', 'deaths', 'mvp']) if (input.stats[key] !== undefined) { const n = Number(input.stats[key]); requireThat(Number.isFinite(n) && n >= 0, `${key}无效`); record[key] = n; }
      if (input.evidence !== undefined) record.evidence = textInput(String(input.evidence), '战绩凭证', 1000);
      if (input.note !== undefined || input.notes !== undefined) record.note = textInput(String(input.note ?? input.notes), '考核备注', 1000);
      if (input.result !== undefined) { const result = ({ pass: '通过', passed: '通过', fail: '不通过', failed: '不通过', pending: '待复核' })[String(input.result).toLowerCase()] || input.result; requireThat(['通过', '不通过', '待复核'].includes(result), '考核结果无效'); record.result = result; record.status = '已完成'; }
      if (input.status !== undefined) { requireThat(['待考核', '已完成', '已取消'].includes(input.status), '考核状态无效'); record.status = input.status; }
      record.performance = { wins: record.wins ?? null, losses: record.losses ?? null, kills: record.kills ?? null, deaths: record.deaths ?? null, mvp: record.mvp ?? null };
      record.updatedAt = now(); record.updatedBy = actor.name; record.version = Number(record.version || 1) + 1;
      return record;
    });
  }
  assessmentAction(user, id, input = {}) { return id ? this.updateAssessment(user, id, input) : this.createAssessment(user, input); }
  validateProfile(data, target, games, levelId) {
    const names = catalogNames(data);
    requireThat(Array.isArray(games) && games.length <= names.size && games.every(game => names.has(game)), '请选择有效的游戏');
    requireThat(levelOf(data, levelId), '请选择有效的陪玩等级');
    const next = { ...target, games: [...new Set(games)], levelId };
    requireThat(!profileConflicts(data, next), '此变更会使成员不再符合已派订单要求，请先退回待确认或待服务订单', 409);
    Object.assign(target, { games: next.games, levelId, shareBps: rateOf(data, next, next.games[0]) });
    if (!games.length) { target.online = false; target.examiner = false; }
  }
  membershipAction(user, id, action, input) {
    return this.transaction(user, 'account:manage', `成员 ${id} · ${action}`, (data, actor) => {
      const target = data.users.find(u => u.id === id);
      if (action === 'escort' && target) requireRealName(target);
      requireThat(target && isClubMember(target), '成员不存在，请先按用户 ID 加入俱乐部', 404);
      requireThat(input.memberVersion === target.memberVersion, '成员资料已更新，请刷新后重试', 409);
      if (action === 'role') {
        requireThat(target.role !== 'escort', '请先在陪玩管理中取消陪玩身份');
        requireThat(Object.hasOwn(roles, input.role) && !['escort', 'user'].includes(input.role), '请选择有效的管理角色');
        requireThat(target.id !== actor.id || input.role === 'admin', '不能移除自己的最高负责人权限');
        target.role = input.role;
      } else if (action === 'escort') {
        requireThat(target.role !== 'escort', '该成员已是陪玩', 409);
        requireThat(target.id !== actor.id, '不能移除自己的最高负责人权限');
        requireThat(target.active, '请先启用该成员账号');
        const deposit = input.depositCents === undefined ? Number(target.depositCents || 0) : Number(input.depositCents);
        requireThat(Number.isSafeInteger(deposit) && deposit >= 0, '请输入有效的押金金额');
        target.role = 'escort'; target.online = false; target.escortFrozen = false;
        target.depositCents = deposit;
        this.validateProfile(data, target, input.games || [], input.levelId || 'gold');
      } else if (action === 'profile') {
        requireThat(target.role === 'escort', '该成员不是陪玩');
        this.validateProfile(data, target, input.games, input.levelId);
      } else if (action === 'freeze') {
        requireThat(target.role === 'escort' && typeof input.frozen === 'boolean', '陪玩冻结参数无效');
        target.escortFrozen = input.frozen;
        if (input.frozen) target.online = false;
      } else if (action === 'remove') {
        requireThat(target.role === 'escort', '该成员不是陪玩');
        requireThat(!hasOpenOrders(data, id), '仍有未完成订单，请处理后再取消陪玩身份', 409);
        requireThat(target.balanceCents === 0 && !target.frozenBalanceCents && !data.withdrawals.some(w => w.userId === id && ['待审核','待线下打款'].includes(w.status)), '请先结清陪玩余额、冻结收益和提现，再取消陪玩身份', 409);
        Object.assign(target, { role: 'member', levelId: null, games: [], shareBps: 0, examiner: false, online: false, escortFrozen: false });
      } else if (action === 'leaveClub') {
        requireThat(target.id !== actor.id, '不能移除自己的最高负责人权限');
        requireThat(!hasOpenOrders(data, id), '请先处理未完成订单', 409);
        requireThat(!target.balanceCents && !target.frozenBalanceCents && !target.depositCents && !data.withdrawals.some(w => w.userId === id && ['待审核', '待线下打款'].includes(w.status)), '请先结清成员收益、押金和提现', 409);
        Object.assign(target, { role: 'user', levelId: null, games: [], shareBps: 0, examiner: false, online: false, escortFrozen: false });
      } else if (action === 'status') {
        requireThat(typeof input.active === 'boolean', '成员状态无效');
        requireThat(target.id !== actor.id || input.active, '不能停用自己的账号');
        target.active = input.active;
        if (!input.active) { target.online = false; target.examiner = false; }
      } else if (action === 'freezeBalance') {
        const amount = Number(input.amountCents);
        requireThat(Number.isSafeInteger(amount) && amount > 0, '请输入有效的冻结金额');
        requireThat(amount <= target.balanceCents, '冻结金额不能超过可提现余额');
        requireThat(Number.isSafeInteger(target.balanceCents - amount) && Number.isSafeInteger((target.frozenBalanceCents || 0) + amount), '冻结后余额无效，请先核对账户', 409);
        target.balanceCents -= amount;
        target.frozenBalanceCents = (target.frozenBalanceCents || 0) + amount;
        data.ledger.unshift({ id: randomUUID(), userId: target.id, account: target.name, deltaCents: -amount, afterCents: target.balanceCents, source: `member-freeze-${randomUUID()}`, label: '人工冻结', by: actor.name, at: now() });
      } else if (action === 'unfreezeBalance') {
        const amount = Number(input.amountCents || target.frozenBalanceCents || 0);
        requireThat(Number.isSafeInteger(amount) && amount > 0 && amount <= (target.frozenBalanceCents || 0), '解冻金额无效');
        requireThat(Number.isSafeInteger(target.balanceCents + amount) && Number.isSafeInteger((target.frozenBalanceCents || 0) - amount), '解冻后余额无效，请先核对账户', 409);
        target.frozenBalanceCents -= amount;
        target.balanceCents += amount;
        data.ledger.unshift({ id: randomUUID(), userId: target.id, account: target.name, deltaCents: amount, afterCents: target.balanceCents, source: `member-unfreeze-${randomUUID()}`, label: '人工解冻', by: actor.name, at: now() });
      } else requireThat(false, '成员操作不存在', 404);
      target.memberVersion++;
      if (['role','escort','remove','status','leaveClub'].includes(action)) this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      return memberRecord(data, target, publicUser);
    });
  }
  bindSkills(user, input) {
    return this.transaction(user, 'account:manage', '批量绑定游戏技能', data => {
      requireThat(Array.isArray(input.members) && input.members.length > 0 && input.members.length <= 100 && new Set(input.members.map(m => m.id)).size === input.members.length, '请选择 1–100 位陪玩');
      requireThat(Array.isArray(input.games) && input.games.length > 0, '请至少选择一个游戏');
      for (const item of input.members) {
        const target = data.users.find(u => u.id === item.id && u.role === 'escort');
        requireThat(target && target.memberVersion === item.memberVersion, '成员资料已更新，请刷新后重新选择', 409);
        this.validateProfile(data, target, [...new Set([...target.games.filter(game => catalogNames(data).has(game)), ...input.games])], target.levelId);
        target.memberVersion++;
      }
      return { ok: true };
    });
  }
  configureLevels(user, input) {
    return this.transaction(user, 'account:manage', '更新等级分成', data => {
      const validateSharedLevels = levels => {
        const ids = new Set(levels.map(level => level.id));
        requireThat(levels.every(level => Number.isSafeInteger(level.rank) && level.rank > 0) && new Set(levels.map(level => level.rank)).size === levels.length, '等级排序必须为不同的正整数');
        const referenced = id => data.users.some(member => member.levelId === id)
          || data.orders.some(order => order.levelId === id || order.participants?.some(member => member.levelId === id))
          || data.assessments.some(record => record.levelId === id)
          || Object.entries(data.gameLevelConfigs || {}).some(([game, config]) => game !== '三角洲行动' && config.levels?.some(level => level.id === id));
        requireThat(data.levels.every(level => ids.has(level.id) || !referenced(level.id)), '等级已有成员、订单或游戏配置引用，请保留该等级', 409);
        const candidate = { ...data, levels };
        requireThat(data.users.filter(member => member.role === 'escort').every(member => profileConflicts(data, member) || !profileConflicts(candidate, member)), '等级排序变更会使成员不再符合现有订单，请先处理相关订单', 409);
      };
      if (input.game) {
        const gameName = String(input.game).trim();
        requireThat(catalogNames(data).has(gameName), '请选择有效的游戏');
        data.gameLevelConfigs ||= {};
        const creatingStructure = !data.gameLevelConfigs[gameName]?.levels?.length;
        const config = data.gameLevelConfigs[gameName] ||= { levels: [], version: 1 };
        requireThat((input.version ?? input.revision) === (config.version || 1), '配置已更新，请刷新后重试', 409);
        requireThat(Array.isArray(input.levels) && input.levels.length >= 1 && input.levels.length <= 12 && new Set(input.levels.map(l => l.id)).size === input.levels.length, '等级数量必须为 1–12 个');
        const levels = input.levels.map((item, index) => {
          const id = String(item.id || '').trim();
          const previous = (config.levels || []).find(level => level.id === id);
          const suppliedPrice = item.priceCents === undefined ? previous?.priceCents : Number(item.priceCents);
          return { id, name: String(item.name || '').trim(), rank: Number(item.rank || input.levels.length - index), shareBps: Number(item.shareBps), ...(suppliedPrice === undefined ? {} : { priceCents: suppliedPrice }) };
        });
        requireThat(levels.every(l => /^[A-Za-z0-9_-]{1,40}$/.test(l.id) && l.name && Number.isInteger(l.shareBps) && l.shareBps > 0 && l.shareBps <= 10000), '等级配置无效');
        requireThat(new Set(levels.map(level => level.id)).size === levels.length, '等级标识不能重复');
        requireThat(levels.every(level => Number.isSafeInteger(level.rank) && level.rank > 0) && new Set(levels.map(level => level.rank)).size === levels.length, '等级排序必须为不同的正整数');
        if (gameName === '三角洲行动') validateSharedLevels(levels);
        else requireThat(levels.every(level => data.levels.some(shared => shared.id === level.id)), '游戏等级需使用现有陪玩等级；新增等级请先在三角洲行动等级配置中设置');
        const pricesProvided = levels.some(level => Object.hasOwn(level, 'priceCents'));
        // Creating a game's level/share structure may precede price entry in
        // the management UI. Permit that first step only when no price was
        // supplied; once prices exist, every configured level must carry a
        // valid positive amount.
        requireThat(!pricesProvided || levels.every(l => Number.isSafeInteger(l.priceCents) && l.priceCents > 0 && l.priceCents <= 100000000), '等级价格必须为正数，且最多 100 万元');
        requireThat(levels.every((level, index) => !index || levels[index - 1].shareBps > level.shareBps), '分成须从高等级到低等级递减');
        config.levels = levels;
        // Legacy clients first create non-Delta game levels without prices and
        // then call /level-prices with the original token. Keep that setup
        // compatible; once a priced configuration exists, every edit advances
        // its optimistic-concurrency version.
        if (!creatingStructure || pricesProvided) config.version = (config.version || 1) + 1;
        else config.version ||= 1;
        if (gameName === '三角洲行动') {
          data.levelPrices = Object.fromEntries(levels.map(level => [level.id, level.priceCents]));
          data.levelPriceVersion = config.version;
          data.levels = levels.map(({ priceCents, ...level }) => ({ ...level }));
          for (const member of data.users.filter(user => user.role === 'escort')) { member.shareBps = rateOf(data, member, member.games?.[0]); member.memberVersion++; }
        }
        return levels;
      }
      // Catalog uses the dedicated levelPriceVersion token. Keep accepting
      // revision for older management screens and API clients.
      const expected = input.version === undefined && input.revision !== undefined ? data.revision : (data.levelPriceVersion || 1);
      requireThat((input.version ?? input.revision) === expected, '配置已更新，请刷新后重试', 409);
      requireThat(Array.isArray(input.levels) && input.levels.length >= 1 && input.levels.length <= 12 && new Set(input.levels.map(l => l.id)).size === input.levels.length, '等级数量必须为 1–12 个');
      const levels = input.levels.map((item, index) => ({ id: String(item.id || '').trim(), name: String(item.name || '').trim(), rank: Number(item.rank || input.levels.length - index), shareBps: Number(item.shareBps) }));
      requireThat(levels.every(l => /^[A-Za-z0-9_-]{1,40}$/.test(l.id)), '等级标识无效');
      requireThat(levels.every(l => l.name && Number.isInteger(l.shareBps) && l.shareBps > 0 && l.shareBps <= 10000), '等级名称和分成配置无效');
      requireThat(levels.every((l, i) => Number.isInteger(l.shareBps) && l.shareBps > 0 && l.shareBps <= 10000 && (!i || levels[i-1].shareBps > l.shareBps)), '分成须大于 0 且不超过 100%，从明星到金牌依次递减');
      validateSharedLevels(levels);
      data.levels = levels;
      if (data.gameLevelConfigs?.['三角洲行动']) data.gameLevelConfigs['三角洲行动'].levels = levels.map(level => ({ ...level, priceCents: data.gameLevelConfigs['三角洲行动'].levels?.find(item => item.id === level.id)?.priceCents }));
      const validIds = new Set(levels.map(level => level.id));
      const fallback = levels[levels.length - 1];
      for (const target of data.users.filter(u => u.role === 'escort')) {
        if (!validIds.has(target.levelId)) target.levelId = fallback.id;
        target.shareBps = rateOf(data, target, target.games?.[0]); target.memberVersion++;
      }
      data.levelPriceVersion = (data.levelPriceVersion || 1) + 1;
      if (data.gameLevelConfigs?.['三角洲行动']) data.gameLevelConfigs['三角洲行动'].version = data.levelPriceVersion;
      return levels;
    });
  }
  configureLevelPrices(user, input) {
    return this.transaction(user, 'account:manage', '更新三角洲陪玩定价', data => {
      if (input.game) {
        const gameName = String(input.game).trim();
        const config = data.gameLevelConfigs?.[gameName];
        requireThat(catalogNames(data).has(gameName), '请选择有效的游戏');
        requireThat(config, '该游戏尚未配置等级，请先添加等级');
        requireThat((input.version ?? input.revision) === (config.version || 1), '配置已更新，请刷新后重试', 409);
        requireThat(input.prices && typeof input.prices === 'object', '定价配置数据不完整');
        const next = {};
        for (const level of config.levels || []) {
          const supplied = Array.isArray(input.prices) ? input.prices.find(item => String(item.levelId) === level.id)?.priceCents : input.prices[level.id];
          const value = Number(supplied);
          requireThat(Number.isSafeInteger(value) && value > 0 && value <= 100000000, '价格必须为正数，且最多 100 万元');
          next[level.id] = value;
        }
        config.levels = config.levels.map(level => ({ ...level, priceCents: next[level.id] }));
        config.version = (config.version || 1) + 1;
        if (gameName === '三角洲行动') { data.levelPrices = next; data.levelPriceVersion = config.version; data.levels = config.levels.map(({ priceCents, ...level }) => level); }
        return next;
      }
      const expected = input.version === undefined && input.revision !== undefined ? data.revision : (data.levelPriceVersion || 1);
      requireThat((input.version ?? input.revision) === expected, '配置已更新，请刷新后重试', 409);
      requireThat(input.prices && typeof input.prices === 'object', '定价配置数据不完整');
      const next = {};
      for (const level of data.levels) {
        const supplied = Array.isArray(input.prices) ? input.prices.find(item => String(item.levelId) === level.id)?.priceCents : input.prices[level.id];
        const value = Number(supplied);
        requireThat(Number.isSafeInteger(value) && value > 0 && value <= 100000000, '价格必须为正数，且最多 100 万元');
        next[level.id] = value;
      }
      data.levelPrices = next;
      data.levelPriceVersion = (data.levelPriceVersion || 1) + 1;
      if (data.gameLevelConfigs?.['三角洲行动']) { data.gameLevelConfigs['三角洲行动'].levels = data.gameLevelConfigs['三角洲行动'].levels.map(level => ({ ...level, priceCents: next[level.id] })); data.gameLevelConfigs['三角洲行动'].version = data.levelPriceVersion; }
      return next;
    });
  }
  configureCommissions(user, input) {
    return this.transaction(user, 'finance:manage', '更新游戏抽佣配置', data => {
      const games = catalogList(data);
      requireThat(Array.isArray(input.games) && input.games.length === games.length && new Set(input.games.map(game => game.name)).size === games.length, '抽佣配置数据不完整');
      const ids = new Set(games.map(g => g.name));
      requireThat(input.games.every(g => ids.has(g.name) && Number.isInteger(g.commissionBps) && g.commissionBps > 0 && g.commissionBps <= 10000), '抽佣比例需为 0.01%–100%');
      for (const item of input.games) {
        games.find(g => g.name === item.name).commissionBps = item.commissionBps;
        const historical = data.games.find(g => g.name === item.name);
        if (historical) historical.commissionBps = item.commissionBps;
      }
      for (const target of data.users.filter(u => u.role === 'escort')) { target.shareBps = rateOf(data, target, target.games?.[0]); target.memberVersion++; }
      return games.map(({ name, commissionBps }) => ({ name, commissionBps }));
    });
  }
  accountAction(user, id, input) {
    return this.transaction(user, 'account:manage', id ? '更新成员权限' : input.action === 'joinById' ? '加入俱乐部成员' : '创建成员账号', (data, actor) => {
      if (!id && input.action === 'joinById') {
        const externalId = textInput(input.userId, '用户 ID', 80);
        const source = data.customers.find(customer => customer.id === externalId || customer.customerNo === externalId);
        let target = data.users.find(u => u.id === externalId || u.memberNo === externalId || (source && u.customerId === source.id));
        if (!target && source) {
          target = { id: randomUUID(), memberNo: source.customerNo, username: `member-${source.customerNo}`, name: source.name, role: 'user', active: true, online: false, games: [], balanceCents: 0, frozenBalanceCents: 0, depositCents: 0, shareBps: 0, memberVersion: 0, customerId: source.id, passwordHash: passwordHash(randomBytes(24).toString('hex')) };
          data.users.push(target);
        }
        requireThat(target, '未找到已注册用户，请核对个人中心的用户 ID', 404);
        requireThat(!isClubMember(target), '该用户已经是俱乐部成员', 409);
        requireThat(target.active, '用户账号已停用', 409);
        target.role = 'member'; target.memberVersion++;
        return publicUser(target);
      }
      requireThat(Object.hasOwn(roles, input.role), '职责无效');
      let target = id ? data.users.find(u => u.id === id) : null;
      if (id) requireThat(target, '成员不存在', 404);
      if (id) requireThat(isClubMember(target) && input.role !== 'user', '请通过成员加入或移除操作变更成员资格');
      if (target && input.memberVersion !== undefined) requireThat(input.memberVersion === target.memberVersion, '成员资料已更新，请刷新后重试', 409);
      const name = textInput(input.name, '成员名称', 30);
      requireThat(typeof input.active === 'boolean', '账号状态无效');
      requireThat(actor.id !== id || (input.role === 'admin' && input.active), '不能停用自己或移除自己的管理员权限');
      if (target && target.role !== input.role) requireThat(!hasOpenOrders(data, id), '成员仍有未完成订单，请处理后再调整职责');
      if (target?.role === 'escort' && input.role !== 'escort') requireThat(target.balanceCents === 0 && !target.frozenBalanceCents && !data.withdrawals.some(w => w.userId === id && ['待审核','待线下打款'].includes(w.status)), '请先结清陪玩余额、冻结收益和提现，再调整职责', 409);
      if (!target) {
        const username = textInput(input.username, '登录账号', 30);
        requireThat(/^[a-zA-Z0-9_]{3,30}$/.test(username), '账号需为 3–30 位英文、数字或下划线');
        requireThat(!data.users.some(u => u.username === username), '该账号已存在', 409);
        const password = textInput(input.password, '初始密码', 128);
        requireThat(password.length >= 8, '新账号密码至少 8 位');
        target = { id: randomUUID(), memberNo: String(Math.max(81000000, ...data.users.map(u => Number(u.memberNo) || 0)) + 1), memberVersion: 0, username, passwordHash: passwordHash(password), online: false, escortFrozen: false, balanceCents: 0, frozenBalanceCents: 0, depositCents: 0 };
        data.users.push(target);
      }
      const games = input.role === 'escort' ? input.games : [];
      if (input.role === 'escort') requireRealName(target);
      requireThat(Array.isArray(games) && (input.role !== 'escort' || games.length > 0) && games.every(game => catalogNames(data).has(game)), '打手至少选择一个有效游戏');
      const levelId = input.role === 'escort' ? input.levelId || target.levelId || 'gold' : null;
      if (input.role === 'escort') this.validateProfile(data, target, games, levelId);
      const shareBps = input.role === 'escort' ? rateOf(data, { levelId }) : 0;
      const revoke = target.role !== input.role || target.active !== input.active;
      Object.assign(target, { name, role: input.role, active: input.active, games: [...new Set(games)], shareBps, levelId, memberVersion: target.memberVersion + 1 });
      attachCustomer(data, target);
      if (input.role !== 'escort' || !input.active) target.examiner = false;
      if (revoke) target.online = false;
      if (revoke) this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
      return publicUser(target);
    });
  }
}
