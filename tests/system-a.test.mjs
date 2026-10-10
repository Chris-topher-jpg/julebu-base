import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { ClubStore } from '../server/club.mjs';
import { createClubServer } from '../server.mjs';
import { refundTotals } from '../server/analytics.mjs';
import { memberAvailability } from '../server/system-a.mjs';
import { parseRoute } from '../src/routes.js';
import { companionProfiles } from '../src/companions.js';
import { addFixtureGames } from './catalog-fixture.mjs';
import { verifyFixtureUsers, createVerifiedFixtureEscort } from './real-name-fixture.mjs';

function fixture(t, store) {
  if (!store) {
    store = new ClubStore(':memory:', { edition: 'A' });
    t.after(() => store.close());
  }
  addFixtureGames(store, ['王者荣耀']);
  verifyFixtureUsers(store, ['demo-user', 'demo-escort', 'demo-service']);
  const user = id => store.read().users.find(item => item.id === id);
  const buyer = user('demo-user'), worker = user('demo-escort'), service = user('demo-service'), admin = user('admin');
  const create = (input = {}) => store.createOrder(buyer, { context: 'personal', boss: buyer.name, productId: 'product-1', hours: 1, pay: '在线支付', requirement: '完成一小时约定服务', levelId: 'gold', ...input });
  const current = order => store.read().orders.find(item => item.id === order.id);
  const update = (actor, order, action, input = {}) => store.orderAction(actor, order.id, action, { version: current(order).version, ...input });
  const finish = order => {
    update(service, order, 'dispatch', { memberIds: [worker.id] });
    update(worker, order, 'accept'); update(worker, order, 'start');
    update(worker, order, 'finish', { evidence: '已经完成一小时约定服务' });
  };
  return { store, user, buyer, worker, service, admin, create, current, update, finish };
}

test('A 版默认 HTTP 入口关闭语音和动态，取消与评价响应返回本人订单', async t => {
  const app = createClubServer({ database: ':memory:', production: false, publicOrigin: null });
  const f = fixture(t, app.store);
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ username: 'demo_user', password: 'Test1234!' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  for (const path of ['/api/public/dispatch', '/api/dispatch/lobby/join', '/api/public/moments', '/api/moments/media']) {
    assert.equal((await fetch(base + path)).status, 404);
  }
  for (const page of ['moments', 'dispatchHall']) assert.deepEqual(parseRoute(`#/public/${page}`), { mode: 'public', page: 'overview' });
  const catalog = await (await fetch(base + '/api/public/catalog')).json();
  assert.equal(catalog.edition, 'A');
  const post = async (order, action, input) => {
    const response = await fetch(`${base}/api/orders/${order.id}/${action}`, { method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ context: 'personal', version: f.current(order).version, ...input }) });
    assert.equal(response.status, 200); return response.json();
  };
  const cancelled = f.create();
  assert.equal((await post(cancelled, 'cancel', { reason: '预约时间不合适' })).status, '已取消');
  const completed = f.create(); f.finish(completed); f.update(f.buyer, completed, 'approve', { context: 'personal' });
  const rated = await post(completed, 'rate', { rating: 2, comment: '服务沟通不够及时' });
  assert.equal(rated.id, completed.id); assert.equal(rated.review.rating, 2);
  assert.equal(rated.customerId, undefined); assert.equal(rated.participants[0].shareBps, undefined);
});

