import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClubStore } from '../server/club.mjs';

test('客服与售后会话使用稳定身份资料，只有明确关联订单才展示订单', t => {
  const store = new ClubStore(':memory:');
  t.after(() => store.close());
  const admin = store.read().users.find(user => user.id === 'admin');
  const login = store.register({ username: 'chat_namesake', password: 'testing123', name: '林先生' });
  const namesake = store.session(login.token);
  const consultation = store.conversationCreate(namesake, { escortId: 'escort', message: '我还没有下单，想先咨询。' });
  const linkedOrder = store.read().orders.find(order => order.customerId === 'customer-3');
  assert.ok(linkedOrder);
  store.transaction(admin, 'account:manage', '准备会话身份测试', data => {
    for (const details of [
      { id: 'chat-known-unlinked', customerId: 'customer-3' },
      { id: 'chat-legacy-name' },
      { id: 'chat-order-only', orderId: linkedOrder.id },
      { id: 'chat-user-only', userId: namesake.id },
    ]) data.conversations.push({ boss: '林先生', state: '处理中', notes: [], messages: [], ...details });
  });

  for (const id of ['admin', 'service', 'afterSales']) {
    const workspace = store.workspace({ id });
    const chat = chatId => workspace.conversations.find(item => item.id === chatId);
    const fresh = chat(consultation.id);
    assert.equal(fresh.orderId, undefined);
    assert.deepEqual(fresh.peer, {
      customerId: namesake.customerId, userId: namesake.id, customerNo: namesake.memberNo,
      name: '林先生', username: 'chat_namesake', phone: '',
    });
    assert.deepEqual(chat('chat-user-only').peer, fresh.peer);
    assert.equal(chat('chat-known-unlinked').orderId, undefined);
    assert.equal(chat('chat-known-unlinked').peer.customerId, 'customer-3');
    assert.equal(chat('chat-known-unlinked').peer.phone, '136****0003');
    assert.deepEqual(chat('chat-legacy-name').peer, {
      customerId: '', userId: '', customerNo: '', name: '林先生', username: '', phone: '',
    });
    assert.equal(chat('chat-legacy-name').orderId, undefined);
    assert.equal(chat('chat-order-only').orderId, linkedOrder.id);
    assert.equal(chat('chat-order-only').peer.customerId, 'customer-3');
    assert.equal(chat('chat-order-only').peer.phone, '136****0003');
    for (const item of workspace.conversations) {
      assert.deepEqual(Object.keys(item.peer).sort(), ['customerId', 'customerNo', 'name', 'phone', 'userId', 'username']);
    }
    if (id === 'afterSales') {
      for (const key of ['customers', 'accounts', 'wallet', 'ledger']) assert.equal(workspace[key], undefined);
    }
  }

  const sent = store.conversationMessage({ id: 'service', role: 'service' }, consultation.id, { message: '你好，请问想了解哪项服务？' });
  assert.equal(sent.peer.customerId, namesake.customerId);
  const followed = store.conversationAction({ id: 'afterSales' }, consultation.id, { note: '已解答咨询', state: '处理中' });
  assert.deepEqual(followed.peer, sent.peer);
  assert.equal(store.conversationMessage(namesake, consultation.id, { message: '谢谢' }).peer, undefined);
  assert.equal(store.personal(namesake).conversations.find(item => item.id === consultation.id).peer, undefined);
  assert.equal(store.read().conversations.find(item => item.id === consultation.id).peer, undefined);
});
