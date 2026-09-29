import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { ClubStore } from '../server/club.mjs';
import { createClubServer } from '../server.mjs';
import { verifyFixtureUsers, userById } from './real-name-fixture.mjs';

function fixture(t) {
  const store = new ClubStore(':memory:');
  t.after(() => store.close());
  const user = id => store.read().users.find(item => item.id === id);
  verifyFixtureUsers(store, ['demo-user', 'demo-escort']);
  const buyer = user('demo-user'), worker = user('demo-escort'), staff = user('service'), admin = user('admin');
  store.transaction(admin, 'account:manage', '准备订单完整性测试', data => {
    Object.assign(data.users.find(item => item.id === worker.id), { games: ['三角洲行动'], active: true, online: true, levelId: 'star' });
  });
  const input = extra => ({ context: 'personal', boss: buyer.name, productId: store.read().products.find(item => item.name === '1陪1/1陪2').id, hours: 1, levelId: 'gold', pay: '在线支付', requirement: '按约完成本次游戏陪玩服务', ...extra });
  const raw = order => store.read().orders.find(item => item.id === order.id);
  const act = (actor, order, action, extra = {}) => store.orderAction(actor, order.id, action, { version: raw(order).version, ...extra });
  const create = extra => store.createOrder(buyer, input(extra));
  const start = order => {
    act(worker, order, 'apply'); act(buyer, order, 'selectApplicant', { memberIds: [worker.id] });
    act(worker, order, 'accept'); act(worker, order, 'start');
  };
  return { store, buyer, worker, staff, admin, input, raw, act, create, start };
}

test('双人商品不能指定唯一打手，拒绝不可能履约的订单且不扣款', t => {
  const { store, buyer, worker, create } = fixture(t);
  const before = store.read();
  const dual = before.products.find(item => item.name === '2陪1');
  assert.throws(() => create({ productId: dual.id, orderMode: 'designated', preferredEscortId: worker.id }), /多人配合/);
  assert.equal(store.personal(buyer).wallet.balanceCents, before.customers.find(item => item.id === buyer.customerId).balanceCents);
  assert.equal(store.read().orders.length, before.orders.length);
  assert.equal(store.read().ledger.length, before.ledger.length);
});

test('退单打手不能通过旧式直接接单或客服派单绕过排除名单', t => {
  const { store, worker, staff, input, act, raw } = fixture(t);
  const order = store.createOrder(staff, input({ context: 'management', customerId: userById(store, 'demo-user').customerId, boss: userById(store, 'demo-user').name, pay: '线下已收款', selectionRequired: false }));
  assert.equal(order.selectionRequired, true, '当前订单必须由买家选人，客户端不得关闭');
  store.transaction({ id: 'admin' }, 'account:manage', '准备历史直接接单订单', data => { data.orders.find(item => item.id === order.id).selectionRequired = false; });
  assert.equal(raw(order).selectionRequired, false);
  act(worker, order, 'accept');
  act(worker, order, 'reject', { reason: '无法按预约安排提供服务' });
  assert.throws(() => act(worker, order, 'accept'), { status: 400 });
  assert.throws(() => act(staff, order, 'dispatch', { memberIds: [worker.id] }), { status: 400 });
  assert.equal(raw(order).status, '待接单');
  assert.equal(raw(order).participants.length, 0);
});

test('验收退回不能让成员同时服务两个订单，冲突消除后可继续补充服务', t => {
  const { store, worker, staff, create, start, act, raw } = fixture(t);
  const first = create(); start(first);
  act(worker, first, 'finish', { evidence: '第一笔服务已完成并提交说明' });
  const second = create(); start(second);
  const before = raw(first);
  assert.throws(() => act(staff, first, 'return', { reason: '需要补充第一笔服务的内容' }), { status: 409 });
  assert.deepEqual(raw(first), before);
  act(worker, second, 'finish', { evidence: '第二笔服务已完成并提交说明' });
  act(staff, first, 'return', { reason: '请补充约定的服务内容' });
  assert.equal(raw(first).status, '陪玩中');
  assert.equal(store.read().orders.filter(order => order.status === '陪玩中' && order.participants.some(p => p.userId === worker.id && !p.finished)).length, 1);
  act(worker, first, 'finish', { evidence: '已经完成补充服务并核对要求' });
  act(staff, first, 'approve');
  assert.equal(raw(first).status, '已完成');
});

