import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { metrics, trend, ranking, dateRange, FOUR_HOURS, analyticsOptions } from '../server/analytics.mjs';
import { ClubStore } from '../server/club.mjs';
import { createClubServer } from '../server.mjs';

const at = Date.parse('2026-09-11T18:00:00+08:00');
const person = (id,name=id) => ({userId:id,name});
const order = (id,overrides={}) => ({id,boss:'老板甲',customerId:'customer-a',game:'王者荣耀',product:'排位赛',tags:['上分'],amountCents:10000,status:'已完成',createdAt:'2026-09-10T23:30:00+08:00',completedAt:'2026-09-11T00:00:00+08:00',participants:[person('one','米粒')],...overrides});
const fixtures = {games:[{name:'王者荣耀'},{name:'和平精英'}],orders:[
  order('o1'),
  order('o2',{amountCents:2550,createdAt:'2026-09-11T01:00:00+08:00',completedAt:'2026-09-11T02:00:00+08:00',participants:[person('one','米粒'),person('two','阿九'),person('one','米粒')]}),
  order('o3',{amountCents:8000,boss:'老板乙',customerId:'customer-b',game:'和平精英',tags:['娱乐'],createdAt:'2026-09-10T15:00:00+08:00',completedAt:'2026-09-10T16:00:00+08:00',participants:[person('two','阿九')]}),
  order('pending',{status:'待验收',boss:'老板丙',customerId:'customer-c',createdAt:'2026-09-11T02:00:00+08:00'}),
  order('refund',{status:'退款审核'}),
  order('future',{completedAt:'2026-09-12T00:00:00+08:00',createdAt:'2026-09-12T00:00:00+08:00',customerId:'future'}),
]};
const query={kind:'escorts',start:'2026-09-10',end:'2026-09-11'};
test('经营数据按完成/下单时间区分，边界为北京时间零点，用户和订单去重',()=>{
  const totals=metrics(fixtures,undefined,at);
  assert.deepEqual(totals,{amountCents:20550,orderCount:3,buyerCount:3});
  assert.deepEqual(metrics(fixtures,dateRange('2026-09-11','2026-09-11'),at),{amountCents:12550,orderCount:2,buyerCount:2});
  assert.deepEqual(metrics({...fixtures,orders:[...fixtures.orders,fixtures.orders[0]]},undefined,at),totals);
  assert.deepEqual(metrics(fixtures,dateRange('2026-09-09','2026-09-09'),at),{amountCents:0,orderCount:0,buyerCount:0});
});
test('曲线连续补零、单日查询、双轴合计与金额分精度',()=>{
  const result=trend(fixtures,{start:'2026-09-09',end:'2026-09-11'},at);
  assert.deepEqual(result.points.map(p=>[p.day,p.orderCount,p.amountCents]),[['2026-09-09',0,0],['2026-09-10',1,8000],['2026-09-11',2,12550]]);
  assert.deepEqual(result.total,{orderCount:3,amountCents:20550});
  assert.equal(trend(fixtures,{start:'2026-09-11',end:'2026-09-11'},at).points.length,1);
});
test('游戏与 Tag 同时筛选、多人订单不重复同人、订单级下钻和分页',()=>{
  const list=ranking(fixtures,query,at);
  assert.equal(list.rows[0].key,'one'); assert.equal(list.rows[0].orderCount,2);assert.equal(list.rows[0].amountCents,12550);
  const filtered={...query,game:'王者荣耀',tag:'上分',sort:'count'};
  assert.equal(ranking(fixtures,filtered,at).rows[1].amountCents,2550);
  assert.equal(ranking(fixtures,{...filtered,tag:'娱乐'},at).total,0);
  const detail=ranking(fixtures,{...filtered,key:'one',pageSize:1,page:2},at,true);
  assert.equal(detail.total,2);assert.equal(detail.amountCents,12550);assert.equal(detail.orders[0].id,'o1');
  const bosses=ranking(fixtures,{...query,kind:'buyers'},at);assert.equal(bosses.rows[0].orderCount,2);assert.equal(bosses.total,2);
  const orders=ranking(fixtures,{...query,kind:'orders'},at);assert.equal(orders.rows[0].key,'o1');assert.equal(orders.total,3);
  assert.deepEqual(ranking(fixtures,{...query,kind:'orders',key:'o2'},at,true).orders.map(o=>o.id),['o2']);
  assert.deepEqual(analyticsOptions(fixtures).tagsByGame['和平精英'],['娱乐']);
});
test('拒绝无效日期、颠倒区间、过长区间、无效榜单与分页',()=>{
  for(const dates of [['2026-02-30','2026-03-01'],['2026-09-12','2026-09-11'],['2025-01-01','2026-09-11'],['x','2026-09-11']]) assert.throws(()=>dateRange(...dates),e=>e.status===400);
  assert.equal(dateRange('2024-02-29','2024-02-29').days,1);
  assert.throws(()=>ranking(fixtures,{...query,kind:'admin'},at),e=>e.status===400);
  assert.throws(()=>ranking(fixtures,{...query,page:0.5},at),e=>e.status===400);
});
test('没有完成时间的真实订单不猜测日期，旧示例可回退且不改写订单',()=>{
  const missing=order('missing',{completedAt:null,history:[]});
  assert.equal(metrics({...fixtures,orders:[missing]},undefined,at).orderCount,0);
  const imported=order('import',{completedAt:null,history:[{action:'示例订单导入'}]});
  assert.equal(metrics({...fixtures,orders:[imported]},undefined,at).orderCount,1);
  assert.equal(imported.completedAt,null);
});
test('总数据保持四小时快照，重复刷新不会提前重算，到期后更新',t=>{
  const store=new ClubStore(':memory:');t.after(()=>store.close());
  const data=store.read();data.orders=[order('cached')];store.db.prepare('UPDATE club SET data=? WHERE id=1').run(JSON.stringify(data));
  const first=store.totalSnapshot(at);assert.equal(first.orderCount,1);
  data.orders.push(order('new',{amountCents:7900}));store.db.prepare('UPDATE club SET data=? WHERE id=1').run(JSON.stringify(data));
  assert.deepEqual(store.totalSnapshot(at+FOUR_HOURS-1),first);
  const next=store.totalSnapshot(at+FOUR_HOURS);assert.equal(next.orderCount,2);assert.equal(next.amountCents,17900);assert.equal(Date.parse(next.asOf)-Date.parse(first.asOf),FOUR_HOURS);
});
test('经营统计和考官配置只对最高负责人开放',async t=>{
  const {server}=createClubServer({database:':memory:'});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const endpoint='/api/analytics/summary?day=2026-09-11';
  assert.equal((await fetch(base+endpoint)).status,401);
  for(const username of ['admin','service','escort']){
    const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'123456'})});
    const Cookie=login.headers.get('set-cookie').split(';')[0];
    const result=await fetch(base+endpoint,{headers:{Cookie}});assert.equal(result.status,username==='admin'?200:403);
    const response=await fetch(base+'/api/examiners/escort',{method:'POST',headers:{Cookie,'Content-Type':'application/json'},body:JSON.stringify({examiner:true})});assert.equal(response.status,username==='admin'?200:403);
    if(username==='admin'){
      const bad=await fetch(base+'/api/analytics/trend?start=2026-09-12&end=2026-09-11',{headers:{Cookie}});assert.equal(bad.status,400);
      const offline=await fetch(base+'/api/examiners/taotao',{method:'POST',headers:{Cookie,'Content-Type':'application/json'},body:JSON.stringify({examiner:true})});assert.equal(offline.status,400);
    }
  }
});
