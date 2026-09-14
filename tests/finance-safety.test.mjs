import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClubStore } from '../server/club.mjs';
import { walletPayment } from '../server/flow.mjs';
import { addFixtureGames } from './catalog-fixture.mjs';

function fixture(t) {
  const store = new ClubStore(':memory:');
  t.after(() => store.close());
  addFixtureGames(store, ['王者荣耀']);
  const user = id => store.read().users.find(item => item.id === id);
  const admin = user('admin'), buyer = user('demo-user'), escort = user('demo-escort'), finance = user('finance'), afterSales = user('afterSales');
  const update = (actor, order, action, input = {}) => store.orderAction(actor, order.id, action, { version: store.read().orders.find(item => item.id === order.id).version, ...input });
  const create = (offline = false) => store.createOrder(offline ? admin : buyer, { ...(offline ? { customerId: buyer.customerId } : { context: 'personal' }), boss: buyer.name, productId: 'product-1', hours: 1, pay: offline ? '线下已收款' : '在线支付', requirement: '资金链路验证服务', levelId: 'gold' });
  const start = order => { update(escort, order, 'apply'); update(buyer, order, 'selectApplicant', { context: 'personal', memberIds: [escort.id] }); update(escort, order, 'accept'); update(escort, order, 'start'); };
  const finish = order => { start(order); update(escort, order, 'finish', { evidence: '约定服务已经完成，申请客户验收' }); update(buyer, order, 'approve', { context: 'personal' }); };
  const request = (order, amountCents = order.amountCents) => store.createRefund(buyer, { context: 'personal', orderId: order.id, amountCents, reason: '服务存在问题，申请售后处理' });
  const fundEscort = (amountCents = 20000) => store.transaction(admin, 'account:manage', '准备测试收益', data => { data.users.find(item => item.id === escort.id).balanceCents = amountCents; });
  return { store, user, admin, buyer, escort, finance, afterSales, update, create, start, finish, request, fundEscort };
}

test('服务中可申请售后，期间暂停履约，驳回保留申请原因并恢复原阶段', t => {
  const { store, admin, buyer, escort, create, start, request, update } = fixture(t);
  const order = create(); start(order);
  const refund = request(order, 1000);
  assert.equal(refund.originalStatus, '陪玩中');
  assert.throws(() => update(escort, order, 'finish', { evidence: '售后中不能直接继续结算' }), { status: 409 });
  assert.throws(() => request(order), { status: 409 });
  const rejected = store.reviewRefund(admin, refund.id, { action: 'reject', reason: '双方协商继续服务' });
  assert.equal(rejected.reason, refund.reason);
  assert.equal(rejected.reviewNote, '双方协商继续服务');
  assert.equal(store.read().orders.find(item => item.id === order.id).status, '陪玩中');
  const replacement = request(order, 1000);
  const balance = store.personal(buyer).wallet.balanceCents;
  store.reviewRefund(admin, replacement.id, { action: 'approve' });
  assert.equal(store.personal(buyer).wallet.balanceCents, balance + 1000);
  assert.equal(store.read().orders.find(item => item.id === order.id).status, '陪玩中');
  update(escort, order, 'finish', { evidence: '已继续完成约定服务' });
  const settled = update(buyer, order, 'approve', { context: 'personal' });
  assert.equal(settled.participants[0].earningCents, Math.round((order.amountCents - 1000) * settled.participants[0].shareBps / 10000));
});

test('线下退款审核仅进入待付款，财务登记凭证后才退款并冲回已结算收益', t => {
  const { store, buyer, finance, afterSales, escort, create, finish, request } = fixture(t);
  const order = create(true); finish(order);
  const balance = store.personal(buyer).wallet.balanceCents;
  const income = store.workspace(escort).wallet.balanceCents;
  const refund = request(order);
  const approved = store.reviewRefund(afterSales, refund.id, { action: 'approve', reason: '服务问题核验属实' });
  assert.equal(approved.status, '待线下退款');
  assert.equal(store.read().orders.find(item => item.id === order.id).refundedCents || 0, 0);
  assert.equal(store.read().orders.find(item => item.id === order.id).status, '退款审核');
  assert.equal(store.workspace(escort).wallet.balanceCents, income);
  assert.equal(store.personal(buyer).wallet.balanceCents, balance);
  assert.throws(() => store.withdrawal(escort, { amount: '1' }), { status: 409 });
  assert.throws(() => request(order), { status: 409 });
  assert.throws(() => store.reviewRefund(afterSales, refund.id, { action: 'markPaid', payoutRef: 'RF-BANK-1' }), { status: 403 });
  assert.throws(() => store.reviewRefund(finance, refund.id, { action: 'markPaid' }), { status: 400 });
  const paid = store.reviewRefund(finance, refund.id, { action: 'markPaid', payoutRef: 'RF-BANK-1' });
  assert.equal(paid.status, '已退款');
  assert.ok(paid.paidAt);
  assert.equal(store.read().orders.find(item => item.id === order.id).status, '已退款');
  assert.equal(store.workspace(escort).wallet.balanceCents, 0);
  assert.equal(store.personal(buyer).wallet.balanceCents, balance, '线下退款不能再增加客户余额');
  const ledger = store.read().ledger.find(item => item.source === refund.id && item.label === '线下订单退款');
  assert.equal(ledger.deltaCents, 0);
  assert.equal(ledger.externalAmountCents, -order.amountCents);
  assert.equal(ledger.payoutRef, 'RF-BANK-1');
  assert.throws(() => store.reviewRefund(finance, refund.id, { action: 'markPaid', payoutRef: 'RF-BANK-1' }), { status: 409 });
});

