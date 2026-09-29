import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClubStore } from '../server/club.mjs';
import { userById, verifyFixtureUsers } from './real-name-fixture.mjs';

function fixture(t) {
  const store = new ClubStore(':memory:');
  t.after(() => store.close());
  verifyFixtureUsers(store, ['demo-user', 'demo-escort']);
  const buyer = userById(store, 'demo-user');
  const worker = userById(store, 'demo-escort');
  const admin = userById(store, 'admin');
  store.transaction(admin, 'account:manage', '准备整小时下单测试', data => {
    data.customers.find(customer => customer.id === buyer.customerId).balanceCents = 1_000_000;
    Object.assign(data.users.find(user => user.id === worker.id), {
      games: ['三角洲行动'], active: true, online: true, levelId: 'gold', escortFrozen: false,
    });
  });
  const product = store.read().products.find(item => item.name === '1陪1/1陪2');
  const input = {
    context: 'personal', boss: buyer.name, productId: product.id, levelId: 'gold',
    pay: '在线支付', requirement: '核验一小时起订及整小时计价',
  };
  return { store, buyer, worker, input };
}

const scenarios = [
  { name: '用户快捷下单', actorId: 'demo-user', orderMode: 'quick' },
  { name: '用户筛选下单', actorId: 'demo-user', orderMode: 'filter' },
  { name: '用户指定陪玩下单', actorId: 'demo-user', orderMode: 'designated' },
  { name: '客服代下单', actorId: 'service', orderMode: 'quick', management: true },
  { name: '管理员代下单', actorId: 'admin', orderMode: 'quick', management: true },
];

function scenarioInput(fixture, scenario, hours) {
  return {
    ...fixture.input, hours, orderMode: scenario.orderMode,
    ...(scenario.orderMode === 'designated' ? { preferredEscortId: fixture.worker.id } : {}),
    ...(scenario.management ? { context: 'management', customerId: fixture.buyer.customerId, pay: '余额支付' } : {}),
  };
}

for (const scenario of scenarios) {
  test(`${scenario.name}拒绝不足一小时、小数时长及超过上限，且不创建订单或扣款`, t => {
    const setup = fixture(t);
    const { store } = setup;
    const actor = userById(store, scenario.actorId);
    const before = store.read();
    for (const hours of [0.5, 1.5, 0, 25]) {
      assert.throws(() => store.createOrder(actor, scenarioInput(setup, scenario, hours)), {
        status: 400, message: /服务时长/,
      }, `不应接受 ${hours} 小时`);
      const after = store.read();
      assert.deepEqual(after.orders, before.orders, `${hours} 小时请求不应产生订单`);
      assert.deepEqual(after.customers, before.customers, `${hours} 小时请求不应修改钱包`);
      assert.deepEqual(after.ledger, before.ledger, `${hours} 小时请求不应产生账单`);
    }
  });

  test(`${scenario.name}接受 1、2、24 小时并按整小时计价扣款`, t => {
    const setup = fixture(t);
    const { store, buyer } = setup;
    const actor = userById(store, scenario.actorId);
    const before = store.read();
    let expectedBalance = before.customers.find(customer => customer.id === buyer.customerId).balanceCents;
    for (const hours of [1, 2, 24]) {
      const order = store.createOrder(actor, scenarioInput(setup, scenario, hours));
      assert.equal(order.hours, hours);
      assert.equal(order.unitPriceCents, 5800);
      assert.equal(order.amountCents, 5800 * hours);
      expectedBalance -= 5800 * hours;
      const after = store.read();
      assert.equal(after.customers.find(customer => customer.id === buyer.customerId).balanceCents, expectedBalance);
      const charges = after.ledger.filter(item => item.source === order.id && item.label === '订单消费');
      assert.equal(charges.length, 1);
      assert.equal(charges[0].deltaCents, -5800 * hours);
    }
    assert.equal(store.read().orders.length, before.orders.length + 3);
  });
}
