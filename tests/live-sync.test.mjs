import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveSync } from '../src/live-sync.js';

function fixture(t) {
  let current = { userId: 'buyer-a', mode: 'personal', revision: 1, generation: 0, busy: false };
  const requests = [], received = [], statuses = [];
  let expirations = 0;
  const live = createLiveSync({
    context: () => current,
    request: path => new Promise((resolve, reject) => requests.push({ path, resolve, reject })),
    receive: value => received.push(value),
    status: value => statuses.push(value),
    expired: () => { expirations++; },
    interval: 1_000_000,
  });
  t.after(() => live.stop());
  return {
    live, requests, received, statuses,
    change: update => { current = update === null ? null : { ...current, ...update }; },
    expirations: () => expirations,
    respond: async (index, response) => { requests[index].resolve(response); await Promise.resolve(); },
    fail: async (index, error) => { requests[index].reject(error); await Promise.resolve(); },
  };
}

const snapshot = (userId = 'buyer-a', revision = 2) => ({
  changed: true, revision, workspace: { user: { id: userId }, revision, orders: [] },
  notifications: { items: [], unreadCount: 0 },
});

test('同一时刻只发送一份同步请求，无业务变更时仍接收通知和已读状态', async t => {
  const f = fixture(t);
  f.live.start();
  f.live.start();
  await Promise.all([f.live.poll(), f.live.poll(), f.live.poll()]);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].path, '/sync?since=1&context=personal');
  const result = { changed: false, revision: 1, notifications: { items: [{ id: 'notice-1', readAt: null }], unreadCount: 1 } };
  await f.respond(0, result);
  assert.deepEqual(f.received, [result]);
  assert.equal(f.statuses.at(-1), '已同步');
  const next = f.live.poll();
  assert.equal(f.requests.length, 2);
  await f.respond(1, { changed: false, revision: 1, notifications: { items: [{ id: 'notice-1', readAt: '2026-09-13T08:00:00Z' }], unreadCount: 0 } });
  await next;
  assert.equal(f.received.at(-1).notifications.unreadCount, 0);
});

test('切换账号或工作区后丢弃旧回包，并按当前身份重新同步', async t => {
  for (const [label, update] of [
    ['切换账号', { userId: 'staff-b' }],
    ['切换工作区', { mode: 'management' }],
  ]) await t.test(label, async subtest => {
    const f = fixture(subtest);
    f.live.start();
    f.change(update);
    await f.respond(0, snapshot());
    assert.equal(f.received.length, 0);
    assert.equal(f.expirations(), 0);
    const next = f.live.poll();
    assert.equal(f.requests.length, 2);
    assert.match(f.requests[1].path, new RegExp(`context=${update.mode || 'personal'}$`));
    await f.respond(1, snapshot(update.userId || 'buyer-a'));
    await next;
    assert.equal(f.received.length, 1);
  });
});

test('刷新版本、切换代次或提交操作后旧快照不能覆盖当前数据', async t => {
  for (const [label, update] of [
    ['刷新到了新版本', { revision: 5 }],
    ['发生新的界面操作', { generation: 1 }],
    ['正在提交业务操作', { busy: true }],
  ]) await t.test(label, async subtest => {
    const f = fixture(subtest);
    f.live.start();
    f.change(update);
    await f.respond(0, snapshot());
    assert.equal(f.received.length, 0);
    assert.equal(f.statuses.includes('已同步'), false);
    f.change({ busy: false });
    const next = f.live.poll();
    await f.respond(1, snapshot('buyer-a', 6));
    await next;
    assert.equal(f.received.at(-1).revision, 6);
  });
});

test('退出再登录同一账号也丢弃退出前请求，未登录或操作忙碌时不轮询', async t => {
  const f = fixture(t);
  f.live.start();
  f.live.stop();
  f.live.start();
  await f.respond(0, snapshot());
  assert.equal(f.received.length, 0);
  const restarted = f.live.poll();
  await f.respond(1, snapshot());
  await restarted;
  assert.equal(f.received.length, 1);
  f.change({ busy: true });
  await f.live.poll();
  assert.equal(f.requests.length, 2);
  f.change(null);
  await f.live.poll();
  assert.equal(f.requests.length, 2);
  f.live.stop();
  await f.live.poll();
  assert.equal(f.requests.length, 2);
});

test('网络失败可以恢复，当前身份的 401 才触发登录失效', async t => {
  const f = fixture(t);
  f.live.start();
  await f.fail(0, new Error('网络连接中断'));
  assert.equal(f.statuses.at(-1), '连接中断，正在重试');
  assert.equal(f.expirations(), 0);
  const retry = f.live.poll();
  await f.respond(1, snapshot());
  await retry;
  assert.equal(f.received.length, 1);
  assert.equal(f.statuses.at(-1), '已同步');
  const expired = f.live.poll();
  await f.fail(2, Object.assign(new Error('登录过期'), { status: 401 }));
  await expired;
  assert.equal(f.expirations(), 1);
});

test('过时请求的 401 不会清除新身份或显示错误状态', async t => {
  for (const [label, update, stop] of [
    ['切换账号', { userId: 'staff-b' }, false],
    ['更新工作区', { mode: 'management', generation: 1 }, false],
    ['退出会话', null, true],
  ]) await t.test(label, async subtest => {
    const f = fixture(subtest);
    f.live.start();
    if (stop) f.live.stop();
    f.change(update);
    await f.fail(0, Object.assign(new Error('旧会话失效'), { status: 401 }));
    assert.equal(f.expirations(), 0);
    assert.equal(f.received.length, 0);
    assert.deepEqual(f.statuses, ['正在同步']);
  });
});

test('服务端返回其他账号的数据时立即要求重新登录且不接收通知或工作区', async t => {
  const f = fixture(t);
  f.live.start();
  await f.respond(0, snapshot('other-account'));
  assert.equal(f.expirations(), 1);
  assert.equal(f.received.length, 0);
});

test('共享 cookie 切换账号且数据版本未变时也不会把其他账号通知送进旧工作区', async t => {
  const f = fixture(t);
  f.live.start();
  await f.respond(0, {
    userId: 'other-account', changed: false, revision: 1,
    notifications: { items: [{ id: 'other-notice' }], unreadCount: 1 },
  });
  assert.equal(f.expirations(), 1);
  assert.equal(f.received.length, 0);
  assert.equal(f.statuses.includes('已同步'), false);
});
