import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { SmsLoginChallenges, loginPhoneForUser, normalizePhone } from '../server/sms-login.mjs';
import { createClubServer } from '../server.mjs';

const phone = '19900000001';
const user = { id: 'demo-user', active: true, loginPhone: phone, loginPhoneVerified: true };
const findUser = value => value === phone ? user : null;
const payload = result => ({ phone, challengeId: result.challengeId, code: result.demoCode });

test('phone challenges are single-use, expire, and resend invalidates previous codes', () => {
  let now = 1000;
  const codes = new SmsLoginChallenges({ clock: () => now });
  const first = codes.issue(phone, findUser);
  assert.match(first.demoCode, /^\d{6}$/);
  assert.equal(first.expiresIn, 300);
  assert.equal(first.retryAfter, 60);
  assert.throws(() => codes.issue(phone, findUser), { status: 429 });
  now += 60000;
  const second = codes.issue(phone, findUser);
  assert.throws(() => codes.verify(payload(first), findUser), { status: 401 });
  assert.equal(codes.verify(payload(second), findUser).id, user.id);
  assert.throws(() => codes.verify(payload(second), findUser), { status: 401 });
  assert.throws(() => codes.issue(phone, findUser), { status: 429 });
  now += 60000;
  const expired = codes.issue(phone, findUser);
  now += 300000;
  assert.throws(() => codes.verify(payload(expired), findUser), { status: 401 });
});

test('wrong codes exhaust the challenge and cannot reset resend cooldown', () => {
  const codes = new SmsLoginChallenges();
  const issued = codes.issue(phone, findUser);
  const wrong = issued.demoCode === '000000' ? '000001' : '000000';
  for (let i = 0; i < 5; i++) assert.throws(() => codes.verify({ ...payload(issued), code: wrong }, findUser), { status: 401 });
  assert.throws(() => codes.verify(payload(issued), findUser), { status: 401 });
  assert.throws(() => codes.issue(phone, findUser), { status: 429 });
});

test('phone binding is separate from editable profile phone and requires verification', () => {
  assert.equal(normalizePhone(phone), phone);
  assert.equal(normalizePhone('123456'), '');
  assert.equal(normalizePhone({ toString: () => phone }), '');
  assert.equal(loginPhoneForUser({ username: phone, phone, smsPhone: phone }), '');
  assert.equal(loginPhoneForUser({ loginPhone: phone }), '');
  assert.equal(loginPhoneForUser(user), phone);
  const codes = new SmsLoginChallenges();
  const issued = codes.issue(phone, findUser);
  assert.throws(() => codes.verify(payload(issued), () => ({ ...user, id: 'replacement' })), { status: 401 });
  const production = new SmsLoginChallenges({ production: true });
  assert.throws(() => production.issue(phone, findUser), { status: 503 });
  assert.throws(() => production.verify(payload(issued), findUser), { status: 503 });
});

async function httpFixture(t, options = {}) {
  const instance = createClubServer({ database: ':memory:', ...options });
  instance.server.listen(0, '127.0.0.1');
  await once(instance.server, 'listening');
  t.after(() => instance.close());
  const base = `http://127.0.0.1:${instance.server.address().port}`;
  const call = async (path, body, cookie = '', headers = {}) => {
    if (headers.Host) return new Promise((resolve, reject) => {
      const req = request(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } }, res => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { text += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
      });
      req.on('error', reject);
      req.end(JSON.stringify(body));
    });
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  const bind = () => instance.store.transaction({ id: 'admin' }, 'account:manage', '测试绑定手机号', data => Object.assign(data.users.find(u => u.id === user.id), { loginPhone: phone, loginPhoneVerified: true }));
  return { instance, call, bind };
}

test('HTTP code and password login access the same account; bad codes and replay do not authenticate', async t => {
  const { instance, call, bind } = await httpFixture(t);
  bind();
  const password = await call('/api/login', { username: 'demo_user', password: 'Test1234!' });
  assert.equal(password.status, 200);
  const sent = await call('/api/login/code', { phone });
  assert.equal(sent.status, 200);
  const throttled = await call('/api/login/code', { phone });
  assert.equal(throttled.status, 429);
  assert.ok(Number(throttled.headers.get('retry-after')) > 0);
  assert.equal((await call('/api/login/phone', { ...payload(sent.body), code: 'invalid' })).status, 401);
  const authenticated = await call('/api/login/phone', payload(sent.body));
  assert.equal(authenticated.status, 200);
  assert.equal(authenticated.body.user.id, password.body.user.id);
  assert.match(authenticated.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const cookie = authenticated.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('/api/me', undefined, cookie)).body.user.id, user.id);
  assert.equal((await call('/api/login/phone', payload(sent.body))).status, 401);
  assert.equal(instance.store.read().users.length, 19);
});

test('HTTP rejects unbound, duplicate, changed and disabled accounts without creating sessions', async t => {
  const { instance, call, bind } = await httpFixture(t);
  instance.store.transaction({ id: 'admin' }, 'account:manage', '测试仅资料手机号', data => {
    data.customers.find(c => c.id === data.users.find(u => u.id === user.id).customerId).phone = phone;
  });
  assert.equal((await call('/api/login/code', { phone })).status, 404);
  bind();
  const sent = await call('/api/login/code', { phone });
  instance.store.transaction({ id: 'admin' }, 'account:manage', '测试停用', data => { data.users.find(u => u.id === user.id).active = false; });
  const disabled = await call('/api/login/phone', payload(sent.body));
  assert.equal(disabled.status, 401);
  assert.equal(disabled.headers.has('set-cookie'), false);
  assert.equal(instance.store.db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0);
  instance.store.transaction({ id: 'admin' }, 'account:manage', '测试重复绑定', data => {
    data.users.find(u => u.id === user.id).active = true;
    Object.assign(data.users.find(u => u.id === 'demo-service'), { loginPhone: phone, loginPhoneVerified: true });
  });
  assert.equal((await call('/api/login/code', { phone })).status, 404);
});

test('HTTP demo code cannot be exposed via a non-loopback public origin or cross-origin request', async t => {
  const { call, bind } = await httpFixture(t, { publicOrigin: 'http://preview.example' });
  bind();
  assert.equal((await call('/api/login/code', { phone }, '', { Host: 'preview.example' })).status, 503);
  assert.equal((await call('/api/login/phone', { phone, code: '000000' }, '', { Host: 'preview.example' })).status, 503);
  assert.equal((await call('/api/login/code', { phone }, '', { Host: 'preview.example', Origin: 'http://evil.example' })).status, 403);
});
