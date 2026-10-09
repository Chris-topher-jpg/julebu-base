import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { ClubStore } from '../server/club.mjs';
import { catalogAction } from '../server/catalog.mjs';
import { createClubServer } from '../server.mjs';
import { analyticsOptions, ranking } from '../server/analytics.mjs';

test('all workspaces use club games and reject legacy game choices', t => {
  const store = new ClubStore(':memory:');
  t.after(() => store.close());
  const admin = { id: 'admin' };
  const originalOrders = store.read().orders;
  const check = expected => {
    const names = new Set(expected);
    for (const user of store.read().users.filter(user => user.active)) {
      for (const workspace of [store.workspace(user), store.personal(user)]) {
        assert.deepEqual(workspace.games.map(game => game.name), expected);
        assert.deepEqual(workspace.catalogGames.map(game => game.name), expected);
        assert.ok((workspace.products || []).every(product => names.has(product.game)));
        assert.ok((workspace.members || []).every(member => member.games.every(game => names.has(game))));
        assert.ok((workspace.accounts || []).every(member => member.games.every(game => names.has(game))));
      }
    }
    assert.deepEqual(store.analytics(admin, 'summary').options.games, expected);
  };
  check(['三角洲行动']);
  const game = catalogAction(store, admin, 'games', { action: 'save', name: '123', category: 'FPS', min: 1, max: 3, state: '上架' });
  check(['三角洲行动', '123']);
  const renamed = catalogAction(store, admin, 'games', { ...game, originalName: game.name, name: '456', action: 'save' });
  check(['三角洲行动', '456']);
  const commissions = store.workspace(admin).games.map(game => ({ name: game.name, commissionBps: 7500 }));
  assert.equal(store.configureCommissions(admin, { games: commissions }).length, 2);
  catalogAction(store, admin, 'games', { action: 'delete', originalName: renamed.name, version: renamed.version });
  check(['三角洲行动']);
  assert.throws(() => store.createOrder(admin, { productId: 'product-1' }), /游戏维护中或商品不可售/);
  assert.throws(() => store.configureLevels(admin, { game: '王者荣耀' }), /有效的游戏/);
  assert.throws(() => store.configureLevelPrices(admin, { game: '王者荣耀' }), /有效的游戏/);
  assert.throws(() => catalogAction(store, admin, 'products', { action: 'save', name: '旧游戏服务', game: '王者荣耀', state: '启用' }), /所属游戏不存在/);
  const target = store.read().users.find(user => user.id === 'demo-escort');
  assert.throws(() => store.membershipAction(admin, target.id, 'profile', { memberVersion: target.memberVersion, games: ['王者荣耀'], levelId: 'gold' }), /有效的游戏/);
  assert.deepEqual(store.read().orders, originalOrders);
});

