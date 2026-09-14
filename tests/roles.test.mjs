import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClubStore } from '../server/club.mjs';
import { createClubServer } from '../server.mjs';
import { addFixtureGames } from './catalog-fixture.mjs';
import { verifyFixtureUsers, userById, createVerifiedFixtureEscort } from './real-name-fixture.mjs';

test('身份切换同步三份名单、撤销旧会话，并在重启后保留', t => {
  const folder = mkdtempSync(join(tmpdir(), 'club-staff-test-'));
  const database = join(folder, 'club.sqlite');
  let store = new ClubStore(database);
  t.after(() => { store.close(); rmSync(folder, { recursive: true, force: true }); });
  const admin = store.read().users.find(u => u.id === 'admin');
  const created = role => store.accountAction(admin, null, { username: `role_${role}`, password: 'testing123', name: `测试${role}`, role, active: true, games: [] });
  const user = created('member');
  for (const role of ['service', 'examiner', 'afterSales', 'member', 'afterSales']) {
    const current = store.read().users.find(u => u.id === user.id);
    const token = store.login(user.username, 'testing123').token;
    store.membershipAction(admin, user.id, 'role', { role, memberVersion: current.memberVersion });
    assert.equal(store.session(token), undefined);
    const workspace = store.workspace(admin);
    assert.equal(workspace.accounts.filter(u => u.id === user.id).length, 1);
    assert.equal(workspace.staffGroups.service.some(u => u.id === user.id), role === 'service');
    assert.equal(workspace.staffGroups.examiner.some(u => u.id === user.id), role === 'examiner');
    assert.equal(workspace.staffGroups.afterSales.some(u => u.id === user.id), role === 'afterSales');
    assert.equal(store.read().users.find(u => u.id === user.id).role, role);
    const login = store.login(user.username, 'testing123');
    assert.equal(store.workspace(store.session(login.token)).user.role, role);
  }
  const current = store.read().users.find(u => u.id === user.id);
  store.membershipAction(admin, user.id, 'status', { active: false, memberVersion: current.memberVersion });
  store.close(); store = new ClubStore(database);
  assert.equal(store.workspace(admin).staffGroups.afterSales.find(u => u.id === user.id).active, false);
  const options = store.workspace(admin).roleOptions;
  assert.deepEqual(options.filter(r => ['service','examiner','afterSales'].includes(r.id)).map(r => r.label), ['俱乐部客服','俱乐部考官','俱乐部售后']);
  assert.equal(options.some(r => r.id === 'manager' || r.label.includes('售后客服') || r.label.includes('客服售后')), false);
});

test('考官和售后工作区只返回各自需要的数据', async t => {
  const { server, store } = createClubServer({ database: ':memory:' });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const admin = store.read().users.find(u => u.id === 'admin');
  for (const role of ['examiner', 'afterSales']) store.accountAction(admin, null, { username: `http_${role}`, password: 'testing123', name: role, role, active: true, games: [] });
  async function login(username) {
    const response = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ username, password: 'testing123' }) });
    assert.equal(response.status, 200); return response.headers.get('set-cookie').split(';')[0];
  }
  const examinerCookie = await login('http_examiner');
  const examiner = await fetch(base + '/api/workspace', { headers: { Cookie: examinerCookie } });
  const examinerBody = await examiner.json();
  for (const key of ['orders','conversations','wallet','accounts','customers','ledger','topups','withdrawals']) assert.equal(examinerBody[key], undefined);
  assert.ok(examinerBody.members.length);
  for (const member of examinerBody.members) for (const key of ['depositCents','balanceCents','shareBps','passwordHash']) assert.equal(member[key], undefined);
  assert.ok(examinerBody.levels.every(l => l.shareBps === undefined));
  const afterCookie = await login('http_afterSales');
  const after = await fetch(base + '/api/workspace', { headers: { Cookie: afterCookie } });
  const afterBody = await after.json();
  assert.ok(Array.isArray(afterBody.orders)); assert.ok(Array.isArray(afterBody.conversations));
  for (const key of ['wallet','accounts','members','customers','ledger','topups','withdrawals']) assert.equal(afterBody[key], undefined);
  const call = (cookie, path, body) => fetch(base + '/api/' + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: base }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal((await call(afterCookie, 'orders')).status, 200);
  assert.equal((await call(examinerCookie, 'orders')).status, 403);
  assert.equal((await call(examinerCookie, 'conversations')).status, 403);
  for (const path of ['accounts', 'topups', 'ledger', 'withdrawals']) assert.equal((await call(afterCookie, path)).status, 403);
  const pending = afterBody.orders.find(o => o.status === '待接单');
  assert.equal((await call(afterCookie, `orders/${pending.id}/dispatch`, { version: pending.version, memberIds: ['escort'] })).status, 403);
  assert.equal((await call(afterCookie, 'members/service/role', { role: 'admin', memberVersion: 1 })).status, 403);
  const chat = afterBody.conversations[0];
  assert.equal((await call(afterCookie, `conversations/${chat.id}`, { note: '已核实售后诉求，等待后续处理', state: '处理中' })).status, 200);
  const escort = store.read().users.find(u => u.id === 'escort');
  const live = store.read().orders.find(o => o.id === 'PO20240618031');
  const review = store.orderAction(escort, live.id, 'finish', { version: live.version, evidence: '服务已完成，请售后核验' });
  assert.equal((await call(afterCookie, `orders/${review.id}/approve`, { version: review.version })).status, 200);
  const create = await fetch(base + '/api/orders', { method: 'POST', headers: { Cookie: afterCookie, 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ boss: 'x', productId: 'product-1', hours: 1, pay: '线下已收款' }) });
  assert.equal(create.status, 403);
});

