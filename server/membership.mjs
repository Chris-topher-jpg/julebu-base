export const MIN_WITHDRAWAL_DEPOSIT_CENTS = 100000;
export const defaultLevels = [
  { id: 'star', name: '明星', rank: 4, shareBps: 8500 },
  { id: 'demon', name: '魔王', rank: 3, shareBps: 8000 },
  { id: 'peak', name: '巅峰', rank: 2, shareBps: 7500 },
  { id: 'gold', name: '金牌', rank: 1, shareBps: 7000 },
];
// Current product scope: Delta Force companion play is priced per escort level.
// Prices are stored in cents and only affect new orders.
export const defaultLevelPrices = { star: 9800, demon: 8800, peak: 7800, gold: 5800 };
export const priceOf = (data, levelId) => Number.isSafeInteger(data.levelPrices?.[levelId]) ? data.levelPrices[levelId] : defaultLevelPrices[levelId];
export const levelOf = (data, id) => data.levels.find(level => level.id === id);
export const meetsLevel = (data, user, order) => (levelOf(data, user.levelId)?.rank || 0) >= (levelOf(data, order.levelId)?.rank || Infinity);
export const rateOf = (data, user, gameName = '') => {
  const game = gameName && data.games.find(g => g.name === gameName);
  return Number.isInteger(game?.commissionBps) ? game.commissionBps : Number(user.commissionBps ?? levelOf(data, user.levelId)?.shareBps ?? user.shareBps ?? 7000);
};
export function lockEarnings(amountCents, participants) {
  const values = participants.map((p, i) => ({ i, numerator: amountCents * p.shareBps }));
  let remainder = Math.round(values.reduce((sum, v) => sum + v.numerator, 0) / 10000);
  for (const v of values) { participants[v.i].earningCents = Math.floor(v.numerator / 10000); remainder -= participants[v.i].earningCents; }
  // Allocate rounding cents deterministically; several 100%-tier players can never overpay an order.
  values.sort((a, b) => b.numerator % 10000 - a.numerator % 10000 || a.i - b.i);
  for (let i = 0; i < remainder; i++) participants[values[i].i].earningCents++;
}
export const hasOpenOrders = (data, id) => data.orders.some(order => !['已完成', '已取消', '已退款'].includes(order.status) && order.participants.some(p => p.userId === id));
export const profileConflicts = (data, user) => data.orders.some(order => {
  const refund = order.status === '退款审核' ? data.refunds.find(item => item.orderId === order.id && ['待审核', '待线下退款'].includes(item.status)) : null;
  const lifecycle = refund?.originalStatus || order.status;
  return ['待确认', '待服务', '陪玩中'].includes(lifecycle)
    && order.participants.some(p => p.userId === user.id && !p.finished)
    && (!user.games.includes(order.game) || !meetsLevel(data, user, order));
});

// Upgrade existing local data once, preserving order prices and locked participant shares.
export function migrateMembership(data) {
  if (data.membershipVersion >= 5) {
    if (!data.levelPrices) { data.levelPrices = { ...defaultLevelPrices }; data.levelPriceVersion ||= 1; return true; }
    if (!data.levelPriceVersion) { data.levelPriceVersion = 1; return true; }
    return false;
  }
  if (data.membershipVersion === 1) {
    data.membershipVersion = 2;
    // Continue through the customer identity migration below.
  }
  if (!data.levels) data.levels = structuredClone(defaultLevels);
  if (!data.levelPrices) data.levelPrices = { ...defaultLevelPrices };
  data.levelPriceVersion ||= 1;
  data.users.forEach((user, i) => {
    user.memberNo ||= String(81000001 + i);
    user.levelId ??= user.role === 'escort' ? 'gold' : null;
    user.escortFrozen ??= false;
    user.memberVersion ||= 1;
    if (user.role === 'escort') user.shareBps = rateOf(data, user, user.games?.[0]);
  });
  data.orders.forEach(order => { order.levelId ||= 'gold'; order.levelName ||= '金牌'; });
  const skills = [
    { name: '三角洲行动', category: 'FPS', state: '上架' },
    { name: '永劫无间', category: '动作竞技', state: '上架' },
    { name: '金铲铲之战', category: '策略', state: '上架' },
  ];
  data.games ||= [];
  for (const game of skills) if (!data.games.some(g => g.name === game.name)) data.games.push({ ...game, min: 1, max: 3, multiplier: '1.00x', multiplierBps: 10000, tone: 'green' });
  (data.customers ||= []).forEach((customer, i) => {
    customer.id ||= `customer-${i + 1}`;
    customer.customerNo ||= `U${String(100001 + i).padStart(6, '0')}`;
    customer.username ||= customer.customerNo.toLowerCase();
    customer.phone ??= '';
    customer.active ??= true;
  });
  const knownCustomers = new Set(data.customers.map(customer => customer.name));
  for (const order of data.orders) {
    const name = typeof order.boss === 'string' ? order.boss.trim() : '';
    if (!name || knownCustomers.has(name)) continue;
    const index = data.customers.length;
    data.customers.push({ id: `customer-${index + 1}`, customerNo: `U${String(100001 + index).padStart(6, '0')}`, username: name, phone: '', name, balanceCents: 0, active: true });
    knownCustomers.add(name);
  }
  data.membershipVersion = 5;
  return true;
}

export function memberRecord(data, user, publicUser) {
  const pending = data.orders.filter(order => !['已完成', '退款审核', '已取消', '已退款'].includes(order.status));
  const busy = data.orders.some(order => order.status === '陪玩中' && order.participants.some(p => p.userId === user.id && !p.finished));
  return {
    ...publicUser(user),
    levelName: levelOf(data, user.levelId)?.name || '',
    shareBps: user.role === 'escort' ? rateOf(data, user, user.games?.[0]) : 0,
    commissionByGame: user.role === 'escort' ? Object.fromEntries((user.games || []).map(name => [name, rateOf(data, user, name)])) : {},
    takingStatus: user.role !== 'escort' ? '未开通' : busy ? '接单中' : user.online ? '空闲' : '离线',
    balanceCents: user.balanceCents,
    depositCents: user.depositCents ?? 0,
    pendingCents: pending.reduce((sum, order) => { const p = order.participants.find(p => p.userId === user.id); return sum + (p?.earningCents ?? Math.round(order.amountCents * (p?.shareBps || 0) / 10000)); }, 0),
    // Keep administrator-controlled freezes separate from withdrawal holds;
    // withdrawal money can be released only through its review workflow.
    frozenBalanceCents: user.frozenBalanceCents || 0,
    frozenCents: user.frozenBalanceCents || 0,
    withdrawalFrozenCents: data.withdrawals.filter(w => w.userId === user.id && ['待审核', '待线下打款'].includes(w.status)).reduce((sum, w) => sum + w.amountCents, 0),
  };
}