test('A 版客服派单、用户验收、自动分成、提现打款形成完整链路且只结算一次', t => {
  const f = fixture(t); const { store, buyer, worker, admin, create, finish, update, current } = f;
  const initial = store.workspace(worker).wallet.balanceCents;
  const order = create();
  assert.equal(order.dispatchMode, 'service'); assert.equal(order.selectionRequired, false);
  assert.deepEqual(store.workspace(worker).availableOrders, []);
  assert.equal(store.workspace(worker).role.pages.includes('availableOrders'), false);
  assert.equal(store.notifications(worker).items.some(item => item.orderId === order.id), false);
  finish(order);
  assert.equal(current(order).status, '待验收'); assert.equal(store.workspace(worker).wallet.balanceCents, initial);
  update(buyer, order, 'approve', { context: 'personal' });
  const earning = current(order).participants[0].earningCents;
  assert.equal(store.workspace(worker).wallet.balanceCents, initial + earning);
  assert.throws(() => update(buyer, order, 'approve', { context: 'personal' }), { status: 409 });
  assert.equal(store.read().ledger.filter(item => item.source === order.id && item.label === '订单分成').length, 1);
  const withdrawal = store.withdrawal(worker, { amount: '10' });
  assert.equal(store.workspace(worker).wallet.frozenCents, 1000);
  store.reviewWithdrawal(admin, withdrawal.id, { action: 'approve', reason: '核验通过' });
  store.reviewWithdrawal(admin, withdrawal.id, { action: 'markPaid', payoutRef: 'SYSTEM-A-PAYOUT-001' });
  assert.equal(store.workspace(worker).wallet.frozenCents, 0);
  assert.throws(() => store.reviewWithdrawal(admin, withdrawal.id, { action: 'markPaid', payoutRef: 'SYSTEM-A-PAYOUT-001' }), { status: 409 });
});

test('A 版拒绝自主抢单与买家候选选择，旧招募订单读时保持原记录、操作时客服直接派单', t => {
  const { store, buyer, worker, service, admin, create, current, update } = fixture(t);
  const order = create();
  store.transaction(admin, 'account:manage', '模拟完整版本旧订单', data => {
    const legacy = data.orders.find(item => item.id === order.id);
    legacy.selectionRequired = true; delete legacy.dispatchMode;
    legacy.applications = [{ userId: worker.id, source: 'self', appliedAt: new Date().toISOString() }];
  });
  const before = store.read();
  const visible = store.personal(buyer).orders.find(item => item.id === order.id);
  assert.equal(visible.selectionRequired, false); assert.deepEqual(visible.applications, []);
  assert.deepEqual(store.read(), before);
  assert.equal(store.notifications(worker).items.some(item => item.page === 'availableOrders'), false);
  for (const [actor, action] of [[worker, 'apply'], [worker, 'accept'], [buyer, 'selectApplicant']]) {
    assert.throws(() => update(actor, order, action, { memberIds: [worker.id] }), { status: 403 });
    assert.deepEqual(store.read(), before);
  }
  update(service, order, 'dispatch', { memberIds: [worker.id] });
  assert.equal(current(order).status, '待确认'); assert.equal(current(order).participants[0].userId, worker.id);
  assert.equal(current(order).selectionRequired, false);
  assert.throws(() => store.orderAction(service, order.id, 'dispatch', { version: order.version, memberIds: [worker.id] }), { status: 409 });
});

test('A 版忙闲状态阻止重复分配，指定陪玩拒单后能重新派单并转单', t => {
  const { store, worker, service, admin, create, update, current } = fixture(t);
  const replacement = createVerifiedFixtureEscort(store, admin, { username: 'system_a_worker', password: 'testing123', name: '替补陪玩', role: 'escort', active: true, games: ['王者荣耀'], levelId: 'gold' });
  store.setOnline(replacement, { online: true });
  const order = create({ orderMode: 'designated', preferredEscortId: worker.id });
  update(service, order, 'dispatch', { memberIds: [worker.id] });
  assert.equal(memberAvailability(store.read(), worker), '服务中');
  const another = create();
  const before = store.read();
  assert.throws(() => update(service, another, 'dispatch', { memberIds: [worker.id] }));
  assert.deepEqual(store.read(), before);
  update(worker, order, 'reject', { reason: '临时无法服务' });
  assert.equal(current(order).preferredEscortId, null); assert.equal(current(order).status, '待接单');
  assert.equal(memberAvailability(store.read(), worker), '空闲');
  update(service, order, 'dispatch', { memberIds: [replacement.id] });
  const third = createVerifiedFixtureEscort(store, admin, { username: 'system_a_third', password: 'testing123', name: '转派陪玩', role: 'escort', active: true, games: ['王者荣耀'], levelId: 'gold' });
  store.setOnline(third, { online: true });
  update(service, order, 'transfer', { memberIds: [third.id], reason: '客服重新安排服务' });
  assert.equal(current(order).status, '待确认'); assert.equal(current(order).participants[0].userId, third.id);
});

