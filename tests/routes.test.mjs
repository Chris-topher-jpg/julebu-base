import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { parseRoute, resolveRoute } from '../src/routes.js';
import { createClubServer } from '../server.mjs';

test('public routes and legacy anchors resolve to explicit pages', () => {
  for (const hash of ['', '#/', '#/public', '#/public/overview', '#/login', '#/personal', '#/personal/', '#/personal/overview', '#personal/overview']) {
    assert.deepEqual(parseRoute(hash), { mode: 'public', page: 'overview' }, hash);
  }
  assert.deepEqual(parseRoute('#/public/companions'), { mode: 'public', page: 'companions' });
  assert.deepEqual(parseRoute('#/public/guarantees'), { mode: 'public', page: 'guarantees' });
  assert.deepEqual(parseRoute('#members'), { mode: 'public', page: 'companions' });
  assert.deepEqual(parseRoute('#rules'), { mode: 'public', page: 'guarantees' });
  assert.deepEqual(resolveRoute('personal'), { mode: 'public', page: 'overview' });
});

test('unknown public pages fall back to home', () => {
  assert.deepEqual(parseRoute('#/public/unknown'), { mode: 'public', page: 'overview' });
  assert.deepEqual(resolveRoute('public', 'unknown'), { mode: 'public', page: 'overview' });
});

test('explicit personal, order and support pages remain reachable and reloadable', () => {
  for (const page of ['memberProfile', 'placeOrder', 'memberOrders', 'memberAfterSales', 'memberWallet']) {
    assert.deepEqual(parseRoute(`#/personal/${page}`), { mode: 'personal', page });
    assert.deepEqual(resolveRoute('personal', page), { mode: 'personal', page });
  }
});

test('management overview still resolves to the role workspace', () => {
  assert.deepEqual(parseRoute('#/management/overview'), { mode: 'management', page: 'overview' });
  assert.deepEqual(resolveRoute('management'), { mode: 'management', page: 'overview' });
});

test('bare user aliases open the personal center and explicit hashes survive navigation and reload', () => {
  for (const pathname of ['/user', '/user/']) {
    assert.deepEqual(parseRoute('', pathname), { mode: 'personal', page: 'memberProfile' });
    for (const hash of ['#/', '#/public/companions', '#/public/guarantees', '#members', '#/management/overview', '#/management/orders', '#/personal/memberWallet', '#/personal/memberOrders', '#/personal/memberAfterSales', '#/personal/placeOrder']) {
      assert.deepEqual(parseRoute(hash, pathname), parseRoute(hash), `${pathname}${hash}`);
    }
  }
  assert.deepEqual(parseRoute('', '/'), { mode: 'public', page: 'overview' });
  assert.deepEqual(parseRoute('', '/users'), { mode: 'public', page: 'overview' });
});

test('the personal center URL serves the app shell while its data stays protected', async t => {
  const { server } = createClubServer({ database: ':memory:' });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const home = await (await fetch(base + '/')).text();
  for (const path of ['/user', '/user/', '/user?source=profile']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.equal(await response.text(), home);
  }
  const head = await fetch(base + '/user/', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal((await fetch(base + '/api/me')).status, 401);
  assert.equal((await fetch(base + '/user/missing')).status, 404);
});