test('analytics Tag options stay synchronized with special-order catalog', t => {
  const store = new ClubStore(':memory:');
  t.after(() => store.close());
  const admin = { id: 'admin' };
  const options = store.analytics(admin, 'summary').options;
  assert.deepEqual(options.tags, ['1陪1/1陪2', '2陪1']);
  assert.deepEqual(options.tagsByGame['三角洲行动'], ['1陪1/1陪2', '2陪1']);
  assert.equal(options.tags.includes('娱乐陪玩'), false);
  assert.equal(options.tags.includes('双排陪玩'), false);

  store.transaction(admin, 'account:manage', '准备历史标签', data => {
    data.orders[0].tags = ['夜间陪玩', '夜间上分', '历史标签'];
  });
  const originalOrders = store.read().orders;
  const created = catalogAction(store, admin, 'products', {
    action: 'save', name: '夜间陪玩', game: '三角洲行动', state: '启用', unit: '小时', priceCents: 8800, note: '夜间时段服务',
  });
  assert.ok(store.analytics(admin, 'summary').options.tags.includes('夜间陪玩'));

  let renamed = catalogAction(store, admin, 'products', {
    action: 'save', ...created, id: created.id, version: created.version, name: '夜间上分', game: created.game, state: created.state, unit: created.unit, priceCents: created.priceCents, note: created.note,
  });
  const renamedOptions = store.analytics(admin, 'summary').options;
  assert.ok(renamedOptions.tags.includes('夜间上分'));
  assert.ok(!renamedOptions.tags.includes('夜间陪玩'));
  assert.ok(!renamedOptions.tags.includes('历史标签'));
  renamed = catalogAction(store, admin, 'products', { action: 'state', id: renamed.id, version: renamed.version, state: '暂停' });
  assert.ok(store.analytics(admin, 'summary').options.tags.includes('夜间上分'), '暂停服务仍在特殊订单模块中');

  const revision = store.read().revision;
  catalogAction(store, admin, 'products', { action: 'delete', id: renamed.id, version: renamed.version });
  const deletedOptions = store.analytics(admin, 'summary').options;
  assert.ok(!deletedOptions.tags.includes('夜间上分'));
  assert.deepEqual(deletedOptions.tagsByGame['三角洲行动'], ['1陪1/1陪2', '2陪1']);
  const synced = store.sync(admin, revision);
  assert.equal(synced.changed, true);
  assert.deepEqual(analyticsOptions(synced.workspace), deletedOptions);
  assert.deepEqual(store.read().orders, originalOrders);
});

test('Tag 按已配置游戏去重，空配置不回填历史标签，改名后仍能查询原订单', () => {
  const data = {
    catalogGames: [{ name: '游戏甲' }, { name: '游戏乙' }],
    products: [
      { id: 'p1', game: '游戏甲', name: '当前服务', state: '启用' },
      { id: 'p2', game: '游戏乙', name: '当前服务', state: '暂停' },
      { id: 'p3', game: '已移除游戏', name: '旧游戏服务', state: '启用' },
    ],
    orders: [{ id: 'order1', productId: 'p1', product: '旧名称', tags: ['旧名称', '历史标签'], game: '游戏甲', status: '已完成', amountCents: 10000, completedAt: '2026-09-11T12:00:00+08:00', participants: [], boss: '测试用户' }],
  };
  const originalOrders = structuredClone(data.orders);
  assert.deepEqual(analyticsOptions(data), {
    games: ['游戏甲', '游戏乙'], tags: ['当前服务'], tagsByGame: { 游戏甲: ['当前服务'], 游戏乙: ['当前服务'] },
  });
  const report = ranking(data, { kind: 'orders', start: '2026-09-11', end: '2026-09-11', tag: '当前服务' }, Date.parse('2026-09-12'));
  assert.equal(report.total, 1);
  assert.equal(report.rows[0].amountCents, 10000);
  data.products = data.products.filter(product => product.id !== 'p1');
  assert.deepEqual(analyticsOptions(data).tagsByGame.游戏甲, []);
  assert.deepEqual(analyticsOptions(data).tags, ['当前服务']);
  data.products = [];
  assert.deepEqual(analyticsOptions(data).tags, []);
  assert.deepEqual(data.orders, originalOrders);
});

test('public catalog is anonymous, current and contains no staff data', async t => {
  const { server, store } = createClubServer({ database: ':memory:' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const read = async () => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/public/catalog`);
    assert.equal(response.status, 200);
    return response.json();
  };
  const initial = await read();
  assert.deepEqual(initial.games.map(game => game.name), ['三角洲行动']);
  assert.equal(initial.users, undefined);
  assert.ok(Array.isArray(initial.members));
  assert.ok(initial.members.every(member => member.game === '三角洲行动'));
  assert.ok(initial.members.every(member => !('balanceCents' in member) && !('phone' in member)));
  assert.ok(initial.games.every(game => !('commissionBps' in game)));
  catalogAction(store, { id: 'admin' }, 'games', { action: 'save', name: '123', category: 'FPS', min: 1, max: 1, state: '上架' });
  assert.deepEqual((await read()).games.map(game => game.name), ['三角洲行动', '123']);
});