test('用户取消未开始的余额订单只退款一次，越权和服务开始后取消均原子拒绝', t => {
  const { store, buyer, worker, service, user, create, update, current } = fixture(t);
  for (const status of ['待接单', '待确认', '待服务']) {
    const initial = store.personal(buyer).wallet.balanceCents;
    const order = create();
    if (status !== '待接单') update(service, order, 'dispatch', { memberIds: [worker.id] });
    if (status === '待服务') update(worker, order, 'accept');
    const before = store.read();
    assert.throws(() => update(user('user-demo'), order, 'cancel', { context: 'personal', reason: '越权取消' }), { status: 403 });
    assert.throws(() => update(buyer, order, 'cancel', { context: 'personal', reason: '' }));
    assert.deepEqual(store.read(), before);
    update(buyer, order, 'cancel', { context: 'personal', reason: '取消预约服务' });
    assert.equal(current(order).status, '已取消'); assert.equal(store.personal(buyer).wallet.balanceCents, initial);
    assert.equal(store.read().ledger.filter(item => item.source === order.id && item.label === '取消订单退款').length, 1);
    assert.equal(store.read().ledger.some(item => item.source === order.id && item.label === '订单分成'), false);
    const after = store.read();
    assert.throws(() => update(buyer, order, 'cancel', { context: 'personal', reason: '重复取消' }), { status: 409 });
    assert.deepEqual(store.read(), after);
    assert.ok(store.notifications(user('finance')).items.some(item => item.kind === 'refund' && item.orderId === order.id));
  }
  const active = create(); update(service, active, 'dispatch', { memberIds: [worker.id] }); update(worker, active, 'accept'); update(worker, active, 'start');
  const before = store.read();
  assert.throws(() => update(buyer, active, 'cancel', { context: 'personal', reason: '服务中取消' }), { status: 409 });
  assert.deepEqual(store.read(), before);
});

test('A 版服务中售后暂停履约、通知财务和负责人，驳回后恢复、全额退款冲回收益', t => {
  const { store, buyer, worker, service, admin, user, create, update, current } = fixture(t);
  const balance = store.personal(buyer).wallet.balanceCents, income = store.workspace(worker).wallet.balanceCents;
  const order = create(); update(service, order, 'dispatch', { memberIds: [worker.id] }); update(worker, order, 'accept'); update(worker, order, 'start');
  let refund = store.createRefund(buyer, { context: 'personal', orderId: order.id, amountCents: 1000, reason: '服务问题请核实' });
  assert.equal(memberAvailability(store.read(), worker), '服务中');
  assert.throws(() => update(worker, order, 'finish', { evidence: '售后期间不允许完单' }), { status: 409 });
  for (const actor of [admin, user('finance')]) assert.ok(store.notifications(actor).items.some(item => item.kind === 'refund' && item.entityId === refund.id));
  store.reviewRefund(admin, refund.id, { action: 'reject', version: refund.version, reason: '核实后继续服务' });
  assert.equal(current(order).status, '陪玩中');
  update(worker, order, 'finish', { evidence: '完成约定服务等待用户验收' }); update(buyer, order, 'approve', { context: 'personal' });
  refund = store.createRefund(buyer, { context: 'personal', orderId: order.id, amountCents: order.amountCents, reason: '核实后全额退款' });
  store.reviewRefund(admin, refund.id, { action: 'approve', version: refund.version, reason: '核验后退款' });
  assert.equal(current(order).status, '已退款'); assert.equal(store.personal(buyer).wallet.balanceCents, balance);
  assert.equal(store.workspace(worker).wallet.balanceCents, income);
});

test('用户评价须为本人已完成订单，差评向对应陪玩可见且重复或无效提交不改变数据', t => {
  const { store, buyer, worker, user, create, update, finish } = fixture(t);
  const order = create();
  assert.throws(() => update(buyer, order, 'rate', { context: 'personal', rating: 1, comment: '尚未完成' }), { status: 409 });
  finish(order); update(buyer, order, 'approve', { context: 'personal' });
  const before = store.read();
  for (const rating of [0, 6, 1.5, '2', true]) assert.throws(() => update(buyer, order, 'rate', { context: 'personal', rating, comment: '无效评分' }));
  assert.throws(() => update(user('user-demo'), order, 'rate', { context: 'personal', rating: 1, comment: '越权评分' }), { status: 403 });
  assert.deepEqual(store.read(), before);
  update(buyer, order, 'rate', { context: 'personal', rating: 2, comment: '<script>服务沟通不及时</script>' });
  assert.equal(store.workspace(worker).orders.find(item => item.id === order.id).review.rating, 2);
  assert.equal(store.personal(user('user-demo')).orders.some(item => item.id === order.id), false);
  const after = store.read();
  assert.throws(() => update(buyer, order, 'rate', { context: 'personal', rating: 5, comment: '重复评分' }), { status: 409 });
  assert.deepEqual(store.read(), after);
});

