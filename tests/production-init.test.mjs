import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ClubStore } from '../server/club.mjs';

test('production store bootstraps explicit admin without demo fixtures', t => {
  const store = new ClubStore(':memory:', { production: true, bootstrapAdmin: { username: 'owner_prod', password: 'StrongPass!2026', name: '正式管理员' } });
  t.after(() => store.close());
  const data = store.read();
  assert.equal(data.deploymentMode, 'production');
  assert.deepEqual(data.users.map(user => user.username), ['owner_prod']);
  assert.equal(data.orders.length, 0);
  assert.equal(store.login('owner_prod', 'StrongPass!2026').user.role, 'admin');
});

test('production store rejects demo database and weak bootstrap credentials', () => {
  assert.throws(() => new ClubStore(':memory:', { production: true, bootstrapAdmin: { username: 'owner_prod', password: '123456' } }), /至少 12 位/);
  const folder = mkdtempSync(join(tmpdir(), 'club-production-'));
  const path = join(folder, 'club.sqlite');
  const demo = new ClubStore(path); demo.close();
  assert.throws(() => new ClubStore(path, { production: true, bootstrapAdmin: { username: 'owner_prod', password: 'StrongPass!2026' } }), /不能使用演示/);
  rmSync(folder, { recursive: true, force: true });
});

test('production-created accounts use the strong password policy', () => {
  const store = new ClubStore(':memory:', { production: true, bootstrapAdmin: { username: 'owner_prod', password: 'StrongPass!2026', name: '正式管理员' } });
  try {
    const admin = { id: store.read().users[0].id };
    assert.throws(() => store.accountAction(admin, null, { username: 'weak_staff', password: 'weakpass1', name: '弱密码员工', role: 'service', active: true, games: [] }), /至少 12 位/);
    const created = store.accountAction(admin, null, { username: 'strong_staff', password: 'StaffPass!2026', name: '正式客服', role: 'service', active: true, games: [] });
    assert.equal(created.username, 'strong_staff');
    assert.equal(store.login('strong_staff', 'StaffPass!2026').user.id, created.id);
  } finally { store.close(); }
});

test('expired sessions are removed and stale presence is cleared', () => {
  const store = new ClubStore(':memory:');
  try {
    const login = store.login('demo_user', 'Test1234!');
    const data = store.read();
    data.users.find(user => user.id === 'demo-user').online = true;
    data.users.find(user => user.id === 'demo-user').presenceSession = true;
    store.db.prepare('UPDATE club SET data=? WHERE id=1').run(JSON.stringify(data));
    store.db.prepare('UPDATE sessions SET expires=? WHERE token=?').run(Date.now() - 1, createHash('sha256').update(login.token).digest('hex'));
    assert.equal(store.cleanupExpiredSessions(), true);
    assert.equal(store.read().users.find(user => user.id === 'demo-user').online, false);
    assert.equal(store.db.prepare('SELECT 1 FROM sessions WHERE expires <= ?').get(Date.now()), undefined);
  } finally { store.close(); }
});
