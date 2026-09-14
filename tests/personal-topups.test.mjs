import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createClubServer } from '../server.mjs';

test('个人充值申请按本人归属、审核幂等入账并隔离通知同步', async t => {
  const instance = createClubServer({ database: ':memory:' });
  instance.server.listen(0, '127.0.0.1');
  await once(instance.server, 'listening');
  const base = `http://127.0.0.1:${instance.server.address().port}`;
  const cookies = new Map();
  const call = async (who, path, body) => {
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(cookies.has(who) ? { Cookie: cookies.get(who) } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: base }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
  };
  const login = async (who, username, password = 'Test1234!') => {
    const result = await call(who, '/api/login', { username, password });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    cookies.set(who, result.headers.get('set-cookie').split(';')[0]);
    return result.body.user;
  };
  const sync = async (who, since = 0, context = 'personal') => {
    const result = await call(who, `/api/sync?since=${since}&context=${context}`);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body;
  };
  t.after(() => new Promise(resolve => instance.server.close(resolve)));

  const buyer = await login('buyer', 'demo_user');
  const other = await login('other', 'user', '123456');
  await login('finance', 'demo_finance');
  await login('service', 'demo_service');

  const before = await sync('buyer');
  const otherBefore = await sync('other');
  const balanceBefore = before.workspace.wallet.balanceCents;
  const foreignCustomerId = otherBefore.workspace.user.id;
  const buyerCustomerId = instance.store.read().users.find(item => item.id === 'demo-user').customerId;
  let requestNumber = 0;
  const requestId = () => `topup-test-${++requestNumber}`;

  // Only the authenticated user's customer identity is accepted; a forged id is ignored.
  const created = await call('buyer', '/api/topups', {
    amountCents: 12345,
    customerId: foreignCustomerId,
    note: '  充值测试备注  ',
    receiptReference: 'WX-TEST-001',
    paymentChannel: '微信',
    requestId: requestId(),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.amountCents, 12345);
  assert.equal(created.body.customerId, buyerCustomerId);
  assert.equal(created.body.note, '充值测试备注');
  assert.equal((await sync('buyer', before.revision)).workspace.wallet.balanceCents, balanceBefore, '待审核申请不得增加余额');

  // Boundary and malformed amounts are rejected, while one yuan and the upper bound are valid.
  for (const amountCents of [99, 100000001, 100.5, null, {}, '']) {
    assert.equal((await call('buyer', '/api/topups', { amountCents })).status, 400, `invalid amount ${String(amountCents)}`);
  }
  for (const amountCents of [100, 100000000]) {
    const result = await call('buyer', '/api/topups', { amountCents, requestId: requestId() });
    assert.equal(result.status, 201, `boundary amount ${amountCents}`);
  }

  // Personal lists contain only this buyer's records; another account cannot read or mutate them.
  const personal = (await call('buyer', '/api/me')).body;
  assert.ok(personal.topups.some(item => item.id === created.body.id));
  assert.ok(personal.topups.every(item => item.customerId === undefined || item.customerId === buyerCustomerId));
  const otherPersonal = (await call('other', '/api/me')).body;
  assert.equal(otherPersonal.topups.some(item => item.id === created.body.id), false);
  assert.equal((await call('buyer', '/api/topups')).status, 403);
  assert.equal((await call('service', `/api/topups/${created.body.id}`, { action: 'approve', reason: '越权审核' })).status, 403);
  assert.equal((await call('buyer', `/api/topups/${created.body.id}`, { action: 'approve', reason: '越权审核' })).status, 403);

  const financeFeed = await call('finance', '/api/notifications');
  assert.equal(financeFeed.status, 200);
  assert.ok(financeFeed.body.items.some(item => item.kind === 'topup' && item.entityId === created.body.id));

  const approved = await call('finance', `/api/topups/${created.body.id}`, { action: 'approve', reason: '已核验到账' });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.state, '已通过');
  const afterApprove = await sync('buyer', 0);
  assert.equal(afterApprove.workspace.wallet.balanceCents, balanceBefore + 12345);
  assert.equal((await call('finance', `/api/topups/${created.body.id}`, { action: 'approve', reason: '重复审核' })).status, 409);
  assert.equal((await sync('buyer', 0)).workspace.wallet.balanceCents, balanceBefore + 12345, '重复审核不得再次入账');
  const buyerNotices = await call('buyer', '/api/notifications');
  assert.ok(buyerNotices.body.items.some(item => item.kind === 'topup' && item.entityId === created.body.id));

  const rejected = await call('buyer', '/api/topups', { amountCents: 500, note: '将被驳回', requestId: requestId() });
  assert.equal(rejected.status, 201);
  const beforeReject = (await call('buyer', '/api/me')).body.wallet.balanceCents;
  assert.equal((await call('finance', `/api/topups/${rejected.body.id}`, { action: 'reject', reason: '凭证不符' })).status, 200);
  assert.equal((await call('finance', `/api/topups/${rejected.body.id}`, { action: 'reject', reason: '重复驳回' })).status, 409);
  assert.equal((await call('buyer', '/api/me')).body.wallet.balanceCents, beforeReject, '驳回不得入账');

  const otherSync = await sync('other', otherBefore.revision);
  assert.equal(otherSync.workspace.topups.some(item => item.id === created.body.id), false);
  const financeTopups = await call('finance', '/api/topups');
  assert.equal(financeTopups.status, 200);
  assert.ok(financeTopups.body.some(item => item.id === created.body.id));
});