test('客服未联系会话仅在工作人员实际回复后移出待办，内部备注和用户消息不算回复', t => {
  const { store, buyer, service } = fixture(t);
  const chat = store.conversationCreate(buyer, { context: 'personal', escortName: '俱乐部客服', message: '咨询下单安排' });
  const contacted = () => store.workspace(service).conversations.find(item => item.id === chat.id).contacted;
  assert.equal(contacted(), false);
  store.conversationAction(service, chat.id, { note: '准备安排接待' });
  assert.equal(contacted(), false);
  store.conversationMessage(buyer, chat.id, { context: 'personal', message: '我需要两小时' });
  assert.equal(contacted(), false);
  store.conversationMessage(service, chat.id, { message: '已收到，正在安排' });
  assert.equal(contacted(), true);
});

test('员工以买家身份咨询不算客服回复，登录个人目录保留忙闲状态', t => {
  const { store, service, admin, buyer, worker, create, update } = fixture(t);
  const chat = store.conversationCreate(service, { context: 'personal', type: 'consultation', message: '我作为买家咨询下单' });
  const contacted = () => store.workspace(admin).conversations.find(item => item.id === chat.id).contacted;
  assert.equal(contacted(), false);
  store.conversationMessage(service, chat.id, { context: 'personal', message: '我要预约一小时' });
  assert.equal(contacted(), false);
  store.conversationMessage(admin, chat.id, { message: '客服已收到你的需求' });
  assert.equal(contacted(), true);
  const order = create(); update(service, order, 'dispatch', { memberIds: [worker.id] });
  assert.equal(store.personal(buyer).members.find(item => item.id === worker.id).availability, '服务中');
  update(worker, order, 'reject', { reason: '时间冲突' });
  assert.equal(store.personal(buyer).members.find(item => item.id === worker.id).availability, '空闲');
});

test('陪玩目录包含空闲、忙碌和离线状态，退款统计按北京时间实际到账日期跨月区分', () => {
  const users = [{ id: 'free', online: true }, { id: 'busy', online: true }, { id: 'offline', online: false }];
  const data = { orders: [{ status: '待确认', participants: [{ userId: 'busy' }] }], refunds: [
    { status: '已通过', amountCents: 100, paidAt: '2026-09-30T16:00:00Z', requestedAt: '2026-09-29T00:00:00Z' },
    { status: '已退款', amountCents: 200, paidAt: '2026-10-02T00:00:00Z' },
    { status: '已退款', amountCents: 300, paidAt: '2026-09-30T15:59:59Z' },
    { status: '待线下退款', amountCents: 999, approvedAt: '2026-10-01T00:00:00Z' },
    { status: '已驳回', amountCents: 999, reviewedAt: '2026-10-01T00:00:00Z' },
    { status: '已退款', amountCents: 999, paidAt: 'invalid' },
    { status: '已退款', amountCents: 999, paidAt: '2026-11-01T00:00:00Z' },
  ] };
  assert.deepEqual(users.map(user => memberAvailability(data, user)), ['空闲', '服务中', '离线']);
  const profiles = companionProfiles({ catalogGames: [{ name: '王者荣耀' }], members: users.map(user => ({ ...user, name: user.id, games: ['王者荣耀'], availability: memberAvailability(data, user) })) });
  assert.equal(profiles.length, 3); assert.deepEqual(profiles.map(item => item.availability), ['空闲', '服务中', '离线']);
  assert.deepEqual(refundTotals(data, '2026-10-01', Date.parse('2026-10-10T00:00:00Z')), { dailyRefundCents: 100, monthlyRefundCents: 300 });
  assert.deepEqual(refundTotals(data, '2026-09-30', Date.parse('2026-10-10T00:00:00Z')), { dailyRefundCents: 300, monthlyRefundCents: 300 });
});
