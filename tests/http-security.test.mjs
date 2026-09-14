import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createClubServer } from '../server.mjs';
import { clubDay } from '../server/analytics.mjs';

async function fixture(t, options = {}, cleanup = () => {}) {
  const instance = createClubServer({ database: ':memory:', production: false, publicOrigin: '', ...options });
  instance.server.listen(0, '127.0.0.1');
  await once(instance.server, 'listening');
  t.after(async () => { await instance.close(); cleanup(); });
  const base = `http://127.0.0.1:${instance.server.address().port}`;
  return { ...instance, base };
}

async function post(base, path, body, headers = {}) {
  return fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, ...headers }, body: JSON.stringify(body) });
}

// Node fetch pins Host to the URL, even when a different Host was supplied.
// Exercise reverse-proxy traffic with node:http so the configured host is sent.
async function proxyPost(base, path, body, headers = {}) {
  return rawRequest(base, path, { 'Content-Type': 'application/json', ...headers }, [JSON.stringify(body)]);
}

function rawRequest(base, path, headers = {}, chunks = []) {
  return new Promise((resolve, reject) => {
    const req = request(base + path, { method: chunks.length ? 'POST' : 'GET', headers }, res => {
      const data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(data).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('error', reject);
    (async () => {
      req.flushHeaders();
      for (const chunk of chunks) { req.write(chunk); await delay(5); }
      req.end();
    })().catch(reject);
  });
}

test('request parser preserves split UTF-8 and rejects malformed, oversized or non-JSON input', async t => {
  const { base } = await fixture(t);
  const text = JSON.stringify({ username: 'utf8_customer', name: '小林', password: 'SafeTest123!' });
  const data = Buffer.from(text);
  const split = data.indexOf(Buffer.from('小')) + 1;
  const response = await rawRequest(base, '/api/register', { 'Content-Type': 'application/json', Origin: base }, [data.subarray(0, split), data.subarray(split)]);
  assert.equal(response.status, 201);
  assert.equal(JSON.parse(response.text).user.name, '小林');
  assert.equal((await post(base, '/api/logout', {}, { 'Content-Type': 'application/json-malicious' })).status, 415);
  assert.equal((await post(base, '/api/logout', [])).status, 400);
  assert.equal((await post(base, '/api/logout', { text: '好'.repeat(9000) })).status, 413);
  const invalidUtf8 = await rawRequest(base, '/api/logout', { 'Content-Type': 'application/json', Origin: base }, [Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d])]);
  assert.equal(invalidUtf8.status, 400);
  assert.equal((await post(base, '/api/logout', {}, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
});

test('a successful login cannot clear failures accumulated from the same local source', async t => {
  const { base } = await fixture(t);
  for (let i = 0; i < 5; i++) assert.equal((await post(base, '/api/login', { username: 'admin', password: 'wrong' })).status, 401);
  assert.equal((await post(base, '/api/login', { username: 'user', password: '123456' })).status, 200);
  for (let i = 0; i < 5; i++) assert.equal((await post(base, '/api/login', { username: 'admin', password: 'wrong' })).status, 401);
  const denied = await post(base, '/api/login', { username: 'admin', password: 'wrong' });
  assert.equal(denied.status, 429);
  assert.ok(Number(denied.headers.get('retry-after')) > 0);
});

test('malformed hosts are client errors and private files remain inaccessible', async t => {
  const { base } = await fixture(t);
  for (const host of ['localhost:99999', 'localhost/path', '[::::]']) {
    assert.equal((await rawRequest(base, '/', { Host: host })).status, 400, host);
  }
  assert.equal((await rawRequest(base, '/', { Host: 'evil.example' })).status, 403);
  for (const path of ['/server.mjs', '/server/club.mjs', '/data/club.sqlite', '/package.json', '/.env', '/src/../server.mjs']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
});

test('CSV export safely preserves quotes and newlines while neutralizing spreadsheet formulas', async t => {
  const { base, store } = await fixture(t);
  const data = store.read();
  const completed = data.orders.find(order => order.status === '已完成');
  const names = ['=HYPERLINK("https://example.invalid","订单")', '客户 "小王",\n下一行'];
  data.orders = names.map((boss, i) => ({ ...completed, id: `csv-order-${i}`, customerId: `csv-customer-${i}`, boss, amountCents: (2 - i) * 100, completedAt: new Date().toISOString() }));
  store.db.prepare('UPDATE club SET data=? WHERE id=1').run(JSON.stringify(data));
  const { token } = store.login('admin', '123456');
  const day = clubDay(Date.now());
  const response = await fetch(`${base}/api/analytics/export?kind=rankings&rankKind=buyers&start=${day}&end=${day}`, { headers: { Cookie: `club_session=${token}` } });
  assert.equal(response.status, 200);
  const { content } = await response.json();
  assert.equal(content, '\uFEFFrank,name,orderCount,amountCents\r\n1,"\'=HYPERLINK(""https://example.invalid"",""订单"")",1,2\r\n2,"客户 ""小王"",\n下一行",1,1');
});

test('production startup requires an HTTPS origin and an explicit persistent database', () => {
  assert.throws(() => createClubServer({ production: true, publicOrigin: '' }), /CLUB_PUBLIC_ORIGIN/);
  for (const publicOrigin of ['http://club.example', 'https://club.example/path', 'https://name:pass@club.example', 'https://club.example?x=1']) {
    assert.throws(() => createClubServer({ production: true, publicOrigin }), /CLUB_PUBLIC_ORIGIN/);
  }
  assert.throws(() => createClubServer({ production: true, publicOrigin: 'https://club.example' }), /CLUB_DATABASE/);
  assert.throws(() => createClubServer({ production: true, publicOrigin: 'https://club.example', database: ':memory:' }), /CLUB_DATABASE/);
});

test('production uses the configured HTTPS host and secure cookies, with separate login failure budgets', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'club-http-production-'));
  const origin = 'https://club.example';
  const { base } = await fixture(t, { production: true, publicOrigin: origin, database: join(folder, 'production.sqlite'), bootstrapAdmin: { username: 'club_owner', password: 'OwnerPassword123!', name: '正式负责人' } }, () => rmSync(folder, { recursive: true, force: true }));
  const headers = { Host: 'club.example', Origin: origin };
  const home = await rawRequest(base, '/', { Host: 'club.example' });
  assert.equal(home.status, 200);
  assert.equal(home.headers['strict-transport-security'], 'max-age=31536000');
  assert.equal((await rawRequest(base, '/', { Host: 'club.example:443' })).status, 200);
  assert.equal((await rawRequest(base, '/', { Host: 'club.example:4173' })).status, 403);
  assert.equal((await rawRequest(base, '/', { Host: 'evil.example', 'X-Forwarded-Host': 'club.example' })).status, 403);
  assert.equal((await proxyPost(base, '/api/login', { username: 'club_owner', password: 'OwnerPassword123!' }, { ...headers, Origin: 'http://club.example' })).status, 403);
  for (let i = 0; i < 10; i++) assert.equal((await proxyPost(base, '/api/login', { username: 'unknown', password: 'wrong' }, headers)).status, 401);
  assert.equal((await proxyPost(base, '/api/login', { username: 'unknown', password: 'wrong' }, headers)).status, 429);
  const login = await proxyPost(base, '/api/login', { username: 'club_owner', password: 'OwnerPassword123!' }, headers);
  assert.equal(login.status, 200);
  assert.match(login.headers['set-cookie'][0], /HttpOnly; SameSite=Strict; Path=\/; Secure; Max-Age=28800/);
  const Cookie = login.headers['set-cookie'][0].split(';')[0];
  assert.equal((await rawRequest(base, '/api/me', { ...headers, Cookie })).status, 200);
  const logout = await proxyPost(base, '/api/logout', {}, { ...headers, Cookie });
  assert.match(logout.headers['set-cookie'][0], /Secure; Max-Age=0/);
  assert.equal((await rawRequest(base, '/api/me', { ...headers, Cookie })).status, 401);
});

test('phone login whitespace aliases share the same production failure budget', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'club-http-phone-'));
  const { base, store } = await fixture(t, { production: true, publicOrigin: 'https://club.example', database: join(folder, 'production.sqlite'), bootstrapAdmin: { username: 'phone_owner', password: 'OwnerPassword123!' } }, () => rmSync(folder, { recursive: true, force: true }));
  const data = store.read();
  data.customers.find(customer => customer.id === data.users[0].customerId).phone = '13800138000';
  store.db.prepare('UPDATE club SET data=? WHERE id=1').run(JSON.stringify(data));
  const headers = { Host: 'club.example', Origin: 'https://club.example' };
  assert.equal((await proxyPost(base, '/api/login', { username: '138 0013 8000', password: 'OwnerPassword123!' }, headers)).status, 200);
  for (let i = 0; i < 10; i++) {
    const username = `138${' '.repeat(i + 1)}00138000`;
    assert.equal((await proxyPost(base, '/api/login', { username, password: 'wrong' }, headers)).status, 401);
  }
  const denied = await proxyPost(base, '/api/login', { username: '13800138000', password: 'wrong' }, headers);
  assert.equal(denied.status, 429);
  assert.ok(Number(denied.headers['retry-after']) > 0);
});

