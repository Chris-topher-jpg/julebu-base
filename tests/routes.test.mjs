import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, resolveRoute } from '../src/routes.js';

test('home and legacy personal overview URLs resolve to the public roster', () => {
  for (const hash of ['', '#/', '#/login', '#/personal', '#/personal/', '#/personal/overview', '#personal/overview']) {
    assert.deepEqual(parseRoute(hash), { mode: 'public', page: 'overview' }, hash);
  }
  assert.deepEqual(resolveRoute('personal'), { mode: 'public', page: 'overview' });
});

test('explicit order and support pages remain reachable and reloadable', () => {
  for (const page of ['placeOrder', 'memberOrders', 'memberAfterSales', 'memberWallet']) {
    assert.deepEqual(parseRoute(`#/personal/${page}`), { mode: 'personal', page });
    assert.deepEqual(resolveRoute('personal', page), { mode: 'personal', page });
  }
});

test('management overview still resolves to the role workspace', () => {
  assert.deepEqual(parseRoute('#/management/overview'), { mode: 'management', page: 'overview' });
  assert.deepEqual(resolveRoute('management'), { mode: 'management', page: 'overview' });
});