test('负责人陪玩押金使用实际账户金额，与陪玩本人钱包一致，新账号为零', t => {
  const store = new ClubStore(':memory:'); t.after(() => store.close());
  addFixtureGames(store, ['王者荣耀']);
  const admin = store.read().users.find(u => u.id === 'admin');
  const added = createVerifiedFixtureEscort(store, admin, { username:'deposit_zero', password:'testing123', name:'押金测试', role:'escort', active:true, games:['王者荣耀'] });
  store.transaction(admin, 'account:manage', '测试押金读取', data => { data.users.find(u => u.id === 'escort').depositCents = 123456; });
  const w = store.workspace(admin);
  assert.equal(w.members.find(u => u.id === 'escort').depositCents, 123456);
  for (const id of ['escort', added.id]) {
    const member = w.members.find(u => u.id === id);
    assert.equal(member.depositCents, store.workspace({ id }).wallet.depositCents);
    assert.equal(w.accounts.find(u => u.id === id).depositCents, member.depositCents);
  }
  assert.equal(w.members.find(u => u.id === added.id).depositCents, 0);
});

test('抽佣配置按游戏技能生效，等级只负责接单门槛且已派订单比例锁定', t => {
  const store = new ClubStore(':memory:'); t.after(() => store.close());
  addFixtureGames(store, ['王者荣耀']);
  const admin = store.read().users.find(u => u.id === 'admin');
  verifyFixtureUsers(store, ['demo-user', 'escort']);
  const escort = store.read().users.find(u => u.id === 'escort');
  const game = store.read().games.find(g => g.name === escort.games[0]);
  store.configureCommissions(admin, { games: store.read().catalogGames.map(g => ({ name: g.name, commissionBps: g.name === game.name ? 6100 : 7200 })) });
  const first = store.workspace(escort);
  assert.equal(first.user.commissionByGame[game.name], 6100);
  const order = store.createOrder(admin, { boss:userById(store,'demo-user').name, customerId:userById(store,'demo-user').customerId, productId:'product-1', hours:1, requirement:'测试游戏抽佣', pay:'线下已收款', levelId:'gold' });
  store.setOnline(escort, { online: true });
  const applied = store.orderAction(escort, order.id, 'apply', { version: order.version });
  const selected = store.orderAction(userById(store,'demo-user'), order.id, 'selectApplicant', { version: applied.version, memberIds: [escort.id] });
  const accepted = store.orderAction(escort, order.id, 'accept', { version: selected.version });
  assert.equal(accepted.participants[0].baseShareBps, 6100);
  store.configureCommissions(admin, { games: store.read().catalogGames.map(g => ({ name: g.name, commissionBps: g.name === game.name ? 6200 : 7200 })) });
  assert.equal(store.read().orders.find(o => o.id === order.id).participants[0].shareBps, 6100);
  assert.equal(store.workspace(escort).user.commissionByGame[game.name], 6200);
});

