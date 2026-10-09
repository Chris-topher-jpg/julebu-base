import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createClubServer } from '../server.mjs';
import { createHash } from 'node:crypto';
import { ClubStore } from '../server/club.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function fixture(t) {
  const { server, store } = createClubServer({ database: ':memory:' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const cookies = new Map();
  const call = async (client, path, body) => {
    const response = await fetch(base + '/api' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(cookies.has(client) ? { Cookie: cookies.get(client) } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: base }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  const login = async (client, username = client) => {
    const result = await call(client, '/login', { username, password: '123456' });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    cookies.set(client, result.headers.get('set-cookie').split(';')[0]);
    return result.body.user;
  };
  const me = async client => {
    const result = await call(client, '/me');
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body;
  };
  const person = id => store.read().users.find(user => user.id === id);
  return { call, login, me, person, store };
}

test('所有角色无需实名即可设置本人状态，个人和后台同步一致，退出后离线', async t => {
  const { call, login, me, person, store } = await fixture(t);
  assert.equal((await call('anonymous', '/online', { online: true })).status, 401);
  for (const username of ['user', 'member', 'admin', 'service', 'finance', 'examiner', 'afterSales', 'escort']) {
    await t.test(username, async () => {
      const user = await login(username);
      assert.equal(user.online, true);
      const personal = await me(username);
      assert.equal(personal.user.online, true);
      assert.equal(personal.user.role, 'user');
      for (const privateKey of ['passwordHash', 'shareBps', 'balanceCents', 'games']) {
        assert.equal(Object.hasOwn(personal.user, privateKey), false);
      }
      for (const online of [false, true]) {
        const before = store.read().revision;
        const result = await call(username, '/online', { online });
        assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.equal(result.body.online, online);
        assert.deepEqual(Object.keys(result.body).sort(), ['id', 'online']);
        assert.equal((await me(username)).user.online, online);
        assert.equal((await call(username, '/workspace')).body.user.online, online);
        const synced = await call(username, `/sync?since=${before}&context=personal`);
        assert.equal(synced.status, 200);
        assert.equal(synced.body.changed, true);
        assert.equal(synced.body.workspace.user.online, online);
      }
      const beforeInvalid = store.read();
      assert.equal((await call(username, '/online', { online: 'false' })).status, 400);
      assert.deepEqual(store.read(), beforeInvalid);
      const beforeLogout = store.read().revision;
      assert.equal((await call(username, '/logout', {})).status, 200);
      assert.equal(person(user.id).online, false);
      assert.ok(store.read().revision > beforeLogout);
      assert.equal((await call(username, '/me')).status, 401);
      assert.equal((await call(username, '/online', { online: true })).status, 401);
    });
  }
});

test('每种角色手动离线后刷新、其他设备登录、退出重登均保留选择', async t => {
  const { call, login, me, person } = await fixture(t);
  for (const username of ['user', 'member', 'admin', 'service', 'finance', 'examiner', 'afterSales', 'escort']) {
    const user = await login('first', username);
    assert.equal((await call('first', '/online', { online: false, expectedUserId: user.id })).status, 200);
    assert.equal((await me('first')).user.online, false);
    assert.equal((await login('second', username)).online, false);
    assert.equal((await me('first')).user.online, false);
    assert.equal((await call('first', '/logout', {})).status, 200);
    assert.equal((await call('second', '/logout', {})).status, 200);
    assert.equal((await login('third', username)).online, false);
    assert.equal((await call('third', '/online', { online: true })).status, 200);
    assert.equal(person(user.id).onlinePreference, true);
    await call('third', '/logout', {});
    assert.equal((await login('fourth', username)).online, true);
    await call('fourth', '/logout', {});
  }
});

test('只能更新当前会话本人，旧页面跨账号提交会拒绝且不泄露工作资料', async t => {
  const { call, login, person, store } = await fixture(t);
  const actor = await login('current', 'user');
  const adminBefore = person('admin');
  const response = await call('current', '/online', { online: false, userId: 'admin', role: 'admin' });
  assert.deepEqual(response.body, { id: actor.id, online: false });
  assert.deepEqual(person('admin'), adminBefore);
  const before = store.read();
  assert.equal((await call('current', '/online', { online: true, expectedUserId: 'admin' })).status, 409);
  assert.deepEqual(store.read(), before);
  for (const online of [null, 0, 1, 'true', {}, []]) {
    assert.equal((await call('current', '/online', { online })).status, 400);
    assert.deepEqual(store.read(), before);
  }
});

test('未实名陪玩可以在线，但不能因此绕过接单资格', async t => {
  const { call, login, person, store } = await fixture(t);
  const escort = await login('escort');
  assert.equal(person(escort.id).realNameVerification.status, 'unverified');
  assert.equal((await call('escort', '/online', { online: true })).status, 200);
  const data = store.read(), order = data.orders[0];
  assert.equal(store.assignable(data, order, person(escort.id)), false);
  assert.equal((await call('escort', `/orders/${order.id}/accept`, { version: order.version })).status, 403);
  assert.deepEqual(store.read(), data);
});

test('已有在线状态的登录仍持久保存会话标记，过期不误伤其他会话和演示状态', async t => {
  const { login, person, store } = await fixture(t);
  const data = store.read();
  data.users.find(user => user.id === 'user-demo').online = true;
  const demo = data.users.find(user => user.id === 'xiaoman');
  demo.online = true;
  delete demo.presenceSession;
  store.db.prepare('UPDATE club SET data=? WHERE id=1').run(JSON.stringify(data));
  const user = await login('current', 'user');
  assert.equal(person(user.id).presenceSession, true);
  store.db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run('expired-current', user.id, Date.now() - 1);
  assert.equal(store.cleanupExpiredSessions(), false);
  assert.equal(person(user.id).online, true);
  store.db.prepare('UPDATE sessions SET expires=? WHERE user_id=?').run(Date.now() - 1, user.id);
  assert.equal(store.cleanupExpiredSessions(), true);
  assert.equal(person(user.id).online, false);
  assert.equal(person('xiaoman').online, true);
  assert.equal(store.cleanupExpiredSessions(), false);
});

test('离线偏好与在线会话清理在数据库重启和失败回滚后保持一致', t => {
  const directory = mkdtempSync(join(tmpdir(), 'club-presence-'));
  const database = join(directory, 'club.sqlite');
  let store = new ClubStore(database);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  let login = store.login('user', '123456');
  store.setOnline(login.user, { online: false });
  store.close();
  store = new ClubStore(database);
  assert.equal(store.login('user', '123456').user.online, false);
  store.setOnline(login.user, { online: true });
  store.db.prepare('UPDATE sessions SET expires=?').run(Date.now() - 1);
  const before = store.read(), sessions = store.db.prepare('SELECT * FROM sessions').all();
  store.db.exec("CREATE TRIGGER fail_cleanup BEFORE UPDATE ON club BEGIN SELECT RAISE(ABORT, 'cleanup write failed'); END;");
  assert.throws(() => store.cleanupExpiredSessions(), /cleanup write failed/);
  assert.deepEqual(store.read(), before);
  assert.deepEqual(store.db.prepare('SELECT * FROM sessions').all(), sessions);
  store.db.exec('DROP TRIGGER fail_cleanup');
  store.cleanupExpiredSessions();
  login = store.login('user', '123456');
  assert.equal(login.user.online, true);
  store.setOnline(login.user, { online: false });
  store.db.prepare('UPDATE sessions SET expires=? WHERE token=?').run(Date.now() - 1, createHash('sha256').update(login.token).digest('hex'));
  store.cleanupExpiredSessions();
  assert.equal(store.login('user', '123456').user.online, false);
});

test('同账号替换会话和多设备退出不会误离线，最后一个有效会话退出才离线', async t => {
  const { call, login, me, person, store } = await fixture(t);
  const user = await login('first', 'user');
  await login('second', 'user');
  const beforeReplacement = store.read().revision;
  await login('first', 'user');
  assert.equal(store.read().revision, beforeReplacement);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS total FROM sessions WHERE user_id=?').get(user.id).total, 2);
  assert.equal((await call('first', '/logout', {})).status, 200);
  assert.equal(person(user.id).online, true);
  assert.equal((await me('second')).user.online, true);
  assert.equal(store.read().revision, beforeReplacement);
  assert.equal((await call('second', '/logout', {})).status, 200);
  assert.equal(person(user.id).online, false);
  assert.ok(store.read().revision > beforeReplacement);

  await login('last', 'user');
  store.db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run('expired-presence-fixture', user.id, Date.now() - 1000);
  assert.equal((await call('last', '/logout', {})).status, 200);
  assert.equal(person(user.id).online, false, '过期会话不能阻止退出时自动离线');
});

test('失败登录不会改动在线状态或撤销已有会话', async t => {
  const { call, login, me, store } = await fixture(t);
  await login('current', 'user');
  for (const online of [false, true]) {
    assert.equal((await call('current', '/online', { online })).status, 200);
    const before = store.read();
    const sessions = store.db.prepare('SELECT * FROM sessions ORDER BY token').all();
    const failed = await call('current', '/login', { username: 'user', password: 'wrong-password' });
    assert.equal(failed.status, 401);
    assert.equal(failed.headers.has('set-cookie'), false);
    assert.deepEqual(store.read(), before);
    assert.deepEqual(store.db.prepare('SELECT * FROM sessions ORDER BY token').all(), sessions);
    assert.equal((await me('current')).user.online, online);
  }
});

test('登录和退出持久化失败时，会话与在线状态一起回滚', async t => {
  const { call, login, me, person, store } = await fixture(t);
  const failWrites = () => store.db.exec("CREATE TRIGGER fail_presence BEFORE UPDATE ON club BEGIN SELECT RAISE(ABORT, 'presence test write failure'); END;");
  failWrites();
  const beforeLogin = store.read();
  const failedLogin = await call('current', '/login', { username: 'user', password: '123456' });
  assert.equal(failedLogin.status, 500);
  assert.deepEqual(store.read(), beforeLogin);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS total FROM sessions').get().total, 0);
  store.db.exec('DROP TRIGGER fail_presence');

  const user = await login('current', 'user');
  failWrites();
  const beforeLogout = store.read();
  assert.equal((await call('current', '/logout', {})).status, 500);
  assert.deepEqual(store.read(), beforeLogout);
  assert.equal(person(user.id).online, true);
  assert.equal((await me('current')).user.online, true);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS total FROM sessions').get().total, 1);
  store.db.exec('DROP TRIGGER fail_presence');
  assert.equal((await call('current', '/logout', {})).status, 200);
  assert.equal(person(user.id).online, false);
});
