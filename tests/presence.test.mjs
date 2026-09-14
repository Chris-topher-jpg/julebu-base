import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createClubServer } from '../server.mjs';
import { verifyFixtureUsers } from './real-name-fixture.mjs';

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

test('每种角色登录自动在线，可手动切换状态，退出后离线并同步个人状态', async t => {
  const { call, login, me, person, store } = await fixture(t);
  verifyFixtureUsers(store, ['escort'], { onlineEscorts: false });
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
        assert.equal((await me(username)).user.online, online);
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
