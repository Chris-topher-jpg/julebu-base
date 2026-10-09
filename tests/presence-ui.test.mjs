import test from 'node:test';
import assert from 'node:assert/strict';
import { accountHeaderActionsMarkup } from '../src/account-header.js';
import { presenceButtonMarkup, createPresenceController } from '../src/presence.js';

test('所有身份的个人和后台导航均提供同一个可访问的状态开关', () => {
  for (const role of ['user', 'member', 'admin', 'service', 'finance', 'examiner', 'afterSales', 'escort']) {
    for (const online of [false, true]) {
      const workspace = { user: { id: role, name: role, role, online } };
      for (const management of [false, true]) {
        const markup = accountHeaderActionsMarkup(workspace, { management });
        assert.match(markup, /role="switch" aria-label="在线状态"/);
        assert.ok(markup.includes(`aria-checked="${online}"`));
        assert.equal((markup.match(/data-presence-control/g) || []).length, 1);
        assert.ok(markup.includes(presenceButtonMarkup(workspace.user)));
      }
    }
  }
});

function fixture() {
  let ctx = { userId: 'user', epoch: 1, online: true };
  let resolve, reject;
  const received = [], pending = [], errors = [], requests = [];
  const controller = createPresenceController({
    context: () => ctx,
    request: body => { requests.push(body); return new Promise((yes, no) => { resolve = yes; reject = no; }); },
    receive: online => { received.push(online); ctx.online = online; },
    onBusy: busy => pending.push(busy),
    onError: error => errors.push(error.message),
  });
  return { controller, received, pending, errors, requests, setContext: value => { ctx = value; }, resolve: value => resolve(value), reject: value => reject(value) };
}

test('状态保存期间阻止重复提交，只在成功回包后更新状态', async () => {
  const f = fixture();
  const pending = f.controller.toggle();
  assert.equal(await f.controller.toggle(), false);
  assert.deepEqual(f.requests, [{ online: false, expectedUserId: 'user' }]);
  assert.deepEqual(f.received, []);
  f.resolve({ id: 'user', online: false, role: 'admin' });
  assert.equal(await pending, true);
  assert.deepEqual(f.received, [false], '只接收在线状态，不合并后台身份等字段');
  assert.deepEqual(f.pending, [true, false]);
});

test('切换账号、退出重登或页面切换后丢弃旧状态回包', async () => {
  for (const next of [null, { userId: 'other', epoch: 1, online: true }, { userId: 'user', epoch: 2, online: true }]) {
    const f = fixture();
    const pending = f.controller.toggle();
    f.setContext(next);
    f.resolve({ id: 'user', online: false });
    assert.equal(await pending, false);
    assert.deepEqual(f.received, []);
    assert.equal(f.controller.busy, false);
  }
});

test('网络失败及身份不匹配不会改动显示状态，重试仍按原状态提交', async () => {
  const f = fixture();
  const first = f.controller.toggle();
  f.reject(new Error('网络断开'));
  assert.equal(await first, false);
  assert.deepEqual(f.received, []);
  assert.deepEqual(f.errors, ['网络断开']);
  const second = f.controller.toggle();
  assert.deepEqual(f.requests[1], { online: false, expectedUserId: 'user' });
  f.resolve({ id: 'other', online: false });
  assert.equal(await second, false);
  assert.deepEqual(f.received, []);
  assert.equal(f.controller.busy, false);
});