test('相同下单请求只扣款一次，错误复用请求与无效请求不产生订单', t => {
  const { store, buyer, admin, input } = fixture(t);
  const before = store.personal(buyer).wallet.balanceCents;
  const body = input({ requestId: 'order-retry-0001', expectedUnitPriceCents: 5800 });
  const created = store.createOrder(buyer, body);
  assert.equal(store.createOrder(buyer, { ...body }).id, created.id);
  assert.equal(store.personal(buyer).wallet.balanceCents, before - created.amountCents);
  assert.equal(store.read().ledger.filter(item => item.source === created.id && item.label === '订单消费').length, 1);
  assert.throws(() => store.createOrder(buyer, { ...body, hours: 2 }), { status: 409 });
  for (const requestId of ['', 'short', null, 123, {}, 'a'.repeat(81)]) assert.throws(() => store.createOrder(buyer, { ...body, requestId }), { status: 400 });
  store.transaction(admin, 'account:manage', '模拟下单成功后商品暂停', data => { data.products.find(item => item.id === body.productId).state = '暂停'; });
  assert.equal(store.createOrder(buyer, body).id, created.id);
  assert.equal(store.personal(buyer).wallet.balanceCents, before - created.amountCents);
});

test('下单请求在数据库重启后仍去重，并按操作账号隔离', t => {
  const folder = mkdtempSync(join(tmpdir(), 'club-order-integrity-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const path = join(folder, 'club.sqlite');
  let store = new ClubStore(path);
  verifyFixtureUsers(store, ['demo-user', 'user-demo']);
  try {
    const buyer = store.read().users.find(item => item.id === 'demo-user');
    const body = { boss: buyer.name, productId: store.read().products.find(item => item.name === '1陪1/1陪2').id, hours: 1, pay: '在线支付', requirement: '重启后继续查询本次下单结果', requestId: 'persistent-order-1' };
    const created = store.createOrder(buyer, body);
    const balance = store.personal(buyer).wallet.balanceCents;
    store.close(); store = null;
    store = new ClubStore(path);
    assert.equal(store.createOrder(buyer, body).id, created.id);
    assert.equal(store.personal(buyer).wallet.balanceCents, balance);
    const otherBuyer = store.read().users.find(item => item.id === 'user-demo');
    const other = store.createOrder(otherBuyer, { ...body, boss: otherBuyer.name });
    assert.notEqual(other.id, created.id);
    assert.equal(other.customerId, otherBuyer.customerId);
  } finally { store?.close(); }
});

test('个人 HTTP 下单、重试与验收响应仅返回买家可见字段', async t => {
  const instance = createClubServer({ database: ':memory:' });
  instance.server.listen(0, '127.0.0.1');
  await once(instance.server, 'listening');
  t.after(() => new Promise(resolve => instance.server.close(resolve)));
  const { store } = instance;
  verifyFixtureUsers(store, ['demo-user', 'demo-escort']);
  const base = `http://127.0.0.1:${instance.server.address().port}`;
  const buyer = store.read().users.find(item => item.id === 'demo-user');
  const worker = store.read().users.find(item => item.id === 'demo-escort');
  const admin = store.read().users.find(item => item.id === 'admin');
  store.transaction(admin, 'account:manage', '准备 HTTP 订单测试', data => { data.users.find(item => item.id === worker.id).games = ['三角洲行动']; });
  const token = store.login(buyer.username, 'Test1234!').token;
  const post = async (path, body) => {
    const response = await fetch(base + path, { method: 'POST', headers: { Origin: base, Cookie: `club_session=${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    assert.ok(response.ok, JSON.stringify(result));
    return result;
  };
  const body = { context: 'personal', boss: buyer.name, productId: store.read().products.find(item => item.name === '1陪1/1陪2').id, hours: 1, pay: '在线支付', requirement: '核验订单响应与资金隐私', requestId: 'http-order-privacy' };
  let response = await post('/api/orders', body);
  const id = response.id;
  const assertPrivate = result => {
    for (const field of ['customerId', 'selectedBy', 'excludedEscortIds']) assert.equal(result[field], undefined);
    assert.ok(result.history.every(item => item.by === undefined && item.note === undefined));
    for (const participant of result.participants) for (const field of ['shareBps', 'baseShareBps', 'earningCents', 'settledCents']) assert.equal(participant[field], undefined);
  };
  assertPrivate(response);
  const act = (actor, action, extra = {}) => store.orderAction(actor, id, action, { version: store.read().orders.find(item => item.id === id).version, ...extra });
  act(worker, 'apply'); act(buyer, 'selectApplicant', { memberIds: [worker.id] }); act(worker, 'accept'); act(worker, 'start');
  act(worker, 'finish', { evidence: '已完成约定服务并提交验收材料' });
  response = await post(`/api/orders/${id}/approve`, { context: 'personal', version: store.read().orders.find(item => item.id === id).version });
  assert.equal(response.status, '已完成');
  assertPrivate(response);
  const retry = await post('/api/orders', body);
  assert.equal(retry.id, id); assert.equal(retry.status, '已完成'); assertPrivate(retry);
  assert.equal(store.read().ledger.filter(item => item.source === id && item.label === '订单消费').length, 1);
  assert.equal(store.read().ledger.filter(item => item.source === id && item.label === '订单分成').length, 1);
});
