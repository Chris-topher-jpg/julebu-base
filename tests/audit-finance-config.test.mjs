import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClubStore } from '../server/club.mjs';
import { verifyFixtureUser } from './real-name-fixture.mjs';

test('等级配置保存价格、递增版本且不改历史订单价格', t => {
  const store = new ClubStore(':memory:');
  t.after(() => store.close());
  const admin = store.read().users.find(user => user.id === 'admin');
  const before = store.read();
  const oldOrder = before.orders[0];
  const config = before.gameLevelConfigs['三角洲行动'];
  const next = config.levels.map((level, index) => ({ ...level, priceCents: 20000 - index * 1000 }));
  const result = store.configureLevels(admin, { game: '三角洲行动', version: config.version, levels: next });
  const after = store.read();
  assert.equal(after.gameLevelConfigs['三角洲行动'].version, config.version + 1);
  assert.deepEqual(after.gameLevelConfigs['三角洲行动'].levels.map(level => level.priceCents), [20000, 19000, 18000, 17000]);
  assert.equal(after.levelPrices.star, 20000);
  assert.equal(result[0].priceCents, 20000);
  assert.deepEqual(after.orders.find(order => order.id === oldOrder.id), oldOrder);
  assert.throws(() => store.configureLevels(admin, { game: '三角洲行动', version: config.version, levels: next }), { status: 409 });
});

test('人工冻结和提现冻结分开统计并写入资金流水', t => {
  const store = new ClubStore(':memory:');
  t.after(() => store.close());
  const admin = store.read().users.find(user => user.id === 'admin');
  const escort = store.read().users.find(user => user.id === 'escort');
  verifyFixtureUser(store, escort);
  store.transaction(admin, 'account:manage', '准备冻结测试账户', data => {
    const target = data.users.find(user => user.id === escort.id);
    target.balanceCents = 20000;
    target.depositCents = 100000;
  });
  const withdrawal = store.withdrawal(escort, { amount: '30.00' });
  const first = store.membershipAction(admin, escort.id, 'freezeBalance', { memberVersion: escort.memberVersion, amountCents: 5000 });
  assert.equal(first.frozenBalanceCents, 5000);
  assert.equal(first.withdrawalFrozenCents, 3000);
  assert.equal(first.frozenCents, 5000);
  assert.equal(store.read().ledger[0].label, '人工冻结');
  const second = store.membershipAction(admin, escort.id, 'unfreezeBalance', { memberVersion: first.memberVersion, amountCents: 5000 });
  assert.equal(second.frozenBalanceCents, 0);
  assert.equal(second.balanceCents, 17000);
  assert.equal(second.withdrawalFrozenCents, 3000);
  assert.equal(store.read().withdrawals.find(item => item.id === withdrawal.id).status, '待审核');
  assert.equal(store.read().ledger[0].label, '人工解冻');
  assert.equal(store.read().ledger[1].label, '人工冻结');
  assert.deepEqual(store.read().ledger.slice(0, 2).map(entry => [entry.deltaCents, entry.afterCents]), [[5000, 17000], [-5000, 12000]]);
  const ledgerCount = store.read().ledger.length;
  assert.throws(() => store.membershipAction(admin, escort.id, 'unfreezeBalance', { memberVersion: second.memberVersion, amountCents: second.withdrawalFrozenCents }), /解冻金额无效/);
  assert.equal(store.read().ledger.length, ledgerCount);
});

test('已使用等级不能删除，新增和改名保留旧订单及价格快照', t => {
  const store = new ClubStore(':memory:');
  t.after(() => store.close());
  const admin = { id: 'admin' };
  const before = store.read();
  const config = before.gameLevelConfigs['三角洲行动'];
  assert.throws(() => store.configureLevels(admin, { game: '三角洲行动', version: config.version, levels: config.levels.filter(level => level.id !== 'gold') }), { status: 409 });
  assert.deepEqual(store.read().gameLevelConfigs['三角洲行动'], config);
  const updated = [{ id: 'legend', name: '传奇', rank: 5, shareBps: 9000, priceCents: 19900 }, ...config.levels.map(level => ({ ...level, name: `${level.name}级` }))];
  store.configureLevels(admin, { game: '三角洲行动', version: config.version, levels: updated });
  const after = store.read();
  assert.equal(after.levels.find(level => level.id === 'legend').rank, 5);
  assert.equal(after.levelPrices.legend, 19900);
  assert.deepEqual(after.orders, before.orders);
  assert.deepEqual(after.users.map(user => user.levelId), before.users.map(user => user.levelId));
});
