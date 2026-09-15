import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClubServer } from '../server.mjs';
import { addFixtureGames } from './catalog-fixture.mjs';
import { verifyFixtureUsers, userById } from './real-name-fixture.mjs';

const GAME = '\u738b\u8005\u8363\u8000';
const FEE = 2000;
const BUYER = 'demo-user';
const EXAMINER = 'demo-examiner';

async function fixture(t, { persistent = false } = {}) {
  const directory = persistent ? await mkdtemp(join(tmpdir(), 'club-admissions-http-')) : null;
  const database = directory ? join(directory, 'club.sqlite') : ':memory:';
  let instance = createClubServer({ database, production: false, publicOrigin: null });
  let base;
  const cookies = new Map();
  const credentials = new Map();
  t.after(async () => {
    await instance.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  const start = async () => {
    instance.server.listen(0, '127.0.0.1');
    await once(instance.server, 'listening');
    base = `http://127.0.0.1:${instance.server.address().port}`;
  };
  await start();
  addFixtureGames(instance.store, [GAME]);
  verifyFixtureUsers(instance.store, [BUYER]);
  const stranger = instance.store.accountAction(userById(instance.store, 'admin'), null, {
    username: 'admissions_stranger', password: 'testing123', name: 'Admission stranger', role: 'member', active: true, games: [],
  });
  credentials.set(stranger.id, { username: stranger.username, password: 'testing123' });
  instance.store.transaction({ id: 'admin' }, 'profile:update', 'Prepare assessment wallet', data => {
    const buyer = data.users.find(user => user.id === BUYER);
    data.customers.find(customer => customer.id === buyer.customerId).balanceCents = 10000;
  });
  const request = async (actor, path, body, expected = 200) => {
    if (actor && !cookies.has(actor)) {
      const user = userById(instance.store, actor);
      const login = await fetch(`${base}/api/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials.get(actor) || { username: user.username, password: actor.startsWith('demo-') ? 'Test1234!' : '123456' }),
      });
      assert.equal(login.status, 200, `Login ${actor}`);
      await login.json();
      cookies.set(actor, login.headers.get('set-cookie').split(';')[0]);
    }
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(actor ? { Cookie: cookies.get(actor) } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    assert.equal(response.status, expected, `${actor || 'anonymous'} ${path}: ${JSON.stringify(result)}`);
    return result;
  };
  const config = (overrides = {}) => ({ game: GAME, enabled: true, feeCents: FEE, description: 'Paid skill assessment; failing does not automatically refund.', levelId: 'gold', examinerIds: [EXAMINER, 'examiner'], version: 0, ...overrides });
  const apply = (actor = BUYER, examinerId = EXAMINER) => request(actor, '/api/admissions/applications', { game: GAME, examinerId }, 201);
  const createOrder = application => request(BUYER, `/api/admissions/applications/${application.id}/orders`, {
    version: application.version, configVersion: 1, appointmentAt: new Date(Date.now() + 86400000).toISOString(),
  }, 201);
  const action = (actor, order, name, input = {}, expected = 200) => request(actor, `/api/admissions/orders/${order.id}/actions`, { action: name, version: order.version, ...input }, expected);
  const ordered = async () => {
    await request('admin', '/api/admissions/config', config());
    const application = await apply();
    return { application, order: await createOrder(application) };
  };
  return {
    get store() { return instance.store; }, stranger, request, config, apply, createOrder, action, ordered,
    async restart() {
      assert.ok(persistent);
      await instance.close();
      instance = createClubServer({ database, production: false, publicOrigin: null });
      await start();
    },
  };
}

test('admission HTTP endpoints require authentication and ignore forged roles and personal context', async t => {
  const f = await fixture(t);
  for (const [path, body] of [
    ['/api/admissions', undefined],
    ['/api/admissions/config', f.config()],
    ['/api/admissions/applications', { game: GAME, examinerId: EXAMINER }],
    ['/api/admissions/orders', { game: GAME, configVersion: 1, acceptStandards: true, requestId: 'http-create-request-1' }],
    ['/api/admissions/applications/unknown/orders', {}],
    ['/api/admissions/conversations/unknown/messages', { text: 'private' }],
    ['/api/admissions/orders/unknown/actions', { action: 'pay' }],
    ['/api/admissions/applications/unknown/actions', { action: 'cancel' }],
  ]) await f.request(null, path, body, 401);

  for (const actor of [BUYER, f.stranger.id, EXAMINER, 'demo-service', 'demo-finance', 'demo-escort']) {
    await f.request(actor, '/api/admissions/config?context=personal', {
      ...f.config(), context: 'personal', role: 'admin', userId: 'admin', actor: { id: 'admin', role: 'admin' },
    }, 403);
  }
  for (const actor of ['admin', EXAMINER, 'demo-service', 'demo-finance', 'demo-escort']) {
    await f.request(actor, '/api/admissions/applications?context=personal', {
      game: GAME, examinerId: EXAMINER, context: 'personal', role: 'user', userId: BUYER,
    }, 403);
  }
  assert.deepEqual(f.store.read().admissionApplications, []);
  assert.deepEqual(f.store.read().admissionSettings, []);
  const { order } = await f.ordered();
  await f.action(EXAMINER, order, 'pay', { context: 'personal', userId: BUYER, acceptTerms: true, configVersion: 1 }, 403);
  await f.action(BUYER, order, 'start', { role: 'examiner', examinerId: EXAMINER }, 403);
  await f.action('demo-service', order, 'refund', { context: 'personal', role: 'admin', reason: 'forged admin' }, 404);
  assert.equal((await f.request(BUYER, '/api/admissions')).balanceCents, 10000);
});

test('order-first HTTP creation is atomic, idempotent, scoped and immediately notifies the assigned examiner', async t => {
  const f = await fixture(t, { persistent: true });
  await f.request('admin', '/api/admissions/config', f.config());
  const input = { game: GAME, configVersion: 1, acceptStandards: true, requestId: 'http-create-request-1', examinerId: 'demo-escort', feeCents: 1 };
  await f.request(EXAMINER, '/api/admissions/orders', input, 403);
  await f.request(BUYER, '/api/admissions');
  const before = f.store.read();
  await f.request(BUYER, '/api/admissions/orders', { ...input, configVersion: 0 }, 409);
  assert.deepEqual(f.store.read(), before);
  const results = await Promise.all(Array.from({ length: 3 }, () => f.request(BUYER, '/api/admissions/orders', input, 201)));
  const order = results[0];
  assert.ok(results.every(result => result.id === order.id));
  assert.equal(f.store.read().admissionOrders.length, 1);
  assert.equal(order.examinerId, EXAMINER);
  assert.equal(order.feeCents, FEE);
  assert.equal(order.appointmentAt, null);
  const feed = await f.request(EXAMINER, '/api/notifications');
  assert.ok(feed.items.some(item => item.entityId === order.applicationId && item.title === '收到考核派单，请联系申请人'));
  const workspace = await f.request(EXAMINER, '/api/workspace');
  assert.equal(workspace.admissionOrders[0].id, order.id);
  assert.equal((await f.request('examiner', '/api/workspace')).admissionOrders.length, 0);
  const application = (await f.request(BUYER, '/api/admissions')).applications[0];
  await f.request(EXAMINER, `/api/admissions/conversations/${application.conversationId}/messages`, { text: '请确认考核时间' });
  let current = (await f.request(BUYER, '/api/admissions')).orders[0];
  assert.ok(current.contactedAt);
  current = await f.action(EXAMINER, current, 'schedule', { confirmed: true, appointmentAt: new Date(Date.now() + 86400000).toISOString() });
  await f.action(EXAMINER, current, 'start', {}, 409);
  const paid = await f.action(BUYER, current, 'pay', { acceptTerms: true, configVersion: 1 });
  assert.equal((await f.action(EXAMINER, paid, 'start')).status, 'inProgress');
  await f.restart();
  assert.equal((await f.request(BUYER, '/api/admissions/orders', input, 201)).id, order.id);
  assert.equal(f.store.read().admissionOrders.length, 1);
});

test('waiting dispatch notifies admins and manual assignment makes the order visible only to its examiner', async t => {
  const f = await fixture(t);
  await f.request('admin', '/api/admissions/config', f.config());
  f.store.transaction({ id: 'admin' }, 'profile:update', '考官暂不可接待', data => {
    for (const id of [EXAMINER, 'examiner']) data.users.find(user => user.id === id).active = false;
  });
  const order = await f.request(BUYER, '/api/admissions/orders', { game: GAME, configVersion: 1, acceptStandards: true, requestId: 'waiting-order-request' }, 201);
  assert.equal(order.examinerId, null);
  assert.ok((await f.request('admin', '/api/notifications')).items.some(item => item.entityId === order.applicationId && item.title === '考核订单待分配考官'));
  f.store.transaction({ id: 'admin' }, 'profile:update', '考官恢复接待', data => { data.users.find(user => user.id === EXAMINER).active = true; });
  const application = (await f.request('admin', '/api/admissions')).applications[0];
  await f.request('admin', `/api/admissions/applications/${application.id}/actions`, { action: 'reassign', version: application.version, examinerId: EXAMINER, reason: '安排接待' });
  assert.equal((await f.request(EXAMINER, '/api/admissions')).orders[0].id, order.id);
  assert.equal((await f.request(BUYER, '/api/admissions')).orders[0].examinerId, EXAMINER);
  assert.equal((await f.request(f.stranger.id, '/api/admissions')).orders.length, 0);
});

test('private admission messages and notifications are scoped and reassignment revokes former examiner access', async t => {
  const f = await fixture(t);
  await f.request('admin', '/api/admissions/config', f.config());
  const application = await f.apply();
  const other = await f.apply(f.stranger.id, 'examiner');
  const privateText = 'Private applicant details only for the assigned examiner.';
  await f.request(BUYER, `/api/admissions/conversations/${application.conversationId}/messages`, { text: privateText });
  for (const actor of [BUYER, EXAMINER, 'admin']) {
    const snapshot = await f.request(actor, '/api/admissions');
    assert.equal(snapshot.conversations.find(chat => chat.id === application.conversationId).messages[0].text, privateText);
  }
  for (const actor of [f.stranger.id, 'examiner', 'demo-service', 'demo-finance', 'demo-aftersales']) {
    const snapshot = await f.request(actor, '/api/admissions?context=personal');
    assert.ok(!snapshot.applications.some(item => item.id === application.id));
    assert.ok(!snapshot.conversations.some(item => item.id === application.conversationId));
    assert.ok(!JSON.stringify(snapshot).includes(privateText));
    await f.request(actor, `/api/admissions/conversations/${application.conversationId}/messages`, { text: 'unauthorized' }, 404);
    const sync = await f.request(actor, '/api/sync?since=0&context=personal');
    assert.ok(!JSON.stringify(sync).includes(privateText));
    assert.ok(!sync.notifications.items.some(item => item.kind === 'admission' && item.entityId === application.id));
  }
  const feed = await f.request(EXAMINER, '/api/notifications');
  const notification = feed.items.find(item => item.kind === 'admission' && item.entityId === application.id);
  assert.ok(notification);
  assert.ok(!JSON.stringify(feed).includes(privateText));
  assert.ok(!feed.items.some(item => item.entityId === other.id));
  await f.request('demo-service', '/api/notifications/read', { ids: [notification.id] }, 403);
  assert.equal((await f.request(EXAMINER, '/api/notifications')).items.find(item => item.id === notification.id).readAt, null);

  await f.request('admin', `/api/admissions/applications/${application.id}/actions`, {
    action: 'reassign', version: application.version, examinerId: 'examiner', reason: 'Examiner scheduling change',
  });
  assert.ok(!(await f.request(EXAMINER, '/api/admissions')).applications.some(item => item.id === application.id));
  assert.ok(!(await f.request(EXAMINER, '/api/notifications')).items.some(item => item.entityId === application.id));
  await f.request(EXAMINER, `/api/admissions/conversations/${application.conversationId}/messages`, { text: 'former examiner' }, 404);
  const reassigned = await f.request('examiner', '/api/admissions');
  assert.equal(reassigned.conversations.find(chat => chat.id === application.conversationId).messages[0].text, privateText);
  assert.ok((await f.request('examiner', '/api/notifications')).items.some(item => item.entityId === application.id));
});

test('HTTP payment and refund retries change the wallet once and survive database reload', async t => {
  const f = await fixture(t, { persistent: true });
  const { application, order } = await f.ordered();
  const initial = f.store.read();
  const customerId = userById(f.store, BUYER).customerId;
  const payment = { acceptTerms: true, configVersion: order.configVersion };
  await f.action(BUYER, order, 'pay', { ...payment, acceptTerms: false }, 400);
  assert.deepEqual(f.store.read(), initial);
  const responses = await Promise.all(Array.from({ length: 3 }, () => f.action(BUYER, order, 'pay', payment)));
  assert.ok(responses.every(result => result.id === order.id && result.status === 'pending'));
  const paid = responses[0];
  let data = f.store.read();
  const payments = data.ledger.filter(entry => entry.admissionOrderId === order.id);
  assert.equal(data.customers.find(customer => customer.id === customerId).balanceCents, 10000 - FEE);
  assert.equal(payments.length, 1);
  assert.equal(payments[0].deltaCents, -FEE);
  assert.equal(payments[0].customerId, customerId);
  assert.equal(payments[0].userId, null);
  assert.equal(data.orders.length, initial.orders.length);
  assert.equal(data.admissionApplications.find(item => item.id === application.id).status, 'pending');

  await f.restart();
  const restored = await f.request(BUYER, '/api/admissions');
  assert.equal(restored.balanceCents, 10000 - FEE);
  assert.deepEqual(restored.orders.find(item => item.id === order.id), paid);
  await f.action(BUYER, order, 'pay', payment);
  const refunds = await Promise.all(Array.from({ length: 3 }, () => f.action(BUYER, paid, 'cancel', { reason: 'Schedule conflict' })));
  assert.ok(refunds.every(result => result.status === 'refunded' && result.refundedCents === FEE));
  await f.action('admin', paid, 'refund', { reason: 'Duplicate refund request' });
  await f.restart();
  data = f.store.read();
  const entries = data.ledger.filter(entry => entry.admissionOrderId === order.id);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map(entry => entry.deltaCents).sort((a, b) => a - b), [-FEE, FEE]);
  assert.equal(entries.reduce((sum, entry) => sum + entry.deltaCents, 0), 0);
  assert.ok(entries.every(entry => entry.customerId === customerId));
  assert.equal((await f.request(BUYER, '/api/admissions')).balanceCents, 10000);
  assert.equal(data.admissionOrders.find(item => item.id === order.id).status, 'refunded');
  assert.equal(userById(f.store, BUYER).role, 'user');
});

test('failed HTTP mutations roll back application changes, audit and notifications, including after reload', async t => {
  const f = await fixture(t, { persistent: true });
  const application = await f.apply();
  const before = f.store.read();
  // Cancellation assigns status before validating its reason in the domain.
  await f.request(BUYER, `/api/admissions/applications/${application.id}/actions`, {
    action: 'cancel', version: application.version, reason: '',
  }, 400);
  assert.deepEqual(f.store.read(), before);
  await f.restart();
  assert.deepEqual(f.store.read().admissionApplications, before.admissionApplications);
  assert.deepEqual(f.store.read().notifications, before.notifications);
  assert.deepEqual(f.store.read().audit, before.audit);
  assert.equal(f.store.read().revision, before.revision);
  assert.equal((await f.request(BUYER, '/api/admissions')).applications[0].status, 'consulting');
});

test('passing an HTTP assessment grants only the configured escort qualification and enables ordinary order acceptance', async t => {
  const f = await fixture(t);
  const { order } = await f.ordered();
  verifyFixtureUsers(f.store, [f.stranger.id]);
  const ordinary = await f.request('admin', '/api/orders', {
    boss: f.stranger.name, customerId: userById(f.store, f.stranger.id).customerId,
    productId: 'product-1', hours: 2, requirement: 'Ordinary service order', pay: '\u7ebf\u4e0b\u5df2\u6536\u6b3e', levelId: 'gold',
  }, 201);
  await f.request(BUYER, `/api/orders/${ordinary.id}/apply`, { version: ordinary.version }, 403);
  const paid = await f.action(BUYER, order, 'pay', { acceptTerms: true, configVersion: 1 });
  await f.action(EXAMINER, paid, 'review', { result: 'pass', score: 88, notes: 'Ready', evidence: 'Recording A1' }, 409);
  const started = await f.action(EXAMINER, paid, 'start');
  const beforeReview = f.store.read();
  await f.action(EXAMINER, started, 'review', { result: 'pass', score: 88, notes: 'Ready', evidence: '' }, 400);
  assert.deepEqual(f.store.read(), beforeReview);
  const memberVersion = userById(f.store, BUYER).memberVersion;
  const passed = await f.action(EXAMINER, started, 'review', {
    result: 'pass', score: 88, notes: 'Skills and communication meet the configured standard.', evidence: 'Recording A1',
    role: 'admin', games: ['invented'], levelId: 'star', shareBps: 10000,
  });
  assert.equal(passed.status, 'passed');
  const user = userById(f.store, BUYER);
  assert.equal(user.role, 'escort');
  assert.deepEqual(user.games, [GAME]);
  assert.equal(user.levelId, 'gold');
  assert.equal(user.shareBps, order.shareBps);
  assert.equal(user.online, false);
  assert.equal(user.memberVersion, memberVersion + 1);
  assert.equal((await f.request(BUYER, '/api/admissions')).canApply, false);
  await f.action(EXAMINER, started, 'review', { result: 'pass', score: 88, notes: 'Replay', evidence: 'Recording A1' }, 409);
  assert.equal(userById(f.store, BUYER).memberVersion, memberVersion + 1);
  await f.action('admin', passed, 'refund', { reason: 'Cannot refund granted qualification' }, 409);

  await f.request(BUYER, '/api/online', { online: true });
  const workspace = await f.request(BUYER, '/api/workspace');
  assert.equal(workspace.user.role, 'escort');
  assert.ok(workspace.availableOrders.some(item => item.id === ordinary.id));
  const applied = await f.request(BUYER, `/api/orders/${ordinary.id}/apply`, { version: ordinary.version });
  const selected = await f.request(f.stranger.id, `/api/orders/${ordinary.id}/selectApplicant`, {
    version: applied.version, memberIds: [BUYER], context: 'personal',
  });
  const accepted = await f.request(BUYER, `/api/orders/${ordinary.id}/accept`, { version: selected.version });
  assert.equal(accepted.participants.find(participant => participant.userId === BUYER).accepted, true);
  const premium = await f.request('admin', '/api/orders', {
    boss: f.stranger.name, customerId: userById(f.store, f.stranger.id).customerId,
    productId: 'product-1', hours: 1, requirement: 'Higher level service', pay: '\u7ebf\u4e0b\u5df2\u6536\u6b3e', levelId: 'star',
  }, 201);
  assert.ok(!(await f.request(BUYER, '/api/workspace')).availableOrders.some(item => item.id === premium.id));
  await f.request(BUYER, `/api/orders/${premium.id}/apply`, { version: premium.version }, 400);
});
