import { randomUUID } from 'node:crypto';
import { requireThat } from './club.mjs';

const timestamp = () => new Date().toISOString();
const reasonOf = input => {
  requireThat(typeof input === 'string' && input.trim().length > 0 && input.trim().length <= 300, '请填写 1–300 字处理依据');
  return input.trim();
};
const step = (item, actor, action, note) => {
  item.version++;
  item.updatedAt = timestamp();
  item.history.push({ action, note, at: item.updatedAt, by: actor.name });
};

export function createCompensation(data, actor, input) {
  const order = data.orders.find(order => order.id === input.orderId);
  requireThat(order, '订单不存在', 404);
  requireThat(actor.role !== 'user' || order.customerId === actor.customerId, '只能申请自己的订单赔偿', 403);
  requireThat(order.customerId && !['未支付', '待支付'].includes(order.paymentStatus) && !['未支付', '待支付'].includes(order.status), '只有已支付订单可以申请赔偿', 409);
  requireThat(Number.isSafeInteger(input.amountCents) && input.amountCents > 0, '赔偿金额必须是有效的正数');
  const reason = reasonOf(input.reason);
  requireThat(typeof input.requestId === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(input.requestId), '赔偿请求无效，请重新打开申请窗口');
  const records = data.compensations ||= [];
  const previous = records.find(item => item.requestId === input.requestId && item.requestedById === actor.id);
  if (previous) {
    requireThat(previous.orderId === order.id && previous.amountCents === input.amountCents && previous.reason === reason, '请求已经提交，请重新确认赔偿申请', 409);
    return previous;
  }
  requireThat(!records.some(item => item.orderId === order.id && item.status === '待审核'), '该订单已有待处理赔偿申请', 409);
  const item = { id: `CP${randomUUID()}`, orderId: order.id, customerId: order.customerId, customer: order.boss, amountCents: input.amountCents, reason, requestId: input.requestId, requestedById: actor.id, requestedAt: timestamp(), status: '待审核', channel: '账户余额', version: 0, history: [] };
  step(item, actor, '提交赔偿申请', reason);
  records.unshift(item);
  return item;
}

export function resolveCompensation(data, actor, id, input) {
  const item = (data.compensations || []).find(item => item.id === id);
  requireThat(item, '赔偿申请不存在', 404);
  requireThat(['approve', 'reject', 'retract'].includes(input.action), '赔偿处理动作无效');
  if (input.action === 'retract') requireThat(actor.role === 'user' && item.customerId === actor.customerId && item.requestedById === actor.id, '只能撤回本人发起的赔偿申请', 403);
  requireThat(input.version === item.version && item.status === '待审核', '赔偿申请已更新或处理，请刷新后查看', 409);
  const note = input.action === 'retract' ? '申请人撤回' : reasonOf(input.reason);
  if (input.action === 'approve') {
    const customer = data.customers.find(customer => customer.id === item.customerId);
    requireThat(customer && Number.isSafeInteger(customer.balanceCents) && Number.isSafeInteger(customer.balanceCents + item.amountCents), '赔偿后余额无效，请核对账户', 409);
    requireThat(!data.ledger.some(entry => entry.source === item.id), '赔偿已经入账', 409);
    customer.balanceCents += item.amountCents;
    data.ledger.unshift({ id: randomUUID(), customerId: customer.id, userId: null, account: customer.name, deltaCents: item.amountCents, afterCents: customer.balanceCents, source: item.id, orderId: item.orderId, label: '售后赔偿', by: actor.name, at: timestamp() });
    item.status = '已到账'; item.paidAt = timestamp();
  } else item.status = input.action === 'reject' ? '已驳回' : '已撤回';
  item.reviewNote = note; item.reviewedAt = timestamp();
  step(item, actor, input.action === 'approve' ? '财务核准，赔偿到账' : item.status, note);
  return item;
}

export const personalCompensations = (data, user) => (data.compensations || []).filter(item => item.customerId === user.customerId).map(item => ({
  id: item.id, orderId: item.orderId, amountCents: item.amountCents, reason: item.reason, status: item.status, channel: item.channel,
  version: item.version, requestedAt: item.requestedAt, updatedAt: item.updatedAt, paidAt: item.paidAt, reviewNote: item.reviewNote || '',
  canRetract: item.status === '待审核' && item.requestedById === user.id,
  history: item.history.map(({ action, note, at }) => ({ action, note, at })),
}));
