// All club periods use Beijing time, independent of the browser's time zone.
export function earningsSummary(ledger, at = Date.now()) {
  const shifted = new Date(at + 8 * 3600000);
  const day = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - 8 * 3600000;
  const week = day - ((shifted.getUTCDay() + 6) % 7) * 86400000;
  const month = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) - 8 * 3600000;
  const income = start => ledger.filter(item => ['订单分成', '退款冲回分成', '退款分成冲回'].includes(item.label) && Date.parse(item.at) >= start && Date.parse(item.at) <= at).reduce((total, item) => total + Number(item.deltaCents || 0), 0);
  return { day: income(day), week: income(week), month: income(month) };
}
