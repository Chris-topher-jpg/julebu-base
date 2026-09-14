import { randomUUID } from 'node:crypto';
import { priceOf } from './membership.mjs';
import { catalogList, catalogNames, visibleProducts } from './game-catalog.mjs';
import { applicationViews, buyerSelectionRequired } from './order-matching.mjs';
import { conversationType } from './conversations.mjs';
import { realNameVerification, isRealNameVerified } from './real-name.mjs';

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
  const games = catalogList(data);
  const names = catalogNames(data);
  const customer = data.customers.find(c => c.id === user.customerId);
  const belongs = item => Boolean(customer && item.customerId === customer.id);
  const orders = data.orders.filter(belongs).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(o => ({
    id: o.id, version:o.version, boss: o.boss, game: o.game, product: o.product, hours: o.hours,
    amountCents: o.amountCents, refundedCents: o.refundedCents || 0, pay: o.pay, status: o.status,
    requirement: o.requirement, createdAt: o.createdAt, levelName: o.levelName, paymentStatus: o.paymentStatus || '已支付', orderMode: o.orderMode || 'quick', preferredEscortId: o.preferredEscortId || null, region: o.region || '', voice: o.voice || '', appointmentAt: o.appointmentAt || null,
    participants: o.participants.map(p => ({ name: p.name, evidence:p.evidence||'', accepted: p.accepted, finished: p.finished })),
    selectionRequired: buyerSelectionRequired(o), participantMin: o.participantMin ?? data.games.find(g => g.name === o.game)?.min ?? 1,
    participantMax: o.participantMax ?? data.games.find(g => g.name === o.game)?.max ?? 1,
    applications: applicationViews(data, o),
    history: o.history.map(h => ({ action: h.action, at: h.at })),
  }));
  const orderIds = new Set(orders.map(o => o.id));
  return {
    mode: 'personal', clubName: '星河游戏俱乐部', revision: data.revision, role: roles.user,
    user: { id: user.id, memberNo: user.memberNo, username: user.username, name: user.name,
      role: 'user', roleLabel: '用户', tone: 'blue', phone: customer?.phone || '', online: Boolean(user.online), avatar: user.avatar || '', bio: user.bio || '', profileTags: Array.isArray(user.profileTags) ? user.profileTags : [], realNameVerification: realNameVerification(user) },
    membership: isClubMember(user) ? { role: user.role, label: roles[user.role].label, active: user.active } : null,
    wallet: { balanceCents: customer?.balanceCents || 0, topups: data.topups.filter(belongs).map(item => ({ id: item.id, amountCents: item.amountCents, before: item.before, after: item.after, state: item.state, proof: item.proof, note: item.note || '', paymentChannel: item.paymentChannel || '', receiptReference: item.receiptReference || '', requestedAt: item.requestedAt, reviewedAt: item.reviewedAt })) }, orders,
    refunds: data.refunds.filter(r => orderIds.has(r.orderId)).map(r => ({
      id: r.id, orderId: r.orderId, amountCents: r.amountCents, reason: r.reason,
      status: r.status, requestedAt: r.requestedAt, approvedAt: r.approvedAt, channel: r.channel,
      reviewNote: r.reviewNote || '', paidAt: r.paidAt || null, payoutRef: r.payoutRef || '',
    })),
    ...(user.role === 'user' || user.role === 'member' ? { topups: data.topups.filter(belongs).map(item => ({ id: item.id, customerId: item.customerId, amountCents: item.amountCents, before: item.before, after: item.after, state: item.state, proof: item.proof, note: item.note || '', paymentChannel: item.paymentChannel || '', receiptReference: item.receiptReference || '', requestedAt: item.requestedAt, reviewedAt: item.reviewedAt })) } : {}),
    conversations: data.conversations.filter(c => c.orderId ? orderIds.has(c.orderId) : belongs(c)).map(c => ({
      id: c.id, type: conversationType(c), orderId:c.orderId||null, channel: c.channel, state: c.state, last: c.last, updatedAt: c.updatedAt, createdAt: c.createdAt, escortId: c.escortId || null, escortName: c.escortName || '', unread: c.customerUnread || 0,
      messages: (c.messages || []).map(m => ({ text: m.text, author: m.author, authorId: m.authorId || null, at: m.at })),
    })),
    ledger: data.ledger.filter(l => !l.userId && belongs(l)).map(l => ({
      id: l.id, account: l.account, deltaCents: l.deltaCents, afterCents: l.afterCents,
      label: l.label, source: l.source, at: l.at, externalAmountCents: l.externalAmountCents,
      payoutRef: l.payoutRef || '', receiptReference: l.receiptReference || '',
    })),
    // Customer order forms use the same current level prices as checkout.
    // Expose catalog metadata and eligibility levels without staff shares.
    levels: data.levels.map(({ id, name, rank }) => ({ id, name, rank, priceCents: priceOf(data, id) })),
    gameLevelConfigs: Object.fromEntries(Object.entries(data.gameLevelConfigs || {}).filter(([game]) => names.has(game)).map(([game, config]) => [game, {
      levels: (config.levels || []).filter(item => data.levels.some(level => level.id === item.id)).map(({ id, priceCents }) => ({
        id, name: data.levels.find(level => level.id === id).name, rank: data.levels.find(level => level.id === id).rank, priceCents,
      })),
    }])),
    games,
    catalogGames: games,
    products: visibleProducts(data),
    members: data.users.filter(candidate => candidate.role === 'escort' && candidate.active && !candidate.escortFrozen && isRealNameVerified(candidate)).map(candidate => ({ id: candidate.id, memberNo: candidate.memberNo || candidate.id, name: candidate.name, games: (candidate.games || []).filter(game => names.has(game)), online: candidate.online, levelId: candidate.levelId, avatar: candidate.avatar || '', bio: candidate.bio || '', profileTags: Array.isArray(candidate.profileTags) ? candidate.profileTags : [] })),
  };
}
