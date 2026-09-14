import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClubStore } from '../server/club.mjs';
import { catalogAction } from '../server/catalog.mjs';
import { hasOpenOrders, profileConflicts } from '../server/membership.mjs';
import { addFixtureGames } from './catalog-fixture.mjs';

function fixture(t){
  const store=new ClubStore(':memory:');t.after(()=>store.close());
  addFixtureGames(store, ['王者荣耀']);
  const user=id=>store.read().users.find(u=>u.id===id);
  const customer=user('demo-user'),escort=user('demo-escort'),admin=user('admin');
  const create=(buyer=customer)=>store.createOrder(buyer,{context:'personal',boss:buyer.name,productId:'product-1',hours:1,pay:'在线支付',requirement:'完成约定服务后提供说明',levelId:'gold'});
  const update=(actor,order,action,input={})=>store.orderAction(actor,order.id,action,{version:store.read().orders.find(o=>o.id===order.id).version,...input});
  const finish=order=>{update(escort,order,'apply');update(customer,order,'selectApplicant',{memberIds:[escort.id]});update(escort,order,'accept');update(escort,order,'start');update(escort,order,'finish',{evidence:'已完成一小时约定服务'});};
  return {store,user,customer,escort,admin,create,update,finish};
}

test('顾客确认完单发放一次收益，退款原路返还并冲回收益',t=>{
  const {store,customer,escort,admin,create,update,finish}=fixture(t);
  const before=store.personal(customer).wallet.balanceCents, income=store.workspace(escort).wallet.balanceCents;
  const order=create();finish(order);
  const personal=store.personal(customer).orders.find(o=>o.id===order.id);
  assert.ok(personal.version);assert.equal(personal.participants[0].evidence,'已完成一小时约定服务');
  const done=update(customer,order,'approve',{context:'personal'});
  assert.equal(store.workspace(escort).wallet.balanceCents,income+done.participants[0].earningCents);
  assert.throws(()=>update(customer,order,'approve',{context:'personal'}),{status:409});
  const refund=store.createRefund(customer,{context:'personal',orderId:order.id,amountCents:order.amountCents,reason:'测试全额退款'});
  assert.equal(refund.channel,'余额原路');
  store.reviewRefund(admin,refund.id,{action:'approve',reason:'核验退款'});
  assert.equal(store.personal(customer).wallet.balanceCents,before);
  assert.equal(store.workspace(escort).wallet.balanceCents,income);
  assert.equal(store.read().orders.find(o=>o.id===order.id).status,'已退款');
  assert.throws(()=>store.reviewRefund(admin,refund.id,{action:'approve'}),{status:409});
});

test('部分退款恢复待验收并只结算剩余金额，提现待打款仍冻结',t=>{
  const {store,customer,escort,admin,create,update,finish}=fixture(t);
  const order=create();finish(order);
  const request=store.createRefund(customer,{context:'personal',orderId:order.id,amountCents:1700,reason:'部分服务未达约定'});
  store.reviewRefund(admin,request.id,{action:'approve',reason:'按约退款'});
  assert.equal(store.read().orders.find(o=>o.id===order.id).status,'待验收');
  const done=update(customer,order,'approve',{context:'personal'});
  assert.equal(done.participants[0].earningCents,Math.round(5100*done.participants[0].shareBps/10000));
  const withdrawal=store.withdrawal(escort,{amount:'10'});
  store.reviewWithdrawal(admin,withdrawal.id,{action:'approve',reason:'已核对'});
  assert.equal(store.workspace(escort).wallet.frozenCents,1000);
  store.reviewWithdrawal(admin,withdrawal.id,{action:'markPaid',payoutRef:'QA-PAYOUT-001'});
  assert.equal(store.workspace(escort).wallet.frozenCents,0);
});

test('普通成员及工作人员个人能力仅处理本人，消息未读独立且内部备注不外泄',t=>{
  const {store,user,admin}=fixture(t);const member=user('member-demo'),service=user('service');
  assert.ok(store.workspace(member).role.pages.includes('memberWallet'));
  const chat=store.conversationCreate(member,{context:'personal',escortName:'俱乐部客服',message:'咨询服务'});
  assert.equal(store.workspace(admin).conversations.find(c=>c.id===chat.id).unread,1);
  store.conversationAction(service,chat.id,{note:'内部专用说明',state:'已结束'});
  store.conversationMessage(member,chat.id,{context:'personal',message:'追加问题'});
  const reopened=store.workspace(service).conversations.find(c=>c.id===chat.id);
  assert.equal(reopened.state,'处理中');assert.ok(reopened.slaDueAt);
  store.conversationMessage(service,chat.id,{message:'已收到'});
  const personal=store.personal(member).conversations.find(c=>c.id===chat.id);
  assert.equal(personal.unread,1);assert.equal(personal.notes,undefined);
  store.conversationAction(member,chat.id,{context:'personal'});
  assert.equal(store.personal(member).conversations.find(c=>c.id===chat.id).unread,0);
  assert.throws(()=>store.conversationAction(user('demo-user'),chat.id,{context:'personal'}),{status:403});
  assert.throws(()=>store.conversationAction(member,chat.id,{context:'personal',note:'越权内部备注'}),{status:403});
  const staffChat=store.conversationCreate(service,{context:'personal',escortName:'俱乐部客服',message:'工作人员的个人咨询'});
  assert.ok(store.personal(service).conversations.some(c=>c.id===staffChat.id));
});

