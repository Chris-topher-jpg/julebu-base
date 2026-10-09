import { meetsLevel, levelOf, isQualifiedForGame, workerLevelId } from './membership.mjs';
import { catalogNames } from './game-catalog.mjs';
import { isRealNameVerified } from './real-name.mjs';

// Older self-service orders also require the buyer's final choice.
export const buyerSelectionRequired = order => order.selectionRequired ?? order.pay === '在线支付';
export const recruitmentOpen = order => order.status === '待接单' && !order.participants.length;

export function matchesOrder(data, order, user) {
  return Boolean(user?.active && isQualifiedForGame(user, order.game) && !user.escortFrozen && isRealNameVerified(user)
    && !(order.excludedEscortIds || []).includes(user.id)
    && (!order.preferredEscortId || order.preferredEscortId === user.id)
    && meetsLevel(data, user, order)
    && catalogNames(data).has(order.game));
}

export function applicationViews(data, order) {
  return (order.applications || []).map(application => {
    const member = data.users.find(user => user.id === application.userId);
    return {
      userId: application.userId, name: member?.name || application.name,
      levelId: workerLevelId(member, order.game) || application.levelId,
      levelName: levelOf(data, workerLevelId(member, order.game))?.name || application.levelName,
      games: (member?.role === 'admin' ? (member.escortQualifications || []).map(item => item.game) : member?.games || application.games || []).filter(game => catalogNames(data).has(game)),
      source: application.source || 'self', appliedAt: application.appliedAt,
      eligible: matchesOrder(data, order, member) && Boolean(member?.online),
    };
  });
}

export function escortOrderView(data, order, user) {
  const { customerId, excludedEscortIds, selectedBy, ...visible } = order;
  return {
    ...visible, selectionRequired: buyerSelectionRequired(order),
    history: (order.history || []).map(({ action, at }) => ({ action, at })),
    applications: applicationViews(data, order).filter(item => item.userId === user.id),
    participants: order.participants.map(p => p.userId === user.id ? p : {
      userId: p.userId, name: p.name, accepted: p.accepted, finished: p.finished,
    }),
  };
}
