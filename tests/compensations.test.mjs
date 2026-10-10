import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClubStore } from '../server/club.mjs';
import { createClubServer } from '../server.mjs';
import { addFixtureGames } from './catalog-fixture.mjs';
import { verifyFixtureUsers } from './real-name-fixture.mjs';
import { refundTotals } from '../server/analytics.mjs';
import { compensationPanel } from '../src/compensations.js';

function fixture(t, database = ':memory:') {
  const store = new ClubStore(database, { edition: 'A' });
  t.after(() => store.close());
  addFixtureGames(store, ['王者荣耀']); verifyFixtureUsers(store, ['demo-user', 'demo-escort']);
  const user = id => store.read().users.find(user => user.id === id);
  const buyer = user('demo-user'), admin = user('admin'), finance = user('finance'), service = user('demo-service');
  const order = store.createOrder(buyer, { context: 'personal', boss: buyer.name, productId: 'product-1', hours: 1, pay: '在线支付', requirement: '测试赔偿链路', levelId: 'gold' });
  const input = (overrides = {}) => ({ orderId: order.id, requestId: randomUUID(), amountCents: 1200, reason: '<服务迟到>协商补偿', ...overrides });
  return { store, user, buyer, admin, finance, service, order, input };
}

test('赔偿申请通知、财务审核、余额到账和流水持久化，独立于退款与服务状态', t => {
  const directory = mkdtempSync(join(tmpdir(), 'club-compensation-'));
  const database = join(directory, 'club.sqlite');
  const { store, buyer, finance, order, input } = fixture(t, database);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const before = store.personal(buyer).wallet.balanceCents;
  const request = input({ amountCents: order.amountCents + 100 });
  const item = store.createCompensation(buyer, request);
  assert.equal(store.createCompensation(buyer, request).id, item.id);
  assert.equal(store.read().compensations.length, 1);
  assert.ok(store.notifications(finance).items.some(notice => notice.kind === 'compensation' && notice.entityId === item.id));
  const totals = refundTotals(store.read(), new Date().toISOString().slice(0, 10));
  store.resolveCompensation(finance, item.id, { action: 'approve', version: item.version, reason: '俱乐部承担，核准补偿' });
  assert.ok(store.notifications(buyer).items.some(notice => notice.kind === 'compensation' && notice.entityId === item.id));
  assert.equal(store.personal(buyer).wallet.balanceCents, before + request.amountCents);
  assert.deepEqual(store.read().orders.find(item => item.id === order.id), order);
  assert.deepEqual(refundTotals(store.read(), new Date().toISOString().slice(0, 10)), totals);
  assert.equal(store.read().ledger.filter(entry => entry.source === item.id).length, 1);
  const snapshot = store.read();
  assert.throws(() => store.resolveCompensation(finance, item.id, { action: 'approve', version: item.version, reason: '重复入账' }), { status: 409 });
  assert.deepEqual(store.read(), snapshot);
  const reopened = new ClubStore(database, { edition: 'A' });
  try { assert.equal(reopened.personal(buyer).compensations[0].status, '已到账'); assert.equal(reopened.personal(buyer).wallet.balanceCents, before + request.amountCents); }
  finally { reopened.close(); }
});

