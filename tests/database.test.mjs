import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { snapshotDatabase } from '../scripts/database.mjs';

test('在线备份包含 WAL 中的提交，恢复保留业务并清除旧会话，拒绝覆盖原文件', async t => {
  const folder = await mkdtemp(resolve(tmpdir(), 'club-backup-test-'));
  const source = resolve(folder, 'source.sqlite');
  const target = resolve(folder, 'backup.sqlite');
  const restored = resolve(folder, 'restored.sqlite');
  const db = new DatabaseSync(source);
  t.after(() => db.close());
  t.after(() => rm(folder, { recursive: true, force: true }));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE club (id INTEGER PRIMARY KEY, data TEXT); CREATE TABLE sessions (token TEXT); CREATE TABLE analytics_cache (key TEXT);');
  const business = { users: [{ id: 'owner' }], orders: [{ id: 'paid-order', amountCents: 12345 }], customers: [], ledger: [{ amountCents: 12345 }], revision: 17 };
  db.prepare('INSERT INTO club VALUES (1, ?)').run(JSON.stringify(business));
  db.exec("INSERT INTO sessions VALUES ('old-session'); INSERT INTO analytics_cache VALUES ('old-total');");
  await access(`${source}-wal`);
  const result = await snapshotDatabase(source, target);
  assert.equal(result.revision, 17);
  const before = await readFile(target);
  await assert.rejects(snapshotDatabase(source, target), { code: 'EEXIST' });
  assert.deepEqual(await readFile(target), before);
  await snapshotDatabase(target, restored, { restore: true });
  const restoredDb = new DatabaseSync(restored, { readOnly: true });
  try {
    assert.deepEqual(JSON.parse(restoredDb.prepare('SELECT data FROM club').get().data), business);
    assert.equal(restoredDb.prepare('SELECT count(*) AS n FROM sessions').get().n, 0);
    assert.equal(restoredDb.prepare('SELECT count(*) AS n FROM analytics_cache').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM sessions').get().n, 1);
  } finally { restoredDb.close(); }
});

test('源文件缺失或内容损坏时不产生可用备份，也不会初始化源文件', async t => {
  const folder = await mkdtemp(resolve(tmpdir(), 'club-backup-invalid-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const missing = resolve(folder, 'missing.sqlite');
  const target = resolve(folder, 'backup.sqlite');
  await assert.rejects(snapshotDatabase(missing, target), { code: 'ENOENT' });
  await assert.rejects(access(missing), { code: 'ENOENT' });
  const invalid = new DatabaseSync(resolve(folder, 'invalid.sqlite'));
  invalid.close();
  await assert.rejects(snapshotDatabase(resolve(folder, 'invalid.sqlite'), target));
  await assert.rejects(access(target), { code: 'ENOENT' });
});
