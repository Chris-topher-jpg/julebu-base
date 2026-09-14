import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClubStore } from '../server/club.mjs';

function fixture(t, database = ':memory:') {
  const store = new ClubStore(database);
  t.after(() => store.close());
  const user = id => store.read().users.find(user => user.id === id);
  const buyer = user('demo-user'), staff = user('service'), admin = user('admin');
  store.transaction(admin, 'account:manage', '准备订单候选测试', data => {
    for (const id of ['demo-escort', 'escort', 'xiaoman']) Object.assign(data.users.find(user => user.id === id), { games: ['三角洲行动'], active: true, online: true, levelId: 'star', escortFrozen: false });
  });
  const create = (extra = {}) => store.createOrder(buyer, { context: 'personal', boss: buyer.name, productId: store.read().products.find(p => p.name === '1陪1/1陪2').id, levelId: 'gold', hours: 1, pay: '在线支付', requirement: '确认时间和游戏要求', ...extra });
  const raw = order => store.read().orders.find(item => item.id === order.id);
  const act = (actor, order, action, extra = {}) => store.orderAction(actor, order.id, action, { version: raw(order).version, ...extra });
  return { store, user, buyer, staff, admin, create, raw, act };
}

test('客服推荐与多人报名共存，只有老板选择后才锁定服务成员', t => {
  const { store, user, buyer, staff, create, raw, act } = fixture(t);
  const order = create({ selectionRequired: false });
  assert.equal(order.selectionRequired, true);
  const first = user('demo-escort'), second = user('escort'), third = user('xiaoman');
  act(staff, order, 'dispatch', { memberIds: [first.id] });
  assert.equal(raw(order).status, '待接单');
  assert.equal(raw(order).participants.length, 0);
  assert.ok(store.notifications(first).items.some(item => item.orderId === order.id && item.title === '客服邀请你参与订单'));
  for (const actor of [second, third]) assert.ok(store.workspace(actor).availableOrders.some(item => item.id === order.id));
  act(second, order, 'apply');
  // Old clients cannot use accept to claim a buyer's order before selection.
  const response = act(third, order, 'accept');
  assert.equal(response.status, '待接单');
  assert.equal(response.customerId, undefined);
  assert.deepEqual(response.applications.map(item => item.userId), [third.id]);
  assert.equal(raw(order).applications.length, 3);
  assert.throws(() => act(first, order, 'start'), { status: 403 });
  assert.throws(() => act(first, order, 'apply'), { status: 409 });
  assert.equal(raw(order).applications.length, 3);
  assert.throws(() => act(user('user-demo'), order, 'selectApplicant', { memberIds: [first.id] }), { status: 403 });
  assert.throws(() => act(staff, order, 'selectApplicant', { memberIds: [first.id] }), { status: 403 });
  assert.throws(() => act(staff, order, 'selectApplicant', { context: 'personal', memberIds: [first.id] }), { status: 403 });
  const personal = store.personal(buyer).orders.find(item => item.id === order.id);
  assert.deepEqual(personal.applications.map(item => item.source), ['service', 'self', 'self']);
  assert.equal(JSON.stringify(personal).includes('shareBps'), false);
  const selected = act(buyer, order, 'selectApplicant', { memberIds: [second.id] });
  assert.equal(selected.status, '待确认');
  assert.equal(raw(order).selectedBy, buyer.id);
  assert.deepEqual(raw(order).participants.map(item => item.userId), [second.id]);
  assert.equal(selected.participants[0].shareBps, undefined);
  assert.equal(store.workspace(first).availableOrders.some(item => item.id === order.id), false);
  assert.ok(store.notifications(first).items.some(item => item.orderId === order.id && item.title === '本次订单已结束招募'));
  assert.ok(store.notifications(second).items.some(item => item.orderId === order.id && item.page === 'myOrders'));
  assert.throws(() => act(staff, order, 'dispatch', { memberIds: [first.id] }), { status: 409 });
  assert.throws(() => act(third, order, 'apply'), { status: 409 });
  act(second, order, 'accept');
  assert.equal(raw(order).status, '待服务');
});

test('游戏、等级、冻结与在线状态在报名、展示和最终选择时重新校验', t => {
  const { store, user, admin, buyer, create, raw, act } = fixture(t);
  const worker = user('demo-escort'), order = create({ levelId: 'star' });
  const edit = changes => store.transaction(admin, 'account:manage', '调整测试资格', data => Object.assign(data.users.find(item => item.id === worker.id), changes));
  for (const changes of [{ games: ['王者荣耀'] }, { levelId: 'gold' }, { escortFrozen: true }]) {
    edit({ games: ['三角洲行动'], levelId: 'star', escortFrozen: false, ...changes });
    assert.equal(store.workspace(worker).availableOrders.some(item => item.id === order.id), false);
    assert.equal(store.notifications(worker).items.some(item => item.orderId === order.id), false);
    assert.throws(() => act(worker, order, 'apply'), { status: 400 });
  }
  edit({ games: ['三角洲行动'], levelId: 'star', escortFrozen: false, online: false });
  assert.ok(store.workspace(worker).availableOrders.some(item => item.id === order.id));
  assert.throws(() => act(worker, order, 'apply'), { status: 400 });
  edit({ online: true }); act(worker, order, 'apply');
  edit({ levelId: 'gold' });
  assert.equal(store.personal(buyer).orders.find(item => item.id === order.id).applications[0].eligible, false);
  assert.throws(() => act(buyer, order, 'selectApplicant', { memberIds: [worker.id] }), { status: 409 });
  assert.equal(raw(order).participants.length, 0);
  edit({ active: false });
  assert.throws(() => act(worker, order, 'apply'), { status: 401 });
  assert.throws(() => act(buyer, order, 'selectApplicant', { memberIds: [worker.id] }), { status: 409 });
});

