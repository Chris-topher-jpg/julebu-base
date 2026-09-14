import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClubStore } from '../server/club.mjs';
import { addFixtureGames } from './catalog-fixture.mjs';
import { verifyFixtureUsers } from './real-name-fixture.mjs';

test('管理员改价后个人目录使用实时等级价，下单金额与余额实扣一致且不暴露分成', t => {
  const store = new ClubStore(':memory:');
  t.after(() => store.close());
  verifyFixtureUsers(store, ['demo-user']);
  const data = store.read();
  const admin = data.users.find(user => user.id === 'admin');
  const customer = data.users.find(user => user.id === 'demo-user');
  const product = data.products.find(item => item.game === '三角洲行动' && item.state === '启用');
  const originalGoldPrice = data.levelPrices.gold;
  const prices = { ...data.levelPrices, gold: 7001, star: 12345 };
  store.configureLevelPrices(admin, { version: data.levelPriceVersion, prices });

  const catalog = store.personal(customer);
  assert.ok(catalog.catalogGames.some(game => game.name === product.game));
  assert.ok(catalog.levels.every(level => level.shareBps === undefined));
  assert.ok(catalog.gameLevelConfigs[product.game].levels.every(level => level.shareBps === undefined));
  assert.equal(catalog.products.find(item => item.id === product.id).priceCents, product.priceCents);
  const beforeStaleAttempt = store.personal(customer).wallet.balanceCents;
  const orderCountBeforeStaleAttempt = store.read().orders.length;
  assert.throws(() => store.createOrder(customer, {
    context: 'personal', boss: customer.name, productId: product.id, levelId: 'gold',
    hours: 1, pay: '在线支付', requirement: '旧价格不应继续扣款', expectedUnitPriceCents: originalGoldPrice,
  }), { status: 409 });
  assert.equal(store.personal(customer).wallet.balanceCents, beforeStaleAttempt);
  assert.equal(store.read().orders.length, orderCountBeforeStaleAttempt);
  for (const expectedUnitPriceCents of [-1, 0, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null, '7001', true, {}, []]) {
    assert.throws(() => store.createOrder(customer, {
      context: 'personal', boss: customer.name, productId: product.id, levelId: 'gold',
      hours: 1, pay: '在线支付', requirement: '拒绝伪造确认价格', expectedUnitPriceCents,
    }), { status: 400 });
  }
  assert.equal(store.personal(customer).wallet.balanceCents, beforeStaleAttempt);
  assert.equal(store.read().orders.length, orderCountBeforeStaleAttempt);
  for (const levelId of ['gold', 'star']) {
    const level = catalog.levels.find(item => item.id === levelId);
    assert.equal(level.priceCents, prices[levelId]);
    const before = store.personal(customer).wallet.balanceCents;
    const order = store.createOrder(customer, {
      context: 'personal', boss: customer.name, productId: product.id, levelId,
      hours: 1.5, pay: '在线支付', requirement: '核验改价后的个人目录与实际扣款',
      expectedUnitPriceCents: level.priceCents,
    });
    const quotedCents = Math.round(level.priceCents * 1.5);
    assert.equal(order.unitPriceCents, level.priceCents);
    assert.equal(order.amountCents, quotedCents);
    assert.equal(before - store.personal(customer).wallet.balanceCents, quotedCents);
    assert.equal(store.personal(customer).ledger.find(entry => entry.source === order.id).deltaCents, -quotedCents);
  }
});

test('个人下单按游戏配置报价并保留其他商品定价', t => {
  const store = new ClubStore(':memory:');
  t.after(() => store.close());
  addFixtureGames(store, ['王者荣耀', '无畏契约']);
  verifyFixtureUsers(store, ['demo-user']);
  const data = store.read();
  const admin = data.users.find(user => user.id === 'admin');
  const buyer = data.users.find(user => user.id === 'demo-user');
  store.configureLevels(admin, { game: '王者荣耀', version: 1, levels: data.levels });
  store.configureLevelPrices(admin, { game: '王者荣耀', version: 1, prices: { star: 14000, demon: 12000, peak: 10000, gold: 7001 } });
  const catalog = store.personal(buyer);
  const configuredPrice = catalog.gameLevelConfigs['王者荣耀'].levels.find(level => level.id === 'gold').priceCents;
  assert.equal(configuredPrice, 7001);
  assert.ok(catalog.gameLevelConfigs['王者荣耀'].levels.every(level => !('shareBps' in level)));
  const before = catalog.wallet.balanceCents;
  const order = store.createOrder(buyer, {
    context: 'personal', boss: buyer.name, productId: 'product-1', levelId: 'gold', hours: 1.5,
    pay: '在线支付', requirement: '核验分游戏价格', expectedUnitPriceCents: configuredPrice,
  });
  assert.equal(order.amountCents, Math.round(7001 * 1.5));
  assert.equal(store.personal(buyer).wallet.balanceCents, before - order.amountCents);
  const other = catalog.products.find(product => product.id === 'product-2');
  const otherOrder = store.createOrder(buyer, {
    context: 'personal', boss: buyer.name, productId: other.id, levelId: 'gold', hours: 1,
    pay: '在线支付', requirement: '未配置游戏使用商品价', expectedUnitPriceCents: other.priceCents,
  });
  assert.equal(otherOrder.amountCents, other.priceCents);
});
