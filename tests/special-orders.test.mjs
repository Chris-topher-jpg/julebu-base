import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClubStore } from '../server/club.mjs';
import { catalogAction } from '../server/catalog.mjs';
import { createClubServer } from '../server.mjs';
import { personalCenterMarkup } from '../src/personal.js';
import { productStartingPrice, productUnitPrice, productNeedsLevel, orderHasLevel } from '../src/product-config.js';
import { userById, verifyFixtureUsers } from './real-name-fixture.mjs';

const admin = { id: 'admin' };
const configuredService = (store, overrides = {}) => catalogAction(store, admin, 'products', {
  action: 'save', name: '夜间护航', game: '三角洲行动', unit: '小时', orderType: '护航单',
  pricingMode: 'level', escortCount: 2, priceCents: 8800, guarantee: '100 保 300 万', note: '双人护航，预约开麦', state: '启用', ...overrides,
});

test('special services appear in personal and public catalogs with matching prices', async t => {
  const { server, store } = createClubServer({ database: ':memory:' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const buyer = userById(store, 'demo-user');
  const escort = configuredService(store);
  const fun = configuredService(store, { name: '趣味挑战', orderType: '趣味单', pricingMode: 'fixed', escortCount: 3, priceCents: 7500, note: '自定义趣味玩法' });
  const other = configuredService(store, { name: '训练赛', orderType: '训练单', pricingMode: 'fixed', escortCount: 1, priceCents: 3000 });
  const personal = store.personal(buyer);
  const markup = personalCenterMarkup(personal);
  for (const name of [escort.name, fun.name, other.name]) assert.ok(markup.includes(name));
  assert.ok(markup.includes('100 保 300 万'));
  assert.equal(productUnitPrice(escort, 'gold', personal.gameLevelConfigs, personal.levels), 8800);
  assert.equal(productUnitPrice(escort, 'star', personal.gameLevelConfigs, personal.levels), 8800);
  assert.equal(productUnitPrice(fun, 'gold', personal.gameLevelConfigs, personal.levels), 7500);
  assert.equal(productStartingPrice(fun, personal.gameLevelConfigs, personal.levels), 7500);
  const read = async () => (await fetch(`http://127.0.0.1:${server.address().port}/api/public/catalog`)).json();
  const publicCatalog = await read();
  assert.equal(publicCatalog.products.find(product => product.id === escort.id).priceCents, 8800);
  assert.equal(publicCatalog.products.find(product => product.id === escort.id).pricingMode, 'fixed');
  assert.equal(publicCatalog.products.find(product => product.id === escort.id).guarantee, '100 保 300 万');
  assert.equal(publicCatalog.products.find(product => product.id === fun.id).guarantee, '');
  assert.equal(publicCatalog.products.find(product => product.id === fun.id).priceCents, 7500);
  assert.equal(publicCatalog.products.find(product => product.id === other.id).orderType, '训练单');
  assert.ok(publicCatalog.products.every(product => !('version' in product) && !('customerId' in product)));
  catalogAction(store, admin, 'products', { action: 'state', id: fun.id, version: fun.version, state: '暂停' });
  assert.ok(!(await read()).products.some(product => product.id === fun.id));
});

test('order stores configured type and requires review after any service change', t => {
  const store = new ClubStore(':memory:');
  t.after(() => store.close());
  verifyFixtureUsers(store, ['demo-user']);
  const buyer = userById(store, 'demo-user');
  store.transaction(admin, 'account:manage', '准备特殊订单余额', data => {
    data.customers.find(customer => customer.id === buyer.customerId).balanceCents = 100000;
  });
  const fixed = configuredService(store, { name: '趣味挑战', orderType: '趣味单', pricingMode: 'fixed', escortCount: 3, priceCents: 7500 });
  const input = { context: 'personal', boss: buyer.name, productId: fixed.id, levelId: 'gold', hours: 2, pay: '在线支付', requirement: '测试趣味订单', expectedProductVersion: fixed.version, expectedUnitPriceCents: 7500 };
  const before = store.read();
  const edited = catalogAction(store, admin, 'products', { ...fixed, action: 'save', note: '新玩法规则' });
  assert.throws(() => store.createOrder(buyer, input), { status: 409 });
  assert.deepEqual(store.read().orders, before.orders);
  assert.deepEqual(store.read().customers, before.customers);
  const order = store.createOrder(buyer, { ...input, expectedProductVersion: edited.version });
  assert.equal(order.orderType, '趣味单');
  assert.equal(order.levelRequired, false);
  assert.equal(order.levelId, null);
  assert.equal(order.levelName, '');
  assert.equal(order.guarantee, '');
  assert.equal(order.serviceNote, '新玩法规则');
  assert.equal(order.amountCents, 15000);
  assert.equal(order.participantMin, 3);
  assert.equal(order.participantMax, 3);
  catalogAction(store, admin, 'products', { ...edited, action: 'save', name: '新的趣味玩法', orderType: '训练单', escortCount: 1, priceCents: 9000 });
  assert.equal(store.read().orders.find(item => item.id === order.id).orderType, '趣味单');
  assert.equal(store.personal(buyer).orders.find(item => item.id === order.id).serviceNote, '新玩法规则');
  assert.equal(store.read().orders.find(item => item.id === order.id).amountCents, 15000);
});

test('invalid settings are atomic and configured Delta services survive restart', t => {
  const directory = mkdtempSync(join(tmpdir(), 'club-special-orders-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'club.sqlite');
  const store = new ClubStore(path);
  const original = store.read().products;
  for (const overrides of [{ orderType: '' }, { pricingMode: 'unknown' }, { escortCount: 0 }, { escortCount: 11 }, { guarantee: '' }, { guarantee: ' ' }, { guarantee: '保'.repeat(81) }]) {
    assert.throws(() => configuredService(store, overrides));
    assert.deepEqual(store.read().products, original);
  }
  const service = configuredService(store);
  const standard = store.read().products.find(product => product.name === '1陪1/1陪2');
  catalogAction(store, admin, 'products', { ...standard, version: standard.version ?? 0, action: 'save', escortCount: 3, pricingMode: 'fixed', priceCents: 8000 });
  const dual = store.read().products.find(product => product.name === '2陪1');
  catalogAction(store, admin, 'products', { action: 'delete', id: dual.id, version: dual.version ?? 0 });
  store.close();
  const reopened = new ClubStore(path);
  assert.equal(reopened.read().products.find(product => product.id === service.id).orderType, '护航单');
  assert.equal(reopened.read().products.find(product => product.id === service.id).guarantee, '100 保 300 万');
  assert.equal(reopened.read().products.find(product => product.id === service.id).pricingMode, 'fixed');
  assert.equal(reopened.read().products.find(product => product.id === standard.id).escortCount, 3);
  assert.equal(reopened.read().products.some(product => product.id === dual.id), false);
  reopened.close();
});

test('special orders ignore supplied levels and keep ordinary companion level checks', t => {
  const store = new ClubStore(':memory:');
  t.after(() => store.close());
  verifyFixtureUsers(store, ['demo-user']);
  const buyer = userById(store, 'demo-user');
  store.transaction(admin, 'account:manage', '准备特殊订单测试余额', data => {
    data.customers.find(customer => customer.id === buyer.customerId).balanceCents = 100000;
  });
  for (const type of ['趣味单', '护航单']) {
    const service = configuredService(store, { name: `${type}测试`, orderType: type });
    assert.equal(service.pricingMode, 'fixed');
    assert.equal(productNeedsLevel(service), false);
    for (const levelId of [undefined, 'star', 'not-a-level']) {
      const order = store.createOrder(buyer, { context: 'personal', boss: buyer.name, productId: service.id, levelId, levelRequired: true, guarantee: '伪造保障', hours: 1, pay: '在线支付', requirement: '按配置完成服务' });
      assert.equal(order.amountCents, 8800);
      assert.equal(order.levelRequired, false);
      assert.equal(order.levelId, null);
      assert.equal(order.levelName, '');
      assert.equal(order.guarantee, type === '护航单' ? '100 保 300 万' : '');
    }
  }
  const ordinary = store.read().products.find(product => product.name === '1陪1/1陪2');
  const input = { context: 'personal', boss: buyer.name, productId: ordinary.id, hours: 1, pay: '在线支付', requirement: '普通陪玩服务', levelRequired: false };
  assert.throws(() => store.createOrder(buyer, { ...input, levelId: 'not-a-level' }), /订单等级/);
  const order = store.createOrder(buyer, { ...input, levelId: 'star' });
  assert.equal(order.levelRequired, true);
  assert.equal(order.levelId, 'star');
  assert.equal(orderHasLevel({ levelId: 'gold' }), true, '历史订单保留原等级要求');
});

test('low-level qualified workers can apply, be chosen and accept special orders', t => {
  const store = new ClubStore(':memory:');
  t.after(() => store.close());
  verifyFixtureUsers(store, ['demo-user', 'demo-escort', 'escort']);
  const buyer = userById(store, 'demo-user');
  store.transaction(admin, 'account:manage', '准备特殊订单候选测试', data => {
    for (const id of ['demo-escort', 'escort']) Object.assign(data.users.find(user => user.id === id), { games: ['三角洲行动'], levelId: 'gold', online: true, active: true, escortFrozen: false });
    data.customers.find(customer => customer.id === buyer.customerId).balanceCents = 100000;
  });
  const worker = userById(store, 'demo-escort'), invited = userById(store, 'escort');
  const act = (actor, order, action, extra = {}) => store.orderAction(actor, order.id, action, { version: store.read().orders.find(item => item.id === order.id).version, ...extra });
  for (const type of ['趣味单', '护航单']) {
    const service = configuredService(store, { name: `${type}接单测试`, orderType: type });
    const order = store.createOrder(buyer, { context: 'personal', boss: buyer.name, productId: service.id, levelId: 'star', hours: 1, pay: '在线支付', requirement: '测试特殊服务接单' });
    assert.ok(store.workspace(worker).availableOrders.some(item => item.id === order.id && item.levelRequired === false));
    act(worker, order, 'apply');
    act(userById(store, 'service'), order, 'dispatch', { memberIds: [invited.id] });
    assert.ok(store.personal(buyer).orders.find(item => item.id === order.id).applications.every(item => item.eligible));
    act(buyer, order, 'selectApplicant', { memberIds: [worker.id, invited.id] });
    act(worker, order, 'accept');
    act(invited, order, 'accept');
    assert.equal(store.read().orders.find(item => item.id === order.id).status, '待服务');
  }
  const ordinary = store.read().products.find(product => product.name === '1陪1/1陪2');
  const order = store.createOrder(buyer, { context: 'personal', boss: buyer.name, productId: ordinary.id, levelId: 'star', hours: 1, pay: '在线支付', requirement: '最高等级陪玩要求' });
  assert.equal(store.workspace(worker).availableOrders.some(item => item.id === order.id), false);
  assert.throws(() => act(worker, order, 'apply'), { status: 400 });
  assert.throws(() => act(userById(store, 'service'), order, 'dispatch', { memberIds: [worker.id] }), { status: 400 });
});

test('special matching still enforces game, freeze, verification, online and designated-worker rules', t => {
  const store = new ClubStore(':memory:');
  t.after(() => store.close());
  verifyFixtureUsers(store, ['demo-user', 'demo-escort']);
  const buyer = userById(store, 'demo-user'), worker = userById(store, 'demo-escort');
  store.transaction(admin, 'account:manage', '准备护航资格测试', data => {
    Object.assign(data.users.find(user => user.id === worker.id), { games: ['三角洲行动'], levelId: 'gold', online: true });
    data.customers.find(customer => customer.id === buyer.customerId).balanceCents = 100000;
  });
  const service = configuredService(store, { escortCount: 1 });
  const input = { context: 'personal', boss: buyer.name, productId: service.id, levelId: 'star', hours: 1, pay: '在线支付', requirement: '指定护航服务' };
  const order = store.createOrder(buyer, { ...input, orderMode: 'designated', preferredEscortId: worker.id });
  assert.equal(order.preferredEscortId, worker.id);
  assert.equal(store.workspace(userById(store, 'escort')).availableOrders.some(item => item.id === order.id), false);
  const verified = userById(store, worker.id).realNameVerification;
  for (const changes of [{ games: ['王者荣耀'] }, { escortFrozen: true }, { online: false }, { realNameVerification: { status: 'pending' } }]) {
    store.transaction(admin, 'account:manage', '改变护航候选资格', data => Object.assign(data.users.find(user => user.id === worker.id), { games: ['三角洲行动'], escortFrozen: false, online: true, realNameVerification: verified, ...changes }));
    assert.throws(() => store.orderAction(worker, order.id, 'apply', { version: order.version }));
    assert.equal(store.read().orders.find(item => item.id === order.id).applications.length, 0);
  }
});

test('order guarantee remains unchanged after catalog edits and database restart', t => {
  const directory = mkdtempSync(join(tmpdir(), 'club-guarantee-snapshot-'));
  const path = join(directory, 'club.sqlite');
  const store = new ClubStore(path);
  let reopened;
  t.after(() => {
    if (store.db.isOpen) store.close();
    if (reopened?.db.isOpen) reopened.close();
    rmSync(directory, { recursive: true, force: true });
  });
  verifyFixtureUsers(store, ['demo-user']);
  const buyer = userById(store, 'demo-user');
  const service = configuredService(store);
  const order = store.createOrder(buyer, { context: 'personal', boss: buyer.name, productId: service.id, hours: 1, pay: '在线支付', requirement: '按原保障履约' });
  catalogAction(store, admin, 'products', { ...service, action: 'save', guarantee: '200 保 600 万', priceCents: 15000 });
  assert.equal(store.personal(buyer).orders.find(item => item.id === order.id).guarantee, '100 保 300 万');
  store.close();
  reopened = new ClubStore(path);
  const preserved = reopened.read().orders.find(item => item.id === order.id);
  assert.equal(preserved.guarantee, '100 保 300 万');
  assert.equal(preserved.amountCents, 8800);
  assert.equal(preserved.levelRequired, false);
  assert.equal(preserved.levelId, null);
  assert.equal(reopened.personal(userById(reopened, buyer.id)).orders.find(item => item.id === order.id).levelRequired, false);
  assert.equal(reopened.read().products.find(item => item.id === service.id).guarantee, '200 保 600 万');
});
