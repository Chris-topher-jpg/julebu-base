import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClubStore } from '../server/club.mjs';
import { catalogAction } from '../server/catalog.mjs';

test('商品配置校验权限、并发版本，并保留旧订单价格与引用', t=>{
  const store=new ClubStore(':memory:');t.after(()=>store.close());
  const admin=store.read().users.find(u=>u.id==='admin'), service=store.read().users.find(u=>u.id==='service');
  const game=catalogAction(store,admin,'games',{action:'save',name:'验证游戏',category:'竞技',min:1,max:2,state:'上架'});
  const product=catalogAction(store,admin,'products',{action:'save',name:'验证服务',game:game.name,unit:'小时',priceCents:12345,note:'价格测试',state:'启用'});
  assert.throws(()=>catalogAction(store,service,'products',{action:'state',id:product.id,version:1,state:'暂停'}),{status:403});
  const order=store.createOrder(service,{boss:'价格测试客户',productId:product.id,hours:2,pay:'线下已收款',requirement:'核验商品价格快照'});
  const updated=catalogAction(store,admin,'products',{...product,name:'修改后的服务',action:'save',priceCents:7777});
  const old=store.read().orders.find(o=>o.id===order.id);
  assert.equal(old.amountCents,24690);assert.equal(old.product,'验证服务');assert.equal(updated.priceCents,7777);
  assert.throws(()=>catalogAction(store,admin,'products',{action:'state',id:product.id,version:1,state:'暂停'}),{status:409});
  assert.throws(()=>catalogAction(store,admin,'products',{action:'delete',id:product.id,version:2}),{status:409});
  assert.throws(()=>catalogAction(store,admin,'games',{action:'delete',originalName:game.name,version:1}),{status:409});
  catalogAction(store,admin,'products',{action:'state',id:product.id,version:2,state:'暂停'});
  assert.throws(()=>store.createOrder(service,{boss:'价格测试客户',productId:product.id,hours:1,pay:'线下已收款',requirement:'暂停服务不可再买'}));
  assert.ok(store.auditList(admin).some(a=>a.action.includes('商品配置')));
});

test('配置拒绝非法金额和人数，未被引用的游戏和商品可删除', t=>{
  const store=new ClubStore(':memory:');t.after(()=>store.close());const admin={id:'admin'};
  assert.throws(()=>catalogAction(store,admin,'games',{action:'save',name:'错人数',category:'MOBA',min:4,max:1,state:'上架'}));
  const game=catalogAction(store,admin,'games',{action:'save',name:'临时测试',category:'策略',min:1,max:1,state:'下架'});
  const input={action:'save',name:'测试商品',game:game.name,unit:'小时',note:'',state:'暂停'};
  for(const priceCents of [-1,0,1.5,Infinity,100000001])assert.throws(()=>catalogAction(store,admin,'products',{...input,priceCents}));
  const p=catalogAction(store,admin,'products',{...input,priceCents:1});
  catalogAction(store,admin,'products',{action:'delete',id:p.id,version:1});
  catalogAction(store,admin,'games',{action:'delete',originalName:game.name,version:1});
  assert.equal(store.read().games.some(g=>g.name===game.name),false);
});