test('下架游戏仅禁止新订单，已付订单仍可接单并验收',t=>{
  const {store,customer,admin,create,finish,update}=fixture(t);const order=create();
  catalogAction(store,admin,'games',{action:'state',originalName:'王者荣耀',version:0,state:'下架'});
  assert.throws(()=>create());finish(order);const done=update(customer,order,'approve',{context:'personal'});assert.equal(done.status,'已完成');
});

test('指定订单在扣款前拦截多人服务、冻结成员和等级不符',t=>{
  const {store,customer,escort,admin}=fixture(t);
  const input={context:'personal',boss:customer.name,productId:'product-1',hours:1,pay:'在线支付',requirement:'指定服务测试',orderMode:'designated',preferredEscortId:escort.id};
  const before=store.personal(customer).wallet.balanceCents;
  store.transaction(admin,'account:manage','设置测试成员',data=>{data.users.find(u=>u.id===escort.id).escortFrozen=true;});
  assert.throws(()=>store.createOrder(customer,input),/暂不可接单/);
  assert.equal(store.personal(customer).members.some(m=>m.id===escort.id),false);
  store.transaction(admin,'account:manage','恢复测试成员',data=>{const member=data.users.find(u=>u.id===escort.id);member.escortFrozen=false;member.levelId='gold';});
  assert.throws(()=>store.createOrder(customer,{...input,levelId:'star'}),/等级/);
  const game=store.read().games.find(g=>g.name==='王者荣耀');
  catalogAction(store,admin,'games',{...game,action:'save',originalName:game.name,version:game.version??0,min:2,max:3});
  assert.throws(()=>store.createOrder(customer,input),/多人配合/);
  assert.equal(store.personal(customer).wallet.balanceCents,before);
});

test('长商品名可购买，同名用户仍按本人客户 ID 扣款',t=>{
  const {store,customer,admin}=fixture(t);
  const before=store.personal(customer).wallet.balanceCents;
  const name='完整服务说明'.repeat(9);
  const product=catalogAction(store,admin,'products',{action:'save',name,game:'王者荣耀',priceCents:1234,unit:'小时',note:'长名称服务',state:'启用'});
  store.transaction(admin,'account:manage','准备同名用户',data=>{data.customers.push({id:'same-name-customer',name:customer.name,balanceCents:55555});});
  const order=store.createOrder(customer,{context:'personal',boss:customer.name,productId:product.id,hours:1,pay:'在线支付',requirement:'同名用户购买服务'});
  assert.equal(order.product,name);
  assert.equal(order.customerId,customer.customerId);
  assert.equal(store.personal(customer).wallet.balanceCents,before-1234);
  assert.equal(store.read().customers.find(c=>c.id==='same-name-customer').balanceCents,55555);
});

test('服务前全额退款返还余额并阻止继续接单',t=>{
  const {store,customer,escort,admin,create,update}=fixture(t);
  const before=store.personal(customer).wallet.balanceCents,order=create();
  const refund=store.createRefund(customer,{context:'personal',orderId:order.id,amountCents:order.amountCents,reason:'开始服务前取消预约'});
  assert.throws(()=>update(escort,order,'accept'),{status:403});
  store.reviewRefund(admin,refund.id,{action:'approve'});
  assert.equal(store.personal(customer).wallet.balanceCents,before);
  assert.equal(store.read().orders.find(o=>o.id===order.id).status,'已退款');
  assert.throws(()=>update(escort,order,'accept'),{status:403});
  assert.equal(store.read().ledger.some(l=>l.source===order.id && l.label==='订单分成'),false);
});

test('服务前退款审核暂停履约，驳回或部分退款后恢复原阶段',t=>{
  const {store,customer,escort,admin,create,update}=fixture(t),order=create();
  update(admin,order,'dispatch',{memberIds:[escort.id]});
  update(customer,order,'selectApplicant',{memberIds:[escort.id]});
  const request=()=>store.createRefund(customer,{context:'personal',orderId:order.id,amountCents:1700,reason:'调整服务安排'});
  let refund=request();
  assert.equal(hasOpenOrders(store.read(),escort.id),true);
  assert.equal(profileConflicts(store.read(),{...escort,games:[]}),true);
  assert.throws(()=>update(escort,order,'accept'),{status:409});
  store.reviewRefund(admin,refund.id,{action:'reject',reason:'已协商继续服务'});
  assert.equal(store.read().orders.find(o=>o.id===order.id).status,'待确认');
  update(escort,order,'accept');
  refund=request();
  assert.throws(()=>update(escort,order,'start'),{status:409});
  store.reviewRefund(admin,refund.id,{action:'approve'});
  assert.equal(store.read().orders.find(o=>o.id===order.id).status,'待服务');
  update(escort,order,'start');update(escort,order,'finish',{evidence:'已完成协商后的服务'});
  const done=update(customer,order,'approve',{context:'personal'});
  assert.equal(done.participants[0].earningCents,Math.round(5100*done.participants[0].shareBps/10000));
});
