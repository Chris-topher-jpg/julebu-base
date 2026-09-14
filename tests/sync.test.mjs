import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClubStore } from '../server/club.mjs';
import { createClubServer } from '../server.mjs';
import { addFixtureGames } from './catalog-fixture.mjs';

const purchase = buyer => ({
  context: 'personal', boss: buyer.name, productId: 'product-1', hours: 1,
  pay: '在线支付', requirement: '同步测试：完成约定的一小时服务', levelId: 'gold',
});
const orderNotice = (feed, id) => feed.items.find(item => item.kind === 'order' && item.orderId === id);

function fixture(t) {
  const store = new ClubStore(':memory:');
  t.after(() => store.close());
  addFixtureGames(store, ['王者荣耀']);
  const user = id => store.read().users.find(item => item.id === id);
  const create = (buyer = user('demo-user')) => store.createOrder(buyer, purchase(buyer));
  return { store, user, create };
}

async function httpFixture(t, persistent = false) {
  const folder = persistent ? mkdtempSync(join(tmpdir(), 'club-sync-test-')) : null;
  const database = folder ? join(folder, 'club.sqlite') : ':memory:';
  let instance, base;
  const cookies = new Map();
  const start = async () => {
    instance = createClubServer({ database });
    addFixtureGames(instance.store, ['王者荣耀']);
    instance.server.listen(0, '127.0.0.1');
    await once(instance.server, 'listening');
    base = `http://127.0.0.1:${instance.server.address().port}`;
  };
  const close = () => new Promise(resolve => instance.server.close(resolve));
  await start();
  t.after(async () => { await close(); if (folder) rmSync(folder, { recursive: true, force: true }); });
  const call = async (who, path, body) => {
    const response = await fetch(base + '/api' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(cookies.has(who) ? { Cookie: cookies.get(who) } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: base }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  const login = async (who, username, password = 'Test1234!') => {
    const result = await call(who, '/login', { username, password });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    cookies.set(who, result.headers.get('set-cookie').split(';')[0]);
    return result.body.user;
  };
  const sync = async (who, since = 0, context = 'management') => {
    const result = await call(who, `/sync?since=${since}&context=${context}`);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body;
  };
  return { call, login, sync, restart: async () => { await close(); await start(); } };
}

test('多账号同步下单、客服派单、打手履约、验收和收益，其他用户与打手保持隔离', async t => {
  const { call, login, sync } = await httpFixture(t);
  const buyer = await login('buyer', 'demo_user');
  await login('service', 'demo_service');
  const escort = await login('escort', 'demo_escort');
  await login('otherBuyer', 'user', '123456');
  await login('otherEscort', 'escort', '123456');
  await login('finance', 'demo_finance');
  const customerBefore = await sync('buyer', 0, 'personal');
  const serviceBefore = await sync('service');
  const escortBefore = await sync('escort');
  const created = await call('buyer', '/orders', purchase(buyer));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  let order = created.body;

  const serviceNew = await sync('service', serviceBefore.revision);
  assert.equal(serviceNew.changed, true);
  assert.equal(serviceNew.workspace.orders.find(item => item.id === order.id).status, '待接单');
  assert.equal(orderNotice(serviceNew.notifications, order.id)?.page, 'dispatch');
  assert.equal(orderNotice(serviceNew.notifications, order.id)?.readAt, null);
  assert.ok(serviceNew.notifications.unreadCount > 0);
  const customerPaid = await sync('buyer', customerBefore.revision, 'personal');
  assert.equal(customerPaid.workspace.wallet.balanceCents, customerBefore.workspace.wallet.balanceCents - order.amountCents);

  const update = async (who, action, input = {}) => {
    const result = await call(who, `/orders/${order.id}/${action}`, { version: order.version, ...input });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    order = result.body;
  };
  await update('service', 'dispatch', { memberIds: [escort.id] });
  assert.equal(order.status, '待接单');
  assert.equal(order.participants.length, 0);
  await update('buyer', 'selectApplicant', { memberIds: [escort.id] });
  const assigned = await sync('escort', escortBefore.revision);
  assert.equal(assigned.workspace.orders.find(item => item.id === order.id).status, '待确认');
  assert.equal(orderNotice(assigned.notifications, order.id)?.page, 'myOrders');
  assert.equal(orderNotice(assigned.notifications, order.id)?.mode, 'management');
  const customerAssigned = await sync('buyer', customerPaid.revision, 'personal');
  assert.equal(customerAssigned.workspace.orders.find(item => item.id === order.id).participants[0].name, escort.name);
  assert.equal(orderNotice(customerAssigned.notifications, order.id)?.mode, 'personal');

  for (const [action, status, input] of [
    ['accept', '待服务', {}], ['start', '陪玩中', {}],
    ['finish', '待验收', { evidence: '已完成约定的一小时服务，请客服验收' }],
  ]) {
    const previousRevision = (await sync('service')).revision;
    await update('escort', action, input);
    const staff = await sync('service', previousRevision);
    const personal = await sync('buyer', previousRevision, 'personal');
    assert.equal(staff.workspace.orders.find(item => item.id === order.id).status, status);
    assert.equal(personal.workspace.orders.find(item => item.id === order.id).status, status);
    assert.equal(orderNotice(staff.notifications, order.id)?.readAt, null);
  }
  await update('service', 'approve');
  const [finished, paid, finance] = await Promise.all([
    sync('buyer', 0, 'personal'), sync('escort'), sync('finance'),
  ]);
  assert.equal(finished.workspace.orders.find(item => item.id === order.id).status, '已完成');
  assert.equal(paid.workspace.orders.find(item => item.id === order.id).status, '已完成');
  const earning = order.participants.find(item => item.userId === escort.id).earningCents;
  assert.equal(paid.workspace.wallet.balanceCents, escortBefore.workspace.wallet.balanceCents + earning);
  assert.equal(paid.workspace.ledger.find(item => item.source === order.id).deltaCents, earning);
  assert.equal(finance.workspace.ledger.find(item => item.source === order.id && item.userId === escort.id).deltaCents, earning);
  assert.equal(finished.workspace.ledger.find(item => item.source === order.id).deltaCents, -order.amountCents);
  assert.equal((await call('service', `/orders/${order.id}/approve`, { version: order.version })).status, 409);
  assert.equal((await sync('escort')).workspace.wallet.balanceCents, paid.workspace.wallet.balanceCents);

  for (const [who, context] of [['otherBuyer', 'personal'], ['otherEscort', 'management']]) {
    const unrelated = await sync(who, 0, context);
    assert.equal(unrelated.workspace.orders.some(item => item.id === order.id), false);
    assert.equal((unrelated.workspace.availableOrders || []).some(item => item.id === order.id), false);
    assert.equal(orderNotice(unrelated.notifications, order.id), undefined);
    assert.equal(JSON.stringify(unrelated).includes(purchase(buyer).requirement), false);
  }
});

test('匹配打手可以报名，老板查看报名名单并选择最终打手', async t => {
  const { call, login, sync } = await httpFixture(t);
  const buyer = await login('buyer', 'demo_user');
  await login('service', 'demo_service');
  const escort = await login('escort', 'demo_escort');
  await login('otherEscort', 'escort', '123456');
  const created = await call('buyer', '/orders', purchase(buyer));
  assert.equal(created.status, 201);
  let order = created.body;
  let escortWorkspace = await sync('escort', 0);
  assert.ok(escortWorkspace.workspace.availableOrders.some(item => item.id === order.id));
  const application = await call('escort', `/orders/${order.id}/apply`, { version: order.version });
  assert.equal(application.status, 200, JSON.stringify(application.body));
  order = application.body;
  assert.equal(order.status, '待接单');
  assert.equal(order.participants.length, 0);
  assert.equal(order.applications.length, 1);
  const ownerWorkspace = await sync('buyer', 0, 'personal');
  const ownerOrder = ownerWorkspace.workspace.orders.find(item => item.id === order.id);
  assert.equal(ownerOrder.applications[0].name, '测试陪玩');
  escortWorkspace = await sync('otherEscort', 0);
  assert.ok(escortWorkspace.workspace.availableOrders.some(item => item.id === order.id));
  const selected = await call('buyer', `/orders/${order.id}/selectApplicant`, { version: order.version, userId: escort.id });
  assert.equal(selected.status, 200, JSON.stringify(selected.body));
  assert.equal(selected.body.status, '待确认');
  assert.deepEqual(selected.body.participants.map(item => item.name), ['测试陪玩']);
  assert.equal(selected.body.participants[0].shareBps, undefined);
  const hiddenFromOthers = await sync('otherEscort', 0);
  assert.equal(hiddenFromOthers.workspace.availableOrders.some(item => item.id === order.id), false);
});

test('同步游标无变化时省略工作区，未来游标可以恢复，并拒绝无效参数', t => {
  const { store, user, create } = fixture(t);
  const service = user('demo-service');
  const first = store.sync(service, 0, 'management');
  assert.equal(first.changed, true);
  assert.equal(first.workspace.user.id, service.id);
  const quiet = store.sync(service, first.revision, 'management');
  assert.equal(quiet.changed, false);
  assert.equal(quiet.revision, first.revision);
  assert.equal(Object.hasOwn(quiet, 'workspace'), false);
  assert.deepEqual(quiet.notifications, first.notifications);
  assert.equal(store.read().revision, first.revision);
  const recovery = store.sync(service, first.revision + 1000, 'management');
  assert.equal(recovery.changed, true);
  assert.equal(recovery.revision, first.revision);
  assert.equal(recovery.workspace.user.id, service.id);
  create();
  const changed = store.sync(service, first.revision, 'management');
  assert.ok(changed.revision > first.revision);
  assert.equal(changed.changed, true);
  for (const cursor of [-1, 1.5, 'NaN', 'Infinity', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => store.sync(service, cursor, 'management'), { status: 400 });
  }
  assert.throws(() => store.sync(service, 0, 'admin'), { status: 400 });
});

test('同一浏览器切换账号后，即使数据版本未变化也返回当前账号 ID', async t => {
  const { call, login, sync } = await httpFixture(t);
  const buyer = await login('buyer', 'demo_user');
  const service = await login('sharedBrowser', 'demo_service');
  // Keep both identities online so replacing this browser's session does not
  // change presence or the shared revision; identity must still be returned.
  await login('serviceBackup', 'demo_service');
  await login('userBackup', 'user', '123456');
  const created = await call('buyer', '/orders', purchase(buyer));
  assert.equal(created.status, 201);
  const staff = await sync('sharedBrowser', 0, 'personal');
  assert.equal(staff.userId, service.id);
  assert.ok(orderNotice(staff.notifications, created.body.id));
  assert.equal((await sync('sharedBrowser', staff.revision, 'personal')).userId, service.id);

  const nextUser = await login('sharedBrowser', 'user', '123456');
  const unchanged = await sync('sharedBrowser', staff.revision, 'personal');
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.revision, staff.revision);
  assert.equal(unchanged.workspace, undefined);
  assert.equal(unchanged.userId, nextUser.id);
  assert.notEqual(unchanged.userId, service.id);
  assert.equal(orderNotice(unchanged.notifications, created.body.id), undefined);
  const refreshed = await sync('sharedBrowser', 0, 'personal');
  assert.equal(refreshed.userId, nextUser.id);
  assert.equal(refreshed.workspace.user.id, nextUser.id);
  assert.equal(refreshed.workspace.orders.some(item => item.id === created.body.id), false);
});

test('转单后旧打手仅保留移出提示，新打手与买家收到新进度且旧派单备注不外泄', t => {
  const { store, user, create } = fixture(t);
  const service = user('demo-service'), previousEscort = user('demo-escort'), buyer = user('demo-user');
  const replacement = store.accountAction(user('admin'), null, { username: 'transfer_worker', password: 'testing123', name: '接替打手', role: 'escort', active: true, games: ['王者荣耀'], levelId: 'gold' });
  store.setOnline(replacement, { online: true });
  let order = create();
  const update = (actor, action, input = {}) => { order = store.orderAction(actor, order.id, action, { version: order.version, ...input }); };
  update(service, 'dispatch', { memberIds: [previousEscort.id] });
  update(buyer, 'selectApplicant', { memberIds: [previousEscort.id] });
  const oldAssignment = orderNotice(store.notifications(previousEscort), order.id);
  assert.equal(oldAssignment.title, '你收到一笔新派单');
  update(service, 'transfer', { memberIds: [replacement.id], reason: '内部排班信息，仅管理人员查看' });
  assert.equal(order.status, '待接单');
  update(buyer, 'selectApplicant', { memberIds: [replacement.id] });
  const transferred = store.sync(previousEscort, 0, 'management');
  assert.equal(transferred.workspace.orders.some(item => item.id === order.id), false);
  const removed = transferred.notifications.items.filter(item => item.orderId === order.id);
  assert.equal(removed.length, 1);
  assert.equal(removed[0].title, '订单已移出你的服务列表');
  assert.notEqual(removed[0].id, oldAssignment.id);
  assert.equal(JSON.stringify(removed).includes(replacement.name), false);
  assert.equal(JSON.stringify(removed).includes('内部排班信息'), false);

  const assigned = store.sync(replacement, 0, 'management');
  const assignedOrder = assigned.workspace.orders.find(item => item.id === order.id);
  assert.equal(assignedOrder.status, '待确认');
  assert.equal(orderNotice(assigned.notifications, order.id).title, '你收到一笔新派单');
  assert.equal(JSON.stringify(assignedOrder).includes(previousEscort.name), false);
  assert.equal(JSON.stringify(assignedOrder).includes('内部排班信息'), false);
  assert.equal(store.personal(buyer).orders.find(item => item.id === order.id).participants[0].name, replacement.name);
  update(replacement, 'accept');
  update(replacement, 'start');
  update(replacement, 'finish', { evidence: '替补成员已完成约定服务' });
  update(service, 'approve');
  assert.deepEqual(store.notifications(previousEscort).items.filter(item => item.orderId === order.id), removed);
  assert.equal(store.personal(buyer).orders.find(item => item.id === order.id).status, '已完成');
  assert.equal(store.workspace(replacement).orders.find(item => item.id === order.id).status, '已完成');
});

test('打手主动退回订单后，重新派单及服务动态不再发送给原打手', t => {
  const { store, user, create } = fixture(t);
  const service = user('demo-service'), previousEscort = user('demo-escort');
  const replacement = store.accountAction(user('admin'), null, { username: 'reassigned_worker', password: 'testing123', name: '重新派单打手', role: 'escort', active: true, games: ['王者荣耀'], levelId: 'gold' });
  store.setOnline(replacement, { online: true });
  let order = create();
  const update = (actor, action, input = {}) => { order = store.orderAction(actor, order.id, action, { version: order.version, ...input }); };
  update(service, 'dispatch', { memberIds: [previousEscort.id] });
  update(user('demo-user'), 'selectApplicant', { memberIds: [previousEscort.id] });
  assert.ok(orderNotice(store.notifications(previousEscort), order.id));
  update(previousEscort, 'reject', { reason: '个人安排冲突，请重新安排' });
  assert.equal(order.status, '待接单');
  assert.equal(orderNotice(store.notifications(previousEscort), order.id), undefined);
  assert.ok(orderNotice(store.notifications(service), order.id));
  update(service, 'dispatch', { memberIds: [replacement.id] });
  update(user('demo-user'), 'selectApplicant', { memberIds: [replacement.id] });
  update(replacement, 'accept');
  update(replacement, 'start');
  const former = store.sync(previousEscort, 0, 'management');
  assert.equal(former.workspace.orders.some(item => item.id === order.id), false);
  assert.equal(former.workspace.availableOrders.some(item => item.id === order.id), false);
  assert.equal(orderNotice(former.notifications, order.id), undefined);
  assert.equal(orderNotice(store.notifications(replacement), order.id).page, 'myOrders');
});

test('通知优先返回最新未读且最多 100 条，较早未读可以分批处理', t => {
  const { store, user } = fixture(t);
  const recipient = user('demo-user');
  const instant = Date.parse('2026-01-01T00:00:00.000Z');
  store.transaction(user('admin'), 'account:manage', '准备大量历史通知', data => {
    data.notifications.unshift(...Array.from({ length: 140 }, (_, position) => ({
      id: `batch-notice-${position}`, recipientId: recipient.id, kind: 'account', entityId: recipient.id,
      mode: 'personal', page: 'memberProfile', title: '账号资料已更新', body: '测试历史通知',
      createdAt: new Date(instant + position * 1000).toISOString(), readAt: position < 120 ? null : new Date(instant + 150000).toISOString(),
    })));
  });
  const first = store.notifications(recipient);
  assert.equal(first.unreadCount, 120);
  assert.equal(first.items.length, 100);
  assert.ok(first.items.every(item => !item.readAt));
  assert.equal(first.items[0].id, 'batch-notice-119');
  assert.equal(first.items.at(-1).id, 'batch-notice-20');
  const next = store.readNotifications(recipient, { ids: first.items.map(item => item.id) });
  assert.equal(next.unreadCount, 20);
  assert.equal(next.items.length, 100);
  assert.equal(next.items[0].id, 'batch-notice-19');
  assert.equal(next.items[19].id, 'batch-notice-0');
  assert.ok(next.items.slice(20).every(item => item.readAt));
  const final = store.readNotifications(recipient, { ids: next.items.filter(item => !item.readAt).map(item => item.id) });
  assert.equal(final.unreadCount, 0);
  assert.equal(final.items.length, 100);
  assert.equal(final.items[0].id, 'batch-notice-139');
});

test('工作人员进入个人工作区时只同步本人消费资料，工作通知仍保留正确入口', t => {
  const { store, user, create } = fixture(t);
  const service = user('demo-service');
  const customerOrder = create();
  store.transaction(user('admin'), 'account:manage', '准备工作人员个人余额', data => {
    data.customers.find(item => item.id === service.customerId).balanceCents = 20000;
  });
  const personalOrder = create(service);
  const personal = store.sync(service, 0, 'personal');
  assert.equal(personal.workspace.mode, 'personal');
  assert.equal(personal.workspace.user.role, 'user');
  assert.equal(personal.workspace.membership.role, 'service');
  assert.deepEqual(personal.workspace.orders.map(item => item.id), [personalOrder.id]);
  assert.equal(personal.workspace.wallet.balanceCents, 20000 - personalOrder.amountCents);
  for (const key of ['customers', 'accounts', 'audit', 'topups', 'withdrawals']) assert.equal(personal.workspace[key], undefined);
  assert.ok(personal.workspace.ledger.every(item => !item.userId));
  const notification = orderNotice(personal.notifications, customerOrder.id);
  assert.equal(notification?.mode, 'management');
  assert.equal(notification?.page, 'dispatch');
  assert.equal(Object.hasOwn(notification, 'recipientId'), false);
  const management = store.sync(service, 0, 'management');
  assert.equal(management.workspace.user.role, 'service');
  assert.ok(management.workspace.orders.some(item => item.id === customerOrder.id));
  assert.equal(JSON.stringify(personal.workspace).includes('passwordHash'), false);
});

test('通知已读只影响当前账号，跨会话同步并在服务重启后持久保存，退出后停止授权', async t => {
  const { call, login, sync, restart } = await httpFixture(t, true);
  const buyer = await login('buyer', 'demo_user');
  await login('service', 'demo_service');
  await login('serviceSecondSession', 'demo_service');
  await login('otherService', 'service', '123456');
  assert.equal((await call('anonymous', '/sync?since=0')).status, 401);
  assert.equal((await call('anonymous', '/notifications')).status, 401);
  const created = await call('buyer', '/orders', purchase(buyer));
  assert.equal(created.status, 201);
  const feed = (await call('service', '/notifications')).body;
  const notice = orderNotice(feed, created.body.id);
  assert.ok(notice);
  assert.equal(notice.readAt, null);
  const otherBefore = (await call('otherService', '/notifications')).body;
  const foreign = orderNotice(otherBefore, created.body.id);
  assert.ok(foreign);
  assert.notEqual(foreign.id, notice.id);
  const rejected = await call('buyer', '/notifications/read', { ids: [notice.id] });
  assert.equal(rejected.status, 403);
  assert.equal(orderNotice((await call('service', '/notifications')).body, created.body.id).readAt, null);
  const before = await sync('service');
  const marked = await call('service', '/notifications/read', { ids: [notice.id] });
  assert.equal(marked.status, 200, JSON.stringify(marked.body));
  assert.ok(orderNotice(marked.body, created.body.id).readAt);
  assert.equal(marked.body.unreadCount, feed.unreadCount - 1);
  const secondSession = await sync('serviceSecondSession', before.revision);
  assert.equal(secondSession.changed, true);
  assert.equal(orderNotice(secondSession.notifications, created.body.id).readAt, orderNotice(marked.body, created.body.id).readAt);
  assert.equal(orderNotice((await call('otherService', '/notifications')).body, created.body.id).readAt, null);
  const repeated = await call('service', '/notifications/read', { ids: [notice.id] });
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.unreadCount, marked.body.unreadCount);
  const savedReadAt = orderNotice(marked.body, created.body.id).readAt;

  await restart();
  const persisted = await sync('service');
  assert.equal(orderNotice(persisted.notifications, created.body.id).readAt, savedReadAt);
  assert.ok(persisted.workspace.orders.some(item => item.id === created.body.id));
  assert.equal(orderNotice((await call('otherService', '/notifications')).body, created.body.id).readAt, null);
  assert.equal((await call('service', '/logout', {})).status, 200);
  for (const path of ['/sync?since=0&context=personal', '/notifications']) assert.equal((await call('service', path)).status, 401);
  assert.equal((await call('service', '/notifications/read', { ids: [notice.id] })).status, 401);
  assert.equal((await call('serviceSecondSession', '/notifications')).status, 200);
});

