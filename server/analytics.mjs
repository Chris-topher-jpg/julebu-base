import { catalogList, visibleProducts } from './game-catalog.mjs';
import { catalogTags } from '../src/catalog-tags.js';

// Club reporting dates use UTC+08:00, independent of the server's local timezone.
export const FOUR_HOURS = 4 * 60 * 60 * 1000;
const DAY = 86400000;
export const clubDay = value => new Date(Number(new Date(value)) + 8 * 3600000).toISOString().slice(0, 10);
function valid(condition, message) { if (!condition) throw Object.assign(new Error(message), { status: 400 }); }
export function dateRange(start, end) {
  const parse = value => {
    valid(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), '请选择有效日期');
    const ms = Date.parse(`${value}T00:00:00+08:00`);
    valid(Number.isFinite(ms) && clubDay(ms) === value, '日期不存在');
    return ms;
  };
  const from = parse(start); const to = parse(end);
  valid(from <= to, '开始日期不能晚于结束日期');
  valid((to - from) / DAY < 366, '一次最多查询 366 天，请缩小日期范围');
  return { from, to: to + DAY, days: (to - from) / DAY + 1, start, end };
}
export const orderTags = order => [...new Set(Array.isArray(order.tags) && order.tags.length ? order.tags : [order.product].filter(Boolean))];
export const buyerKey = order => order.customerId || order.boss?.trim() || `unknown:${order.id}`;
export function completionTime(order) {
  if (order.completedAt) return Date.parse(order.completedAt);
  const recorded = order.history?.findLast(h => h.action === '验收通过并入账');
  if (recorded) return Date.parse(recorded.at);
  // The original local seed omitted this timestamp. Do not guess dates for real orders.
  return order.history?.some(h => h.action === '示例订单导入') ? Date.parse(order.createdAt) : NaN;
}
const completed = order => order.status === '已完成';
const inRange = (time, range, at) => Number.isFinite(time) && time >= range.from && time < range.to && time <= at;
const sum = orders => orders.reduce((total, order) => total + order.amountCents, 0);
function uniqueOrders(orders) { return [...new Map(orders.map(o => [o.id, o])).values()]; }
function filteredOrders(data, query) {
  const game = query.game || ''; const tag = query.tag || '';
  valid(typeof game === 'string' && game.length <= 60 && typeof tag === 'string' && tag.length <= 60, '筛选条件无效');
  const products = new Map((data.products || []).map(product => [product.id, product]));
  const hasTag = order => {
    if (!tag) return true;
    // Tags in the ranking filter are synchronized with current special-order
    // names. Resolve productId so a renamed service still matches historical
    // orders while retaining the order's original display snapshot.
    const product = order.productId ? products.get(order.productId) : undefined;
    return orderTags(order).includes(tag) || product?.name === tag || (!order.productId && order.product === tag);
  };
  return uniqueOrders(data.orders).filter(o => (!game || o.game === game) && hasTag(o));
}
export function metrics(data, range = { from: -Infinity, to: Infinity }, at = Date.now()) {
  const orders = uniqueOrders(data.orders);
  const done = orders.filter(o => completed(o) && inRange(completionTime(o), range, at));
  const placed = orders.filter(o => inRange(Date.parse(o.createdAt), range, at));
  return { amountCents: sum(done), orderCount: done.length, buyerCount: new Set(placed.map(buyerKey)).size };
}
export function dailyBusinessMetrics(data, range, at = Date.now()) {
  const orders = uniqueOrders(data.orders);
  const placed = orders.filter(order => inRange(Date.parse(order.createdAt), range, at));
  const completed = orders.filter(order => order.status === '已完成' && inRange(completionTime(order), range, at));
  const createdStatus = status => placed.filter(order => order.status === status).length;
  const unpaid = placed.filter(order => order.paymentStatus === '未支付' || order.pay === '未支付').length;
  const accepted = placed.filter(order => order.participants?.some(participant => participant.accepted)).length;
  const refunded = placed.filter(order => ['已退款', '退款审核'].includes(order.status)).length;
  const amountCents = sum(completed);
  return { uv: new Set(placed.map(buyerKey)).size, unpaidOrderCount: unpaid, acceptedOrderCount: accepted, completedOrderCount: completed.length, cancelledOrderCount: createdStatus('已取消'), refundedOrderCount: refunded, completedAmountCents: amountCents, completedBuyerCount: new Set(completed.map(buyerKey)).size, averageOrderCents: completed.length ? Math.round(amountCents / completed.length) : 0 };
}
export function trend(data, query, at = Date.now()) {
  const range = dateRange(query.start, query.end);
  const points = Array.from({ length: range.days }, (_, i) => ({ day: clubDay(range.from + i * DAY), orderCount: 0, amountCents: 0 }));
  for (const o of filteredOrders(data, query)) {
    const time = completionTime(o);
    if (completed(o) && inRange(time, range, at)) {
      const point = points[Math.floor((time - range.from) / DAY)]; point.orderCount++; point.amountCents += o.amountCents;
    }
  }
  return { points, start: query.start, end: query.end, asOf: new Date(at).toISOString(), total: { orderCount: points.reduce((a,p) => a+p.orderCount,0), amountCents: points.reduce((a,p) => a+p.amountCents,0) } };
}
export function ranking(data, query, at = Date.now(), details = false) {
  const range = dateRange(query.start, query.end);
  valid(['escorts','buyers','orders'].includes(query.kind), '排名类型无效');
  valid(!query.sort || ['amount','count'].includes(query.sort), '排序类型无效');
  const orders = filteredOrders(data, query).filter(o => completed(o) && inRange(completionTime(o), range, at));
  const key = String(query.key || '');
  const grouped = new Map();
  const add = (key, name, order) => {
    if (!grouped.has(key)) grouped.set(key, { key, name, orderCount: 0, amountCents: 0 });
    const group = grouped.get(key); group.orderCount++; group.amountCents += order.amountCents;
  };
  for (const o of orders) {
    if (query.kind === 'escorts') for (const p of new Map(o.participants.map(p => [p.userId,p])).values()) add(p.userId, p.name, o);
    else if (query.kind === 'buyers') add(buyerKey(o), o.boss, o);
    else { add(o.id, o.id, o); Object.assign(grouped.get(o.id), { game: o.game, product: o.product, boss: o.boss, tags: orderTags(o) }); }
  }
  const all = [...grouped.values()].sort((a,b) => (query.sort === 'count' ? b.orderCount-a.orderCount || b.amountCents-a.amountCents : b.amountCents-a.amountCents || b.orderCount-a.orderCount) || a.key.localeCompare(b.key));
  const page = Number(query.page || 1); const pageSize = Number(query.pageSize || 10);
  valid(Number.isInteger(page) && page >= 1 && Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 50, '分页参数无效');
  if (details) {
    valid(key.length > 0 && key.length < 160, '请选择要查看的排名');
    const matches = orders.filter(o => query.kind === 'escorts' ? o.participants.some(p => p.userId === key) : query.kind === 'buyers' ? buyerKey(o) === key : o.id === key).sort((a,b) => completionTime(b)-completionTime(a) || a.id.localeCompare(b.id));
    return { orders: matches.slice((page-1)*pageSize,page*pageSize).map(o => ({ ...o, completedAt: new Date(completionTime(o)).toISOString(), tags: orderTags(o) })), total: matches.length, page, pageSize, amountCents: sum(matches), name: grouped.get(key)?.name || key };
  }
  return { rows: all.slice((page-1)*pageSize,page*pageSize).map((r,i) => ({ ...r, rank: (page-1)*pageSize+i+1 })), total: all.length, page, pageSize, asOf: new Date(at).toISOString() };
}
export function analyticsOptions(data) {
  const games = catalogList(data).map(game => game.name);
  const products = visibleProducts(data);
  const tags = catalogTags(products);
  const tagsByGame = Object.fromEntries(games.map(game => [game, catalogTags(products, game)]));
  return { games, tags, tagsByGame };
}