test('赔偿阻止越权、重复待审、请求参数变化和无效金额，不产生额外资金变动', t => {
  const { store, buyer, finance, service, user, input } = fixture(t);
  const stranger = user('user-demo'), worker = user('demo-escort');
  const initial = store.read();
  for (const amountCents of [0, -100, 1.2, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => store.createCompensation(buyer, input({ amountCents })));
  assert.throws(() => store.createCompensation(stranger, input()), { status: 403 });
  assert.throws(() => store.createCompensation(worker, input()), { status: 403 });
  assert.deepEqual(store.read(), initial);
  const request = input(); const item = store.createCompensation(service, request);
  const snapshot = store.read();
  assert.throws(() => store.createCompensation(service, { ...request, amountCents: 500 }), { status: 409 });
  assert.throws(() => store.createCompensation(buyer, input()), { status: 409 });
  for (const actor of [buyer, service, user('afterSales'), worker]) assert.throws(() => store.resolveCompensation(actor, item.id, { action: 'approve', version: item.version, reason: '越权' }), { status: 403 });
  assert.throws(() => store.resolveCompensation(finance, item.id, { context: 'personal', action: 'approve', version: item.version, reason: '个人模式越权' }), { status: 403 });
  assert.throws(() => store.resolveCompensation(finance, item.id, { action: 'approve', version: item.version + 1, reason: '过期操作' }), { status: 409 });
  assert.throws(() => store.resolveCompensation(buyer, item.id, { action: 'retract', version: item.version }), { status: 403 });
  assert.deepEqual(store.read(), snapshot);
  assert.equal(store.personal(stranger).compensations.length, 0);
  assert.equal(store.workspace(worker).compensations, undefined);
  assert.equal(store.notifications(stranger).items.some(notice => notice.entityId === item.id), false);
});

test('赔偿撤回与驳回保留记录且不入账，余额溢出时审核原子回滚', t => {
  const { store, buyer, admin, finance, input } = fixture(t);
  const balance = store.personal(buyer).wallet.balanceCents;
  const first = store.createCompensation(buyer, input());
  store.resolveCompensation(buyer, first.id, { action: 'retract', version: first.version });
  const second = store.createCompensation(buyer, input());
  store.resolveCompensation(finance, second.id, { action: 'reject', version: second.version, reason: '协商未达成' });
  assert.equal(store.personal(buyer).wallet.balanceCents, balance);
  assert.equal(store.personal(buyer).compensations.find(item => item.id === first.id).status, '已撤回');
  const third = store.createCompensation(buyer, input());
  store.transaction(admin, 'finance:manage', '准备溢出边界', data => { data.customers.find(item => item.id === buyer.customerId).balanceCents = Number.MAX_SAFE_INTEGER; });
  const before = store.read();
  assert.throws(() => store.resolveCompensation(finance, third.id, { action: 'approve', version: third.version, reason: '溢出测试' }), { status: 409 });
  assert.deepEqual(store.read(), before);
  const html = compensationPanel(store.personal(buyer), { personal: true });
  assert.ok(html.includes('&lt;服务迟到&gt;')); assert.ok(!html.includes('<服务迟到>'));
  assert.ok(!html.includes('data-action="compensationReview"'));
});

test('HTTP 赔偿接口及个人同步仅返回本人脱敏记录，客服不可审核', async t => {
  const app = createClubServer({ database: ':memory:', production: false, publicOrigin: null });
  t.after(() => app.close());
  addFixtureGames(app.store, ['王者荣耀']); verifyFixtureUsers(app.store, ['demo-user']);
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  async function login(username) {
    const response = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ username, password: 'Test1234!' }) });
    assert.equal(response.status, 200); return response.headers.get('set-cookie').split(';')[0];
  }
  const buyerCookie = await login('demo_user'), serviceCookie = await login('demo_service');
  const call = (path, cookie, body) => fetch(base + path, { method: body ? 'POST' : 'GET', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const buyer = app.store.read().users.find(item => item.id === 'demo-user');
  const order = app.store.createOrder(buyer, { boss: buyer.name, productId: 'product-1', hours: 1, pay: '在线支付', requirement: 'HTTP 测试', levelId: 'gold' });
  const response = await call('/api/compensations', buyerCookie, { context: 'personal', orderId: order.id, requestId: randomUUID(), amountCents: 500, reason: '服务补偿' });
  assert.equal(response.status, 201); const item = await response.json();
  assert.equal(item.requestedById, undefined); assert.equal(item.requestId, undefined);
  assert.equal((await call('/api/compensations/' + item.id, serviceCookie, { action: 'approve', version: item.version, reason: '客服越权' })).status, 403);
  const sync = await (await call('/api/sync?since=0&context=personal', buyerCookie)).json();
  assert.equal(sync.workspace.compensations[0].id, item.id);
  assert.equal((await call('/api/compensations/' + item.id, buyerCookie, { action: 'retract', version: item.version })).status, 200);
});
