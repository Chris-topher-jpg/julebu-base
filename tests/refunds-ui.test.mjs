import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refundProgress, refundDetailsMarkup, refundQueueMarkup } from '../src/refunds.js';

test('退款队列优先展示更早的待办，财务和售后操作按能力展示', () => {
  const refunds = [
    { id: 'RF-DONE', orderId: 'O1', status: '已退款', requestedAt: '2026-09-29T05:00:00Z' },
    { id: 'RF-NEW', orderId: 'O2', status: '待审核', requestedAt: '2026-09-29T04:00:00Z' },
    { id: 'RF-OLD', orderId: 'O3', status: '待线下退款', requestedAt: '2026-09-28T04:00:00Z' },
  ];
  const workspace = permissions => ({ refunds, role: { permissions } });
  const finance = refundQueueMarkup(workspace(['refund:manage', 'finance:manage']));
  assert.ok(finance.indexOf('RF-OLD') < finance.indexOf('RF-NEW'));
  assert.ok(finance.indexOf('RF-NEW') < finance.indexOf('RF-DONE'));
  assert.ok(finance.includes('登记退款 / 撤销审核'));
  assert.match(finance, /data-action="refundReviewById" data-id="RF-OLD"/);
  const afterSales = refundQueueMarkup(workspace(['refund:manage']), { filter: '待处理' });
  assert.equal(afterSales.includes('RF-DONE'), false);
  assert.ok(afterSales.includes('查看 / 撤销审核'));
  assert.equal(afterSales.includes('登记退款 /'), false);
  assert.equal(refundQueueMarkup(workspace(['order:review'])).includes('data-action="refundReviewById"'), false);
});

test('退款进度区分待实际打款和余额到账，记录转义并隐藏内部操作人', () => {
  const item = { id: 'RF-1', orderId: 'O1', status: '待线下退款', amountCents: 1000, channel: '线下人工', reason: '<img src=x onerror=alert(1)>', history: [{ action: '审核通过', at: '2026-09-29T04:00:00Z', by: '内部操作员', note: '<script>unsafe</script>' }] };
  assert.match(refundProgress(item), /尚未退款到账/);
  assert.match(refundProgress({ status: '已通过' }), /退回原消费余额/);
  assert.match(refundProgress({ status: '已撤回' }), /未产生退款/);
  const personal = refundDetailsMarkup(item, { personal: true });
  assert.equal(personal.includes('<img'), false);
  assert.equal(personal.includes('<script>'), false);
  assert.equal(personal.includes('内部操作员'), false);
  assert.match(personal, /&lt;script&gt;/);
  assert.match(refundDetailsMarkup(item), /内部操作员/);
});

test('旧申请详情使用已有时间，空队列和未知状态保留清晰提示', () => {
  const legacy = { id: 'RF-LEGACY', status: '已驳回', requestedAt: '2026-09-28T04:00:00Z', reviewedAt: '2026-09-29T04:00:00Z', reason: '服务安排变化', reviewNote: '已协商继续' };
  assert.match(refundDetailsMarkup(legacy), /提交退款申请/);
  assert.match(refundDetailsMarkup(legacy), /已协商继续/);
  assert.match(refundDetailsMarkup({ id: 'RF-EMPTY' }), /暂无处理记录/);
  assert.match(refundQueueMarkup({}), /暂无退款申请/);
});
