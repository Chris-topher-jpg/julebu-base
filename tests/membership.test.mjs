import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { ClubStore } from '../server/club.mjs';
import { createClubServer } from '../server.mjs';
import { lockEarnings } from '../server/membership.mjs';

function fixture(t) {
  const store=new ClubStore(':memory:');t.after(()=>store.close());
  const admin=store.read().users.find(u=>u.id==='admin');
  const create=(role='member',suffix=role)=>store.accountAction(admin,null,{username:`test_${suffix}`,password:'testing123',name:`测试${suffix}`,role,active:true,games:role==='escort'?['王者荣耀']:[],levelId:'gold'});
  const person=id=>store.read().users.find(u=>u.id===id);
  const change=(u,action,body)=>store.membershipAction(admin,u.id,action,{...body,memberVersion:person(u.id).memberVersion});
  const order=(levelId='gold')=>store.createOrder(admin,{boss:'测试老板',productId:'product-1',hours:2,requirement:'开麦游戏服务',pay:'线下已收款',levelId});
  return {store,admin,create,person,change,order};
}
test('成员与陪玩共用身份记录，设置角色撤销会话且即时改变权限',t=>{
  const {store,admin,create,person,change}=fixture(t);
  const u=create();const token=store.login(u.username,'testing123').token;
  assert.ok(store.session(token));
  change(u,'role',{role:'finance'});assert.equal(store.session(token),undefined);
  assert.deepEqual(store.workspace(person(u.id)).role.pages,['overview','topups','flows','settlements']);
  assert.equal(store.workspace(person(u.id)).orders,undefined);
  change(u,'role',{role:'service'});
  assert.equal(store.workspace(person(u.id)).ledger,undefined);
  assert.throws(()=>store.membershipAction(person(u.id),admin.id,'role',{role:'member',memberVersion:admin.memberVersion}),e=>e.status===403);
  change(u,'escort',{games:['三角洲行动','英雄联盟'],levelId:'demon'});
  const w=store.workspace(admin);assert.ok(w.accounts.some(m=>m.id===u.id));assert.ok(w.members.some(m=>m.id===u.id));
  assert.equal(w.members.find(m=>m.id===u.id).shareBps,8000);assert.equal(w.members.find(m=>m.id===u.id).levelName,'魔王');
  assert.throws(()=>change(u,'role',{role:'admin'}),/先在陪玩管理/);
  change(u,'remove',{});assert.ok(!store.workspace(admin).members.some(m=>m.id===u.id));assert.ok(store.workspace(admin).accounts.some(m=>m.id===u.id));
  assert.throws(()=>change(admin,'escort',{levelId:'gold'}),/自己的/);
  assert.throws(()=>change(admin,'role',{role:'finance'}),/自己的/);
  assert.throws(()=>change(u,'role',{role:'manager'}),/有效的管理角色/);
  assert.ok(!store.workspace(admin).roleOptions.some(r=>r.id==='manager'));
});
test('高等级可以接低等级单，低等级在大厅、派单、直接接单均受阻；新单锁定等级分成',t=>{
  const {store,admin,create,person,change,order}=fixture(t);
  const low=create('escort','low'),high=create('escort','high');change(high,'profile',{games:['王者荣耀'],levelId:'demon'});
  store.setOnline(low,{online:true});store.setOnline(high,{online:true});
  const premium=order('demon'),basic=order('gold');
  assert.ok(!store.workspace(person(low.id)).availableOrders.some(o=>o.id===premium.id));
  assert.ok(store.workspace(person(high.id)).availableOrders.some(o=>o.id===basic.id));
  assert.throws(()=>store.orderAction(low,premium.id,'accept',{version:premium.version}),/等级/);
  assert.throws(()=>store.orderAction(admin,premium.id,'dispatch',{version:premium.version,memberIds:[low.id]}),/等级/);
  const accepted=store.orderAction(high,basic.id,'accept',{version:basic.version});assert.equal(accepted.participants[0].shareBps,8000);
  change(high,'profile',{games:['王者荣耀'],levelId:'star'});
  assert.equal(store.read().orders.find(o=>o.id===basic.id).participants[0].shareBps,8000);
  const levels=store.read().levels.map(l=>({...l,shareBps:l.shareBps-100}));store.configureLevels(admin,{revision:store.read().revision,levels});
  assert.equal(person(high.id).shareBps,8400);assert.equal(store.read().orders.find(o=>o.id===basic.id).participants[0].shareBps,8000);
  const acceptedPremium=store.orderAction(high,premium.id,'accept',{version:premium.version});assert.equal(acceptedPremium.participants[0].shareBps,8400);
  assert.throws(()=>change(high,'profile',{games:['王者荣耀'],levelId:'gold'}),e=>e.status===409);
  assert.throws(()=>change(high,'profile',{games:['三角洲行动'],levelId:'star'}),e=>e.status===409);
  assert.throws(()=>order('fake'),/有效的订单等级/);
});
test('多人分成总和不超额、每人按等级分摊，冻结后禁止新接单但不阻塞已开始订单完单',t=>{
  const {store,admin,create,person,change,order}=fixture(t);
  const a=create('escort','a'),b=create('escort','b');change(a,'profile',{games:['王者荣耀'],levelId:'demon'});
  store.setOnline(a,{online:true});store.setOnline(b,{online:true});
  let o=order();o=store.orderAction(admin,o.id,'dispatch',{version:o.version,memberIds:[a.id,b.id]});
  assert.deepEqual(o.participants.map(p=>p.shareBps),[4000,3500]);
  o=store.orderAction(a,o.id,'accept',{version:o.version});o=store.orderAction(b,o.id,'accept',{version:o.version});
  change(a,'freeze',{frozen:true});assert.throws(()=>store.orderAction(a,o.id,'start',{version:o.version}),/暂不能开始/);
  assert.deepEqual(store.workspace(person(a.id)).availableOrders,[]);assert.throws(()=>store.setOnline(a,{online:true}),/冻结/);
  change(a,'freeze',{frozen:false});store.setOnline(a,{online:true});o=store.orderAction(a,o.id,'start',{version:o.version});
  change(a,'freeze',{frozen:true});o=store.orderAction(a,o.id,'finish',{version:o.version,evidence:'服务完成请客服验收'});assert.equal(o.participants[0].finished,true);
  assert.throws(()=>change(b,'remove',{}),/未完成订单/);
});
test('多人分成在奇数分金额和 100% 分成边界不超付，按小数余数分配尾差',()=>{
  const equal=[{shareBps:5000},{shareBps:5000}];lockEarnings(101,equal);
  assert.deepEqual(equal.map(p=>p.earningCents),[51,50]);
  const mixed=[{shareBps:4000},{shareBps:3500}];lockEarnings(101,mixed);
  assert.deepEqual(mixed.map(p=>p.earningCents),[41,35]);
  assert.equal(mixed.reduce((sum,p)=>sum+p.earningCents,0),Math.round(101*0.75));
});
test('资料版本、无效技能、等级分成顺序、余额及批量操作都有服务端校验',t=>{
  const {store,admin,create,person,change}=fixture(t);
  const a=create('escort','a'),b=create('escort','b');
  assert.throws(()=>store.membershipAction(admin,a.id,'profile',{memberVersion:0,levelId:'star',games:['王者荣耀']}),e=>e.status===409);
  assert.throws(()=>change(a,'profile',{games:['不存在的游戏'],levelId:'star'}),/有效的游戏/);
  const invalid=store.read().levels.map(l=>({...l,shareBps:7000}));assert.throws(()=>store.configureLevels(admin,{revision:store.read().revision,levels:invalid}),/依次递减/);
  store.bindSkills(admin,{members:[a,b].map(u=>({id:u.id,memberVersion:u.memberVersion})),games:['三角洲行动']});assert.deepEqual(person(a.id).games,['王者荣耀','三角洲行动']);
  const before=person(a.id).games;
  assert.throws(()=>store.bindSkills(admin,{members:[{id:a.id,memberVersion:person(a.id).memberVersion},{id:b.id,memberVersion:0}],games:['Apex']}),e=>e.status===409);
  assert.deepEqual(person(a.id).games,before);
  assert.throws(()=>change(person('ajiu'),'remove',{}),/结清/);
  const data=store.read();assert.deepEqual(data.levels.map(l=>l.name),['明星','魔王','巅峰','金牌']);
  assert.ok(data.orders.every(o=>o.levelId));
  assert.equal(data.orders.find(o=>o.id==='PO20240618019').participants[0].shareBps,6800);
});
test('HTTP 层财务、客服、普通成员只能访问获准数据和操作，已移除的身份不可创建',async t=>{
  const {server,store}=createClubServer({database:':memory:'});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`,admin=store.read().users.find(u=>u.id==='admin');
  assert.throws(()=>store.accountAction(admin,null,{username:'removed_manager',password:'testing123',name:'已删除角色',role:'manager',active:true,games:[]}),/职责无效/);
  for(const role of ['service','finance','member']){
    store.accountAction(admin,null,{username:`http_${role}`,password:'testing123',name:role,role,active:true,games:[]});
    const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:`http_${role}`,password:'testing123'})});
    const Cookie=login.headers.get('set-cookie').split(';')[0];
    for(const path of ['accounts','analytics/summary','topups','orders','conversations']){
      const allowed=role==='finance'?path==='topups':role==='service'?['orders','conversations'].includes(path):false;
      assert.equal((await fetch(`${base}/api/${path}`,{headers:{Cookie}})).status,allowed?200:403,`${role} ${path}`);
    }
    assert.equal((await fetch(base+'/api/members/service/escort',{method:'POST',headers:{Cookie,'Content-Type':'application/json'},body:JSON.stringify({memberVersion:1})})).status,403);
  }
});
