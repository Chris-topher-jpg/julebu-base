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
    assert.equal((await page.request.post(`${base}/api/login`, { data: { username: 'admin', password: '123456' } })).status(), 200);
    assert.equal((await page.request.post(`${base}/api/staff/u_escort`, { data: { name: '陪玩小北', avatarUrl: '/src/assets/gaming.jpg', bio: '擅长射击竞技' } })).status(), 200);
    assert.equal((await page.request.post(`${base}/api/games/1`, { data: { name: '三角洲行动', category: '射击竞技', coverUrl: '/src/assets/gaming.jpg' } })).status(), 200);
    const login = await page.request.post(`${base}/api/login`, { data: { username: 'user', password: '123456' } });
    assert.equal(login.status(), 200);
    await page.goto(base);
    assert.equal(await page.locator('.service-cover').count(), 0);
    const openOrder = async name => {
      await page.locator('.service-card').filter({ has: page.getByRole('heading', { name, exact: true }) }).getByRole('button', { name: '查看详情', exact: true }).click();
      await page.getByRole('button', { name: /预约这项服务/ }).click();
    };
    await openOrder('竞技上分陪玩');
    assert.equal(await page.getByText('陪玩小北', { exact: true }).count(), 1);
    assert.equal(await page.getByAltText('陪玩小北头像').count(), 1);
    await page.locator('.escort-choice').filter({ hasText: '陪玩小北' }).click();
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
    assert.equal(await page.locator('input[name="preferredEscortId"]:checked').inputValue(), 'u_escort');
    await page.getByLabel('服务类型', { exact: true }).selectOption('3');
    assert.equal(await hours.count(), 0);
    assert.equal(await total.innerText(), '¥128.00');
    assert.match(await page.locator('#booking-quote').innerText(), /固定套餐 · 2 小时/);
    await hourly.click();
    assert.equal(await page.locator('input[name="preferredEscortId"]:checked').inputValue(), 'u_escort');
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
    assert.equal(order.preferred_escort_id, 'u_escort');
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

