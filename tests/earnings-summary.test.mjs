import test from 'node:test';
import assert from 'node:assert/strict';
import { earningsSummary } from '../src/earnings-summary.js';

test('收益按北京时间日、周一、月边界统计净分成，排除未来和非收益流水', () => {
  const entry = (at, deltaCents, label = '订单分成') => ({ at, deltaCents, label });
  const ledger = [entry('2026-01-31T15:59:59Z', 900), entry('2026-01-31T16:00:00Z', 100), entry('2026-02-01T15:59:59Z', 200), entry('2026-02-01T16:00:00Z', 300), entry('2026-02-02T01:00:00Z', -50, '退款冲回分成'), entry('2026-02-02T01:00:00Z', 800, '充值'), entry('2026-02-03T01:00:00Z', 700), entry('invalid', 900)];
  assert.deepEqual(earningsSummary(ledger, Date.parse('2026-02-02T02:00:00Z')), { day: 250, week: 250, month: 550 });
});
