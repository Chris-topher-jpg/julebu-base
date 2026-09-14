import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { ClubStore } from '../server/club.mjs';
import { createClubServer } from '../server.mjs';
import { addFixtureGames } from './catalog-fixture.mjs';
import { verifyFixtureUser, userById } from './real-name-fixture.mjs';

const identity = (realName = '测试用户', idNumber = '11010519491231002X') => ({ consent: true, realName, idNumber });

test('all seeded and newly registered users start unverified; submission is versioned and validated', t => {
  const store = new ClubStore(':memory:');
  t.after(() => store.close());
  for (const user of store.read().users.filter(item => item.active)) assert.equal(store.realNameStatus(user).status, 'unverified');
  const created = store.register({ username: 'rn_new_user', password: 'testing123', name: '新实名用户' });
  const user = userById(store, created.user.id);
  assert.equal(store.realNameStatus(user).status, 'unverified');
  for (const input of [{ ...identity(), consent: false }, { ...identity(), realName: '' }, { ...identity(), idNumber: '11010519491231002A' }, { ...identity(), idNumber: '11010519491231001X' }]) {
    assert.throws(() => store.submitRealName(user, input), { status: 400 });
    assert.equal(store.realNameStatus(user).status, 'unverified');
  }
  const pending = store.submitRealName(user, identity('张三'));
  assert.equal(pending.status, 'pending');
  assert.equal(pending.version, 1);
  assert.match(pending.maskedIdNumber, /^110\*+002X$/);
  assert.throws(() => store.submitRealName(user, identity('重复提交')), { status: 409 });
  assert.throws(() => store.reviewRealName({ id: 'admin' }, pending.requestId, { action: 'approve', version: 0, documentsChecked: true, reviewNote: '错误版本' }), { status: 409 });
});

test('pending and rejected identities gate personal actions without mutations; rejection permits resubmission', t => {
  const store = new ClubStore(':memory:');
  t.after(() => store.close());
  const buyer = userById(store, 'demo-user');
  const escort = userById(store, 'demo-escort');
  const registered = store.register({ username: 'rn_member', password: 'testing123', name: '待实名成员' });
  const member = userById(store, registered.user.id);
  const before = store.read();
  const pending = store.submitRealName(buyer, identity('待审用户'));
  store.submitRealName(escort, identity('待审打手'));
  assert.throws(() => store.createOrder(buyer, { context: 'personal', boss: buyer.name, productId: 'product-1', hours: 1, pay: '在线支付', requirement: '实名门禁测试' }), { status: 403 });
  assert.throws(() => store.createTopup(buyer, { amountCents: 1000, requestId: 'rn-pending-topup' }), { status: 403 });
  assert.throws(() => store.withdrawal(escort, { amount: '1' }), { status: 403 });
  const memberVersion = member.memberVersion;
  assert.throws(() => store.membershipAction({ id: 'admin' }, member.id, 'escort', { memberVersion, games: ['王者荣耀'], levelId: 'gold' }), { status: 403 });
  assert.equal(store.read().users.find(item => item.id === member.id).role, 'user');
  assert.equal(store.read().orders.length, before.orders.length);
  assert.equal(store.read().topups.length, before.topups.length);
  store.reviewRealName({ id: 'admin' }, pending.requestId, { action: 'reject', version: pending.version, reviewNote: '证件信息不清晰' });
  assert.equal(store.realNameStatus(buyer).status, 'rejected');
  assert.throws(() => store.createOrder(buyer, { context: 'personal', boss: buyer.name, productId: 'product-1', hours: 1, pay: '在线支付', requirement: '实名门禁测试' }), { status: 403 });
  const resubmitted = store.submitRealName(buyer, identity('重新提交用户'));
  assert.equal(resubmitted.status, 'pending');
  assert.equal(resubmitted.version, 3);
});

test('review permissions, forged requests, self-review, and stale versions are rejected', t => {
  const store = new ClubStore(':memory:');
  t.after(() => store.close());
  const buyer = userById(store, 'demo-user');
  const escort = userById(store, 'demo-escort');
  const pending = store.submitRealName(buyer, identity('买家'));
  assert.throws(() => store.reviewRealName(escort, pending.requestId, { action: 'approve', version: 1, documentsChecked: true, reviewNote: '越权' }), { status: 403 });
  assert.throws(() => store.reviewRealName({ id: 'admin' }, 'RN-forged-request', { action: 'approve', version: 1, documentsChecked: true, reviewNote: '伪造' }), { status: 404 });
  const own = store.submitRealName({ id: 'admin' }, identity('管理员'));
  assert.throws(() => store.reviewRealName({ id: 'admin' }, own.requestId, { action: 'approve', version: own.version, documentsChecked: true, reviewNote: '管理员不可自审' }), { status: 403 });
  assert.throws(() => store.reviewRealName({ id: 'admin' }, pending.requestId, { action: 'approve', version: pending.version, documentsChecked: false, reviewNote: '未核验' }), { status: 400 });
  const approved = store.reviewRealName({ id: 'admin' }, pending.requestId, { action: 'approve', version: pending.version, documentsChecked: true, reviewNote: '已人工核验' });
  assert.equal(approved.status, 'verified');
  assert.throws(() => store.reviewRealName({ id: 'admin' }, pending.requestId, { action: 'reject', version: pending.version, reviewNote: '重复审核' }), { status: 409 });
});

