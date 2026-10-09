import { serviceOccupiesMember } from './flow.mjs';

export function memberAvailability(data, user) {
  if (!user.online) return '离线';
  const assigned = data.orders.some(order => ['待确认', '待服务'].includes(order.status)
    && order.participants.some(participant => participant.userId === user.id));
  return assigned || serviceOccupiesMember(data, user.id) ? '服务中' : '空闲';
}

export function systemAWorkspace(workspace) {
  const orderView = order => ({ ...order, selectionRequired: false, applications: [] });
  const result = { ...workspace, edition: 'A', availableOrders: [] };
  if (workspace.role) result.role = { ...workspace.role, pages: workspace.role.pages.filter(page => page !== 'availableOrders') };
  if (workspace.orders) result.orders = workspace.orders.map(orderView);
  if (workspace.workerOrders) result.workerOrders = workspace.workerOrders.map(orderView);
  return result;
}

export const excludedSystemAEndpoint = path => /^\/api\/(?:public\/)?(?:dispatch|moments)(?:\/|$)/.test(path);
