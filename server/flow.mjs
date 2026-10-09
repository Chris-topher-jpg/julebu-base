import { randomUUID } from 'node:crypto';
import { requireThat } from './club.mjs';
import { lockEarnings } from './membership.mjs';

export const personalContext = (user,input={}) => input.context==='personal' || ['user','member'].includes(user.role);
export const walletPayment = order => order.paymentSource ? order.paymentSource === 'wallet' : ['余额支付','在线支付'].includes(order.pay);
// A member remains occupied while an in-service order is under an unresolved
// refund review. The order is still operationally live until the refund is
// rejected or the offline payment is actually recorded.
export const serviceOccupiesMember = (data, userId, excludeOrderId = null) => data.orders.some(order => {
  if (order.id === excludeOrderId || !order.participants?.some(p => p.userId === userId && !p.finished)) return false;
  if (order.status === '陪玩中') return true;
  if (order.status !== '退款审核') return false;
  return data.refunds?.some(refund => refund.orderId === order.id && ['待审核', '待线下退款'].includes(refund.status) && refund.originalStatus === '陪玩中');
});
export function settleOrder(data,order,actor) {
  requireThat(!order.settledAt && !data.ledger.some(l=>l.source===order.id && l.label==='订单分成'),'订单收益已经结算',409);
  const netCents=order.amountCents-(order.refundedCents||0);
  requireThat(Number.isSafeInteger(netCents) && netCents>=0 && Array.isArray(order.participants) && order.participants.length>0,'订单金额或服务成员无效，无法结算',409);
  requireThat(new Set(order.participants.map(p=>p.userId)).size===order.participants.length && order.participants.every(p=>Number.isInteger(p.shareBps) && p.shareBps>=0 && p.shareBps<=10000) && order.participants.reduce((sum,p)=>sum+p.shareBps,0)<=10000,'订单分成比例无效，请先核对后结算',409);
  lockEarnings(netCents,order.participants);
  for(const participant of order.participants){
    const member=data.users.find(u=>u.id===participant.userId);
    requireThat(member && Number.isSafeInteger(member.balanceCents) && Number.isSafeInteger(member.balanceCents+participant.earningCents),'服务成员或收益余额无效，请先核对订单',409);
  }
  for(const participant of order.participants){
    const member=data.users.find(u=>u.id===participant.userId);
    requireThat(member,'找不到服务成员，请先核对订单',409);
    member.balanceCents+=participant.earningCents;
    participant.settledCents=participant.earningCents;
    data.ledger.unshift({id:randomUUID(),userId:member.id,account:member.name,deltaCents:participant.earningCents,afterCents:member.balanceCents,source:order.id,label:'订单分成',at:new Date().toISOString(),by:actor.name});
  }
  order.status='已完成';order.completedAt=new Date().toISOString();order.settledAt=order.completedAt;
}
export function reverseRefundEarnings(data,order,refund,actor,{validateOnly=false}={}) {
  const paid=data.ledger.filter(l=>l.source===order.id && l.label==='订单分成');
  if(!paid.length && !order.settledAt)return;
  const remaining=Math.max(0,order.amountCents-(order.refundedCents||0)-refund.amountCents);
  const next=order.participants.map(p=>({...p}));lockEarnings(remaining,next);
  const changes=[];
  for(let i=0;i<order.participants.length;i++){
    const p=order.participants[i], member=data.users.find(u=>u.id===p.userId);
    const initial=paid.filter(l=>l.userId===p.userId).reduce((s,l)=>s+l.deltaCents,0);
    const clawbacks=data.ledger.filter(l=>l.orderId===order.id && l.userId===p.userId && l.label==='退款分成冲回').reduce((s,l)=>s+l.deltaCents,0);
    const previous=p.settledCents??Math.max(0,initial+clawbacks);
    const reversal=Math.max(0,previous-next[i].earningCents);
    requireThat(member && Number.isSafeInteger(member.balanceCents) && Number.isSafeInteger(reversal) && member.balanceCents>=reversal,'陪玩可用收益不足以冲回，请先驳回未打款提现或解冻收益后再退款',409);
    changes.push({p,member,previous,reversal,nextEarningCents:next[i].earningCents});
  }
  if(validateOnly)return;
  for(const {p,member,previous,reversal,nextEarningCents} of changes){
    if(reversal){member.balanceCents-=reversal;data.ledger.unshift({id:randomUUID(),userId:p.userId,account:p.name,deltaCents:-reversal,afterCents:member.balanceCents,source:refund.id,orderId:order.id,label:'退款分成冲回',at:new Date().toISOString(),by:actor.name});}
    p.settledCents=Math.max(0,previous-reversal);p.earningCents=nextEarningCents;
  }
}
