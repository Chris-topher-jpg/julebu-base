import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createClubServer } from '../server.mjs';

test('角色权限、数据归属、订单状态、金额与持久化', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'club-role-test-'));
  const database = join(folder, 'club.sqlite');
  let instance = createClubServer({ database });
  instance.server.listen(0, '127.0.0.1'); await once(instance.server, 'listening');
  let base = `http://127.0.0.1:${instance.server.address().port}`;
  const clients = {};
  const call = async (who, path, body, headers = {}) => {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(clients[who] ? { Cookie: clients[who] } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: base }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const content = await response.json().catch(() => null);
    return { status: response.status, body: content, headers: response.headers };
  };
  const login = async (who, username = who, password = '123456') => {
    const result = await call(who, '/api/login', { username, password }); assert.equal(result.status, 200, JSON.stringify(result.body));
    clients[who] = result.headers.get('set-cookie').split(';')[0]; return result;
  };
  const workspace = async who => (await call(who, '/api/workspace')).body;
  const order = async (who, id) => (await workspace(who)).orders.find(o => o.id === id);
  const action = async (who, id, verb, extra = {}) => call(who, `/api/orders/${id}/${verb}`, { version: (await order(who, id))?.version, ...extra });
  t.after(async () => { await new Promise(r => instance.server.close(r)); rmSync(folder, { recursive: true, force: true }); });
  await t.test('登录失败、匿名请求与伪造角色不会获得权限', async () => {
    assert.equal((await call('anon', '/api/workspace')).status, 401);
    assert.equal((await call('anon', '/api/login', { username: 'admin', password: 'wrong' })).status, 401);
    clients.fake = 'club_session=admin'; assert.equal((await call('fake', '/api/workspace')).status, 401);
    for (const who of ['admin','service','escort']) { const result = await login(who); assert.match(result.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/); }
    assert.equal((await call('escort','/api/accounts')).status,403);
    assert.equal((await call('service','/api/topups')).status,403);
    assert.equal((await call('escort','/api/conversations')).status,403);
    assert.equal((await call('service','/api/accounts', {role:'admin'})).status,403);
    assert.equal((await call('escort','/api/online',{online:true},{Origin:'http://evil.example'})).status,403);
    for (const path of ['/server/seed.mjs','/server/club.mjs','/data/club.sqlite','/server.mjs']) assert.equal((await call('anon',path)).status,404);
  });
  await t.test('打手数据只包含本人订单与收益，客服不返回财务数据', async () => {
    const w = await workspace('escort');
    assert.deepEqual(w.role.pages,['overview','availableOrders','myOrders','myEarnings']);
    assert.ok(w.orders.every(o => o.participants.some(p => p.userId === 'escort')));
    assert.ok(w.availableOrders.every(o => w.user.games.includes(o.game)));
    assert.equal(w.accounts,undefined); assert.equal(w.topups,undefined); assert.equal(w.conversations,undefined);
    assert.equal(w.orders[0].participants.find(p => p.userId !== 'escort').shareBps,undefined);
    const service = await workspace('service'); assert.equal(service.ledger,undefined); assert.equal(service.withdrawals,undefined);
    assert.equal(JSON.stringify(service).includes('passwordHash'),false);
  });
  await t.test('阻止不属于本人的操作、不匹配游戏、重复派单与服务冲突', async () => {
    assert.equal((await action('escort','PO20240618019','finish',{evidence:'非法完单操作'})).status,409);
    const foreign = await order('service','PO20240618019');
    assert.equal((await call('escort',`/api/orders/${foreign.id}/finish`,{version:foreign.version,evidence:'非法完单操作'})).status,403);
    const incompatible = await order('service','PO20240618027');
    assert.equal((await call('escort',`/api/orders/${incompatible.id}/accept`,{version:incompatible.version})).status,400);
    assert.equal((await action('service','PO20240618035','dispatch',{memberIds:['escort','escort']})).status,400);
    assert.equal((await action('service','PO20240618035','dispatch',{memberIds:['escort']})).status,200);
    assert.equal((await action('service','PO20240618035','dispatch',{memberIds:['escort']})).status,409);
    assert.equal((await action('escort','PO20240618035','finish',{evidence:'未开始就提交'})).status,409);
    assert.equal((await action('escort','PO20240618035','accept')).status,200);
    assert.equal((await action('escort','PO20240618035','start')).status,409);
    assert.equal((await action('escort','PO20240618031','finish',{evidence:'游戏陪玩服务已完成，客户确认无异议'})).status,200);
    const before = (await workspace('escort')).wallet.balanceCents;
    assert.equal((await action('service','PO20240618031','approve')).status,200);
    assert.equal((await workspace('escort')).wallet.balanceCents,before+4760);
    assert.equal((await action('service','PO20240618031','approve')).status,409);
    assert.equal((await action('escort','PO20240618035','start')).status,200);
    assert.equal((await action('escort','PO20240618035','finish',{evidence:'服务已按要求完成，请核验'})).status,200);
    assert.equal((await action('service','PO20240618035','return',{reason:'请补充本次服务说明'})).status,200);
    assert.equal((await action('escort','PO20240618035','finish',{evidence:'补充：排位辅助全程开麦，客户认可'})).status,200);
    assert.equal((await action('service','PO20240618035','approve')).status,200);
  });
  let createdId;
  await t.test('新建订单由服务端定价、余额校验、维护中商品拦截', async () => {
    const body = {boss:'测试老板', productId:'product-1', hours:2, requirement:'游戏开麦陪玩测试', pay:'线下已收款', amountCents:1};
    assert.equal((await call('escort','/api/orders',body)).status,403);
    assert.equal((await call('service','/api/orders',{...body,hours:-1})).status,400);
    assert.equal((await call('service','/api/orders',{...body,productId:'product-4'})).status,400);
    assert.equal((await call('service','/api/orders',{...body,pay:'余额支付'})).status,400);
    const result = await call('service','/api/orders',body); assert.equal(result.status,201); assert.equal(result.body.amountCents,13600); createdId=result.body.id;
    const pending = await order('service',createdId);
    const results = await Promise.all([call('escort',`/api/orders/${createdId}/accept`,{version:pending.version}),call('escort',`/api/orders/${createdId}/accept`,{version:pending.version})]);
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  });
  await t.test('充值只入账一次、提现不能超额或重复申请、驳回返还', async () => {
    const topupId = 'CZ20240618012';
    assert.equal((await call('service',`/api/topups/${topupId}`,{action:'approve',reason:'已核验到账'})).status,403);
    assert.equal((await call('admin',`/api/topups/${topupId}`,{action:'approve',reason:'已核验到账'})).status,200);
    assert.equal((await call('admin',`/api/topups/${topupId}`,{action:'approve',reason:'已核验到账'})).status,409);
    const before = (await workspace('escort')).wallet.balanceCents;
    assert.equal((await call('escort','/api/withdrawals',{amount:'9999999999'})).status,400);
    const request = await call('escort','/api/withdrawals',{amount:'100'}); assert.equal(request.status,201);
    assert.equal((await workspace('escort')).wallet.balanceCents,before-10000);
    assert.equal((await call('escort','/api/withdrawals',{amount:'100'})).status,409);
    assert.equal((await call('service',`/api/withdrawals/${request.body.id}`,{action:'approve'})).status,403);
    assert.equal((await call('admin',`/api/withdrawals/${request.body.id}`,{action:'reject',reason:'核对后重新提交'})).status,200);
    assert.equal((await workspace('escort')).wallet.balanceCents,before);
    assert.equal((await call('admin',`/api/withdrawals/${request.body.id}`,{action:'reject',reason:'重复驳回'})).status,409);
  });
  await t.test('创建成员、职责调整使旧会话失效、禁止管理员停用自己', async () => {
    const created = await call('admin','/api/accounts',{username:'new_staff',password:'testpass123',name:'测试客服',role:'service',active:true,games:[],shareBps:0});
    assert.equal(created.status,200); await login('new','new_staff','testpass123');
    const update = await call('admin',`/api/accounts/${created.body.id}`,{name:'测试打手',role:'escort',active:true,games:['王者荣耀'],shareBps:6500}); assert.equal(update.status,200);
    assert.equal((await call('new','/api/workspace')).status,401);
    await login('new','new_staff','testpass123'); assert.equal((await workspace('new')).user.role,'escort');
    assert.equal((await call('admin','/api/accounts/admin',{name:'杨澄',role:'admin',active:false,games:[],shareBps:0})).status,400);
  });
  await t.test('退出会话立即失效，服务重启后订单和会话均保留', async () => {
    const saved = clients.service; await call('service','/api/logout',{}); clients.service=saved;
    assert.equal((await call('service','/api/workspace')).status,401);
    await new Promise(r => instance.server.close(r));
    instance = createClubServer({database}); instance.server.listen(0,'127.0.0.1'); await once(instance.server,'listening');
    base=`http://127.0.0.1:${instance.server.address().port}`;
    const w = await workspace('admin'); assert.ok(w.orders.some(o=>o.id===createdId)); assert.ok(w.audit.length>0);
    assert.equal((await call('service','/api/workspace')).status,401);
  });
});
