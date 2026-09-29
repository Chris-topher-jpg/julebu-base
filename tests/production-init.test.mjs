import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
