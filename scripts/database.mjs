import { backup, DatabaseSync } from 'node:sqlite';
import { constants } from 'node:fs';
import { copyFile, mkdir, mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

function verify(db) {
  const rows = db.prepare('PRAGMA quick_check').all();
  if (rows.length !== 1 || Object.values(rows[0])[0] !== 'ok') throw new Error('数据库完整性检查失败');
  const row = db.prepare('SELECT data FROM club WHERE id = 1').get();
  const data = JSON.parse(row?.data || 'null');
  if (!data || !['users', 'orders', 'customers', 'ledger'].every(key => Array.isArray(data[key]))) {
    throw new Error('不是有效的俱乐部数据库');
  }
  return { users: data.users.length, orders: data.orders.length, revision: data.revision || 0 };
}

// SQLite's online backup includes committed WAL data without stopping the server.
// Publish only a verified snapshot, and never replace an existing destination.
export async function snapshotDatabase(source, destination, { restore = false } = {}) {
  const sourcePath = await realpath(resolve(source));
  if (!(await stat(sourcePath)).isFile()) throw new Error('源数据库必须是文件');
  const destinationPath = resolve(destination);
  await mkdir(dirname(destinationPath), { recursive: true });
  const stagingDirectory = await mkdtemp(resolve(dirname(destinationPath), '.club-snapshot-'));
  const stagingPath = resolve(stagingDirectory, 'club.sqlite');
  let sourceDb;
  let snapshot;
  try {
    sourceDb = new DatabaseSync(sourcePath, { readOnly: true });
    sourceDb.exec('PRAGMA busy_timeout=5000');
    verify(sourceDb);
    await backup(sourceDb, stagingPath);
    sourceDb.close();
    sourceDb = undefined;
    snapshot = new DatabaseSync(stagingPath);
    if (restore) {
      // A restored database must not bring old login sessions or cached totals back.
      snapshot.exec('BEGIN IMMEDIATE; DELETE FROM sessions; DELETE FROM analytics_cache; COMMIT;');
    }
    const summary = verify(snapshot);
    snapshot.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;');
    snapshot.close();
    snapshot = undefined;
    await copyFile(stagingPath, destinationPath, constants.COPYFILE_EXCL);
    return { path: destinationPath, ...summary };
  } finally {
    sourceDb?.close();
    snapshot?.close();
    await rm(stagingDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const [command, sourceArg, destinationArg, ...extra] = process.argv.slice(2);
  if (!['backup', 'restore'].includes(command) || extra.length || (command === 'restore' && (!sourceArg || !destinationArg))) {
    throw new Error('用法：node scripts/database.mjs backup [源数据库] [备份文件]\n      node scripts/database.mjs restore <备份文件> <全新数据库路径>');
  }
  const source = sourceArg || process.env.CLUB_DATABASE || resolve(root, 'data/club.sqlite');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = destinationArg || resolve(root, 'backups', `${basename(source, '.sqlite')}-${stamp}.sqlite`);
  const result = await snapshotDatabase(source, destination, { restore: command === 'restore' });
  console.log(`${command === 'restore' ? '恢复完成，旧登录会话已清除' : '备份完成，完整性校验通过'}\n${result.path}\n用户 ${result.users}，订单 ${result.orders}，数据版本 ${result.revision}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.code === 'EEXIST' ? '目标文件已存在，已拒绝覆盖；请使用全新路径。' : error.message);
    process.exitCode = 1;
  });
}
