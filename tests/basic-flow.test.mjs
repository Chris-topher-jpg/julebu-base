import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBasicClubServer } from '../server.mjs';

const start = async () => {
  const app = createBasicClubServer();
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  return { app, base: `http://127.0.0.1:${app.server.address().port}` };
};

const request = async (base, path, options = {}) => {
  const { cookie = '', body, method = body ? 'POST' : 'GET' } = options;
  const response = await fetch(`${base}/api${path}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json();
  return { response, result, cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie };
};

const login = async (base, username) => {
  const result = await request(base, '/login', { body: { username, password: '123456' } });
  assert.equal(result.response.status, 200);
  return result.cookie;
};

test('basic edition keeps the order chain from order submission to customer acceptance', async t => {
  const { app, base } = await start();
  t.after(() => { app.server.close(); app.close(); });
  const customer = await login(base, 'user');
  const service = (await request(base, '/public/services', { method: 'GET' })).result.services[0];
  const created = await request(base, '/orders', { cookie: customer, body: { gameId: 1, serviceId: service.id, contact: 'wechat-demo', note: '今晚八点开始' } });
  assert.equal(created.response.status, 201);
  const orderId = created.result.id;
  assert.equal(created.result.status, '待支付');
  const reported = await request(base, `/orders/${orderId}/actions`, { cookie: customer, body: { action: 'pay', reference: '微信付款 68 元' } });
  assert.equal(reported.result.status, '待核款');
  assert.equal(reported.result.paid_at, null);
  const serviceCookie = await login(base, 'service');
  assert.equal((await request(base, `/orders/${orderId}/actions`, { cookie: serviceCookie, body: { action: 'dispatch', escortId: 'u_escort' } })).response.status, 409);
  assert.equal((await request(base, `/orders/${orderId}/actions`, { cookie: customer, body: { action: 'confirm-payment' } })).response.status, 403);
  const confirmed = await request(base, `/orders/${orderId}/actions`, { cookie: serviceCookie, body: { action: 'confirm-payment' } });
  assert.equal(confirmed.result.status, '待派单');
  assert.ok(confirmed.result.paid_at);
  assert.equal((await request(base, `/orders/${orderId}/actions`, { cookie: serviceCookie, body: { action: 'dispatch', escortId: 'u_escort' } })).result.status, '待服务');
  const escort = await login(base, 'escort');
  assert.equal((await request(base, `/orders/${orderId}/actions`, { cookie: escort, body: { action: 'start' } })).result.status, '服务中');
  assert.equal((await request(base, `/orders/${orderId}/actions`, { cookie: escort, body: { action: 'finish' } })).result.status, '待验收');
  const accepted = await request(base, `/orders/${orderId}/actions`, { cookie: customer, body: { action: 'accept' } });
  assert.equal(accepted.result.status, '已完成');
  assert.deepEqual(accepted.result.events.map(event => event.action), ['提交订单', '提交付款报备', '客服确认收款', '客服派单', '开始服务', '提交完成', '客户验收完成']);
  const duplicate = await request(base, `/orders/${orderId}/actions`, { cookie: customer, body: { action: 'accept' } });
  assert.equal(duplicate.response.status, 409);
  assert.equal((await request(base, '/me', { cookie: customer })).result.orders[0].events.length, 7);
});

test('basic edition does not expose other customer orders or allow out-of-order actions', async t => {
  const { app, base } = await start();
  t.after(() => { app.server.close(); app.close(); });
  const customer = await login(base, 'user');
  const service = (await request(base, '/public/services', { method: 'GET' })).result.services[0];
  const order = await request(base, '/orders', { cookie: customer, body: { gameId: 1, serviceId: service.id, contact: 'wechat-demo', note: '' } });
  const other = await request(base, '/register', { body: { username: 'other_customer', password: '12345678', name: '另一位用户', role: 'admin' } });
  assert.equal(other.response.status, 201);
  assert.equal(other.result.user.role, 'customer');
  const mine = await request(base, '/me', { cookie: other.cookie, method: 'GET' });
  assert.equal(mine.result.orders.length, 0);
  const forbidden = await request(base, `/orders/${order.result.id}/actions`, { cookie: other.cookie, body: { action: 'pay' } });
  assert.equal(forbidden.response.status, 404);
  const invalid = await request(base, `/orders/${order.result.id}/actions`, { cookie: customer, body: { action: 'accept' } });
  assert.equal(invalid.response.status, 409);
  const escort = await login(base, 'escort');
  assert.equal((await request(base, '/me', { cookie: escort })).result.orders.length, 0);
  assert.equal((await request(base, `/orders/${order.result.id}/actions`, { cookie: escort, body: { action: 'start' } })).response.status, 404);
  const cancelled = await request(base, `/orders/${order.result.id}/actions`, { cookie: customer, body: { action: 'cancel' } });
  assert.equal(cancelled.result.status, '已取消');
  assert.equal((await request(base, `/orders/${order.result.id}/actions`, { cookie: customer, body: { action: 'pay', reference: '付款' } })).response.status, 409);
});

test('catalog maintenance preserves order price snapshots and blocks ordering unavailable services', async t => {
  const { app, base } = await start();
  t.after(() => { app.server.close(); app.close(); });
  const admin = await login(base, 'admin');
  const customer = await login(base, 'user');
  const serviceCookie = await login(base, 'service');
  const payload = { name: '基础教学服务', category: '教学', description: '一小时基础游戏教学', priceCents: 5000, durationHours: 1 };
  assert.equal((await request(base, '/services', { cookie: serviceCookie, body: payload })).response.status, 403);
  assert.equal((await request(base, '/services', { cookie: admin, body: { ...payload, priceCents: -1 } })).response.status, 400);
  assert.equal((await request(base, '/services', { cookie: admin, body: payload })).response.status, 201);
  const catalog = (await request(base, '/public/services')).result.services;
  const serviceId = catalog.find(item => item.name === payload.name).id;
  const order = await request(base, '/orders', { cookie: customer, body: { gameId: 1, serviceId, contact: 'test-contact' } });
  assert.equal((await request(base, `/services/${serviceId}`, { cookie: admin, body: { ...payload, name: '调整后的服务名称', priceCents: 8000 } })).response.status, 200);
  const preserved = (await request(base, '/me', { cookie: customer })).result.orders[0];
  assert.equal(preserved.price_cents, 5000);
  assert.equal(preserved.service_name, payload.name);
  assert.equal(preserved.id, order.result.id);
  assert.equal((await request(base, `/services/${serviceId}`, { cookie: admin, body: { active: false } })).response.status, 200);
  assert.ok(!(await request(base, '/public/services')).result.services.some(item => item.id === serviceId));
  assert.equal((await request(base, '/orders', { cookie: customer, body: { gameId: 1, serviceId, contact: 'test-contact' } })).response.status, 404);
  assert.equal((await request(base, `/services/${serviceId}`, { cookie: admin, body: { active: true } })).response.status, 200);
  assert.ok((await request(base, '/public/services')).result.services.some(item => item.id === serviceId));
});

test('staff accounts can be created only by administrators; password changes invalidate prior sessions', async t => {
  const { app, base } = await start();
  t.after(() => { app.server.close(); app.close(); });
  const admin = await login(base, 'admin');
  const customer = await login(base, 'user');
  const payload = { username: 'new_escort', password: 'test-password', name: '新陪玩', role: 'escort' };
  assert.equal((await request(base, '/staff', { cookie: customer, body: payload })).response.status, 403);
  assert.equal((await request(base, '/staff', { cookie: admin, body: { ...payload, role: 'admin' } })).response.status, 400);
  assert.equal((await request(base, '/staff', { cookie: admin, body: payload })).response.status, 201);
  const logged = await request(base, '/login', { body: { username: payload.username, password: payload.password } });
  assert.equal(logged.result.user.role, 'escort');
  assert.ok((await request(base, '/me', { cookie: admin })).result.escorts.some(item => item.name === payload.name));
  const changed = await request(base, '/password', { cookie: logged.cookie, body: { currentPassword: payload.password, password: 'changed-password' } });
  assert.equal(changed.response.status, 200);
  assert.equal((await request(base, '/me', { cookie: logged.cookie })).response.status, 401);
  assert.equal((await request(base, '/me', { cookie: changed.cookie })).response.status, 200);
  await request(base, '/logout', { cookie: changed.cookie, body: {} });
  assert.equal((await request(base, '/me', { cookie: changed.cookie })).response.status, 401);
});

test('static assets cannot expose databases, repository files or removed modules', async t => {
  const { app, base } = await start();
  t.after(() => { app.server.close(); app.close(); });
  for (const path of ['/data/club-basic.sqlite', '/data/club.sqlite', '/.env', '/.git/config', '/server.mjs', '/server/club.mjs', '/src/app.js', '/src/../server.mjs']) {
    assert.equal((await fetch(`${base}${path}`)).status, 404, path);
  }
  assert.equal((await fetch(base)).status, 200);
  assert.equal((await fetch(`${base}/src/main.js`)).status, 200);
  assert.equal((await request(base, '/orders', { body: { gameId: 1, serviceId: 1, contact: 'test' } })).response.status, 401);
  const crossSite = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' }, body: JSON.stringify({ username: 'admin', password: '123456' }) });
  assert.equal(crossSite.status, 403);
});

test('fresh database directories are created and persisted orders survive reopening', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'club-basic-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const database = join(directory, 'new-directory', 'club.sqlite');
  const app = createBasicClubServer({ database });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${app.server.address().port}`;
    const customer = await login(base, 'user');
    const created = await request(base, '/orders', { cookie: customer, body: { gameId: 1, serviceId: 1, contact: 'persisted-contact' } });
    assert.equal(created.response.status, 201);
  } finally { await new Promise(resolve => app.server.close(resolve)); app.close(); }
  const reopened = createBasicClubServer({ database });
  try {
    assert.equal(reopened.db.prepare('SELECT contact FROM orders').get().contact, 'persisted-contact');
    assert.equal(reopened.db.prepare('SELECT COUNT(*) count FROM order_events').get().count, 1);
  } finally { reopened.close(); }
  assert.throws(() => createBasicClubServer({ database, production: true, publicOrigin: 'https://club.example.com' }), /独立数据库/);
});

