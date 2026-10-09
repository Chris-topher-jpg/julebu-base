import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ClubStore } from './server/club.mjs';

// This smoke script is intentionally restricted to the disposable snapshot.
const database = fileURLToPath(new URL('./test-results/virtual-escorts-smoke.sqlite', import.meta.url));
const store = new ClubStore(database);
const runId = randomUUID();
const result = { database, runId, startedAt: new Date().toISOString(), checks: [] };
const user = id => store.read().users.find(item => item.id === id);
const order = id => store.read().orders.find(item => item.id === id);
const wallet = id => store.read().customers.find(item => item.id === user(id).customerId).balanceCents;
const act = (actor, id, action, fields = {}) => store.orderAction(user(actor), id, action, { version: order(id).version, ...fields });
const check = (label, actual, expected) => { assert.deepEqual(actual, expected, label); result.checks.push(label); };

try {
  const buyer = user('demo-user');
  const stars = ['demo-escort-4', 'demo-escort-5'];
  const initialData = store.read();
  const pairProduct = initialData.products.find(item => item.game === '三角洲行动' && item.escortCount === 2);
  const singleProduct = initialData.products.find(item => item.game === '三角洲行动' && item.escortCount === 1);
  const initialWallet = wallet(buyer.id);
  const initialBalances = stars.map(id => user(id).balanceCents);
  const initialCustomerWallets = stars.map(wallet);
  for (const id of stars) check(`${id} can serve star orders`, [user(id).role, user(id).levelId, user(id).online, user(id).realNameVerification.status, user(id).depositCents], ['escort', 'star', true, 'verified', 100000]);

  const duo = store.createOrder(buyer, { context: 'personal', boss: buyer.name, productId: pairProduct.id, hours: 1, pay: '在线支付', requirement: `双人明星完整线路测试 ${runId}`, levelId: 'star', orderMode: 'quick' });
  result.duoOrderId = duo.id;
  check('double star one-hour charge', duo.amountCents, 19600);
  check('double order debits customer wallet', wallet(buyer.id), initialWallet - 19600);
  for (const id of stars) act(id, duo.id, 'apply');
  check('both stars applied', order(duo.id).applications.map(item => item.userId), stars);
  act(buyer.id, duo.id, 'selectApplicant', { memberIds: stars });
  check('buyer selection requires confirmation', order(duo.id).status, '待确认');
  act(stars[0], duo.id, 'accept');
  check('first confirmation waits for second', order(duo.id).status, '待确认');
  act(stars[1], duo.id, 'accept');
  check('all confirmed enables start', order(duo.id).status, '待服务');
  act(stars[0], duo.id, 'start');
  check('double service started', order(duo.id).status, '陪玩中');
  act(stars[0], duo.id, 'finish', { evidence: '第一位明星已完成本地虚拟陪玩测试服务' });
  check('first completion waits for second', order(duo.id).status, '陪玩中');
  act(stars[1], duo.id, 'finish', { evidence: '第二位明星已完成本地虚拟陪玩测试服务' });
  check('all submitted reaches acceptance', order(duo.id).status, '待验收');
  act('demo-service', duo.id, 'approve');
  check('customer service acceptance settles order', order(duo.id).status, '已完成');
  check('two equal earnings at 70% total', order(duo.id).participants.map(item => [item.shareBps, item.earningCents, item.settledCents]), [[3500, 6860, 6860], [3500, 6860, 6860]]);
  check('earnings credit escort accounts', stars.map(id => user(id).balanceCents), initialBalances.map(value => value + 6860));
  check('personal escort wallets stay separate', stars.map(wallet), initialCustomerWallets);
  const ledgers = store.read().ledger.filter(item => item.source === duo.id);
  check('customer charge ledger', ledgers.filter(item => item.label === '订单消费').map(item => item.deltaCents), [-19600]);
  check('earnings ledger total', ledgers.filter(item => item.label === '订单分成').reduce((sum, item) => sum + item.deltaCents, 0), 13720);
  result.duo = { status: order(duo.id).status, amountCents: duo.amountCents, totalEarningCents: 13720, retainedCents: 5880 };

  result.withdrawals = [];
  for (const [index, id] of stars.entries()) {
    const withdrawal = store.withdrawal(user(id), { amount: '68.60' });
    check(`${id} withdrawal freezes full new earnings`, user(id).balanceCents, initialBalances[index]);
    store.reviewWithdrawal(user('demo-finance'), withdrawal.id, { action: 'approve' });
    check(`${id} financial approval awaits payment`, store.read().withdrawals.find(item => item.id === withdrawal.id).status, '待线下打款');
    const payoutRef = `SMOKE-${runId}-${index + 1}`;
    store.reviewWithdrawal(user('demo-finance'), withdrawal.id, { action: 'markPaid', payoutRef });
    const paid = store.read().withdrawals.find(item => item.id === withdrawal.id);
    check(`${id} simulated payout recorded`, [paid.status, paid.amountCents, paid.payoutRef], ['已打款', 6860, payoutRef]);
    const entries = store.read().ledger.filter(item => item.source === withdrawal.id);
    check(`${id} withdrawal ledger net`, entries.reduce((sum, item) => sum + item.deltaCents, 0), -6860);
    check(`${id} payout external ledger`, entries.reduce((sum, item) => sum + (item.externalAmountCents || 0), 0), -6860);
    result.withdrawals.push({ id: withdrawal.id, userId: id, status: paid.status, amountCents: paid.amountCents });
  }

  const designated = store.createOrder(user(buyer.id), { context: 'personal', boss: buyer.name, productId: singleProduct.id, hours: 1, pay: '在线支付', requirement: `指定明星开始服务测试 ${runId}`, levelId: 'star', orderMode: 'designated', preferredEscortId: stars[0] });
  check('single star charge', designated.amountCents, 9800);
  act(stars[0], designated.id, 'apply');
  act(buyer.id, designated.id, 'selectApplicant', { memberIds: [stars[0]] });
  act(stars[0], designated.id, 'accept');
  act(stars[0], designated.id, 'start');
  const finalDesignated = order(designated.id);
  check('designated star starts after buyer selection', [finalDesignated.status, finalDesignated.participants[0].userId], ['陪玩中', stars[0]]);
  check('combined customer charges remain consistent', wallet(buyer.id), initialWallet - 29400);
  check('withdrawal does not debit twice at markPaid', stars.map(id => user(id).balanceCents), initialBalances);
  check('test escorts remain online', stars.map(id => user(id).online), [true, true]);
  result.designated = { id: designated.id, status: finalDesignated.status, amountCents: designated.amountCents, participant: stars[0] };
  result.balances = { initialCustomerWalletCents: initialWallet, finalCustomerWalletCents: wallet(buyer.id), initialEscortBalances: initialBalances, finalEscortBalances: stars.map(id => user(id).balanceCents) };
  result.passed = true;
} catch (error) {
  result.passed = false;
  result.error = { message: error.message, status: error.status, stack: error.stack };
  process.exitCode = 1;
} finally {
  result.finishedAt = new Date().toISOString();
  store.close();
  writeFileSync(new URL('./test-results/virtual-escorts-smoke-results.json', import.meta.url), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
