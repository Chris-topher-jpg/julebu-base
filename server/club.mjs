import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as seed from './seed.mjs';
import { FOUR_HOURS, clubDay, metrics, dateRange, trend, ranking, analyticsOptions } from './analytics.mjs';
import { defaultLevels, levelOf, meetsLevel, rateOf, hasOpenOrders, profileConflicts, migrateMembership, memberRecord, lockEarnings } from './membership.mjs';

export const roles = {
  admin: { label: '最高负责人', tone: 'purple', pages: ['overview', 'clubConfig', 'memberManagement', 'clubMembers', 'clubEscorts', 'serviceManagement', 'examinerManagement', 'afterSales', 'financeManagement', 'financeList', 'commissionConfig', 'orderManagement', 'orderList', 'transferOrders', 'dispatchOrders', 'orders', 'dispatch', 'conversations', 'escorts', 'catalog', 'topups', 'flows', 'settlements', 'accounts'], permissions: ['analytics:view', 'order:view', 'order:create', 'order:dispatch', 'order:review', 'conversation:manage', 'finance:manage', 'account:manage'] },
  service: { label: '俱乐部客服', tone: 'orange', pages: ['overview', 'orders', 'conversations', 'dispatch'], permissions: ['order:view', 'order:create', 'order:dispatch', 'order:review', 'conversation:manage'] },
  examiner: { label: '俱乐部考官', tone: 'blue', pages: ['overview', 'examinerCandidates'], permissions: ['member:skills:view'] },
  afterSales: { label: '俱乐部售后', tone: 'pink', pages: ['overview', 'orders', 'conversations'], permissions: ['order:view', 'order:review', 'conversation:manage'] },
  finance: { label: '俱乐部财务', tone: 'purple', pages: ['overview', 'topups', 'flows', 'settlements'], permissions: ['finance:manage'] },
  member: { label: '普通成员', tone: 'navy', pages: ['overview'], permissions: [] },
  escort: { label: '打手', tone: 'green', pages: ['overview', 'availableOrders', 'myOrders', 'myEarnings'], permissions: ['order:accept', 'order:serve', 'withdrawal:create'] },
};
export function requireThat(condition, message, status = 400) {
  if (!condition) throw Object.assign(new Error(message), { status });
}
const now = () => new Date().toISOString();
const cents = value => Math.round(Number(String(value).replace(/[^\d.]/g, '')) * 100);
const amount = value => `¥ ${(value / 100).toFixed(2)}`;
const hashToken = token => createHash('sha256').update(token).digest('hex');
function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
function checkPassword(password, hash) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [salt, key] = hash.split(':');
  return timingSafeEqual(Buffer.from(key, 'hex'), Buffer.from(passwordHash(password, salt).split(':')[1], 'hex'));
}
function textInput(value, label, max = 100) {
  requireThat(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max, `${label}不能为空且最多 ${max} 个字符`);
  return value.trim();
}
const publicUser = user => ({ id: user.id, memberNo: user.memberNo, memberVersion: user.memberVersion, username: user.username, name: user.name, role: user.role, roleLabel: roles[user.role].label, tone: roles[user.role].tone, active: user.active, online: user.online, games: user.games, shareBps: user.shareBps, levelId: user.levelId, escortFrozen: Boolean(user.escortFrozen), examiner: Boolean(user.examiner) });
export const can = (user, permission) => roles[user.role]?.permissions.includes(permission);
function permit(user, permission) { requireThat(can(user, permission), '你的职责没有此操作权限', 403); }

