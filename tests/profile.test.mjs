import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClubStore } from '../server/club.mjs';

test('updateProfile is self-only, validates fields, and persists safe public data', t => {
  const store = new ClubStore(':memory:');
  t.after(() => store.close());
  const admin = { id: 'admin' };
  const beforeEscort = store.read().users.find(user => user.id === 'demo-escort');
  const result = store.updateProfile(admin, {
    name: '新管理员', avatar: '/src/escort-14.jpg', bio: '俱乐部管理员', tags: ['管理', '管理'],
    id: 'demo-escort', role: 'escort', balanceCents: 1, passwordHash: 'hostile', online: false,
  });
  assert.equal(result.name, '新管理员');
  const savedAdmin = store.read().users.find(user => user.id === 'admin');
  assert.equal(savedAdmin.name, '新管理员');
  assert.equal(savedAdmin.avatar, '/src/escort-14.jpg');
  assert.deepEqual(savedAdmin.profileTags, ['管理']);
  const afterEscort = store.read().users.find(user => user.id === 'demo-escort');
  assert.equal(afterEscort.name, beforeEscort.name);
  assert.equal(afterEscort.balanceCents, beforeEscort.balanceCents);
  assert.equal(savedAdmin.role, 'admin');
  assert.equal(store.personal(admin).user.name, '新管理员');
  assert.equal(store.workspace(admin).user.name, '新管理员');
  assert.equal('passwordHash' in result, false);
  assert.equal('balanceCents' in result, false);
});

test('updateProfile synchronizes linked customer name without rewriting historical order names', t => {
  const store = new ClubStore(':memory:');
  t.after(() => store.close());
  const user = { id: 'demo-user' };
  const account = store.read().users.find(item => item.id === user.id);
  assert.ok(account.customerId);
  const customer = store.read().customers.find(item => item.id === account.customerId);
  assert.ok(customer);
  const historical = store.read().orders.find(order => order.customerId === customer.id);
  const oldBoss = historical?.boss;
  store.updateProfile(user, { name: '改名用户', avatar: '', bio: '', tags: [] });
  const data = store.read();
  assert.equal(data.customers.find(item => item.id === customer.id).name, '改名用户');
  if (historical) assert.equal(data.orders.find(order => order.id === historical.id).boss, oldBoss);
});

test('updateProfile rejects invalid avatars, lengths, and tag payloads', t => {
  const store = new ClubStore(':memory:');
  t.after(() => store.close());
  const user = { id: 'admin' };
  assert.throws(() => store.updateProfile(user, { name: '管理员', avatar: '/src/escort-00.jpg' }), /头像格式无效/);
  assert.throws(() => store.updateProfile(user, { name: '管理员', avatar: 'data:image/jpeg;base64,SGVsbG8=' }), /有效的 JPEG/);
  assert.throws(() => store.updateProfile(user, { name: '管理员', avatar: `data:image/jpeg;base64,${'A'.repeat(90000)}` }), /头像数据过大/);
  assert.throws(() => store.updateProfile(user, { name: '管理员', bio: 'x'.repeat(241) }), /个人介绍最多/);
  assert.throws(() => store.updateProfile(user, { name: '管理员', tags: ['x'.repeat(25)] }), /个人标签过长/);
  assert.throws(() => store.updateProfile(user, { name: '管理员', tags: ['ok', 3] }), /个人标签格式无效/);
  assert.throws(() => store.updateProfile(user, { name: ' ' }), /昵称不能为空/);
});

test('all roles can update their own profile through profile:update', t => {
  const store = new ClubStore(':memory:');
  t.after(() => store.close());
  for (const account of store.read().users.filter(user => user.active)) {
    const saved = store.updateProfile({ id: account.id }, { name: `${account.name}-新`, avatar: '', bio: '', tags: [] });
    assert.equal(saved.name, `${account.name}-新`);
  }
});
