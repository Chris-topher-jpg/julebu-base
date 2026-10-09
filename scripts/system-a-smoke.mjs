// Isolated UI check: never reads or writes the local preview database.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClubServer } from '../server.mjs';
import { addFixtureGames } from '../tests/catalog-fixture.mjs';
import { verifyFixtureUsers } from '../tests/real-name-fixture.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const app = createClubServer({ database: ':memory:', production: false, publicOrigin: '' });
addFixtureGames(app.store, ['王者荣耀']);
verifyFixtureUsers(app.store, ['demo-user', 'demo-escort']);
const user = id => app.store.read().users.find(item => item.id === id);
const buyer = user('demo-user'), worker = user('demo-escort'), service = user('demo-service');
const create = () => app.store.createOrder(buyer, { context: 'personal', boss: buyer.name, productId: 'product-1', hours: 1, pay: '在线支付', levelId: 'gold', requirement: '浏览器验证一小时服务' });
const current = order => app.store.read().orders.find(item => item.id === order.id);
const act = (actor, order, action, input = {}) => app.store.orderAction(actor, order.id, action, { version: current(order).version, ...input });
const completed = create();
act(service, completed, 'dispatch', { memberIds: [worker.id] });
act(worker, completed, 'accept'); act(worker, completed, 'start');
act(worker, completed, 'finish', { evidence: '已按要求完成服务，等待验收' });
act(buyer, completed, 'approve', { context: 'personal' });
const cancelled = create();
app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
const base = `http://127.0.0.1:${app.server.address().port}`;
const output = resolve('test-results/system-a'); await mkdir(output, { recursive: true });
const errors = [];
let browser;
async function client(username, path, viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport });
  if (username) assert.equal((await context.request.post(base + '/api/login', { data: { username, password: 'Test1234!' } })).status(), 200);
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + path); return page;
}
async function fits(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'page has no horizontal overflow');
}
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const home = await client(null, '/#/public/overview');
  await home.getByRole('heading', { name: '在线空闲陪玩', exact: true }).waitFor();
  assert.equal(await home.getByRole('link', { name: /派单大厅|动态广场/ }).count(), 0);
  await fits(home); await home.screenshot({ path: resolve(output, 'home-desktop.png'), fullPage: true });
  const personal = await client('demo_user', '/#/personal/memberOrders');
  await personal.getByRole('button', { name: '取消订单', exact: true }).click();
  await personal.getByLabel('取消原因').fill('预约时间变化，需要取消');
  await personal.getByRole('button', { name: '确认取消', exact: true }).click();
  await personal.getByRole('dialog').waitFor({ state: 'detached' });
  assert.equal(current(cancelled).status, '已取消');
  await personal.getByRole('button', { name: '评价服务', exact: true }).click();
  await personal.getByLabel('服务评分').selectOption('2');
  await personal.getByLabel('评价内容').fill('希望下次沟通更加及时');
  await personal.getByRole('button', { name: '提交评价', exact: true }).click();
  await personal.getByRole('dialog').waitFor({ state: 'detached' });
  assert.equal(current(completed).review.rating, 2);
  await fits(personal); await personal.screenshot({ path: resolve(output, 'buyer-orders.png'), fullPage: true });
  const escort = await client('demo_escort', '/#/management/myOrders');
  await escort.getByRole('button', { name: /差评记录/ }).click();
  await escort.getByText('2 星 · 希望下次沟通更加及时', { exact: true }).waitFor();
  assert.equal(await escort.getByRole('button', { name: '接单大厅', exact: true }).count(), 0);
  await escort.screenshot({ path: resolve(output, 'escort-reviews.png'), fullPage: true });
  const staff = await client('demo_service', '/#/management/overview');
  await staff.getByText('客服派单，打手确认', { exact: true }).waitFor();
  await fits(staff); await staff.screenshot({ path: resolve(output, 'service-overview.png'), fullPage: true });
  const admin = await client('demo_admin', '/#/management/overview');
  await admin.getByText('当日退款金额').waitFor();
  await admin.getByText('当月退款金额').waitFor();
  await fits(admin); await admin.screenshot({ path: resolve(output, 'admin-overview.png'), fullPage: true });
  const mobile = await client(null, '/#/public/overview', { width: 390, height: 844 });
  await mobile.getByRole('heading', { name: '在线空闲陪玩', exact: true }).waitFor();
  await fits(mobile); await mobile.screenshot({ path: resolve(output, 'home-mobile.png'), fullPage: true });
  await mobile.goto(base + '/#/public/companions');
  await mobile.getByRole('heading', { name: '大神陪玩', exact: true }).waitFor();
  await fits(mobile); await mobile.screenshot({ path: resolve(output, 'directory-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('System A UI smoke passed: desktop/mobile, role navigation, cancellation and negative review.');
} finally { await browser?.close(); await app.close(); }