function initialState() {
  const logins = ['escort', 'xiaoman', 'ajiu', 'qiqi', 'taotao'];
  const users = [
    { id: 'admin', username: 'admin', name: '杨澄', role: 'admin' },
    { id: 'service', username: 'service', name: '小林', role: 'service' },
    ...seed.escorts.map((e, i) => ({ id: logins[i], username: logins[i], name: e.name, role: 'escort', games: e.games.split(' · '), shareBps: parseInt(e.share) * 100 || 7000, online: ['在线', '陪玩中'].includes(e.state), active: e.state !== '待审核', depositCents: 100000, balanceCents: cents(e.balance) })),
  ].map(u => ({ active: true, online: false, games: [], balanceCents: 0, depositCents: 0, shareBps: 0, ...u, passwordHash: passwordHash(['admin', 'service', 'escort'].includes(u.username) ? '123456' : randomBytes(24).toString('hex')) }));
  const games = [...seed.games, { name: 'Apex', category: 'FPS', multiplier: '1.00x', min: 1, max: 3, state: '上架', tone: 'green' }].map(g => ({ ...g, multiplierBps: Math.round(parseFloat(g.multiplier) * 10000), ...(Number.isInteger(g.commissionBps) ? { commissionBps: g.commissionBps } : {}) }));
  const products = seed.products.map((p, i) => ({ ...p, id: `product-${i + 1}`, priceCents: cents(p.price) }));
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
  return {
    users, games, products, orders, revision: 1, audit: [], withdrawals: [], ledger: [],
    customers: [{ name: '周致远', balanceCents: 46000 }, { name: '沈嘉禾', balanceCents: 32000 }, { name: '林先生', balanceCents: 382000 }],
    topups: seed.topups.map(t => ({ ...t, amountCents: cents(t.amount) })),
    settlements: seed.settlements,
    conversations: seed.conversations.map((c, i) => ({ ...c, id: `chat-${i + 1}`, notes: [], messages: [{ text: c.last, author: c.boss, at: now() }] })),
  };
}

