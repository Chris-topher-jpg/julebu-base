// Optional browser integration check. Uses a fresh in-memory database and the
// browser's synthetic microphone; never touches the running club database.
// PLAYWRIGHT_MODULE may point to an externally installed playwright index.mjs.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClubServer } from '../server.mjs';
import { verifyFixtureUsers } from '../tests/real-name-fixture.mjs';
import { addFixtureGames } from '../tests/catalog-fixture.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const instance = createClubServer({ database: ':memory:', production: false, publicOrigin: '' });
addFixtureGames(instance.store, ['王者荣耀']);
verifyFixtureUsers(instance.store, ['demo-user', 'demo-escort']);
instance.server.listen(0, '127.0.0.1'); await once(instance.server, 'listening');
const base = `http://127.0.0.1:${instance.server.address().port}`;
const output = resolve('test-results/dispatch'); await mkdir(output, { recursive: true });
let browser;
const pageErrors = [];
async function client(username, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport, permissions: ['microphone'] });
  await context.addInitScript(() => {
    window.__connections = []; window.__tracks = [];
    const Native = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Native { constructor(...args) { super(...args); window.__connections.push(this); } };
    const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => { const stream = await get(constraints); window.__tracks.push(...stream.getTracks()); return stream; };
  });
  if (username) assert.equal((await context.request.post(base + '/api/login', { data: { username, password: 'Test1234!' } })).status(), 200);
  const page = await context.newPage(); page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(base + '/#/public/dispatchHall');
  await page.locator('.dh-room').first().waitFor({ state: 'attached' });
  if (username) {
    await page.locator('.nc-status').filter({ hasText: '已同步' }).waitFor({ state: 'attached' });
    await dismissNotice(page);
  }
  return { context, page };
}
async function waitFor(page, fn, label) {
  try { await page.waitForFunction(fn, undefined, { timeout: 30000 }); }
  catch (error) { console.error(label, await page.locator('[data-dh-feedback]').textContent(), await page.locator('[data-dh-seats]').textContent().catch(() => '')); throw error; }
}
async function controlsFit(page) {
  for (const selector of ['.dh-workspace-header', '.dh-voice-dock', '[data-dh-form="message"]', '[data-dh-form="message"] [type="submit"]']) {
    const box = await page.locator(selector).boundingBox();
    const viewport = page.viewportSize();
    assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, `${selector} fits the viewport: ${JSON.stringify({ box, viewport })}`);
  }
  assert.equal(await page.locator('[data-dh-form="message"] [type="submit"]').evaluate(button => {
    const box = button.getBoundingClientRect();
    return button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  }), true, 'send button remains clickable above the fixed voice dock');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight + 1), true, 'workspace fits the viewport');
}
async function dismissNotice(page) {
  const notice = page.locator('[data-nc-dismiss]');
  if (await notice.isVisible()) await notice.click();
}
async function screenshot(page, filename) {
  await dismissNotice(page);
  await page.screenshot({ path: resolve(output, filename), fullPage: true });
}
async function drawerFits(page, selector) {
  const drawer = page.locator(selector);
  const box = await drawer.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height, `${selector} is inside the viewport`);
  assert.equal(await drawer.evaluate(element => {
    const box = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + 30));
  }), true, `${selector} is above the backdrop`);
}
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}), args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const { page: buyer } = await client();
  assert.equal(await buyer.locator('.dh-room').count(), 5);
  assert.equal(await buyer.locator('.public-nav nav a[aria-current]').textContent(), '派单大厅');
  const hallPalette = await buyer.evaluate(() => ({
    accent: getComputedStyle(document.querySelector('.dh-welcome .dh-primary')).backgroundColor,
    ink: getComputedStyle(document.querySelector('.dispatch-hall')).color,
    toolbar: getComputedStyle(document.querySelector('.public-nav')).backgroundColor,
  }));
  assert.equal(await buyer.locator('.dispatch-hall').evaluate(element => getComputedStyle(element).colorScheme), 'light');
  await screenshot(buyer, 'lobby-desktop.png');
  await buyer.locator('[data-dh-filter="试音"]').click(); assert.equal(await buyer.locator('.dh-room').count(), 1);
  await buyer.locator('[data-dh-filter="全部"]').click();
  await buyer.locator('.dh-welcome [data-dh="quick"]').click();
  await buyer.locator('#loginUsername').fill('demo_user'); await buyer.locator('#loginPassword').fill('Test1234!');
  await buyer.locator('#authSubmit').click();
  await buyer.locator('.public-account-trigger').waitFor();
  await buyer.locator('[data-dh="join"][data-room="lobby"]').click();
  await buyer.locator('#dhRoomTitle').waitFor();
  assert.equal(await buyer.locator('#dhRoomTitle').textContent(), '接待大厅');
  assert.equal(await buyer.locator('[data-dh-seats] .dh-seat').count(), 1, 'lobby shows only its actual member');
  assert.equal(await buyer.getByText('空闲席位', { exact: true }).count(), 0, 'no empty-seat placeholders');
  await screenshot(buyer, 'lobby-joined-desktop.png');
  assert.equal(await buyer.locator('[data-dh="mic"]').getAttribute('aria-pressed'), 'false');
  const { page: service } = await client('demo_service');
  await service.locator('[data-dh="join"][data-room="lobby"]').click(); await service.locator('#dhRoomTitle').waitFor();
  await service.locator('[data-dh-form="assign"] [name="customerId"]').selectOption('demo-user');
  await service.locator('[data-dh-form="assign"] [name="serviceId"]').selectOption('demo-service');
  await service.locator('[data-dh-form="assign"] [name="roomId"]').selectOption('room-1');
  await service.locator('[data-dh-form="assign"] [type="submit"]').click();
  await buyer.locator('#dhRoomTitle').filter({ hasText: '星河接待一厅' }).waitFor();
  await service.locator('#dhRoomTitle').filter({ hasText: '星河接待一厅' }).waitFor();
  await buyer.locator('#dhMessage').fill('王者荣耀，先试音再下单 <script>alert(1)</script>');
  await buyer.locator('[data-dh-form="message"] [type="submit"]').click();
  await service.getByText('王者荣耀，先试音再下单 <script>alert(1)</script>', { exact: true }).waitFor();
  await buyer.locator('[data-dh="mic"]').click();
  await service.locator('[data-dh="mic"]').click();
  await waitFor(buyer, () => window.__connections.some(pc => pc.connectionState === 'connected'), 'buyer connects to service');
  await waitFor(service, () => window.__connections.some(pc => pc.connectionState === 'connected'), 'service connects to buyer');
  await waitFor(service, async () => {
    for (const pc of window.__connections) for (const stat of (await pc.getStats()).values()) if (stat.type === 'inbound-rtp' && stat.kind === 'audio' && stat.bytesReceived > 0) return true;
    return false;
  }, 'service receives real RTP audio');
  const draft = '希望找一位声音温柔的队友，暂时保留的消息草稿';
  const connectionCount = await buyer.evaluate(() => window.__connections.length);
  await buyer.locator('#dhMessage').fill(draft);
  await buyer.locator('.dh-text-channel[data-dh="lobby"]').click();
  assert.equal(await buyer.locator('[data-dh-welcome]').isVisible(), true);
  assert.equal(await buyer.locator('.dh-voice-dock [data-dh="mic"]').isEnabled(), true);
  await service.locator('#dhMessage').fill('可以先在接待大厅查看介绍，回来后继续沟通。');
  await service.locator('[data-dh-form="message"] [type="submit"]').click();
  await buyer.locator('[data-dh="join"][data-room="room-1"]').click();
  assert.equal(await buyer.locator('#dhMessage').inputValue(), draft, 'channel navigation preserves unsent draft');
  await buyer.getByText('可以先在接待大厅查看介绍，回来后继续沟通。', { exact: true }).waitFor();
  assert.equal(await buyer.evaluate(() => window.__connections.length), connectionCount, 'channel navigation does not recreate voice connections');
  assert.equal(await buyer.evaluate(() => window.__connections.some(pc => pc.connectionState === 'connected') && window.__tracks.every(track => track.readyState === 'live')), true, 'voice stays connected in the lobby');
  await buyer.locator('#dhMessage').fill('');
  await controlsFit(buyer);
  await service.locator('[name="inviteEscort"]').selectOption('demo-escort');
  await service.locator('[data-dh-form="invite"] [type="submit"]').click();
  const { page: escort } = await client('demo_escort');
  await escort.locator('[data-dh="join"][data-room="room-1"]').click(); await escort.locator('#dhRoomTitle').waitFor();
  await escort.locator('[data-dh="mic"]').click();
  await waitFor(escort, () => window.__connections.filter(pc => pc.connectionState === 'connected').length === 2, 'escort joins two-way audition');
  await waitFor(buyer, () => window.__connections.filter(pc => pc.connectionState === 'connected').length === 2, 'buyer hears staff and escort');
  assert.equal(await buyer.locator('[data-dh-seats] .dh-seat').count(), 3, 'reception shows only the three current members');
  await buyer.locator('[data-dh="mic"]').click();
  assert.equal(await buyer.evaluate(() => window.__tracks.every(track => !track.enabled)), true);
  await buyer.locator('[data-dh="mic"]').click();
  await buyer.locator('[data-dh="speaker"]').click();
  await dismissNotice(service);
  await service.locator('[data-dh-side-tab="members"]').click();
  await service.locator('[data-dh-roster]').getByText('客服 — 1', { exact: true }).waitFor();
  await service.locator('[data-dh-roster]').getByText('打手 — 1', { exact: true }).waitFor();
  await service.locator('[data-dh-side-tab="service"]').click();
  assert.equal(await buyer.locator('[data-peer-audio]').evaluateAll(elements => elements.every(audio => audio.muted)), true);
  await buyer.locator('[data-dh="speaker"]').click();
  await service.locator('[name="productId"]').selectOption('product-1');
  await service.locator('[name="levelId"]').selectOption('gold');
  await service.locator('[name="hours"]').fill('1');
  await service.locator('[name="escortId"]').selectOption('demo-escort');
  await service.locator('[name="requirement"]').fill('试音满意，陪玩一小时，按约定区服组队。');
  await service.locator('[data-dh-form="proposal"] [type="submit"]').click();
  const confirm = buyer.locator('[data-dh-room-proposals] [data-dh="confirm"]'); await confirm.waitFor();
  await waitFor(buyer, () => {
    const scroll = document.querySelector('.dh-conversation-scroll');
    return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 2;
  }, 'new proposal stays visible at bottom of room conversation');
  await controlsFit(buyer);
  await screenshot(buyer, 'room-desktop.png');
  await screenshot(service, 'staff-desktop.png');
  await confirm.click(); await buyer.locator('.dh-confirm-dialog [type="submit"]').click();
  await buyer.locator('.dh-confirm-dialog').waitFor({ state: 'detached' });
  await waitFor(buyer, () => document.querySelector('[data-dh-feedback]')?.textContent.includes('已创建'), 'buyer confirms order');
  const proposal = instance.store.read().dispatchProposals[0];
  assert.equal(proposal.status, 'confirmed');
  const order = instance.store.read().orders.find(item => item.id === proposal.orderId);
  assert.equal(order.preferredEscortId, 'demo-escort');
  assert.equal(order.status, '待接单');
  assert.equal(instance.store.read().ledger.filter(item => item.source === order.id && item.label === '订单消费').length, 1);
  await service.locator('[data-dh="dispatch"]').waitFor();
  assert.equal(await buyer.locator('#dhRoomTitle').count(), 1, 'workspace synchronization preserves live room');
  await buyer.locator('[data-dh="reconnect"]').click();
  await waitFor(buyer, () => window.__connections.filter(pc => pc.connectionState === 'connected').length === 2, 'reconnect voice');
  await buyer.locator('.public-nav nav a').filter({ hasText: /^首页$/ }).click();
  await buyer.locator('.public-hero').waitFor();
  assert.deepEqual(hallPalette, await buyer.evaluate(() => ({
    accent: getComputedStyle(document.querySelector('.public-brand .brand-mark')).backgroundColor,
    ink: getComputedStyle(document.querySelector('.public-home')).color,
    toolbar: getComputedStyle(document.querySelector('.public-nav')).backgroundColor,
  })), 'dispatch hall and homepage share brand, text and toolbar colors');
  assert.equal(await buyer.evaluate(() => window.__tracks.every(track => track.readyState === 'ended')), true);
  await service.locator('#dhRoomTitle').waitFor({ state: 'detached', timeout: 10000 });
  const { page: mobile } = await client(null, { width: 390, height: 844 });
  await screenshot(mobile, 'lobby-mobile.png');
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile has no horizontal overflow');
  await mobile.locator('[data-dh="channels"]').click();
  await mobile.locator('.dh-room').first().waitFor();
  await drawerFits(mobile, '.dh-sidebar');
  assert.equal(await mobile.locator('[data-dh="channels"]').getAttribute('aria-expanded'), 'true');
  assert.equal(await mobile.locator('.dh-voice-dock').isVisible(), true, 'voice dock remains visible with channel drawer open');
  await screenshot(mobile, 'channels-mobile.png');
  await mobile.keyboard.press('Escape');
  assert.equal(await mobile.locator('[data-dh="channels"]').getAttribute('aria-expanded'), 'false');
  await mobile.locator('[data-dh="members"]').click();
  await mobile.locator('.dh-inspector').waitFor();
  await drawerFits(mobile, '.dh-inspector');
  await mobile.locator('.dh-panel-scrim').click({ position: { x: 10, y: 100 } });
  assert.equal(await mobile.locator('[data-dh="members"]').getAttribute('aria-expanded'), 'false');
  const { page: noMic } = await client('demo_user', { width: 390, height: 844 });
  await noMic.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('denied', 'NotAllowedError'); }; });
  await noMic.locator('[data-dh="channels"]').click();
  await noMic.locator('[data-dh="join"][data-room="room-2"]').click(); await noMic.locator('#dhRoomTitle').waitFor();
  assert.equal(await noMic.locator('[data-dh="channels"]').getAttribute('aria-expanded'), 'false', 'joining closes the drawer');
  await noMic.locator('[data-dh="mic"]').click();
  await noMic.getByText('麦克风权限未开启，请在浏览器中允许麦克风后重试', { exact: true }).waitFor();
  assert.equal(await noMic.locator('[data-dh="mic"]').getAttribute('aria-pressed'), 'false');
  await noMic.locator('#dhMessage').fill('麦克风未授权，继续文字沟通');
  await noMic.locator('[data-dh-form="message"] [type="submit"]').click();
  await noMic.getByText('麦克风未授权，继续文字沟通', { exact: true }).waitFor();
  await screenshot(noMic, 'room-mobile.png');
  await controlsFit(noMic);
  await noMic.setViewportSize({ width: 390, height: 667 });
  await controlsFit(noMic);
  await screenshot(noMic, 'room-mobile-compact.png');
  await service.setViewportSize({ width: 1024, height: 768 });
  await dismissNotice(service);
  await service.locator('[data-dh="members"]').click();
  await service.locator('.dh-inspector').waitFor();
  await drawerFits(service, '.dh-inspector');
  await service.locator('.dh-inspector [data-dh="closePanel"]').click();
  assert.equal(await service.locator('[data-dh="members"]').getAttribute('aria-expanded'), 'false', 'tablet inspector closes');
  assert.deepEqual(pageErrors, []);
  console.log(JSON.stringify({ ok: true, checks: ['guest login', 'reception lobby voice', 'staff assigns customer and receptionist', 'five channels and filters', 'customer/staff text', 'three-party WebRTC', 'received RTP audio', 'mute and speaker', 'audition invitation', 'staff/member tabs', 'staff proposal', 'conversation autoscroll', 'confirmed payment once', 'channel switching preserves voice and draft', 'sync keeps call alive', 'navigation releases microphone', 'mobile/tablet drawers', 'compact mobile controls'], screenshots: output }, null, 2));
} finally {
  await browser?.close(); await instance.close();
}
