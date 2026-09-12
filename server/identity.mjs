import { randomUUID } from 'node:crypto';

export const isClubMember = user => Boolean(user && user.role !== 'user');

export function attachCustomer(data, user) {
  let customer = data.customers.find(c => c.id === user.customerId);
  if (!customer) {
    customer = {
      id: `customer-${randomUUID()}`, customerNo: user.memberNo,
      username: user.username, name: user.name, phone: '', balanceCents: Number(user.balanceCents || 0), active: true,
    };
    data.customers.push(customer);
    user.customerId = customer.id;
  }
  return customer;
}

// Resolve legacy display-name references once, before new users can share those names.
export function migrateIdentity(data) {
  if (data.identityVersion >= 1) return false;
  const uniqueCustomer = name => {
    const matches = data.customers.filter(c => c.name === name);
    return matches.length === 1 ? matches[0] : undefined;
  };
  for (const order of data.orders) order.customerId ||= uniqueCustomer(order.boss)?.id;
  for (const chat of data.conversations) {
    chat.customerId ||= chat.orderId ? data.orders.find(o => o.id === chat.orderId)?.customerId : uniqueCustomer(chat.boss)?.id;
  }
  for (const entry of data.ledger) if (!entry.userId) entry.customerId ||= uniqueCustomer(entry.account)?.id;
  for (const topup of data.topups) topup.customerId ||= uniqueCustomer(topup.user)?.id;
  const claimed = new Set();
  for (const user of data.users) {
    const customer = data.customers.find(c => c.id === user.customerId || c.id === user.externalUserId || c.customerNo === user.externalUserId || c.customerNo === user.memberNo);
    if (customer && !claimed.has(customer.id)) user.customerId = customer.id;
    else delete user.customerId;
    claimed.add(attachCustomer(data, user).id);
    delete user.password;
  }
  data.identityVersion = 1;
  return true;
}

export function personalData(data, user, roles) {
  const customer = data.customers.find(c => c.id === user.customerId);
  const belongs = item => Boolean(customer && item.customerId === customer.id);
  const orders = data.orders.filter(belongs).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(o => ({
    id: o.id, version:o.version, boss: o.boss, game: o.game, product: o.product, hours: o.hours,
    amountCents: o.amountCents, refundedCents: o.refundedCents || 0, pay: o.pay, status: o.status,
    requirement: o.requirement, createdAt: o.createdAt, levelName: o.levelName, paymentStatus: o.paymentStatus || '已支付', orderMode: o.orderMode || 'quick', preferredEscortId: o.preferredEscortId || null, region: o.region || '', voice: o.voice || '', appointmentAt: o.appointmentAt || null,
    participants: o.participants.map(p => ({ name: p.name, evidence:p.evidence||'', accepted: p.accepted, finished: p.finished })),
    history: o.history.map(h => ({ action: h.action, at: h.at })),
  }));
  const orderIds = new Set(orders.map(o => o.id));
  return {
    mode: 'personal', clubName: '星河游戏俱乐部', revision: data.revision, role: roles.user,
    user: { id: user.id, memberNo: user.memberNo, username: user.username, name: user.name,
      role: 'user', roleLabel: '用户', tone: 'blue', phone: customer?.phone || '' },
    membership: isClubMember(user) ? { role: user.role, label: roles[user.role].label, active: user.active } : null,
    wallet: { balanceCents: customer?.balanceCents || 0 }, orders,
    refunds: data.refunds.filter(r => orderIds.has(r.orderId)).map(r => ({
      id: r.id, orderId: r.orderId, amountCents: r.amountCents, reason: r.reason,
      status: r.status, requestedAt: r.requestedAt, approvedAt: r.approvedAt, channel: r.channel,
    })),
    conversations: data.conversations.filter(c => c.orderId ? orderIds.has(c.orderId) : belongs(c)).map(c => ({
      id: c.id, orderId:c.orderId||null, channel: c.channel, state: c.state, last: c.last, updatedAt: c.updatedAt, createdAt: c.createdAt, escortId: c.escortId || null, escortName: c.escortName || '', unread: c.customerUnread || 0,
      messages: (c.messages || []).map(m => ({ text: m.text, author: m.author, authorId: m.authorId || null, at: m.at })),
    })),
    ledger: data.ledger.filter(l => !l.userId && belongs(l)).map(l => ({
      id: l.id, account: l.account, deltaCents: l.deltaCents, afterCents: l.afterCents,
      label: l.label, source: l.source, at: l.at,
    })),
    // Personal workspace needs the same catalog data as the management
    // workspace so the client can render the order form after switching
    // from the public home to "开始点单". Keep the payload read-only and
    // scoped to the public catalog/member roster.
    games: data.games,
    products: data.products,
    members: data.users.filter(candidate => candidate.role === 'escort' && candidate.active && !candidate.escortFrozen).map(candidate => ({ id: candidate.id, name: candidate.name, games: candidate.games || [], online: candidate.online, levelId: candidate.levelId })),
  };
}
