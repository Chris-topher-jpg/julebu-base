import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { createBasicClubServer } from '../server.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');

test('customers can choose hours or an actual fixed package from the default catalog', async () => {
  const app = createBasicClubServer();
  let browser;
  try {
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${app.server.address().port}`;
    browser = await chromium.launch({ headless: true, ...(process.env.BOOKING_BROWSER_EXECUTABLE ? { executablePath: process.env.BOOKING_BROWSER_EXECUTABLE } : {}) });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const login = await page.request.post(`${base}/api/login`, { data: { username: 'user', password: '123456' } });
    assert.equal(login.status(), 200);
    await page.goto(base);
    const openOrder = async name => {
      await page.locator('.service-card').filter({ has: page.getByRole('heading', { name, exact: true }) }).getByRole('button', { name: '查看详情', exact: true }).click();
      await page.getByRole('button', { name: /预约这项服务/ }).click();
    };
    await openOrder('竞技上分陪玩');
    const hourly = page.locator('[data-booking-mode="hourly"]');
    const fixed = page.locator('[data-booking-mode="package"]');
    const hours = page.getByLabel('服务时长（小时）', { exact: true });
    const total = page.locator('#booking-total');
    assert.equal(await hourly.getAttribute('aria-pressed'), 'true');
    assert.equal(await hours.inputValue(), '1');
    await page.getByRole('button', { name: '增加一小时', exact: true }).click();
    assert.equal(await hours.inputValue(), '2');
    assert.equal(await total.innerText(), '¥136.00');
    await page.getByRole('button', { name: '减少一小时', exact: true }).click();
    assert.equal(await total.innerText(), '¥68.00');
    assert.equal(await page.getByRole('button', { name: '减少一小时', exact: true }).isDisabled(), true);
    await hours.fill('24');
    assert.equal(await page.getByRole('button', { name: '增加一小时', exact: true }).isDisabled(), true);
    await hours.fill('1.5');
    assert.equal(await total.innerText(), '—');
    await hours.fill('3');
    assert.equal(await total.innerText(), '¥204.00');
    await page.getByLabel('游戏名称', { exact: true }).selectOption('1');
    await page.getByLabel('联系方式', { exact: true }).fill('booking-regression');
    await page.getByLabel('区服（选填）', { exact: true }).fill('微信区');
    await page.getByLabel('备注', { exact: true }).fill('保留需求');
    await fixed.click();
    await page.getByLabel('服务类型', { exact: true }).selectOption('3');
    assert.equal(await hours.count(), 0);
    assert.equal(await total.innerText(), '¥128.00');
    assert.match(await page.locator('#booking-quote').innerText(), /固定套餐 · 2 小时/);
    await hourly.click();
    assert.equal(await hours.inputValue(), '3');
    assert.equal(await total.innerText(), '¥204.00');
    assert.equal(await page.getByLabel('联系方式', { exact: true }).inputValue(), 'booking-regression');
    assert.equal(await page.getByLabel('区服（选填）', { exact: true }).inputValue(), '微信区');
    assert.equal(await page.getByLabel('备注', { exact: true }).inputValue(), '保留需求');
    await mkdir('test-results', { recursive: true });
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator('.order-form').evaluate(form => { form.scrollTop = 0; });
      assert.ok(await page.locator('.order-form').evaluate(form => form.scrollWidth <= form.clientWidth), `Order form overflows at ${width}px`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: `test-results/booking-hours-${width}.png` });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '确认下单', exact: true }).click();
    await page.waitForURL('**/#/orders');
    const order = app.db.prepare('SELECT * FROM orders').get();
    assert.equal(order.pricing_mode, 'hourly');
    assert.equal(order.duration_hours, 3);
    assert.equal(order.price_cents, 20400);
    assert.match(order.note, /微信区[\s\S]*保留需求/);
    await page.getByRole('link', { name: '服务大厅', exact: true }).click();
    await openOrder('开黑组队服务');
    await hourly.click();
    await page.getByRole('button', { name: '5 小时', exact: true }).click();
    assert.equal(await total.innerText(), '¥340.00');
    await fixed.click();
    assert.equal(await page.getByLabel('服务类型', { exact: true }).inputValue(), '3');
    assert.equal(await total.innerText(), '¥128.00');
    await page.getByLabel('游戏名称', { exact: true }).selectOption('2');
    assert.equal(await page.getByLabel('游戏类型', { exact: true }).inputValue(), 'MOBA');
    await page.getByLabel('联系方式', { exact: true }).fill('package-regression');
    await page.getByRole('button', { name: '确认下单', exact: true }).click();
    await page.waitForURL('**/#/orders');
    const packageOrder = app.db.prepare("SELECT * FROM orders WHERE pricing_mode='package'").get();
    assert.equal(packageOrder.price_cents, 12800);
    assert.equal(packageOrder.duration_hours, 2);
    assert.equal(packageOrder.service_id, 3);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    if (app.server.listening) await new Promise(resolve => app.server.close(resolve));
    app.close();
  }
});

test('the running preview offers editable hours without creating an order', { skip: !process.env.BOOKING_PREVIEW_URL }, async () => {
  const base = process.env.BOOKING_PREVIEW_URL;
  assert.equal(new URL(base).hostname, '127.0.0.1');
  const browser = await chromium.launch({ headless: true, ...(process.env.BOOKING_BROWSER_EXECUTABLE ? { executablePath: process.env.BOOKING_BROWSER_EXECUTABLE } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(8000);
    const catalog = await (await page.request.get(`${base}/api/public/services`)).json();
    assert.equal(catalog.demo, true);
    assert.equal(catalog.services.find(service => service.name === '竞技上分陪玩').pricingMode, 'hourly');
    assert.equal((await page.request.post(`${base}/api/login`, { data: { username: 'user', password: '123456' } })).status(), 200);
    const before = (await (await page.request.get(`${base}/api/me`)).json()).orders;
    await page.goto(base);
    await page.locator('.service-card').filter({ hasText: '竞技上分陪玩' }).getByRole('button', { name: '查看详情', exact: true }).click();
    await page.getByRole('button', { name: /预约这项服务/ }).click();
    await page.getByRole('button', { name: '3 小时', exact: true }).click();
    assert.equal(await page.getByLabel('服务时长（小时）', { exact: true }).inputValue(), '3');
    assert.equal(await page.locator('#booking-total').innerText(), '¥204.00');
    await page.locator('[data-booking-mode="package"]').click();
    assert.equal(await page.locator('#booking-hours').count(), 0);
    await page.locator('[data-booking-mode="hourly"]').click();
    assert.equal(await page.getByLabel('服务时长（小时）', { exact: true }).inputValue(), '3');
    await page.locator('.order-form').evaluate(form => { form.scrollTop = 0; });
    await mkdir('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/live-booking-hours.png' });
    const after = (await (await page.request.get(`${base}/api/me`)).json()).orders;
    assert.deepEqual(after, before);
    await page.request.post(`${base}/api/logout`, { data: {} });
  } finally { await browser.close(); }
});