test('administrators upload, preview, replace and remove game covers on desktop and mobile', async () => {
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
    assert.equal((await page.request.post(`${base}/api/login`, { data: { username: 'admin', password: '123456' } })).status(), 200);
    const service = (await (await page.request.get(`${base}/api/public/services`)).json()).services[0];
    assert.equal((await page.request.post(`${base}/api/services/${service.id}`, { data: { ...service, gameId: 1 } })).status(), 200);
    await page.goto(`${base}/#/settings`);
    const edit = () => page.locator('[data-edit-game="1"]').click();
    const upload = page.getByLabel('上传游戏封面', { exact: true });
    const cover = () => app.db.prepare('SELECT cover_url FROM games WHERE id=1').get().cover_url;
    const save = async () => {
      const [response] = await Promise.all([
        page.waitForResponse(response => /\/api\/games(?:\/\d+)?$/.test(response.url()) && response.request().method() === 'POST'),
        page.getByRole('button', { name: '保存', exact: true }).click(),
      ]);
      assert.ok(response.ok(), await response.text());
      await page.locator('dialog').waitFor({ state: 'hidden' });
    };
    const uploaded = async name => {
      await page.locator('#cover-upload-status').filter({ hasText: `已选择 ${name}` }).waitFor();
      await page.waitForFunction(() => document.querySelector('#cover-preview img')?.naturalWidth > 0);
    };
    await edit();
    await upload.setInputFiles('src/assets/gaming.jpg');
    await uploaded('gaming.jpg');
    assert.equal(cover(), '', 'choosing a file must not save before confirmation');
    await mkdir('test-results', { recursive: true });
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.locator('dialog').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth));
      await page.screenshot({ path: `test-results/cover-upload-${width}.png` });
    }
    await save();
    const firstCover = cover();
    assert.match(firstCover, /^data:image\/jpeg;base64,/);
    assert.ok(firstCover.length > 500);
    await page.reload();
    await edit();
    assert.equal(await page.locator('[name="coverUrl"]').inputValue(), '', 'do not expose encoded image as an editable address');
    assert.equal(await page.getByAltText('游戏封面预览').getAttribute('src'), firstCover);
    await page.getByLabel('游戏名称', { exact: true }).fill('三角洲行动封面');
    await save();
    assert.equal(cover(), firstCover, 'editing other fields preserves uploaded cover');
    await page.goto(base);
    await page.waitForFunction(() => document.querySelector('.service-cover')?.naturalWidth > 0 && document.querySelector('[data-game-id="1"] img')?.naturalWidth > 0);
    assert.equal(await page.locator('.service-cover').getAttribute('src'), firstCover);
    await page.goto(`${base}/#/settings`);
    await edit();
    for (const [file, error] of [
      [{ name: 'invalid.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') }, '请选择 PNG、JPG、WEBP 或 GIF 图片'],
      [{ name: 'large.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) }, '图片不能超过 5 MB'],
      [{ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('invalid-image') }, '图片格式无法读取'],
      [{ name: 'empty.png', mimeType: 'image/png', buffer: Buffer.alloc(0) }, '图片文件为空，请重新选择'],
    ]) {
      await upload.setInputFiles(file);
      await page.locator('.form-error').filter({ hasText: error }).waitFor();
      assert.equal(await page.getByAltText('游戏封面预览').getAttribute('src'), firstCover);
      assert.equal(cover(), firstCover);
    }
    const replacement = { name: 'replacement.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCfkAAAAASUVORK5CYII=', 'base64') };
    await upload.setInputFiles(replacement);
    await uploaded(replacement.name);
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    assert.equal(cover(), firstCover, 'closing dialog cancels pending replacement');
    await edit();
    await upload.setInputFiles(replacement);
    await uploaded(replacement.name);
    await save();
    assert.notEqual(cover(), firstCover);
    await edit();
    await page.getByRole('button', { name: '移除封面', exact: true }).click();
    assert.equal(await page.locator('#cover-preview img').count(), 0);
    await save();
    assert.equal(cover(), '');
    await page.getByRole('button', { name: '新增游戏', exact: true }).click();
    await page.getByLabel('游戏名称', { exact: true }).fill('新游戏上传封面');
    await page.getByLabel('游戏类别', { exact: true }).fill('休闲娱乐');
    await upload.setInputFiles('src/assets/gaming.jpg');
    await uploaded('gaming.jpg');
    await save();
    assert.match(app.db.prepare('SELECT cover_url FROM games WHERE name=?').get('新游戏上传封面').cover_url, /^data:image\/jpeg;base64,/);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    if (app.server.listening) await new Promise(resolve => app.server.close(resolve));
    app.close();
  }
});

test('the running preview offers cover uploads without changing existing games', { skip: !process.env.BOOKING_PREVIEW_URL }, async () => {
  const base = process.env.BOOKING_PREVIEW_URL;
  assert.equal(new URL(base).hostname, '127.0.0.1');
  const browser = await chromium.launch({ headless: true, ...(process.env.BOOKING_BROWSER_EXECUTABLE ? { executablePath: process.env.BOOKING_BROWSER_EXECUTABLE } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(8000);
    const catalog = await (await page.request.get(`${base}/api/public/services`)).json();
    assert.equal(catalog.demo, true);
    assert.equal((await page.request.post(`${base}/api/login`, { data: { username: 'admin', password: '123456' } })).status(), 200);
    const before = (await (await page.request.get(`${base}/api/me`)).json()).games;
    await page.goto(`${base}/#/settings`);
    await page.locator('[data-edit-game]').first().click();
    await page.getByLabel('上传游戏封面', { exact: true }).setInputFiles('src/assets/gaming.jpg');
    await page.locator('#cover-upload-status').filter({ hasText: '已选择 gaming.jpg' }).waitFor();
    await page.waitForFunction(() => document.querySelector('#cover-preview img')?.naturalWidth > 0);
    assert.equal(await page.getByRole('button', { name: '保存', exact: true }).isEnabled(), true);
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    assert.deepEqual((await (await page.request.get(`${base}/api/me`)).json()).games, before);
    await page.request.post(`${base}/api/logout`, { data: {} });
  } finally { await browser.close(); }
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