test('同一旧版本重复操作不覆盖候选，不能伪造候选人或绕过多人订单人数', t => {
  const { store, user, buyer, staff, create, raw, act } = fixture(t);
  const first = user('demo-escort'), second = user('escort'), third = user('xiaoman');
  const order = create({ productId: store.read().products.find(p => p.name === '2陪1').id });
  const originalVersion = order.version;
  act(staff, order, 'dispatch', { memberIds: [first.id] });
  assert.throws(() => act(second, order, 'apply', { version: originalVersion }), { status: 409 });
  act(second, order, 'apply');
  assert.equal(raw(order).applications.length, 2);
  for (const ids of [[], [first.id], [first.id, first.id], [first.id, third.id], [first.id, second.id, third.id], 'invalid']) {
    assert.throws(() => act(buyer, order, 'selectApplicant', { memberIds: ids }));
    assert.equal(raw(order).participants.length, 0);
  }
  const before = raw(order).version;
  act(buyer, order, 'selectApplicant', { memberIds: [first.id, second.id] });
  assert.throws(() => act(buyer, order, 'selectApplicant', { version: before, memberIds: [first.id, second.id] }), { status: 409 });
  const selected = raw(order);
  assert.equal(selected.participants.length, 2);
  assert.ok(selected.participants.reduce((sum, item) => sum + item.earningCents, 0) <= selected.amountCents);
  act(first, order, 'accept'); assert.equal(raw(order).status, '待确认');
  act(second, order, 'accept'); assert.equal(raw(order).status, '待服务');
});

test('退款审核暂停报名与选择，驳回后恢复；指定订单只允许指定打手参与', t => {
  const { store, user, buyer, admin, staff, create, raw, act } = fixture(t);
  const worker = user('demo-escort'), other = user('escort');
  const order = create({ orderMode: 'designated', preferredEscortId: worker.id });
  assert.equal(store.workspace(other).availableOrders.some(item => item.id === order.id), false);
  assert.equal(store.notifications(other).items.some(item => item.orderId === order.id), false);
  assert.throws(() => act(other, order, 'apply'), { status: 400 });
  assert.throws(() => act(staff, order, 'dispatch', { memberIds: [other.id] }), { status: 400 });
  act(worker, order, 'apply');
  const refund = store.createRefund(buyer, { orderId: order.id, amountCents: order.amountCents, reason: '调整预约安排' });
  assert.throws(() => act(staff, order, 'dispatch', { memberIds: [worker.id] }), { status: 409 });
  assert.throws(() => act(buyer, order, 'selectApplicant', { memberIds: [worker.id] }), { status: 409 });
  assert.equal(store.workspace(worker).availableOrders.some(item => item.id === order.id), false);
  store.reviewRefund(admin, refund.id, { action: 'reject', reason: '已确认继续服务' });
  act(buyer, order, 'selectApplicant', { memberIds: [worker.id] });
  assert.equal(raw(order).status, '待确认');
});

test('候选名单与报名来源在数据库重启后保留', t => {
  const folder = mkdtempSync(join(tmpdir(), 'club-applicants-'));
  const path = join(folder, 'club.sqlite');
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  let store = new ClubStore(path);
  const buyer = store.read().users.find(item => item.id === 'demo-user');
  const worker = store.read().users.find(item => item.id === 'demo-escort');
  try {
    store.transaction({ id: 'admin' }, 'account:manage', '准备游戏技能', data => data.users.find(item => item.id === worker.id).games.push('三角洲行动'));
    const order = store.createOrder(buyer, { boss: buyer.name, productId: store.read().products.find(p => p.name === '1陪1/1陪2').id, hours: 1, pay: '在线支付', requirement: '重启后继续选择' });
    store.orderAction(worker, order.id, 'apply', { version: order.version });
    store.close(); store = null;
    store = new ClubStore(path);
    const saved = store.personal(buyer).orders.find(item => item.id === order.id);
    assert.equal(saved.applications[0].userId, worker.id);
    assert.equal(saved.applications[0].source, 'self');
    assert.equal(saved.status, '待接单');
    assert.equal(store.orderAction(buyer, order.id, 'selectApplicant', { version: saved.version, memberIds: [worker.id] }).status, '待确认');
  } finally { store?.close(); }
});
