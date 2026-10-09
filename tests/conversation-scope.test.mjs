import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClubStore } from '../server/club.mjs';

test('客服与售后工作区只返回各自类型的会话', t => {
  const store = new ClubStore(':memory:');
  t.after(() => store.close());
  const customer = store.read().users.find(user => user.id === 'demo-user');
  const service = store.read().users.find(user => user.id === 'service');
  const afterSales = store.read().users.find(user => user.id === 'afterSales');
  const consultation = store.conversationCreate(customer, { type: 'consultation', escortName: '俱乐部客服' });
  const support = store.conversationCreate(customer, { type: 'support' });

  assert.equal(store.workspace(service).conversations.some(chat => chat.id === consultation.id), true);
  assert.equal(store.workspace(service).conversations.some(chat => chat.id === support.id), false);
  assert.equal(store.workspace(afterSales).conversations.some(chat => chat.id === support.id), true);
  assert.equal(store.workspace(afterSales).conversations.some(chat => chat.id === consultation.id), false);
  assert.throws(() => store.conversationMessage(service, support.id, { message: '越权回复' }), { status: 403 });
  assert.throws(() => store.conversationMessage(afterSales, consultation.id, { message: '越权回复' }), { status: 403 });

  const serviceNotifications = store.notifications(service).items.filter(item => item.kind === 'conversation');
  const afterSalesNotifications = store.notifications(afterSales).items.filter(item => item.kind === 'conversation');
  assert.equal(serviceNotifications.some(item => item.entityId === support.id), false);
  assert.equal(afterSalesNotifications.some(item => item.entityId === support.id), true);
  assert.equal(serviceNotifications.some(item => item.entityId === consultation.id), true);
  assert.equal(afterSalesNotifications.some(item => item.entityId === consultation.id), false);
});
