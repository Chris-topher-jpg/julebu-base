import test from 'node:test';
import assert from 'node:assert/strict';
import { admissionMatchesFilter, admissionQueue } from '../src/admission-queue.js';

const application = (id, status, createdAt = '2026-09-01T00:00:00Z', extra = {}) => ({ id, orderId: `order-${id}`, status, createdAt, updatedAt: createdAt, ...extra });
const order = (application, extra = {}) => ({ id: application.orderId, applicationId: application.id, status: application.status, examinerId: 'examiner', ...extra });

test('待分配、待联系和待预约只统计对应准备阶段，并与工作台统计保持一致', () => {
  const waiting = application('waiting', 'unpaid');
  const waitingOrder = order(waiting, { examinerId: null });
  assert.equal(admissionMatchesFilter(waiting, waitingOrder, 'unassigned'), true);
  assert.equal(admissionMatchesFilter(waiting, waitingOrder, 'uncontacted'), false);
  assert.equal(admissionMatchesFilter(waiting, waitingOrder, 'unscheduled'), false);
  const assigned = { ...waitingOrder, examinerId: 'examiner' };
  assert.equal(admissionMatchesFilter(waiting, assigned, 'uncontacted'), true);
  assert.equal(admissionMatchesFilter(waiting, assigned, 'unscheduled'), true);
  assert.equal(admissionMatchesFilter(waiting, { ...assigned, contactedAt: '2026-09-02T00:00:00Z' }, 'uncontacted'), false);
  assert.equal(admissionMatchesFilter(waiting, { ...assigned, contactedAt: '2026-09-02T00:00:00Z' }, 'unscheduled'), true);
  assert.equal(admissionMatchesFilter(waiting, { ...assigned, appointmentAt: '2026-09-03T00:00:00Z' }, 'unscheduled'), false);
  for (const status of ['consulting', 'inProgress', 'recheck', 'passed', 'failed', 'refunded', 'cancelled']) {
    const app = application(status, status), exam = order(app);
    for (const filter of ['unassigned', 'uncontacted', 'unscheduled']) assert.equal(admissionMatchesFilter(app, exam, filter), false, `${status}: ${filter}`);
  }
  assert.equal(admissionMatchesFilter(waiting, undefined, 'unassigned'), false);
  for (const filter of ['unassigned', 'uncontacted', 'unscheduled', 'ongoing', 'ended', 'disputes']) {
    assert.equal(admissionMatchesFilter(waiting, assigned, filter), admissionMatchesFilter(assigned, assigned, filter));
  }
});

test('失败但争议尚未处理的考核仍为进行中，争议关闭后才进入已结束', () => {
  const app = application('appeal', 'failed'), exam = order(app, { dispute: { status: 'pending' } });
  assert.equal(admissionMatchesFilter(app, exam, 'disputes'), true);
  assert.equal(admissionMatchesFilter(app, exam, 'ongoing'), true);
  assert.equal(admissionMatchesFilter(app, exam, 'ended'), false);
  exam.dispute.status = 'resolved';
  assert.equal(admissionMatchesFilter(app, exam, 'disputes'), false);
  assert.equal(admissionMatchesFilter(app, exam, 'ended'), true);
});

test('考核队列优先争议和未派单，同阶段先处理旧申请，已结束记录从新到旧', () => {
  const apps = [application('closed-old', 'passed'), application('new', 'pending', '2026-09-03T00:00:00Z'), application('old', 'pending'), application('closed-new', 'cancelled', '2026-09-04T00:00:00Z'), application('appeal', 'failed', '2026-09-05T00:00:00Z'), application('unassigned', 'unpaid', '2026-09-06T00:00:00Z')];
  const orders = apps.map(app => order(app, app.id === 'appeal' ? { dispute: { status: 'pending' } } : app.id === 'unassigned' ? { examinerId: null } : {}));
  const original = structuredClone({ apps, orders });
  assert.deepEqual(admissionQueue(apps, orders).map(app => app.id), ['appeal', 'unassigned', 'old', 'new', 'closed-new', 'closed-old']);
  assert.deepEqual(admissionQueue(apps, orders, 'uncontacted').map(app => app.id), ['old', 'new']);
  assert.deepEqual(admissionQueue(apps, orders, 'ended').map(app => app.id), ['closed-new', 'closed-old']);
  assert.deepEqual({ apps, orders }, original);
});

test('筛选支持申请关联订单和缺省记录，不将咨询或结束记录混入待办', () => {
  const consulting = application('consult', 'consulting', undefined, { orderId: null });
  const waiting = application('waiting', 'unpaid', undefined, { orderId: null });
  const orders = [{ id: 'legacy-order', applicationId: waiting.id, status: 'unpaid', examinerId: null }];
  assert.deepEqual(admissionQueue([consulting, waiting], orders, 'unassigned').map(app => app.id), ['waiting']);
  assert.deepEqual(admissionQueue([consulting], [], 'disputes'), []);
  assert.deepEqual(admissionQueue(), []);
  assert.equal(admissionQueue([consulting], [], 'unknown').length, 1);
});