test('未打款的线下退款可以撤销审核，既不扣分成也不增加已退金额', t => {
  const { store, admin, create, request } = fixture(t);
  const order = create(true), refund = request(order, 1000);
  store.reviewRefund(admin, refund.id, { action: 'approve' });
  const rejected = store.reviewRefund(admin, refund.id, { action: 'reject', reason: '用户决定继续服务，取消退款' });
  assert.equal(rejected.status, '已驳回');
  assert.equal(store.read().orders.find(item => item.id === order.id).status, order.status);
  assert.equal(store.read().orders.find(item => item.id === order.id).refundedCents || 0, 0);
  assert.equal(store.read().ledger.some(item => item.source === refund.id), false);
});

test('退款可通过撤销待打款提现释放收益完成，售后中不能继续打款', t => {
  const { store, admin, escort, create, finish, request } = fixture(t);
  const order = create(); finish(order);
  const income = store.workspace(escort).wallet.balanceCents;
  const withdrawal = store.withdrawal(escort, { amount: (income / 100).toFixed(2) });
  store.reviewWithdrawal(admin, withdrawal.id, { action: 'approve' });
  const refund = request(order);
  assert.throws(() => store.reviewWithdrawal(admin, withdrawal.id, { action: 'markPaid', payoutRef: 'BANK-BLOCKED' }), { status: 409 });
  const snapshot = store.read();
  assert.throws(() => store.reviewRefund(admin, refund.id, { action: 'approve' }), { status: 409 });
  assert.deepEqual(store.read(), snapshot, '失败退款应原子回滚');
  store.reviewWithdrawal(admin, withdrawal.id, { action: 'reject', reason: '释放余额处理订单退款' });
  assert.equal(store.workspace(escort).wallet.frozenCents, 0);
  assert.equal(store.workspace(escort).wallet.balanceCents, income);
  assert.throws(() => store.reviewWithdrawal(admin, withdrawal.id, { action: 'reject', reason: '不得重复返还' }), { status: 409 });
  store.reviewRefund(admin, refund.id, { action: 'approve' });
  assert.equal(store.workspace(escort).wallet.balanceCents, 0);
});

test('提现与退款共同拒绝重复打款凭证，提现付款只扣一次可用余额', t => {
  const { store, admin, escort, create, request, fundEscort } = fixture(t);
  fundEscort();
  const withdrawal = store.withdrawal(escort, { amount: '10' });
  store.reviewWithdrawal(admin, withdrawal.id, { action: 'approve' });
  assert.throws(() => store.withdrawal(escort, { amount: '10' }), { status: 409 });
  store.reviewWithdrawal(admin, withdrawal.id, { action: 'markPaid', payoutRef: ' Bank-Unique-01 ' });
  assert.equal(store.workspace(escort).wallet.balanceCents, 19000);
  const payout = store.read().ledger.find(item => item.source === withdrawal.id && item.label === '提现打款');
  assert.equal(payout.externalAmountCents, -1000);
  assert.equal(payout.deltaCents, 0);
  const next = store.withdrawal(escort, { amount: '10' });
  store.reviewWithdrawal(admin, next.id, { action: 'approve' });
  assert.throws(() => store.reviewWithdrawal(admin, next.id, { action: 'markPaid', payoutRef: 'bank-unique-01' }), { status: 409 });
  const refund = request(create(true));
  store.reviewRefund(admin, refund.id, { action: 'approve' });
  assert.throws(() => store.reviewRefund(admin, refund.id, { action: 'markPaid', payoutRef: 'BANK-UNIQUE-01' }), { status: 409 });
  store.reviewWithdrawal(admin, next.id, { action: 'reject', reason: '凭证错误，取消本次提现' });
  assert.equal(store.workspace(escort).wallet.balanceCents, 19000);
});

