export const defaultLevels = [
  { id: 'star', name: '明星', rank: 4, shareBps: 8500 },
  { id: 'demon', name: '魔王', rank: 3, shareBps: 8000 },
  { id: 'peak', name: '巅峰', rank: 2, shareBps: 7500 },
  { id: 'gold', name: '金牌', rank: 1, shareBps: 7000 },
];
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
export const hasOpenOrders = (data, id) => data.orders.some(order => !['已完成', '退款审核', '已取消', '已退款'].includes(order.status) && order.participants.some(p => p.userId === id));
export const profileConflicts = (data, user) => data.orders.some(order => ['待确认', '待服务'].includes(order.status) && order.participants.some(p => p.userId === user.id) && (!user.games.includes(order.game) || !meetsLevel(data, user, order)));

// Upgrade existing local data once, preserving order prices and locked participant shares.
export function migrateMembership(data) {
  if (data.membershipVersion === 2) return false;
  if (data.membershipVersion === 1) {
    data.membershipVersion = 2;
    return true;
  }
  data.levels = structuredClone(defaultLevels);
  data.users.forEach((user, i) => {
    user.memberNo ||= String(81000001 + i);
    user.levelId = user.role === 'escort' ? 'gold' : null;
    user.escortFrozen = false;
    user.memberVersion = 1;
    if (user.role === 'escort') user.shareBps = rateOf(data, user, user.games?.[0]);
  });
  data.orders.forEach(order => { order.levelId ||= 'gold'; order.levelName ||= '金牌'; });
  const skills = [
    { name: '三角洲行动', category: 'FPS', state: '上架' },
    { name: '永劫无间', category: '动作竞技', state: '上架' },
    { name: '金铲铲之战', category: '策略', state: '上架' },
  ];
  for (const game of skills) if (!data.games.some(g => g.name === game.name)) data.games.push({ ...game, min: 1, max: 3, multiplier: '1.00x', multiplierBps: 10000, tone: 'green' });
  data.membershipVersion = 2;
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
    frozenCents: (user.frozenBalanceCents || 0) + data.withdrawals.filter(w => w.userId === user.id && ['待审核', '待线下打款'].includes(w.status)).reduce((sum, w) => sum + w.amountCents, 0),
  };
}
