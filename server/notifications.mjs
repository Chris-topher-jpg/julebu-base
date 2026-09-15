import { randomUUID } from 'node:crypto';
import { matchesOrder, recruitmentOpen } from './order-matching.mjs';
import { conversationType, canManageConversation } from './conversations.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const index = items => new Map((items || []).map(item => [item.id, item]));
const financialRoles = ['admin', 'finance'];
const serviceRoles = ['admin', 'service'];

// Notifications contain navigation hints and a short summary only. Order
// details, customer data, internal notes and money stay in scoped workspaces.
export function recordNotifications(data, before, actor) {
  const pending = [];
  const actorMode = ['user', 'member'].includes(actor.role) ? 'personal' : 'management';
  const push = (recipientId, details) => {
    if (!recipientId || !data.users.some(user => user.id === recipientId)) return;
    if (recipientId === actor.id && details.mode === actorMode) return;
    const key = `${recipientId}:${details.mode}:${details.kind}:${details.entityId}`;
    if (pending.some(item => item.key === key)) return;
    pending.push({ key, recipientId, ...details });
  };
  const staff = (roles, details) => data.users.filter(user => user.active && roles.includes(user.role)).forEach(user => push(user.id, { mode: 'management', ...details }));
  const customer = (customerId, details) => data.users.filter(user => customerId && user.customerId === customerId).forEach(user => push(user.id, { mode: 'personal', ...details }));
  const oldOrders = index(before.orders);
  const oldRefunds = index(before.refunds);
  const changedRefundOrders = new Set((data.refunds || []).filter(item => !same(item, oldRefunds.get(item.id))).map(item => item.orderId));
  for (const order of data.orders || []) {
    const previous = oldOrders.get(order.id);
    if (same(order, previous)) continue;
    const currentMembers = new Set(order.participants.map(item => item.userId));
    const oldMembers = new Set((previous?.participants || []).map(item => item.userId));
    const historyAction = order.history?.at(-1)?.action || '订单更新';
    const title = !previous ? '收到新订单，请安排打手' : historyAction === '打手报名' ? '有打手报名，请查看候选名单' : historyAction === '客服推荐打手' ? '客服已推荐打手，请选择' : historyAction === '老板选择打手' ? '老板已选定打手' : historyAction === '转单待老板选择' ? '订单需重新选择打手' : historyAction === '转单' ? '订单已转派' : historyAction === '客服派单' ? '订单已派单' : historyAction === '提交完单' ? '打手已提交完单' : historyAction === '验收通过并入账' ? '订单已验收完成' : `订单${order.status}`;
    const details = { kind: 'order', entityId: order.id, orderId: order.id, title, body: `订单 ${order.id} · ${order.status}` };
    staff(serviceRoles, { ...details, page: order.status === '待接单' ? 'dispatch' : 'orders' });
    customer(order.customerId, { ...details, title: !previous ? '订单已提交' : title, page: 'memberOrders' });
    const oldApplicants = new Set((previous?.applications || []).map(item => item.userId));
    for (const application of order.applications || []) if (recruitmentOpen(order) && application.source === 'service' && !oldApplicants.has(application.userId)) {
      push(application.userId, { ...details, relation: 'available', mode: 'management', page: 'availableOrders', title: '客服邀请你参与订单', body: `订单 ${order.id}，你已进入候选名单，等待老板选择。` });
    }
    if (recruitmentOpen(order) && (!previous || !recruitmentOpen(previous))) {
      data.users.filter(candidate => !oldMembers.has(candidate.id) && matchesOrder(data, order, candidate)).forEach(candidate => {
        push(candidate.id, { ...details, relation: 'available', mode: 'management', page: 'availableOrders', title: '有新的匹配订单', body: `订单 ${order.id} · ${order.game}，符合条件即可报名。` });
      });
    }
    if (historyAction === '老板选择打手') for (const userId of oldApplicants) if (!currentMembers.has(userId)) {
      push(userId, { ...details, relation: 'notSelected', mode: 'management', page: 'availableOrders', title: '本次订单已结束招募', body: `订单 ${order.id} 已选择其他打手，可继续查看其他订单。` });
    }
    for (const userId of currentMembers) {
      push(userId, { ...details, mode: 'management', page: 'myOrders', title: !oldMembers.has(userId) ? '你收到一笔新派单' : title });
    }
    // A removed participant needs to dismiss the old task, but must never
    // receive details about the replacement or its subsequent service.
    for (const userId of oldMembers) if (!currentMembers.has(userId)) {
      push(userId, { ...details, relation: 'removed', mode: 'management', page: 'myOrders', title: '订单已移出你的服务列表', body: `订单 ${order.id} 已重新安排，无需继续处理。` });
    }
    if (changedRefundOrders.has(order.id)) {
      staff(['afterSales'], { ...details, title: '退款处理进度已更新', page: 'orders' });
      staff(['finance'], { ...details, title: '退款处理进度已更新', page: 'topups' });
    }
  }

  const oldChats = index(before.conversations);
  for (const chat of data.conversations || []) {
    const previous = oldChats.get(chat.id);
    const addedMessages = (chat.messages || []).slice(previous?.messages?.length || 0);
    if (!addedMessages.length && (!previous || chat.state === previous.state)) continue;
    const details = { kind: 'conversation', entityId: chat.id, ...(chat.orderId ? { orderId: chat.orderId } : {}), title: addedMessages.length ? '收到新的会话消息' : '会话处理状态已更新', body: addedMessages.length ? '有新的消息待查看，请进入会话继续沟通。' : `会话当前状态：${chat.state}` };
    if (actorMode === 'personal' || actor.role === 'escort') staff(['admin', conversationType(chat) === 'support' ? 'afterSales' : 'service'], { ...details, page: 'conversations' });
    if (conversationType(chat) === 'consultation' && chat.escortId && actor.id !== chat.escortId) {
      const escort = data.users.find(user => user.id === chat.escortId && user.active && user.role === 'escort');
      if (escort) push(escort.id, { ...details, mode: 'management', page: 'conversations' });
    }
    if (actorMode !== 'personal') customer(chat.customerId, { ...details, page: 'memberAfterSales' });
  }

  const oldWithdrawals = index(before.withdrawals);
  for (const item of data.withdrawals || []) if (!same(item, oldWithdrawals.get(item.id))) {
    const details = { kind: 'withdrawal', entityId: item.id, title: oldWithdrawals.has(item.id) ? '提现处理进度已更新' : '收到新的提现申请', body: `提现申请 ${item.id} · ${item.status}` };
    staff(financialRoles, { ...details, page: 'settlements' });
    push(item.userId, { ...details, mode: 'management', page: 'myEarnings' });
  }
  const oldTopups = index(before.topups);
  for (const item of data.topups || []) if (!same(item, oldTopups.get(item.id))) {
    const details = { kind: 'topup', entityId: item.id, title: '充值处理进度已更新', body: `充值申请 ${item.id} · ${item.state}` };
    staff(financialRoles, { ...details, page: 'topups' });
    customer(item.customerId, { ...details, page: 'memberWallet' });
  }

  const oldAdmissions = index(before.admissionApplications);
  const oldAdmissionOrders = index(before.admissionOrders);
  const oldAdmissionChats = index(before.admissionConversations);
  for (const application of data.admissionApplications || []) {
    const order = (data.admissionOrders || []).find(item => item.id === application.orderId);
    const chat = (data.admissionConversations || []).find(item => item.id === application.conversationId);
    const newMessage = (chat?.messages?.length || 0) > (oldAdmissionChats.get(chat?.id)?.messages?.length || 0);
    if (!newMessage && same(application, oldAdmissions.get(application.id)) && same(order, oldAdmissionOrders.get(order?.id))) continue;
    const labels = { consulting: '咨询中', unpaid: '待支付', pending: '待考核', inProgress: '考核中', recheck: '待复核', passed: '已通过', failed: '未通过', cancelled: '已取消', refunded: '已退款' };
    const assignmentChanged = application.examinerId && application.examinerId !== oldAdmissions.get(application.id)?.examinerId;
    const title = newMessage ? '收到考核会话消息' : order && !oldAdmissionOrders.has(order.id) ? '考核订单已创建' : assignmentChanged ? '考核订单已分配考官' : '考核订单进度有更新';
    const details = { kind: 'admission', entityId: application.id, orderId: order?.id, page: 'admissions', title, body: `${application.game} · ${labels[application.status] || '进度更新'}${order && !application.examinerId ? ' · 等待安排考官' : ''}` };
    push(application.userId, { ...details, mode: 'personal' });
    push(application.examinerId, { ...details, title: assignmentChanged && order ? '收到考核派单，请联系申请人' : details.title, mode: 'management' });
    staff(['admin'], { ...details, title: order?.dispute?.status === 'pending' ? '有考核争议等待处理' : order && !application.examinerId ? '考核订单待分配考官' : details.title });
  }

  const oldAssessments = index(before.assessments);
  for (const item of data.assessments || []) if (!same(item, oldAssessments.get(item.id))) {
    const details = { kind: 'assessment', entityId: item.id, title: '考核进度已更新', body: `${item.type} · ${item.status}${item.result ? ` · ${item.result}` : ''}` };
    staff(['admin'], { ...details, page: 'examinerManagement' });
    push(item.examinerId, { ...details, mode: 'management', page: 'examinerCandidates' });
    push(item.memberId, { ...details, mode: 'personal', page: 'memberProfile' });
  }

  const oldUsers = index(before.users);
  const profile = user => user && [user.role, user.active, user.name, user.games, user.levelId, user.examiner, user.escortFrozen, user.shareBps, user.depositCents];
  for (const user of data.users || []) if (!same(profile(user), profile(oldUsers.get(user.id)))) {
    const details = { kind: 'account', entityId: user.id, title: '账号与成员资料已更新', body: '你的角色、技能或账号资料有更新，请查看最新信息。' };
    push(user.id, { ...details, mode: 'personal', page: 'memberProfile' });
    staff(['admin'], { ...details, title: '成员资料已更新', body: '俱乐部成员资料有更新。', page: 'clubMembers' });
  }
  // Wallet-only operations (for example an administrator freezing earnings)
  // still notify the account owner without exposing amounts to other roles.
  for (const user of data.users || []) {
    const previous = oldUsers.get(user.id);
    if (previous && ['balanceCents', 'frozenBalanceCents'].some(key => user[key] !== previous[key]) && user.role === 'escort') {
      push(user.id, { kind: 'wallet', entityId: user.id, mode: 'management', page: 'myEarnings', title: '你的收益账户已更新', body: '请查看最新收益与资金明细。' });
    }
  }
  if (pending.length) {
    const createdAt = new Date().toISOString();
    data.notifications ||= [];
    data.notifications.unshift(...pending.map(({ key, ...item }) => ({ id: randomUUID(), ...item, createdAt, readAt: null })));
  }
}

