const finished = new Set(['passed', 'failed', 'cancelled', 'refunded']);
export const admissionFilterLabels = Object.freeze({ all: '全部申请', ongoing: '进行中', unassigned: '待分配考官', uncontacted: '待联系申请人', unscheduled: '待安排时间', disputes: '争议待处理', ended: '已结束' });

export function admissionMatchesFilter(application, order, filter = 'all') {
  const ongoing = !finished.has(application.status) || order?.dispute?.status === 'pending';
  const waiting = order && ['unpaid', 'pending'].includes(order.status);
  if (filter === 'ongoing') return ongoing;
  if (filter === 'ended') return !ongoing;
  if (filter === 'disputes') return order?.dispute?.status === 'pending';
  if (filter === 'unassigned') return Boolean(waiting && !order.examinerId);
  if (filter === 'uncontacted') return Boolean(waiting && order.examinerId && !order.contactedAt && !order.appointmentAt);
  if (filter === 'unscheduled') return Boolean(waiting && order.examinerId && !order.appointmentAt);
  return true;
}

export function admissionQueue(applications = [], orders = [], filter = 'all') {
  const byApplication = new Map(orders.map(order => [order.applicationId, order]));
  const byId = new Map(orders.map(order => [order.id, order]));
  const orderFor = application => byId.get(application.orderId) || byApplication.get(application.id);
  const priority = application => {
    const order = orderFor(application);
    return ['disputes', 'unassigned', 'uncontacted', 'unscheduled', 'ongoing'].findIndex(key => admissionMatchesFilter(application, order, key));
  };
  const rank = application => { const value = priority(application); return value < 0 ? 5 : value; };
  const time = (application, ended) => Date.parse(ended ? application.updatedAt || application.createdAt : application.createdAt || application.updatedAt) || 0;
  return applications.filter(application => admissionMatchesFilter(application, orderFor(application), filter)).sort((a, b) => {
    const aRank = rank(a), bRank = rank(b);
    return aRank - bRank || (aRank === 5 ? time(b, true) - time(a, true) : time(a, false) - time(b, false)) || String(a.id).localeCompare(String(b.id));
  });
}