test('real-name state persists and public projections do not expose raw identity documents', t => {
  const folder = mkdtempSync(join(tmpdir(), 'club-real-name-'));
  const path = join(folder, 'club.sqlite');
  let store = new ClubStore(path);
  t.after(() => { store?.close(); rmSync(folder, { recursive: true, force: true }); });
  const buyer = userById(store, 'demo-user');
  const pending = store.submitRealName(buyer, identity('持久用户'));
  const listed = store.realNameRequests({ id: 'admin' });
  assert.equal(listed.requests[0].requestId, pending.requestId);
  assert.equal('realName' in listed.requests[0], false);
  assert.equal('idNumber' in listed.requests[0], false);
  assert.match(listed.requests[0].maskedIdNumber, /^110\*+002X$/);
  const personal = store.personal(buyer);
  assert.equal(personal.user.realNameVerification.status, 'pending');
  assert.equal('idNumber' in personal.user.realNameVerification, false);
  store.close(); store = new ClubStore(path);
  assert.equal(store.realNameStatus(buyer).status, 'pending');
  assert.equal(store.realNameRequests({ id: 'admin' }).requests[0].requestId, pending.requestId);
});

test('HTTP real-name endpoints enforce authentication and admin review, then allow verified order flow', async t => {
  const instance = createClubServer({ database: ':memory:' });
  instance.server.listen(0, '127.0.0.1'); await once(instance.server, 'listening');
  t.after(() => new Promise(resolve => instance.server.close(resolve)));
  const base = `http://127.0.0.1:${instance.server.address().port}`;
  const cookies = {};
  const call = async (who, path, body) => {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(cookies[who] ? { Cookie: cookies[who] } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: base }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
  };
  const login = async (who, username, password) => { const result = await call(who, '/api/login', { username, password }); assert.equal(result.status, 200); cookies[who] = result.headers.get('set-cookie').split(';')[0]; };
  assert.equal((await call('anon', '/api/real-name')).status, 401);
  await login('buyer', 'demo_user', 'Test1234!');
  await login('escort', 'demo_escort', 'Test1234!');
  await login('admin', 'admin', '123456');
  assert.equal((await call('buyer', '/api/real-name/requests')).status, 403);
  const submitted = await call('buyer', '/api/real-name', identity('HTTP买家'));
  assert.equal(submitted.status, 202); assert.equal(submitted.body.status, 'pending');
  const requests = await call('admin', '/api/real-name/requests');
  const request = requests.body.requests.find(item => item.userId === submitted.body.userId) || requests.body.requests[0];
  const reviewed = await call('admin', `/api/real-name/requests/${encodeURIComponent(request.requestId)}`, { action: 'approve', version: request.version, documentsChecked: true, reviewNote: 'HTTP人工核验' });
  assert.equal(reviewed.status, 200); assert.equal(reviewed.body.status, 'verified');
  assert.equal((await call('escort', `/api/real-name/requests/${request.requestId}`, { action: 'approve', version: request.version, documentsChecked: true, reviewNote: '越权' })).status, 403);
  const status = await call('buyer', '/api/real-name');
  assert.equal(status.body.status, 'verified');
});

test('verified buyer and escort can complete the existing order workflow', t => {
  const store = new ClubStore(':memory:');
  t.after(() => store.close());
  addFixtureGames(store, ['三角洲行动']);
  const admin = userById(store, 'admin');
  const buyer = userById(store, 'demo-user');
  const escort = userById(store, 'demo-escort');
  verifyFixtureUser(store, buyer, { realName: '流程买家' });
  verifyFixtureUser(store, escort, { realName: '流程打手' });
  store.transaction(admin, 'account:manage', '准备实名订单流程', data => Object.assign(data.users.find(item => item.id === escort.id), { games: ['三角洲行动'], online: true, active: true, levelId: 'gold' }));
  const order = store.createOrder(buyer, { context: 'personal', boss: buyer.name, productId: 'product-5', hours: 1, pay: '在线支付', requirement: '实名用户订单流程', levelId: 'gold' });
  store.orderAction(escort, order.id, 'apply', { version: order.version });
  let current = store.read().orders.find(item => item.id === order.id);
  store.orderAction(buyer, order.id, 'selectApplicant', { version: current.version, memberIds: [escort.id] });
  current = store.read().orders.find(item => item.id === order.id);
  store.orderAction(escort, order.id, 'accept', { version: current.version });
  current = store.read().orders.find(item => item.id === order.id);
  store.orderAction(escort, order.id, 'start', { version: current.version });
  assert.equal(store.read().orders.find(item => item.id === order.id).status, '陪玩中');
});