test('readiness checks the database without exposing private data', async t => {
  const { base, store } = await fixture(t);
  const healthy = await fetch(base + '/api/health');
  assert.equal(healthy.status, 200);
  assert.equal(healthy.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await healthy.json(), { ok: true });
  store.db.exec('ALTER TABLE club RENAME TO temporarily_unavailable');
  try {
    const unavailable = await fetch(base + '/api/health');
    assert.equal(unavailable.status, 503);
    assert.deepEqual(await unavailable.json(), { ok: false });
  } finally { store.db.exec('ALTER TABLE temporarily_unavailable RENAME TO club'); }
});

test('graceful shutdown finishes accepted mutations and closes the database once', async t => {
  const { base, store, close, server } = await fixture(t);
  const requestStarted = once(server, 'request');
  const data = Buffer.from(JSON.stringify({ username: 'shutdown_customer', password: 'SafeTest123!' }));
  const response = rawRequest(base, '/api/register', { 'Content-Type': 'application/json', Origin: base }, [data.subarray(0, 20), data.subarray(20)]);
  await requestStarted;
  const stopped = close();
  assert.equal(close(), stopped);
  assert.equal((await response).status, 201);
  await stopped;
  assert.equal(server.listening, false);
  assert.throws(() => store.read(), /not open/);
});
