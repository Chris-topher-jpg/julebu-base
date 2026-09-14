import test from 'node:test';
import assert from 'node:assert/strict';
import { ClubStore } from '../server/club.mjs';

function fixture(t) {
  const store = new ClubStore(':memory:');
  t.after(() => store.close());
  const user = id => store.read().users.find(item => item.id === id);
  const buyer = user('demo-user'), escort = user('escort'), other = user('demo-escort'), service = user('service'), admin = user('admin');
  store.transaction(admin, 'account:manage', '配置会话隐私测试', data => {
    data.customers.find(customer => customer.id === buyer.customerId).phone = '13912345678';
    data.users.find(item => item.id === buyer.id).username = 'private-login-account';
  });
  const open = () => store.conversationCreate(buyer, { context: 'personal', type: 'consultation', escortId: escort.id, message: '你好，我想咨询服务时间' });
  const raw = id => store.read().conversations.find(item => item.id === id);
  const view = (actor, id) => store.workspace(actor).conversations.find(item => item.id === id);
  return { store, buyer, escort, other, service, admin, open, raw, view };
}

test('陪玩收发本人咨询，读取与回复响应均不含工作人员备注或客户私密资料', t => {
  const { store, buyer, escort, service, open, view } = fixture(t);
  const chat = open();
  store.conversationAction(service, chat.id, { note: 'private-staff-note' });
  const initial = view(escort, chat.id);
  const read = store.conversationAction(escort, chat.id, {});
  const sent = store.conversationMessage(escort, chat.id, { message: '可以，今晚八点开始' });
  for (const response of [initial, read, sent]) {
    assert.equal(response.escortId, escort.id);
    assert.equal(response.peer.name, buyer.name);
    assert.equal(response.notes, undefined);
    assert.equal(response.peer.username, undefined);
    assert.equal(response.peer.phone, undefined);
    assert.equal(response.customerId, undefined);
    assert.doesNotMatch(JSON.stringify(response), /private-staff-note|private-login-account|13912345678/);
  }
  const personal = store.personal(buyer).conversations.find(item => item.id === chat.id);
  assert.equal(personal.messages.at(-1).text, '可以，今晚八点开始');
  assert.equal(personal.messages.at(-1).authorId, escort.id);
  assert.equal(personal.unread, 1);
});

test('陪玩不能跨会话、以个人模式冒充买家、访问售后或修改内部状态', t => {
  const { store, escort, other, admin, open, raw, view } = fixture(t);
  const chat = open();
  assert.equal(view(other, chat.id), undefined);
  for (const operation of [
    () => store.conversationAction(other, chat.id, {}),
    () => store.conversationMessage(other, chat.id, { message: '越权消息' }),
    () => store.conversationMessage(escort, chat.id, { context: 'personal', message: '冒充买家' }),
    () => store.conversationAction(escort, chat.id, { state: '已结束' }),
    () => store.conversationAction(escort, chat.id, { note: '越权备注' }),
    () => store.conversationAction(escort, chat.id, { note: '' }),
  ]) assert.throws(operation, { status: 403 });
  assert.equal(raw(chat.id).state, '处理中');
  assert.equal(raw(chat.id).messages.length, 1);
  store.transaction(admin, 'account:manage', '模拟旧售后数据含陪玩 ID', data => { data.conversations.find(item => item.id === chat.id).type = 'support'; });
  assert.equal(view(escort, chat.id), undefined);
  assert.throws(() => store.conversationMessage(escort, chat.id, { message: '售后越权' }), { status: 403 });
  assert.throws(() => store.conversationAction(escort, chat.id, {}), { status: 403 });
  assert.equal(store.notifications(escort).items.some(item => item.entityId === chat.id), false);
});

test('陪玩、客服和买家未读相互独立，重复咨询与客服回复都通知陪玩', t => {
  const { store, buyer, escort, service, open, raw, view } = fixture(t);
  const chat = open();
  assert.equal(view(escort, chat.id).unread, 1);
  store.conversationAction(service, chat.id, {});
  assert.equal(view(escort, chat.id).unread, 1);
  assert.equal(raw(chat.id).staffUnread, 0);
  store.conversationAction(escort, chat.id, {});
  assert.equal(view(escort, chat.id).unread, 0);
  open();
  assert.equal(view(escort, chat.id).unread, 1);
  assert.equal(raw(chat.id).staffUnread, 1);
  store.conversationAction(escort, chat.id, {});
  assert.equal(raw(chat.id).staffUnread, 1);
  store.conversationMessage(service, chat.id, { message: '客服补充安排说明' });
  assert.equal(view(escort, chat.id).unread, 1);
  store.conversationMessage(escort, chat.id, { message: '收到，陪玩本人确认' });
  assert.equal(view(escort, chat.id).unread, 0);
  assert.equal(raw(chat.id).staffUnread, 1);
  assert.equal(raw(chat.id).customerUnread, 2);
  store.conversationAction(buyer, chat.id, { context: 'personal' });
  assert.equal(raw(chat.id).staffUnread, 1);
  assert.equal(raw(chat.id).customerUnread, 0);
  store.conversationMessage(buyer, chat.id, { context: 'personal', message: '买家继续提问' });
  assert.equal(view(escort, chat.id).unread, 1);
  assert.equal(raw(chat.id).staffUnread, 2);
});

test('客户消息通知指定陪玩，陪玩回复通知买家和客服，其他陪玩无通知', t => {
  const { store, buyer, escort, other, service, open } = fixture(t);
  const chat = open();
  const notifications = actor => store.notifications(actor).items.filter(item => item.entityId === chat.id);
  assert.ok(notifications(escort).some(item => item.mode === 'management' && item.page === 'conversations'));
  assert.equal(notifications(other).length, 0);
  const before = notifications(service).length;
  store.conversationMessage(escort, chat.id, { message: '陪玩已回复' });
  assert.ok(notifications(buyer).some(item => item.mode === 'personal' && item.page === 'memberAfterSales'));
  assert.ok(notifications(service).length > before);
  assert.equal(notifications(other).length, 0);
  assert.equal(notifications(escort).length, 1);
});
