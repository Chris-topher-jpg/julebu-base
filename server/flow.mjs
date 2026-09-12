import { randomUUID } from 'node:crypto';
import { requireThat } from './club.mjs';
import { lockEarnings } from './membership.mjs';

export const personalContext = (user,input={}) => input.context==='personal' || ['user','member'].includes(user.role);
export const walletPayment = order => order.paymentSource==='wallet' || ['余额支付','在线支付'].includes(order.pay);
export function settleOrder(data,order,actor) {
  requireThat(!order.settledAt && !data.ledger.some(l=>l.source===order.id && l.label==='订单分成'),'订单收益已经结算',409);
  lockEarnings(Math.max(0,order.amountCents-(order.refundedCents||0)),order.participants);
  for(const participant of order.participants){
    const member=data.users.find(u=>u.id===participant.userId);
    requireThat(member,'找不到服务成员，请先核对订单',409);
    member.balanceCents+=participant.earningCents;
    participant.settledCents=participant.earningCents;
    data.ledger.unshift({id:randomUUID(),userId:member.id,account:member.name,deltaCents:participant.earningCents,afterCents:member.balanceCents,source:order.id,label:'订单分成',at:new Date().toISOString(),by:actor.name});
  }
  order.status='已完成';order.completedAt=new Date().toISOString();order.settledAt=order.completedAt;
}
export function reverseRefundEarnings(data,order,refund,actor) {
  const paid=data.ledger.filter(l=>l.source===order.id && l.label==='订单分成');
  if(!paid.length && !order.settledAt)return;
  const remaining=Math.max(0,order.amountCents-(order.refundedCents||0)-refund.amountCents);
  const next=order.participants.map(p=>({...p}));lockEarnings(remaining,next);
  for(let i=0;i<order.participants.length;i++){
    const p=order.participants[i], member=data.users.find(u=>u.id===p.userId);
    const initial=paid.filter(l=>l.userId===p.userId).reduce((s,l)=>s+l.deltaCents,0);
    const clawbacks=data.ledger.filter(l=>l.orderId===order.id && l.userId===p.userId && l.label==='退款分成冲回').reduce((s,l)=>s+l.deltaCents,0);
    const previous=p.settledCents??Math.max(0,initial+clawbacks);
    const reversal=Math.max(0,previous-next[i].earningCents);
    requireThat(member && member.balanceCents>=reversal,'陪玩可用收益不足以冲回，请先处理已冻结提现或结算后再退款',409);
    if(reversal){member.balanceCents-=reversal;data.ledger.unshift({id:randomUUID(),userId:p.userId,account:p.name,deltaCents:-reversal,afterCents:member.balanceCents,source:refund.id,orderId:order.id,label:'退款分成冲回',at:new Date().toISOString(),by:actor.name});}
    p.settledCents=Math.max(0,previous-reversal);p.earningCents=next[i].earningCents;
  }
}