export class ClubStore {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS club (id INTEGER PRIMARY KEY CHECK (id=1), data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL);');
    if (!this.db.prepare('SELECT id FROM club').get()) this.db.prepare('INSERT INTO club VALUES (1, ?)').run(JSON.stringify(initialState()));
    const data = this.read();
    if (migrateMembership(data)) this.db.prepare('UPDATE club SET data=? WHERE id=1').run(JSON.stringify(data));
    this.db.exec('CREATE TABLE IF NOT EXISTS analytics_cache (key TEXT PRIMARY KEY, data TEXT NOT NULL)');
    this.dummyHash = passwordHash(randomBytes(24).toString('hex'));
  }
  read() { return JSON.parse(this.db.prepare('SELECT data FROM club WHERE id=1').get().data); }
  close() { this.db.close(); }
  transaction(user, permission, action, work) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const data = this.read();
      const actor = data.users.find(u => u.id === user.id && u.active);
      requireThat(actor, '账号已停用，请重新登录', 401);
      permit(actor, permission);
      const result = work(data, actor);
      data.revision++;
      data.audit.unshift({ id: randomUUID(), action, by: actor.name, at: now() });
      this.db.prepare('UPDATE club SET data=? WHERE id=1').run(JSON.stringify(data));
      this.db.exec('COMMIT');
      return result;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  login(username, password) {
    const user = this.read().users.find(u => u.username === username);
    const valid = checkPassword(password, user?.passwordHash || this.dummyHash);
    requireThat(valid && user?.active, '账号或密码不正确，或账号已停用', 401);
    const token = randomBytes(32).toString('hex');
    this.db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
    this.db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(hashToken(token), user.id, Date.now() + 8 * 3600000);
    return { token, user: publicUser(user) };
  }
  session(token) {
    const session = this.db.prepare('SELECT user_id FROM sessions WHERE token=? AND expires>?').get(hashToken(token || ''), Date.now());
    return session && this.read().users.find(u => u.id === session.user_id && u.active);
  }
  logout(token) { this.db.prepare('DELETE FROM sessions WHERE token=?').run(hashToken(token || '')); }
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
      return { totals: this.totalSnapshot(at), daily: { ...metrics(data, range, at), day, asOf: new Date(at).toISOString() }, today: clubDay(at), options: analyticsOptions(data) };
    }
    if (section === 'trend') return trend(data, input, at);
    if (section === 'rankings' || section === 'details') return ranking(data, input, at, section === 'details');
    requireThat(false, '统计接口不存在', 404);
  }
  workspace(user) {
    const data = this.read();
    user = data.users.find(u => u.id === user.id && u.active);
    requireThat(user, '账号已停用', 401);
    const mine = data.orders.filter(o => o.participants.some(p => p.userId === user.id)).map(o => ({ ...o, participants: o.participants.map(p => p.userId === user.id ? p : { userId: p.userId, name: p.name, accepted: p.accepted, finished: p.finished }) }));
    const available = data.orders.filter(o => o.status === '待接单' && !o.participants.length && !user.escortFrozen && user.games.includes(o.game) && meetsLevel(data, user, o) && data.games.find(g => g.name === o.game)?.state === '上架').map(o => {
      const rate = rateOf(data, user, o.game);
      return { ...o, expectedShareBps: rate, expectedIncomeCents: Math.round(o.amountCents * rate / 10000) };
    });
    const common = { user: publicUser(user), role: roles[user.role], levels: data.levels, revision: data.revision, clubName: '星河游戏俱乐部' };
    if (user.role === 'escort') return { ...common, user: { ...publicUser(user), commissionByGame: Object.fromEntries((user.games || []).map(game => [game, rateOf(data, user, game)])) }, orders: mine, availableOrders: available, wallet: { balanceCents: user.balanceCents, depositCents: user.depositCents, frozenCents: data.withdrawals.filter(w => w.userId === user.id && w.status === '待审核').reduce((a, w) => a + w.amountCents, 0) }, ledger: data.ledger.filter(l => l.userId === user.id), withdrawals: data.withdrawals.filter(w => w.userId === user.id) };
    if (user.role === 'member') return common;
    if (user.role === 'finance') return { ...common, topups: data.topups, ledger: data.ledger, withdrawals: data.withdrawals, settlements: data.settlements };
    if (user.role === 'examiner') return { ...common, levels: data.levels.map(({ id, name, rank }) => ({ id, name, rank })), members: data.users.filter(u => u.role === 'escort').map(u => ({ id: u.id, memberNo: u.memberNo, name: u.name, active: u.active, games: u.games, levelId: u.levelId, levelName: levelOf(data, u.levelId)?.name || '' })) };
    if (user.role === 'afterSales') return { ...common, orders: data.orders, conversations: data.conversations };
    const response = { ...common, orders: data.orders, games: data.games, products: data.products, conversations: data.conversations, members: data.users.filter(u => u.role === 'escort').map(publicUser), customers: data.customers };
    if (user.role === 'admin') Object.assign(response, { accounts: data.users.map(u => memberRecord(data, u, publicUser)), members: data.users.filter(u => u.role === 'escort').map(u => memberRecord(data, u, publicUser)), roleOptions: Object.entries(roles).map(([id, r]) => ({ id, label: r.label, pages: r.pages, permissions: r.permissions })), topups: data.topups, ledger: data.ledger, withdrawals: data.withdrawals, settlements: data.settlements, audit: data.audit.slice(0, 30) });
    if (user.role === 'admin') response.staffGroups = Object.fromEntries(['service', 'examiner', 'afterSales'].map(role => [role, response.accounts.filter(u => u.role === role)]));
    return response;
  }
  assignable(data, order, user) {
    return user?.active && !user.escortFrozen && user.online && user.role === 'escort' && user.games.includes(order.game) && meetsLevel(data, user, order) && data.games.find(g => g.name === order.game)?.state === '上架';
  }
  createOrder(user, input) {
    return this.transaction(user, 'order:create', '创建订单', (data, actor) => {
      const product = data.products.find(p => p.id === input.productId);
      requireThat(product?.state === '启用' && data.games.find(g => g.name === product.game)?.state === '上架', '游戏维护中或商品不可售');
      const hours = Number(input.hours);
      requireThat(Number.isFinite(hours) && hours >= .5 && hours <= 24 && Number.isInteger(hours * 2), '服务时长应为 0.5–24 小时，按半小时递增');
      const boss = textInput(input.boss, '老板称呼', 30);
      requireThat(['余额支付', '线下已收款'].includes(input.pay), '请选择支付方式');
      const total = Math.round(product.priceCents * hours);
      const level = levelOf(data, input.levelId ?? 'gold');
      requireThat(level, '请选择有效的订单等级');
      const tags = input.tags === undefined ? [product.name] : Array.isArray(input.tags) ? input.tags : String(input.tags).split(/[,，]/).map(t=>t.trim()).filter(Boolean);
      requireThat(tags.length <= 8 && tags.every(t=>typeof t === 'string' && t.trim().length > 0 && t.length <= 30), 'Tag 最多 8 个，每个最多 30 个字符');
      const order = { id: `PO${Date.now()}${randomBytes(2).toString('hex').toUpperCase()}`, boss, game: product.game, tags: [...new Set(tags)], product: product.name, productId: product.id, hours, amountCents: total, pay: input.pay, requirement: textInput(input.requirement, '服务要求', 300), status: '待接单', participants: [], version: 1, createdAt: now(), history: [{ action: '创建订单', by: actor.name, at: now() }] };
      Object.assign(order, { levelId: level.id, levelName: level.name });
      if (input.pay === '余额支付') {
        const customer = data.customers.find(c => c.name === boss);
        requireThat(customer && customer.balanceCents >= total, '老板余额不足，请先审核充值或选择已收款');
        customer.balanceCents -= total;
        data.ledger.unshift({ id: randomUUID(), userId: null, account: boss, deltaCents: -total, afterCents: customer.balanceCents, source: order.id, label: '订单消费', at: now(), by: actor.name });
      }
      data.orders.unshift(order);
      return order;
    });
  }
  orderAction(user, id, action, input) {
    const permissions = { dispatch: 'order:dispatch', accept: 'order:accept', reject: 'order:accept', start: 'order:serve', finish: 'order:serve', approve: 'order:review', return: 'order:review' };
    requireThat(permissions[action], '未知订单操作', 404);
    return this.transaction(user, permissions[action], `订单 ${id} · ${action}`, (data, actor) => {
      const order = data.orders.find(o => o.id === id);
      requireThat(order, '订单不存在', 404);
      requireThat(order.version === input.version, '订单已被更新，请刷新后重试', 409);
      let participant = order.participants.find(p => p.userId === actor.id);
      if (['start', 'finish', 'reject'].includes(action)) requireThat(participant, '只能处理分配给自己的订单', 403);
      if (action === 'dispatch' || (action === 'accept' && order.status === '待接单')) {
        requireThat(order.status === '待接单' && !order.participants.length, '订单已被接走，不能重复分配', 409);
        const ids = action === 'accept' ? [actor.id] : input.memberIds;
        requireThat(Array.isArray(ids) && new Set(ids).size === ids.length, '请正确选择陪玩成员');
        const game = data.games.find(g => g.name === order.game);
        requireThat(game?.state === '上架' && ids.length >= game.min && ids.length <= game.max, '游戏不可接单或陪玩人数超出游戏限制');
        const members = ids.map(id => data.users.find(u => u.id === id));
        requireThat(members.every(m => this.assignable(data, order, m)), '成员必须已启用、未冻结、在线、支持此游戏，且等级不低于订单等级');
        const participants = members.map(m => ({ userId: m.id, name: m.name, levelId: m.levelId, levelName: levelOf(data, m.levelId).name, baseShareBps: rateOf(data, m, order.game), shareBps: Math.floor(rateOf(data, m, order.game) / members.length), accepted: action === 'accept', finished: false, evidence: '' }));
        requireThat(participants.reduce((a, p) => a + p.shareBps, 0) <= 10000, '陪玩分成合计超过 100%，请调整成员或分成配置');
        lockEarnings(order.amountCents, participants);
        order.participants = participants;
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
        order.status = '待接单';
      } else if (action === 'start') {
        requireThat(order.status === '待服务', '请先完成接单确认', 409);
        requireThat(order.participants.every(p => this.assignable(data, order, data.users.find(u => u.id === p.userId))), '成员状态、游戏技能或等级不符合要求，暂不能开始');
        requireThat(!data.orders.some(o => o.id !== id && o.status === '陪玩中' && o.participants.some(p => !p.finished && order.participants.some(p2 => p2.userId === p.userId))), '成员仍有正在服务的订单，请完成后再开始', 409);
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
        order.participants.forEach(p => { p.finished = false; });
        order.status = '陪玩中';
      } else if (action === 'approve') {
        requireThat(order.status === '待验收' && order.participants.every(p => p.finished), '只有已提交完单的订单可以验收', 409);
        for (const p of order.participants) {
          const member = data.users.find(u => u.id === p.userId);
          const earning = p.earningCents ?? Math.round(order.amountCents * p.shareBps / 10000);
          member.balanceCents += earning;
          data.ledger.unshift({ id: randomUUID(), userId: p.userId, account: p.name, deltaCents: earning, afterCents: member.balanceCents, source: order.id, label: '订单分成', at: now(), by: actor.name });
        }
        order.status = '已完成'; order.completedAt = now();
      }
      order.version++;
      const labels = { dispatch: '客服派单', accept: '确认接单', reject: '退回派单池', start: '开始服务', finish: '提交完单', approve: '验收通过并入账', return: '退回补充服务' };
      order.history.push({ action: labels[action], by: actor.name, at: now(), note: input.reason || input.evidence || '' });
      return order;
    });
  }
  conversationAction(user, id, input) {
    return this.transaction(user, 'conversation:manage', '更新客服会话', (data, actor) => {
      const chat = data.conversations.find(c => c.id === id);
      requireThat(chat, '会话不存在', 404);
      if (input.note) chat.notes.push({ text: textInput(input.note, '跟进记录', 1000), author: actor.name, at: now() });
      if (input.state) { requireThat(['处理中', '已结束'].includes(input.state), '会话状态无效'); chat.state = input.state; }
      chat.unread = 0;
      return chat;
    });
  }
  withdrawal(user, input) {
    return this.transaction(user, 'withdrawal:create', '申请提现', (data, actor) => {
      requireThat(actor.depositCents >= 100000, '押金不足，需达到 ¥1,000 后才可提现');
      const value = String(input.amount);
      requireThat(/^\d+(\.\d{1,2})?$/.test(value), '请输入最多两位小数的金额');
      const total = Math.round(Number(value) * 100);
      requireThat(Number.isSafeInteger(total) && total >= 100 && total <= actor.balanceCents, '提现至少 ¥1，且不能超过可提现余额');
      requireThat(!data.withdrawals.some(w => w.userId === actor.id && w.status === '待审核'), '已有待审核提现，请等待处理', 409);
      const withdrawal = { id: `TX${Date.now()}`, userId: actor.id, name: actor.name, amountCents: total, status: '待审核', at: now() };
      actor.balanceCents -= total;
      data.withdrawals.unshift(withdrawal);
      data.ledger.unshift({ id: randomUUID(), userId: actor.id, account: actor.name, deltaCents: -total, afterCents: actor.balanceCents, source: withdrawal.id, label: '提现冻结', by: actor.name, at: now() });
      return withdrawal;
    });
  }
  reviewWithdrawal(user, id, input) {
    return this.transaction(user, 'finance:manage', '复核提现', (data, actor) => {
      const item = data.withdrawals.find(w => w.id === id);
      requireThat(item?.status === '待审核', '该申请已经处理', 409);
      requireThat(['approve', 'reject'].includes(input.action), '审核动作无效');
      const member = data.users.find(u => u.id === item.userId);
      if (input.action === 'approve') {
        requireThat(member.active && member.depositCents >= 100000, '成员已停用或押金不足，请先处理');
        item.status = '待线下打款';
      } else {
        item.reason = textInput(input.reason, '驳回原因', 200); item.status = '已驳回'; member.balanceCents += item.amountCents;
        data.ledger.unshift({ id: randomUUID(), userId: member.id, account: member.name, deltaCents: item.amountCents, afterCents: member.balanceCents, source: id, label: '提现退回', by: actor.name, at: now() });
      }
      return item;
    });
  }
  topupAction(user, id, input) {
    return this.transaction(user, 'finance:manage', '充值审核', (data, actor) => {
      const item = data.topups.find(t => t.id === id);
      requireThat(item?.state === '待审核', '充值申请已处理', 409);
      requireThat(['approve', 'reject'].includes(input.action), '审核动作无效');
      if (input.action === 'approve') {
        textInput(input.reason, '凭证核验说明', 200);
        let customer = data.customers.find(c => c.name === item.user);
        if (!customer) data.customers.push(customer = { name: item.user, balanceCents: cents(item.before) });
        item.before = amount(customer.balanceCents); customer.balanceCents += item.amountCents; item.after = amount(customer.balanceCents);
        item.state = '已通过'; item.proof = '已核验';
        data.ledger.unshift({ id: randomUUID(), userId: null, account: item.user, deltaCents: item.amountCents, afterCents: customer.balanceCents, source: id, label: '充值入账', by: actor.name, at: now() });
      } else { item.state = '已驳回'; item.proof = textInput(input.reason, '驳回原因', 200); }
      return item;
    });
  }
  setOnline(user, input) {
    return this.transaction(user, 'order:accept', '更新接单状态', (data, actor) => {
      requireThat(typeof input.online === 'boolean', '接单状态无效');
      requireThat(!input.online || (!actor.escortFrozen && actor.games.length > 0), '陪玩已冻结或尚未配置技能，无法上线接单');
      actor.online = input.online; return publicUser(actor);
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
  validateProfile(data, target, games, levelId) {
    requireThat(Array.isArray(games) && games.length <= data.games.length && games.every(g => data.games.some(item => item.name === g)), '请选择有效的游戏技能');
    requireThat(levelOf(data, levelId), '请选择有效的陪玩等级');
    const next = { ...target, games: [...new Set(games)], levelId };
    requireThat(!profileConflicts(data, next), '此变更会使成员不再符合已派订单要求，请先退回待确认或待服务订单', 409);
    Object.assign(target, { games: next.games, levelId, shareBps: rateOf(data, next, next.games[0]) });
    if (!games.length) { target.online = false; target.examiner = false; }
  }
  membershipAction(user, id, action, input) {
    return this.transaction(user, 'account:manage', `成员 ${id} · ${action}`, (data, actor) => {
      const target = data.users.find(u => u.id === id);
      requireThat(target, '成员不存在', 404);
      requireThat(input.memberVersion === target.memberVersion, '成员资料已更新，请刷新后重试', 409);
      if (action === 'role') {
        requireThat(target.role !== 'escort', '请先在陪玩管理中取消陪玩身份');
        requireThat(Object.hasOwn(roles, input.role) && input.role !== 'escort', '请选择有效的管理角色');
        requireThat(target.id !== actor.id || input.role === 'admin', '不能移除自己的最高负责人权限');
        target.role = input.role;
      } else if (action === 'escort') {
        requireThat(target.role !== 'escort', '该成员已是陪玩', 409);
        requireThat(target.id !== actor.id, '不能移除自己的最高负责人权限');
        requireThat(target.active, '请先启用该成员账号');
        target.role = 'escort'; target.online = false; target.escortFrozen = false;
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
        requireThat(target.balanceCents === 0 && !data.withdrawals.some(w => w.userId === id && ['待审核','待线下打款'].includes(w.status)), '请先结清陪玩余额和提现，再取消陪玩身份', 409);
        Object.assign(target, { role: 'member', levelId: null, games: [], shareBps: 0, examiner: false, online: false, escortFrozen: false });
      } else if (action === 'status') {
        requireThat(typeof input.active === 'boolean', '成员状态无效');
        requireThat(target.id !== actor.id || input.active, '不能停用自己的账号');
        target.active = input.active;
        if (!input.active) { target.online = false; target.examiner = false; }
      } else requireThat(false, '成员操作不存在', 404);
      target.memberVersion++;
      if (['role','escort','remove','status'].includes(action)) this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      return memberRecord(data, target, publicUser);
    });
  }
  bindSkills(user, input) {
    return this.transaction(user, 'account:manage', '批量绑定游戏技能', data => {
      requireThat(Array.isArray(input.members) && input.members.length > 0 && input.members.length <= 100 && new Set(input.members.map(m => m.id)).size === input.members.length, '请选择 1–100 位陪玩');
      requireThat(Array.isArray(input.games) && input.games.length > 0, '请至少选择一个技能');
      for (const item of input.members) {
        const target = data.users.find(u => u.id === item.id && u.role === 'escort');
        requireThat(target && target.memberVersion === item.memberVersion, '成员资料已更新，请刷新后重新选择', 409);
        this.validateProfile(data, target, [...new Set([...target.games, ...input.games])], target.levelId);
        target.memberVersion++;
      }
      return { ok: true };
    });
  }
  configureLevels(user, input) {
    return this.transaction(user, 'account:manage', '更新等级分成', data => {
      requireThat(input.revision === data.revision, '配置已更新，请刷新后重试', 409);
      requireThat(Array.isArray(input.levels) && input.levels.length === 4 && new Set(input.levels.map(l => l.id)).size === 4, '必须包含四个等级');
      const levels = defaultLevels.map(level => ({ ...level, shareBps: input.levels.find(l => l.id === level.id)?.shareBps }));
      requireThat(levels.every((l, i) => Number.isInteger(l.shareBps) && l.shareBps > 0 && l.shareBps <= 10000 && (!i || levels[i-1].shareBps > l.shareBps)), '分成须大于 0 且不超过 100%，从明星到金牌依次递减');
      data.levels = levels;
      for (const target of data.users.filter(u => u.role === 'escort')) { target.shareBps = rateOf(data, target, target.games?.[0]); target.memberVersion++; }
      return levels;
    });
  }
  configureCommissions(user, input) {
    return this.transaction(user, 'finance:manage', '更新游戏抽佣配置', data => {
      requireThat(Array.isArray(input.games) && input.games.length === data.games.length, '抽佣配置数据不完整');
      const ids = new Set(data.games.map(g => g.name));
      requireThat(input.games.every(g => ids.has(g.name) && Number.isInteger(g.commissionBps) && g.commissionBps > 0 && g.commissionBps <= 10000), '抽佣比例需为 0.01%–100%');
      for (const item of input.games) data.games.find(g => g.name === item.name).commissionBps = item.commissionBps;
      for (const target of data.users.filter(u => u.role === 'escort')) { target.shareBps = rateOf(data, target, target.games?.[0]); target.memberVersion++; }
      return data.games.map(({ name, commissionBps }) => ({ name, commissionBps }));
    });
  }
  accountAction(user, id, input) {
    return this.transaction(user, 'account:manage', id ? '更新成员权限' : '创建成员账号', (data, actor) => {
      requireThat(Object.hasOwn(roles, input.role), '职责无效');
      let target = id ? data.users.find(u => u.id === id) : null;
      if (id) requireThat(target, '成员不存在', 404);
      if (target && input.memberVersion !== undefined) requireThat(input.memberVersion === target.memberVersion, '成员资料已更新，请刷新后重试', 409);
      const name = textInput(input.name, '成员名称', 30);
      requireThat(typeof input.active === 'boolean', '账号状态无效');
      requireThat(actor.id !== id || (input.role === 'admin' && input.active), '不能停用自己或移除自己的管理员权限');
      if (target && target.role !== input.role) requireThat(!data.orders.some(o => !['已完成', '退款审核'].includes(o.status) && o.participants.some(p => p.userId === id)), '成员仍有未完成订单，请处理后再调整职责');
      if (target?.role === 'escort' && input.role !== 'escort') requireThat(target.balanceCents === 0 && !data.withdrawals.some(w => w.userId === id && ['待审核','待线下打款'].includes(w.status)), '请先结清陪玩余额和提现，再调整职责', 409);
      if (!target) {
        const username = textInput(input.username, '登录账号', 30);
        requireThat(/^[a-zA-Z0-9_]{3,30}$/.test(username), '账号需为 3–30 位英文、数字或下划线');
        requireThat(!data.users.some(u => u.username === username), '该账号已存在', 409);
        const password = textInput(input.password, '初始密码', 128);
        requireThat(password.length >= 8, '新账号密码至少 8 位');
        target = { id: randomUUID(), memberNo: String(Math.max(81000000, ...data.users.map(u => Number(u.memberNo) || 0)) + 1), memberVersion: 0, username, passwordHash: passwordHash(password), online: false, escortFrozen: false, balanceCents: 0, depositCents: 0 };
        data.users.push(target);
      }
      const games = input.role === 'escort' ? input.games : [];
      requireThat(Array.isArray(games) && (input.role !== 'escort' || games.length > 0) && games.every(g => data.games.some(item => item.name === g)), '打手至少选择一个有效游戏');
      const levelId = input.role === 'escort' ? input.levelId || target.levelId || 'gold' : null;
      if (input.role === 'escort') this.validateProfile(data, target, games, levelId);
      const shareBps = input.role === 'escort' ? rateOf(data, { levelId }) : 0;
      const revoke = target.role !== input.role || target.active !== input.active;
      Object.assign(target, { name, role: input.role, active: input.active, games: [...new Set(games)], shareBps, levelId, memberVersion: target.memberVersion + 1 });
      if (input.role !== 'escort' || !input.active) target.examiner = false;
      if (revoke) target.online = false;
      if (revoke) this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
      return publicUser(target);
    });
  }
}
