import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClubStore } from '../server/club.mjs';

function fixture(t) {
  const store = new ClubStore(':memory:');
  t.after(() => store.close());
  const user = id => store.read().users.find(candidate => candidate.id === id);
  const customer = user('demo-user');
  const admin = user('admin');
  const service = user('service');
  const createOrder = (buyer = customer) => store.createOrder(buyer, {
    context: 'personal', productId: store.personal(buyer).products.find(product => product.game === '三角洲行动').id,
    boss: buyer.name, hours: 1, pay: '在线支付', requirement: '售后会话回归测试',
  });
  const contact = order => store.conversationCreate(customer, { context: 'personal', type: 'support', ...(order ? { orderId: order.id } : {}) });
  const chat = id => store.read().conversations.find(candidate => candidate.id === id);
  const notifications = id => store.read().notifications.filter(item => item.kind === 'conversation' && item.entityId === id);
  return { store, user, customer, admin, service, createOrder, contact, chat, notifications };
}

test('订单售后关联本人订单并通知在线客服，同一订单重复点击只建立一次会话', t => {
  const { store, customer, service, createOrder, contact, chat, notifications } = fixture(t);
  const order = createOrder();
  const opened = contact(order);
  assert.equal(opened.orderId, order.id);
  assert.equal(opened.escortName, '在线客服');
  assert.equal(opened.channel, '在线客服');
  assert.equal(opened.state, '处理中');
  assert.equal(opened.messages.length, 1);
  assert.match(opened.messages[0].text, new RegExp(order.id));
  const firstNotifications = notifications(opened.id);
  assert.ok(firstNotifications.some(item => item.recipientId === service.id && item.mode === 'management' && item.orderId === order.id));
  for (let i = 0; i < 3; i++) assert.equal(contact(order).id, opened.id);
  assert.equal(chat(opened.id).messages.length, 1);
  assert.equal(chat(opened.id).staffUnread, 1);
  assert.equal(notifications(opened.id).length, firstNotifications.length);
  assert.equal(store.personal(customer).conversations.find(item => item.id === opened.id).orderId, order.id);
  assert.equal(store.workspace(service).conversations.find(item => item.id === opened.id).peer.customerId, customer.customerId);
});

test('非订单售后、每笔订单售后和陪玩咨询分别建立会话', t => {
  const { store, customer, createOrder, contact } = fixture(t);
  const companion = store.conversationCreate(customer, { escortId: 'escort', message: '想了解陪玩安排' });
  const firstOrder = contact(createOrder());
  const secondOrder = contact(createOrder());
  const general = contact();
  assert.equal(new Set([companion.id, firstOrder.id, secondOrder.id, general.id]).size, 4);
  assert.equal(general.orderId, null);
  assert.equal(contact().id, general.id);
  assert.equal(store.conversationCreate(customer, { escortId: 'escort', message: '补充服务安排' }).id, companion.id);
  assert.equal(store.personal(customer).conversations.find(item => item.id === companion.id).messages.length, 2);
  assert.equal(contact().messages.length, 1);
});

test('关闭售后后再次联系重开原会话，重置响应期限且只通知客服一次', t => {
  const { store, customer, service, createOrder, contact, chat, notifications } = fixture(t);
  const order = createOrder();
  const opened = contact(order);
  store.conversationMessage(service, opened.id, { message: '已核实订单情况' });
  store.conversationAction(service, opened.id, { state: '已结束', note: '仅供内部使用的核验备注' });
  const before = notifications(opened.id).length;
  const reopened = contact(order);
  assert.equal(reopened.id, opened.id);
  assert.equal(reopened.state, '处理中');
  assert.equal(reopened.messages.length, 3);
  assert.equal(chat(opened.id).staffUnread, 1);
  assert.ok(Date.parse(chat(opened.id).slaDueAt) > Date.now());
  assert.equal(reopened.notes, undefined);
  assert.ok(notifications(opened.id).length > before);
  assert.ok(notifications(opened.id).some(item => item.recipientId === service.id && item.mode === 'management'));
  const reopenedNotificationCount = notifications(opened.id).length;
  contact(order);
  assert.equal(chat(opened.id).messages.length, 3);
  assert.equal(notifications(opened.id).length, reopenedNotificationCount);
  store.conversationAction(customer, opened.id, { context: 'personal' });
  assert.equal(store.personal(customer).conversations.find(item => item.id === opened.id).unread, 0);
});

test('订单售后拒绝他人订单、不存在的订单和混用陪玩目标，不暴露订单存在性', t => {
  const { store, user, customer, createOrder, contact } = fixture(t);
  const foreign = createOrder(user('user-demo'));
  const before = store.read();
  const denied = id => {
    let error;
    try { contact({ id }); } catch (caught) { error = caught; }
    assert.ok(error);
    return { status: error.status, message: error.message };
  };
  assert.deepEqual(denied(foreign.id), denied('order-does-not-exist'));
  assert.equal(denied(foreign.id).status, 404);
  assert.throws(() => store.conversationCreate(customer, { type: 'support', escortId: 'escort', orderId: foreign.id }), { status: 400 });
  assert.throws(() => store.conversationCreate(customer, { type: 'support', orderId: {} }), { status: 400 });
  assert.equal(store.read().conversations.length, before.conversations.length);
  assert.equal(store.read().revision, before.revision);
  assert.equal(store.personal(customer).orders.some(order => order.id === foreign.id), false);
});

test('不同用户售后隔离，工作人员从个人入口仅能选择自己订单', t => {
  const { store, user, customer, service, createOrder, contact } = fixture(t);
  const order = createOrder();
  const own = contact(order);
  assert.throws(() => store.conversationMessage(user('user-demo'), own.id, { message: '尝试读取他人会话' }), { status: 403 });
  assert.throws(() => store.conversationCreate(service, { context: 'personal', type: 'support', orderId: order.id }), { status: 404 });
  const personalSupport = store.conversationCreate(service, { context: 'personal', type: 'support' });
  assert.equal(store.personal(service).conversations.some(chat => chat.id === personalSupport.id), true);
  assert.equal(store.personal(customer).conversations.some(chat => chat.id === personalSupport.id), false);
  const serviceNotifications = store.notifications(service).items;
  assert.ok(serviceNotifications.some(item => item.entityId === personalSupport.id && item.mode === 'management'));
});

test('原俱乐部客服咨询兼容新售后入口，历史订单会话可以继续处理', t => {
  const { store, customer, admin, createOrder, contact } = fixture(t);
  const order = createOrder();
  store.transaction(admin, 'account:manage', '准备历史客服会话', data => {
    data.conversations.unshift({ id: 'legacy-general-support', customerId: customer.customerId, userId: customer.id, escortId: 'showcase-old-support', escortName: '俱乐部客服', state: '处理中', messages: [{ text: '原咨询内容', author: customer.name }], notes: [] });
    data.conversations.unshift({ id: 'legacy-order-support', customerId: customer.customerId, orderId: order.id, state: '已结束', messages: [{ text: '原订单咨询', author: customer.name }], notes: ['内部信息'] });
  });
  assert.equal(contact().id, 'legacy-general-support');
  assert.equal(store.conversationCreate(customer, { escortName: '俱乐部客服', message: '重复点击' }).messages.length, 1);
  const reopened = contact(order);
  assert.equal(reopened.id, 'legacy-order-support');
  assert.equal(reopened.state, '处理中');
  assert.equal(reopened.escortName, '在线客服');
  assert.equal(reopened.notes, undefined);
});