test('充值幂等包含付款信息，同一交易单号不得跨申请或跨用户重复入账', t => {
  const { store, user, admin, buyer } = fixture(t);
  const input = { amountCents: 1000, note: '银行转账', paymentChannel: '银行', receiptReference: 'BANK-CREDIT-01', requestId: 'finance-topup-01' };
  const before = store.personal(buyer).wallet.balanceCents;
  const created = store.createTopup(buyer, input);
  assert.equal(store.createTopup(buyer, input).id, created.id);
  assert.throws(() => store.createTopup(buyer, { ...input, receiptReference: 'changed-reference' }), { status: 409 });
  assert.throws(() => store.createTopup(user('user-demo'), { ...input, requestId: 'finance-topup-02', receiptReference: ' bank-credit-01 ' }), { status: 409 });
  const pending = store.createTopup(buyer, { amountCents: 1000, requestId: 'finance-topup-03' });
  assert.throws(() => store.topupAction(admin, pending.id, { action: 'approve', reason: '缺少交易凭证' }), { status: 400 });
  store.topupAction(admin, created.id, { action: 'approve', reason: '核验真实到账' });
  assert.throws(() => store.topupAction(admin, pending.id, { action: 'approve', reason: '重复使用凭证', receiptReference: 'bank-credit-01' }), { status: 409 });
  assert.equal(store.personal(buyer).wallet.balanceCents, before + 1000);
  assert.equal(store.read().ledger.filter(item => item.source === created.id && item.label === '充值入账').length, 1);
  store.topupAction(admin, pending.id, { action: 'approve', reason: '另一笔真实到账', receiptReference: 'BANK-CREDIT-02' });
  assert.equal(store.personal(buyer).wallet.balanceCents, before + 2000);
  assert.equal(store.createTopup(buyer, { amountCents: 1000, requestId: 'finance-topup-03' }).id, pending.id, '财务补全凭证后重试原始请求仍幂等');
});

test('充值审核不根据未关联申请捏造客户和期初余额，退款金额不接受布尔等隐式转换', t => {
  const { store, admin, buyer, create, request } = fixture(t);
  store.transaction(admin, 'account:manage', '准备历史孤立充值申请', data => {
    data.topups.unshift({ id: 'ORPHAN-TOPUP', user: '未关联的同名用户', state: '待审核', before: '¥ 999999.00', amountCents: 10000 });
  });
  const snapshot = store.read();
  assert.throws(() => store.topupAction(admin, 'ORPHAN-TOPUP', { action: 'approve', reason: '不可创建虚假期初余额', receiptReference: 'ORPHAN-RECEIPT' }), { status: 409 });
  assert.deepEqual(store.read(), snapshot);
  const order = create();
  for (const amountCents of [true, '100', null, 0.1, -100]) assert.throws(() => request(order, amountCents), { status: 400 });
  store.transaction(admin, 'account:manage', '模拟旧版未支付订单', data => { data.orders.find(item => item.id === order.id).paymentStatus = '待支付'; });
  assert.throws(() => store.createRefund(buyer, { context: 'personal', orderId: order.id, amountCents: 100, reason: '未付款不可退款' }), { status: 409 });
  assert.equal(walletPayment({ paymentSource: 'offline', pay: '在线支付' }), false);
  assert.equal(walletPayment({ paymentSource: 'wallet', pay: '线下已收款' }), true);
});

test('连续小额退款按累计净额计算分成，最后一笔全退不会遗留分币收益', t => {
  const { store, admin, buyer, escort, create, finish, request } = fixture(t);
  const before = store.personal(buyer).wallet.balanceCents;
  const order = create(); finish(order);
  let refunded = 0;
  for (const amountCents of [1, 1, 1, 1, order.amountCents - 4]) {
    const refund = request(order, amountCents);
    store.reviewRefund(admin, refund.id, { action: 'approve' });
    refunded += amountCents;
    const current = store.read().orders.find(item => item.id === order.id);
    assert.equal(current.refundedCents, refunded);
    assert.equal(store.workspace(escort).wallet.balanceCents, Math.round((order.amountCents - refunded) * current.participants[0].shareBps / 10000));
  }
  assert.equal(store.personal(buyer).wallet.balanceCents, before);
  assert.equal(store.read().orders.find(item => item.id === order.id).status, '已退款');
});

test('服务中退款待审核仍占用陪玩，阻止开始或转派另一单，驳回后释放占用', t => {
  const { store, admin, buyer, escort, create, update, request } = fixture(t);
  const first = create(true);
  store.transaction(admin, 'account:manage', '准备直接派单测试', data => { data.orders.find(item => item.id === first.id).selectionRequired = false; });
  update(escort, first, 'accept');
  update(escort, first, 'start');
  const pending = request(first, 100);
  store.reviewRefund(admin, pending.id, { action: 'approve', reason: '先核验线下退款' });
  const second = create(true);
  store.transaction(admin, 'account:manage', '准备第二笔直接派单测试', data => { data.orders.find(item => item.id === second.id).selectionRequired = false; });
  update(escort, second, 'accept');
  assert.throws(() => update(escort, second, 'start'), { status: 409 });
  assert.throws(() => store.orderAction(admin, second.id, 'transfer', { version: store.read().orders.find(item => item.id === second.id).version, memberIds: [escort.id], reason: '排班转派' }), { status: 409 });
  store.reviewRefund(admin, pending.id, { action: 'reject', reason: '继续履约，撤销退款' });
  update(escort, first, 'finish', { evidence: '退款驳回后继续完成原服务' });
  update(escort, second, 'start');
  assert.equal(store.read().orders.find(item => item.id === second.id).status, '陪玩中');
});