test('production bootstrap requires configuration and never seeds demo users or catalog', async t => {
  assert.throws(() => createBasicClubServer({ production: true }), /HTTPS/);
  assert.throws(() => createBasicClubServer({ production: true, publicOrigin: 'https://club.example.com' }), /CLUB_ADMIN_PASSWORD/);
  const app = createBasicClubServer({ production: true, publicOrigin: 'https://club.example.com', adminPassword: 'owner-password-123', adminUsername: 'owner' });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => { app.server.close(); app.close(); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const catalog = (await request(base, '/public/services')).result;
  assert.equal(catalog.demo, false);
  assert.equal(catalog.services.length, 0);
  assert.equal(catalog.games.length, 0);
  assert.equal(app.db.prepare('SELECT COUNT(*) count FROM users').get().count, 1);
  assert.equal((await request(base, '/login', { body: { username: 'admin', password: '123456' } })).response.status, 401);
  const logged = await request(base, '/login', { body: { username: 'owner', password: 'owner-password-123' } });
  assert.equal(logged.response.status, 200);
  assert.match(logged.response.headers.get('set-cookie'), /Secure/);
});

test('payment rejection requires a reason and allows resubmission without bypassing verification', async t => {
  const { app, base } = await start();
  t.after(() => { app.server.close(); app.close(); });
  const customer = await login(base, 'user');
  const service = await login(base, 'service');
  const created = await request(base, '/orders', { cookie: customer, body: { gameId: 1, serviceId: 1, contact: 'test-contact' } });
  const path = `/orders/${created.result.id}/actions`;
  await request(base, path, { cookie: customer, body: { action: 'pay', reference: '付款凭证待核实' } });
  assert.equal((await request(base, path, { cookie: customer, body: { action: 'reject-payment', note: '自行退回' } })).response.status, 403);
  assert.equal((await request(base, path, { cookie: service, body: { action: 'reject-payment', note: '' } })).response.status, 400);
  assert.equal((await request(base, '/me', { cookie: service })).result.orders[0].status, '待核款');
  const rejected = await request(base, path, { cookie: service, body: { action: 'reject-payment', note: '请补充付款人和转账时间' } });
  assert.equal(rejected.result.status, '待支付');
  assert.equal(rejected.result.paid_at, null);
  assert.equal(rejected.result.events.at(-1).note, '请补充付款人和转账时间');
  assert.equal((await request(base, path, { cookie: service, body: { action: 'dispatch', escortId: 'u_escort' } })).response.status, 409);
  assert.equal((await request(base, path, { cookie: customer, body: { action: 'pay', reference: '已补充付款人和时间' } })).result.status, '待核款');
  assert.equal((await request(base, path, { cookie: service, body: { action: 'confirm-payment' } })).result.status, '待派单');
});

test('follow-up notes retain actor and visibility without allowing unauthorized or closed-order edits', async t => {
  const { app, base } = await start();
  t.after(() => { app.server.close(); app.close(); });
  const customer = await login(base, 'user'), service = await login(base, 'service'), escort = await login(base, 'escort');
  const created = await request(base, '/orders', { cookie: customer, body: { gameId: 1, serviceId: 1, contact: 'test-contact' } });
  const path = `/orders/${created.result.id}/actions`;
  assert.equal((await request(base, path, { cookie: customer, body: { action: 'note', note: '用户不应该伪造跟进' } })).response.status, 403);
  assert.equal((await request(base, path, { cookie: escort, body: { action: 'note', note: '未派单不能跟进' } })).response.status, 404);
  const note = await request(base, path, { cookie: service, body: { action: 'note', note: '已联系客户，约定 20:00 服务' } });
  assert.equal(note.result.status, '待支付');
  assert.equal(note.result.events.at(-1).actor, '客服小星');
  assert.equal((await request(base, '/me', { cookie: customer })).result.orders[0].events.at(-1).note, '已联系客户，约定 20:00 服务');
  await request(base, path, { cookie: customer, body: { action: 'cancel' } });
  assert.equal((await request(base, path, { cookie: service, body: { action: 'note', note: '已取消不可继续跟进' } })).response.status, 409);
});

test('disabling staff invalidates sessions and rejects active assignments without breaking unfinished orders', async t => {
  const { app, base } = await start();
  t.after(() => { app.server.close(); app.close(); });
  const admin = await login(base, 'admin'), customer = await login(base, 'user'), service = await login(base, 'service'), escort = await login(base, 'escort');
  assert.equal((await request(base, '/staff/u_escort', { cookie: service, body: { active: false } })).response.status, 403);
  assert.equal((await request(base, '/staff/u_admin', { cookie: admin, body: { active: false } })).response.status, 404);
  assert.equal((await request(base, '/staff/u_escort', { cookie: admin, body: { active: 'false' } })).response.status, 400);
  assert.equal((await request(base, '/staff/u_escort', { cookie: admin, body: { active: false } })).response.status, 200);
  assert.equal((await request(base, '/me', { cookie: escort })).response.status, 401);
  assert.ok(!(await request(base, '/me', { cookie: service })).result.escorts.some(user => user.id === 'u_escort'));
  assert.equal((await request(base, '/login', { body: { username: 'escort', password: '123456' } })).response.status, 401);
  const order = await request(base, '/orders', { cookie: customer, body: { gameId: 1, serviceId: 1, contact: 'test-contact' } });
  const path = `/orders/${order.result.id}/actions`;
  await request(base, path, { cookie: service, body: { action: 'confirm-payment' } });
  assert.equal((await request(base, path, { cookie: service, body: { action: 'dispatch', escortId: 'u_escort' } })).response.status, 400);
  await request(base, '/staff/u_escort', { cookie: admin, body: { active: true } });
  assert.equal((await request(base, '/me', { cookie: escort })).response.status, 401);
  const newEscort = await login(base, 'escort');
  await request(base, path, { cookie: service, body: { action: 'dispatch', escortId: 'u_escort' } });
  assert.equal((await request(base, '/staff/u_escort', { cookie: admin, body: { active: false } })).response.status, 409);
  assert.equal((await request(base, path, { cookie: newEscort, body: { action: 'start' } })).result.status, '服务中');
  assert.equal((await request(base, path, { cookie: newEscort, body: { action: 'note', note: '已按预约时间开始服务' } })).response.status, 200);
});

test('game categories, service associations and availability are enforced while order snapshots survive changes', async t => {
  const { app, base } = await start();
  t.after(() => { app.server.close(); app.close(); });
  const admin = await login(base, 'admin'), customer = await login(base, 'user'), service = await login(base, 'service');
  const game = { name: '星露谷物语', category: '休闲经营' };
  for (const cookie of [customer, service]) {
    assert.equal((await request(base, '/games', { cookie, body: game })).response.status, 403);
    assert.equal((await request(base, '/games/1', { cookie, body: { active: false } })).response.status, 403);
  }
  assert.equal((await request(base, '/games', { cookie: admin, body: { ...game, category: '' } })).response.status, 400);
  assert.equal((await request(base, '/games', { cookie: admin, body: game })).response.status, 201);
  assert.equal((await request(base, '/games', { cookie: admin, body: game })).response.status, 409);
  const catalog = (await request(base, '/public/services')).result;
  const gameId = catalog.games.find(g => g.name === game.name).id;
  assert.ok(catalog.games.some(g => g.category === 'MOBA'));
  assert.ok(catalog.games.some(g => g.category === '射击竞技'));
  assert.ok(catalog.games.some(g => g.category === '休闲经营'));
  assert.equal((await request(base, `/games/${gameId}`, { cookie: admin, body: { active: 'false' } })).response.status, 400);
  assert.equal((await request(base, `/games/${gameId}`, { cookie: admin, body: { name: catalog.games[0].name, category: '重复测试' } })).response.status, 409);
  const payload = { name: '农场联机陪玩', category: '双人联机', description: '一起建设农场并探索地图。', priceCents: 5000, durationHours: 1, gameId };
  assert.equal((await request(base, '/services', { cookie: admin, body: { ...payload, gameId: 999999 } })).response.status, 400);
  assert.equal((await request(base, '/services', { cookie: admin, body: payload })).response.status, 201);
  const linked = (await request(base, '/public/services')).result.services.find(s => s.name === payload.name);
  assert.equal(linked.gameName, game.name);
  assert.equal(linked.gameCategory, game.category);
  const orderPayload = { serviceId: linked.id, gameId, contact: 'test-contact' };
  assert.equal((await request(base, '/orders', { cookie: customer, body: { ...orderPayload, gameId: undefined } })).response.status, 400);
  assert.equal((await request(base, '/orders', { cookie: customer, body: { ...orderPayload, gameId: 1 } })).response.status, 400);
  assert.equal((await request(base, '/orders', { cookie: customer, body: { ...orderPayload, gameId: 999999 } })).response.status, 400);
  const created = await request(base, '/orders', { cookie: customer, body: orderPayload });
  assert.equal(created.response.status, 201);
  assert.equal(created.result.game_name, game.name);
  assert.equal(created.result.game_category, game.category);
  const generic = await request(base, '/orders', { cookie: customer, body: { ...orderPayload, serviceId: 1 } });
  assert.equal(generic.response.status, 201);
  assert.equal(generic.result.game_name, game.name);
  assert.equal((await request(base, `/games/${gameId}`, { cookie: admin, body: { name: '农场物语', category: '模拟经营' } })).response.status, 200);
  const renamed = (await request(base, '/public/services')).result.services.find(s => s.id === linked.id);
  assert.equal(renamed.gameName, '农场物语');
  assert.equal(renamed.gameCategory, '模拟经营');
  await request(base, `/games/${gameId}`, { cookie: admin, body: { active: false } });
  const hidden = (await request(base, '/public/services')).result;
  assert.ok(!hidden.games.some(g => g.id === gameId));
  assert.ok(!hidden.services.some(s => s.id === linked.id));
  assert.ok(hidden.services.some(s => s.id === 1));
  assert.equal((await request(base, '/orders', { cookie: customer, body: orderPayload })).response.status, 404);
  assert.equal((await request(base, '/orders', { cookie: customer, body: { ...orderPayload, serviceId: 1 } })).response.status, 400);
  const workspace = (await request(base, '/me', { cookie: admin })).result;
  assert.equal(workspace.games.find(g => g.id === gameId).active, 0);
  const snapshot = workspace.orders.find(o => o.id === created.result.id);
  assert.equal(snapshot.game_name, game.name);
  assert.equal(snapshot.game_category, game.category);
  const path = `/orders/${created.result.id}/actions`;
  assert.equal((await request(base, path, { cookie: customer, body: { action: 'pay', reference: '游戏下架后付款报备' } })).result.status, '待核款');
  assert.equal((await request(base, path, { cookie: service, body: { action: 'confirm-payment' } })).result.status, '待派单');
  assert.equal((await request(base, path, { cookie: service, body: { action: 'dispatch', escortId: 'u_escort' } })).result.status, '待服务');
  const escort = await login(base, 'escort');
  await request(base, path, { cookie: escort, body: { action: 'start' } });
  await request(base, path, { cookie: escort, body: { action: 'finish' } });
  const accepted = (await request(base, path, { cookie: customer, body: { action: 'accept' } })).result;
  assert.equal(accepted.status, '已完成');
  assert.equal(accepted.game_name, game.name);
  assert.equal((await request(base, `/services/${linked.id}`, { cookie: admin, body: { ...payload, priceCents: 6000 } })).response.status, 200);
  await request(base, `/games/${gameId}`, { cookie: admin, body: { active: true } });
  assert.ok((await request(base, '/public/services')).result.services.some(s => s.id === linked.id));
  await request(base, `/services/${linked.id}`, { cookie: admin, body: { ...payload, gameId: null } });
  assert.equal((await request(base, '/orders', { cookie: customer, body: { ...orderPayload, gameId: 1 } })).response.status, 201);
});

test('existing basic databases migrate without losing services, orders or order events and can reopen repeatedly', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'club-games-migration-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const database = join(directory, 'club.sqlite');
  const old = createBasicClubServer({ database });
  await new Promise(resolve => old.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${old.server.address().port}`;
  const customer = await login(base, 'user');
  const created = await request(base, '/orders', { cookie: customer, body: { serviceId: 1, gameId: 1, contact: 'legacy-contact', note: '旧订单：王者荣耀微信区' } });
  assert.equal(created.response.status, 201);
  await new Promise(resolve => old.server.close(resolve));
  // Reproduce the pre-game basic schema, including its persisted business records.
  old.db.exec(`ALTER TABLE services DROP COLUMN game_id;
    ALTER TABLE orders DROP COLUMN game_name;
    ALTER TABLE orders DROP COLUMN game_category;
    DROP TABLE games;
    DELETE FROM settings WHERE key='game_catalog_seeded';`);
  old.close();
  for (let attempt = 0; attempt < 2; attempt++) {
    const migrated = createBasicClubServer({ database });
    try {
      const order = migrated.db.prepare('SELECT * FROM orders WHERE id=?').get(created.result.id);
      assert.equal(order.contact, 'legacy-contact');
      assert.equal(order.note, '旧订单：王者荣耀微信区');
      assert.equal(order.game_name, '');
      assert.equal(order.status, '待支付');
      assert.equal(migrated.db.prepare('SELECT COUNT(*) count FROM order_events').get().count, 1);
      assert.equal(migrated.db.prepare('SELECT COUNT(*) count FROM games').get().count, 5);
      assert.equal(migrated.db.prepare('SELECT game_id FROM services WHERE id=1').get().game_id, null);
      assert.equal(migrated.db.prepare('SELECT COUNT(*) count FROM services').get().count, 3);
    } finally { migrated.close(); }
  }
});