export function notificationFeed(data, user, roles) {
  const allowed = item => {
    if (item.recipientId !== user.id || item.mode === 'management' && !roles[user.role]?.pages.includes(item.page)) return false;
    if (item.kind === 'order') {
      const order = data.orders.find(order => order.id === item.orderId);
      if (!order) return false;
      if (item.mode === 'personal') return Boolean(user.customerId && order.customerId === user.customerId);
      if (user.role === 'escort') {
        const assigned = order.participants.some(participant => participant.userId === user.id);
        if (item.relation === 'available') return recruitmentOpen(order) && matchesOrder(data, order, user);
        if (item.relation === 'notSelected') return !assigned && !recruitmentOpen(order) && (order.applications || []).some(application => application.userId === user.id);
        return item.relation === 'removed' ? !assigned : assigned;
      }
      return ['admin', 'service', 'afterSales', 'finance'].includes(user.role);
    }
    if (item.kind === 'conversation') {
      const chat = data.conversations.find(chat => chat.id === item.entityId);
      if (!chat) return false;
      return item.mode === 'personal' ? Boolean(user.customerId && chat.customerId === user.customerId) : canManageConversation(user, chat);
    }
    if (item.kind === 'withdrawal') {
      const withdrawal = data.withdrawals.find(withdrawal => withdrawal.id === item.entityId);
      return Boolean(withdrawal && (financialRoles.includes(user.role) || withdrawal.userId === user.id));
    }
    if (item.kind === 'topup') {
      const topup = data.topups.find(topup => topup.id === item.entityId);
      return Boolean(topup && (item.mode === 'personal' ? user.customerId && topup.customerId === user.customerId : financialRoles.includes(user.role)));
    }
    if (item.kind === 'assessment') {
      const assessment = data.assessments.find(assessment => assessment.id === item.entityId);
      return Boolean(assessment && (item.mode === 'personal' ? assessment.memberId === user.id : user.role === 'admin' || assessment.examinerId === user.id));
    }
    if (item.kind === 'admission') {
      const application = (data.admissionApplications || []).find(record => record.id === item.entityId);
      return Boolean(application && (item.mode === 'personal' ? application.userId === user.id : user.role === 'admin' || user.role === 'examiner' && application.examinerId === user.id));
    }
    if (item.kind === 'account') return item.mode === 'personal' ? item.entityId === user.id : user.role === 'admin';
    if (item.kind === 'wallet') return item.entityId === user.id;
    return false;
  };
  const visible = (data.notifications || []).filter(allowed);
  const unreadCount = visible.filter(item => !item.readAt).length;
  visible.sort((a, b) => Number(Boolean(a.readAt)) - Number(Boolean(b.readAt)) || b.createdAt.localeCompare(a.createdAt));
  const items = visible.slice(0, 100).map(({ recipientId, relation, ...item }) => item);
  return { items, unreadCount };
}