test('成员可冻结不超过可提现余额的金额，冻结余额单独展示且冻结账号会撤销会话', t => {
  const store = new ClubStore(':memory:'); t.after(() => store.close());
  const admin = store.read().users.find(u => u.id === 'admin');
  const member = store.read().users.find(u => u.id === 'service');
  store.transaction(admin, 'account:manage', '准备冻结测试', data => { data.users.find(u => u.id === member.id).balanceCents = 12345; });
  const current = store.read().users.find(u => u.id === member.id);
  const token = store.login(member.username, '123456').token;
  const version = current.memberVersion;
  const frozen = store.membershipAction(admin, member.id, 'freezeBalance', { amountCents: 4500, memberVersion: version });
  assert.equal(frozen.balanceCents, 7845); assert.equal(frozen.frozenCents, 4500);
  assert.throws(() => store.membershipAction(admin, member.id, 'freezeBalance', { amountCents: 9000, memberVersion: frozen.memberVersion }), /不能超过可提现余额/);
  const status = store.membershipAction(admin, member.id, 'status', { active: false, memberVersion: frozen.memberVersion });
  assert.equal(status.active, false); assert.equal(store.session(token), undefined);
});

test('用户按 ID 入会不创建登录账号，并在用户管理同步职责', () => {
  const store = new ClubStore(':memory:');
  try {
    addFixtureGames(store, ['王者荣耀']);
    const admin = store.read().users.find(u => u.id === 'admin');
    const before = store.read().users.length;
    const added = store.accountAction(admin, null, { action: 'joinById', userId: 'U100001' });
    assert.equal(store.read().users.length, before + 1);
    assert.equal(added.memberNo, 'U100001');
    assert.equal(store.read().users.some(u => u.username === 'zhouzhiyuan'), false);
    let user = store.workspace(admin).users.find(u => u.customerNo === 'U100001');
    assert.equal(user.joinedClub, true);
    assert.equal(user.memberRoleLabel, '普通成员');
    verifyFixtureUsers(store, [added.id]);
    const member = store.read().users.find(u => u.id === added.id);
    store.membershipAction(admin, added.id, 'escort', { memberVersion: member.memberVersion, games: ['王者荣耀'], levelId: 'gold', depositCents: 100000 });
    user = store.workspace(admin).users.find(u => u.customerNo === 'U100001');
    assert.equal(user.memberRoleLabel, '打手');
    assert.throws(() => store.accountAction(admin, null, { action: 'joinById', userId: 'U100001' }), /已经是俱乐部成员/);
  } finally { store.close(); }
});

test('退款审核按原支付方式返还并可查询 SLA 与审计', () => {
  const store = new ClubStore(':memory:');
  try {
    const admin = store.read().users.find(u => u.id === 'admin');
    const refund = store.read().refunds[0];
    const customer = store.read().customers.find(c => c.name === refund.customer);
    const before = customer.balanceCents;
    const approved = store.reviewRefund(admin, refund.id, { action: 'approve', reason: '已核对服务记录' });
    assert.equal(approved.status, '已通过');
    assert.equal(store.read().customers.find(c => c.name === refund.customer).balanceCents, before + refund.amountCents);
    assert.equal(store.read().orders.find(o => o.id === refund.orderId).status, '已退款');
    assert.equal(store.workspace(admin).conversations.some(c => typeof c.slaOverdue === 'boolean'), true);
    assert.ok(store.auditList(admin).some(item => item.action.includes('退款')));
  } finally { store.close(); }
});

test('提现审核通过后必须登记打款流水号，统计导出返回 CSV', async t => {
  const { server, store } = createClubServer({ database: ':memory:' });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ username: 'admin', password: '123456' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  verifyFixtureUsers(store, ['escort']);
  const escort = store.read().users.find(u => u.id === 'escort');
  store.transaction(store.read().users.find(u => u.id === 'admin'), 'account:manage', '准备提现导出测试', data => { data.users.find(u => u.id === escort.id).balanceCents = 10000; });
  const request = await store.withdrawal(escort, { amount: '10' });
  assert.equal((await fetch(base + `/api/withdrawals/${request.id}`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ action: 'approve' }) })).status, 200);
  const paid = await fetch(base + `/api/withdrawals/${request.id}`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ action: 'markPaid', payoutRef: 'BANK-001' }) });
  assert.equal(paid.status, 200); assert.equal((await paid.json()).status, '已打款');
  const exportResponse = await fetch(base + '/api/analytics/export?kind=summary', { headers: { Cookie: cookie } });
  assert.equal(exportResponse.status, 200); const exported = await exportResponse.json(); assert.match(exported.content, /完成订单总金额/);
});