test('会话消息和财务处理同步给对应人员，内部备注不进入个人工作区', t => {
  const { store, user } = fixture(t);
  const customer = user('demo-user'), service = user('demo-service');
  const chat = store.conversationCreate(customer, { context: 'personal', escortName: '俱乐部客服', message: '想确认服务安排' });
  const staff = store.sync(service, 0, 'management');
  assert.ok(staff.notifications.items.some(item => item.kind === 'conversation' && item.entityId === chat.id));
  store.conversationAction(service, chat.id, { note: '内部备注：仅客服可见' });
  store.conversationMessage(service, chat.id, { message: '已经收到你的需求' });
  const personal = store.sync(customer, staff.revision, 'personal');
  const conversation = personal.workspace.conversations.find(item => item.id === chat.id);
  assert.equal(conversation.messages.at(-1).text, '已经收到你的需求');
  assert.equal(conversation.notes, undefined);
  assert.equal(JSON.stringify(personal).includes('内部备注：仅客服可见'), false);
  assert.ok(personal.notifications.items.some(item => item.kind === 'conversation' && item.entityId === chat.id && item.mode === 'personal'));
  assert.equal(store.sync(user('user-demo'), 0, 'personal').notifications.items.some(item => item.entityId === chat.id), false);

  const escort = user('escort'), finance = user('demo-finance');
  const before = store.sync(finance, 0, 'management');
  const withdrawal = store.withdrawal(escort, { amount: '10' });
  const requested = store.sync(finance, before.revision, 'management');
  assert.equal(requested.workspace.withdrawals.find(item => item.id === withdrawal.id).status, '待审核');
  assert.ok(requested.notifications.items.some(item => item.kind === 'withdrawal' && item.entityId === withdrawal.id));
  store.reviewWithdrawal(finance, withdrawal.id, { action: 'reject', reason: '请补充收款资料后重新提交' });
  const reviewed = store.sync(escort, requested.revision, 'management');
  assert.equal(reviewed.workspace.withdrawals.find(item => item.id === withdrawal.id).status, '已驳回');
  assert.ok(reviewed.notifications.items.some(item => item.kind === 'withdrawal' && item.entityId === withdrawal.id && item.page === 'myEarnings'));
  assert.equal(store.sync(service, 0, 'management').notifications.items.some(item => item.entityId === withdrawal.id), false);
});
