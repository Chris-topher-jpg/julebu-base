import { escapeHtml as e, icon, loginMarkup } from './ui.js';
import { renderOwner, leaveOwner } from './owner.js';
import { mountCompanions, findCompanionProfile } from './companions.js';
import { openCompanionMessenger } from './companion-chat.js';
import { parseRoute, resolveRoute } from './routes.js';
import { catalogMarkup, catalogAction } from './catalog.js';
import { openConversation } from './messages.js';
import { personalCenterMarkup, personalShellMarkup, personalProfileMarkup, personalHomeMarkup, personalActiveOrderStatuses } from './personal.js';
import { createLiveSync } from './live-sync.js';
import { createNotificationCenter } from './notifications.js';
import { openOrderPicker } from './order-picker.js';
import { openSupportPicker } from './support-picker.js';
import { requestJson } from './request.js';
import { lockForm } from './form-state.js';
import { realNameMarkup, bindRealName } from './real-name.js';
import { bindAuth } from './auth.js';

const labels = { overview: '工作台', serviceManagement: '客服管理', examinerCandidates: '考核与质检', orders: '订单管理', dispatch: '派单台', conversations: '会话中心', escorts: '陪玩成员', catalog: '游戏与商品', topups: '充值审核', flows: '资金流水', settlements: '提现与结算', accounts: '成员与权限', availableOrders: '接单大厅', myOrders: '我的订单', myEarnings: '我的收益', memberProfile: '个人中心', memberHome: '个人主页', memberOrders: '我的点单', memberAfterSales: '售后记录' };
const symbols = { overview: 'grid', serviceManagement:'headset', examinerCandidates:'users', orders: 'receipt', dispatch: 'trend', conversations: 'users', escorts: 'headset', catalog: 'game', topups: 'wallet', flows: 'trend', settlements: 'wallet', accounts: 'users', availableOrders: 'game', myOrders: 'receipt', myEarnings: 'wallet', memberProfile: 'grid', memberHome: 'users', memberOrders: 'receipt', memberAfterSales: 'headset' };
const state = { workspace: null, mode: 'public', page: 'overview', filter: '全部', query: '', busy: false };
let syncGeneration = 0, pendingMutations = 0, pendingRender = false, viewEpoch = 0;
let notificationUser = null;
const dirtyForms = new WeakSet();
// Navigation has its own lifetime: creating a chat changes the data revision,
// but must not cancel the view that is waiting to open that same chat.
const captureView = () => ({ epoch: viewEpoch, userId: state.workspace?.user.id, mode: state.mode });
const currentView = view => view.epoch === viewEpoch && view.userId === state.workspace?.user.id && view.mode === state.mode;
function viewError(view, error, fallback) {
  if (!currentView(view)) return;
  if (error.status === 401) renderLogin();
  toast(error.message || fallback);
}
async function personalSnapshot(view) {
  const workspace = await api('/me', undefined, { background: true });
  if (!currentView(view)) return null;
  if (workspace.user?.id !== view.userId) {
    renderLogin(); toast('登录账号已变化，请重新登录'); return null;
  }
  // Keep a locally newer personal snapshot when another operation completed
  // while this GET was in flight; never reuse a management snapshot here.
  return state.mode !== 'management' && state.workspace?.user?.id === view.userId && state.workspace.revision > workspace.revision
    ? state.workspace : workspace;
}
const money = cents => `¥ ${(Number(cents || 0) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = value => value ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
const has = permission => state.workspace?.role.permissions.includes(permission);
const gamesOf = workspace => workspace.catalogGames || workspace.games || [];
const escortCountOf = product => Number(product?.escortCount) === 2 || product?.name === '2陪1' ? 2 : 1;
const buyerChoice = order => order.selectionRequired ?? order.pay === '在线支付';
const orderLimits = order => {
  const game = gamesOf(state.workspace).find(game => game.name === order.game);
  return { min: order.participantMin ?? game?.min ?? 1, max: order.participantMax ?? game?.max ?? 1 };
};
const countLabel = ({ min, max }) => min === max ? `${min} 位` : `${min}–${max} 位`;
const badge = status => `<span class="status ${['已完成','已通过','已打款','在线','启用'].includes(status) ? 'active' : ['待接单','待确认','待服务','陪玩中','待验收','待审核','待线下打款','待线下退款','退款审核'].includes(status) ? 'warning' : 'muted'}"><i></i>${e(status)}</span>`;
const button = (action, text, id = '', primary = false, extra = '') => `<button class="${primary ? 'primary-action' : 'ghost-btn'}" data-action="${action}" data-id="${e(id)}" ${extra}>${text}</button>`;
const empty = message => `<div class="empty-state">${icon('receipt', 28)}<strong>${e(message)}</strong><span>新的业务动态会显示在这里</span></div>`;
const intro = (title, description, action = '') => state.mode === 'personal'
  ? (action ? `<div class="account-page-tools">${action}</div>` : '')
  : `<section class="page-intro"><div><p class="eyebrow">星河游戏俱乐部 / ${e(state.workspace.user.roleLabel)}</p><h1>${title}</h1><p class="subline">${description}</p></div>${action}</section>`;
const metric = (title, value, note, tone, symbol) => `<article class="stat-card"><div class="stat-head">${e(title)}<span class="stat-icon ${tone}">${icon(symbol)}</span></div><div class="stat-value">${value}</div><div class="stat-foot">${e(note)}</div></article>`;
const panel = (title, sub, body, action = '') => `<article class="panel data-panel"><div class="panel-head"><div><h2>${title}</h2><p>${sub}</p></div>${action}</div>${body}</article>`;
const table = (headers, rows) => `<div class="table-scroll"><table class="business-table"><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${headers.length}">${empty('暂无记录')}</td></tr>`}</tbody></table></div>`;
const row = (cells, attrs = '') => `<tr ${attrs}>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
function toast(message) {
  let el = document.querySelector('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.append(el); }
  el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 3500);
}
async function api(path, body, { background = false } = {}) {
  const mutation = body !== undefined;
  if (mutation && ['/login', '/login/phone', '/register', '/logout'].includes(path)) viewEpoch++;
  if (mutation) { pendingMutations++; syncGeneration++; }
  try {
    return await requestJson(`/api${path}`, { credentials: 'same-origin', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify({ ...body, ...(state.mode !== 'management' ? { context: 'personal' } : {}) }) });
  } catch (error) {
    if (!background && error.status === 401 && !['/login', '/login/code', '/login/phone', '/register'].includes(path)) { closeDialog(); state.workspace = null; renderLogin(); }
    throw error;
  } finally { if (mutation) { pendingMutations--; syncGeneration++; } }
}
async function refresh(render = true) {
  const generation = ++syncGeneration, mode = state.mode;
  const view = captureView();
  let workspace;
  try { workspace = await api(mode === 'management' ? '/workspace' : '/me', undefined, { background: true }); }
  catch (error) {
    if (!currentView(view)) return;
    if (error.status === 401) renderLogin();
    throw error;
  }
  if (generation !== syncGeneration || !currentView(view)) return;
  if (view.userId && workspace.user.id !== view.userId) { renderLogin(); toast('登录账号已变化，请重新登录'); return; }
  state.workspace = workspace;
  if (render) renderApp();
}

const notifications = createNotificationCenter({
  openItem: openNotification,
  markRead: async ids => {
    const userId = state.workspace?.user.id;
    const result = await api('/notifications/read', { ids });
    if (state.workspace?.user.id === userId) notifications.update(result);
  },
  onError: error => toast(error.message || String(error)),
});
const liveSync = createLiveSync({
  context: () => state.workspace && ({ userId: state.workspace.user.id, mode: state.mode, revision: state.workspace.revision, generation: syncGeneration, busy: pendingMutations > 0 || state.busy }),
  request: path => api(path, undefined, { background: true }),
  receive: result => {
    if (result.notifications) notifications.update(result.notifications, { announce: true });
    if (result.changed && result.workspace) {
      const previous = state.workspace;
      state.workspace = result.workspace;
      // Read receipts only move the revision; they should not rebuild the page.
      if (JSON.stringify({ ...previous, revision: 0 }) !== JSON.stringify({ ...state.workspace, revision: 0 })) pendingRender = true;
      updateLiveOrderDetail();
      document.dispatchEvent(new CustomEvent('workspace-synced'));
    }
    flushSyncedView();
  },
  status: text => notifications.setStatus(text),
  expired: () => { closeDialog(); renderLogin(); toast('登录已失效，请重新登录'); },
});
function startWorkspaceSync() {
  if (notificationUser !== state.workspace?.user.id) {
    notifications.reset(); notificationUser = state.workspace?.user.id;
  }
  notifications.mount(); liveSync.start(); pendingRender = false;
}
function updateLiveOrderDetail() {
  const modal = document.querySelector('#actionDialog[open]');
  if (modal?.dataset.liveOrderId) {
    const order = getOrder(modal.dataset.liveOrderId);
    modal.querySelector('.dialog-body').innerHTML = order ? orderDetail(order) : '<p>该订单已转派或不再属于你的工作范围。</p>';
  } else if (modal && pendingRender && !modal.classList.contains('service-chat-dialog')) {
    if (!modal.querySelector('.live-dialog-hint')) modal.querySelector('.dialog-body')?.insertAdjacentHTML('afterbegin', '<p class="detail-note live-dialog-hint" role="status">有新的业务动态，你填写的内容已保留；关闭弹窗后显示最新列表。</p>');
  }
}
function flushSyncedView() {
  if (!pendingRender || !state.workspace || state.busy || pendingMutations || document.querySelector('dialog[open]')) return;
  if ([...document.querySelectorAll('#app form')].some(form => dirtyForms.has(form))) return;
  // Keep filters, focus and scroll while rebuilding a list with new records.
  const controls = [...document.querySelectorAll('#app input, #app select, #app textarea')];
  const saved = controls.map(el => ({ id: el.id, name: el.name, form: el.form?.id, value: el.value, checked: el.checked, focused: el === document.activeElement, start: el.selectionStart, end: el.selectionEnd }));
  const scroll = [window.scrollX, window.scrollY];
  if (state.mode === 'public') renderPublicHome(state.workspace, state.page);
  else renderApp();
  for (const item of saved) {
    const el = item.id ? document.getElementById(item.id) : item.form && document.getElementById(item.form)?.elements.namedItem(item.name);
    if (!el || !('value' in el) || el.type === 'file') continue;
    el.value = item.value; if ('checked' in el) el.checked = item.checked;
    if (el.type === 'search' || el.closest('.owner-list-filters')) { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
    if (item.focused) { el.focus({ preventScroll: true }); if (item.start != null) el.setSelectionRange?.(item.start, item.end); }
  }
  window.scrollTo(...scroll); pendingRender = false;
}
async function openNotification(item) {
  if (document.querySelector('dialog[open]') || [...document.querySelectorAll('#app form')].some(form => dirtyForms.has(form))) {
    toast('请先完成或关闭正在编辑的内容，再查看通知'); return false;
  }
  const userId = state.workspace?.user.id;
  let view;
  if (!await switchWorkspace(item.mode, item.page, completedView => { view = completedView; }) || !currentView(view) || state.workspace?.user.id !== userId) return false;
  const ensureCurrent = () => { if (!currentView(view)) throw new Error('页面已切换'); };
  try {
    if (item.kind === 'conversation' && state.workspace.conversations?.some(chat => chat.id === item.entityId)) {
      await openConversation(item.entityId, {
        state, toast,
        api: async (path, body) => {
          ensureCurrent(); const result = await api(path, body, { background: true }); ensureCurrent(); return result;
        },
        refresh: async render => { ensureCurrent(); await refresh(render); ensureCurrent(); },
        onClose: () => { if (currentView(view)) renderApp(); },
      });
    } else if (item.orderId) {
      const order = getOrder(item.orderId);
      if (order) {
        const action = has('order:dispatch') && order.status === '待接单' ? 'dispatch' : state.mode !== 'management' && order.status === '待接单' && order.applications?.length ? 'selectApplicant' : state.mode === 'management' && state.workspace.user.role === 'escort' && order.status === '待确认' ? 'accept' : 'detail';
        await perform({ dataset: { action, id: order.id } });
      }
    }
    return currentView(view);
  } catch (error) {
    if (!currentView(view)) return false;
    if (error.status === 401) renderLogin();
    throw error;
  }
}
document.addEventListener('input', event => {
  const form = event.target.closest('#app form');
  if (form && !form.matches('.owner-query, .owner-rank-form, .owner-list-filters')) dirtyForms.add(form);
});
document.addEventListener('close', () => queueMicrotask(flushSyncedView), true);
document.addEventListener('visibilitychange', () => { if (!document.hidden) void liveSync.poll(); });
window.addEventListener('online', () => void liveSync.poll());
window.addEventListener('focus', () => void liveSync.poll());
window.addEventListener('pagehide', () => { viewEpoch++; liveSync.stop(); });
const route = page => `#/${state.mode}/${page}`;
async function switchWorkspace(mode, page = 'overview', onSwitched) {
  ({ mode, page } = resolveRoute(mode, page));
  syncGeneration++; viewEpoch++;
  const view = captureView();
  let workspace;
  try { workspace = await api(mode === 'management' ? '/workspace' : '/me', undefined, { background: true }); }
  catch (error) {
    if (!currentView(view)) return false;
    if (error.status === 401) renderLogin();
    throw error;
  }
  if (!currentView(view)) return false;
  if (view.userId && workspace.user.id !== view.userId) {
    renderLogin(); toast('登录账号已变化，请重新登录'); return false;
  }
  closeDialog(); leaveOwner(); state.mode = mode; state.workspace = workspace;
  navigate(page);
  onSwitched?.(captureView());
  return true;
}
const openWorkspace = (...args) => switchWorkspace(...args).catch(error => toast(error.message || '页面暂时无法打开，请重试'));
function navigate(page, filter = '全部') {
  syncGeneration++; viewEpoch++;
  if(state.workspace?.user.role==='admin') page=({memberManagement:'clubMembers',accounts:'clubMembers',escorts:'clubEscorts'})[page]||page;
  if (state.mode === 'public') {
    const publicPage = ['companions', 'guarantees'].includes(page) ? page : 'overview';
    state.page = publicPage;
    history.replaceState(null, '', publicPage === 'overview' ? '#/' : `#/public/${publicPage}`);
    return renderPublicRoute(state.workspace, publicPage);
  }
  if (!state.workspace?.role.pages.includes(page)) { page = 'overview'; toast('你没有访问该板块的权限'); }
  state.page = page; state.filter = filter; state.query = '';
  closeDialog(); history.replaceState(null, '', route(page)); renderApp();
  window.scrollTo({ top: 0, behavior: 'instant' });
}
async function renderLogin() {
  syncGeneration++; viewEpoch++; liveSync.stop(); notifications.reset(); notificationUser = null; pendingRender = false;
  document.querySelectorAll('dialog[open]').forEach(modal => { modal.close(); modal.remove(); });
  leaveOwner(); state.workspace = null; state.mode = 'public';
  const parsedRoute = parseRoute(location.hash, location.pathname);
  const shouldOpenLogin = /^#\/?login$/.test(location.hash) || parsedRoute.mode !== 'public';
  const publicPage = parsedRoute.mode === 'public' ? parsedRoute.page : 'overview';
  state.page = publicPage;
  const epoch = viewEpoch;
  let publicCatalog = { catalogGames: [] };
  try { publicCatalog = await api('/public/catalog', undefined, { background: true }); } catch { /* Keep unavailable game choices empty. */ }
  if (epoch !== viewEpoch || state.workspace?.user) return;
  document.querySelector('#app').innerHTML = loginMarkup(publicCatalog);
  enhancePublicHome(publicCatalog);
  if (publicPage !== 'overview') renderPublicStandalone(publicPage);
  const modal = document.querySelector('#authDialog'), form = document.querySelector('#loginForm');
  const { open } = bindAuth({
    modal, form, api,
    authenticate: async (path, body, authCurrent) => {
      const authentication = api(path, body);
      const view = captureView();
      try {
      const identity = await authentication;
      if (!currentView(view) || !authCurrent()) return;
      const workspace = await api(parsedRoute.mode === 'management' ? '/workspace' : '/me', undefined, { background: true });
      if (!currentView(view) || !authCurrent()) return;
      if (workspace.user.id !== identity.user.id) { renderLogin(); toast('登录账号已变化，请重新登录'); return; }
      modal.close();
      if (parsedRoute.mode === 'public') renderPublicHome(workspace, publicPage);
      else { state.mode = parsedRoute.mode; state.workspace = workspace; navigate(parsedRoute.page); }
      } catch (error) { if (currentView(view) && authCurrent()) throw error; }
    },
  });
  document.querySelectorAll('[data-action="openLogin"]').forEach(el => el.onclick = open);
  document.querySelector('[data-action="headerMessages"]')?.addEventListener('click', open);
  document.querySelector('[data-action="headerAccount"]')?.addEventListener('click', open);
  if (shouldOpenLogin) requestAnimationFrame(() => open());
}
function enhancePublicHome(workspace = state.workspace) {
  const home = document.querySelector('.public-home');
  if (!home || home.dataset.enhanced === 'true') return;
  home.dataset.enhanced = 'true';
  const links = [...home.querySelectorAll('.public-nav nav a')];
  const markNavigation = hash => links.forEach(link => {
    if (link.hash === hash) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
  links.forEach(link => link.addEventListener('click', () => markNavigation(link.hash)));
  const parsed = parseRoute(location.hash);
  const section = parsed.page === 'companions' ? '#members' : parsed.page === 'guarantees' ? '#rules' : '#games';
  markNavigation(parsed.page === 'companions' ? '#/public/companions' : parsed.page === 'guarantees' ? '#/public/guarantees' : '#/public/overview');
  const online = home.querySelector('.public-online');
  if (online) online.textContent = '星河陪玩';
  const members = home.querySelector('#members');
  if (members) mountCompanions(members, { workspace, onlineOnly: parsed.page === 'overview', compact: parsed.page === 'overview', requestService: profile => {
    if (state.workspace?.user) {
      openPersonalOrder(profile);
      return;
    }
    home.querySelector('.nav-login-link[data-action="openLogin"]')?.click();
    toast('登录后请重新选择这位陪玩，确认指定对象后再下单');
  }, openChat: profile => openCompanionChat(profile) });
  const footer = home.querySelector('.public-footer'); footer?.removeAttribute('id');
  if (!home.querySelector('#rules')) {
    const section = document.createElement('section'); section.className = 'guarantee-section'; section.id = 'rules';
    section.innerHTML = `<div class="section-heading"><div><span>服务保障</span><h1>每一单，都有清晰的进度和依据</h1><p class="section-caption">从支付到售后，平台记录关键节点，遇到问题可以随时追踪处理。</p></div><button class="filter-button" type="button" data-action="openLogin">开始下单 ${icon('arrow', 14)}</button></div><div class="guarantee-grid"><article class="guarantee-item"><span class="guarantee-icon blue">${icon('lock', 21)}</span><div><h3>交易留痕</h3><p>订单金额和余额变动可追踪，服务验收通过后再结算陪玩收益。</p></div></article><article class="guarantee-item"><span class="guarantee-icon green">${icon('check', 21)}</span><div><h3>接单确认</h3><p>订单同步给客服与匹配打手，接单前可查看服务要求和时间。</p></div></article><article class="guarantee-item"><span class="guarantee-icon orange">${icon('clock', 21)}</span><div><h3>过程留痕</h3><p>下单、接单、开始服务、完单和验收均有记录，状态变化清楚可查。</p></div></article><article class="guarantee-item"><span class="guarantee-icon pink">${icon('headset', 21)}</span><div><h3>售后介入</h3><p>迟到、掉线、时长不足或质量争议，可提交证据申请补做或退款。</p></div></article></div><div class="process-strip"><div><b>01</b><span>提交需求</span></div><i></i><div><b>02</b><span>余额支付</span></div><i></i><div><b>03</b><span>接单服务</span></div><i></i><div><b>04</b><span>服务验收</span></div><i></i><div><b>05</b><span>售后跟进</span></div></div>`;
    footer?.before(section);
  }
  // Keep the footer's “联系客服” anchor meaningful. Previously it pointed to
  // #help while no matching section existed, leaving users at a blank hash.
  if (!home.querySelector('#help')) {
    const help = document.createElement('section');
    help.className = 'help-section';
    help.id = 'help';
    help.innerHTML = `<div class="section-heading"><div><span>需要帮助</span><h1>客服会跟进每一笔订单</h1><p class="section-caption">登录后可在会话中心查看处理进度；下单、支付或售后问题都可以留下说明。</p></div><button class="filter-button" type="button" data-action="openLogin">联系在线客服 ${icon('headset', 14)}</button></div><div class="help-cards"><article><strong>订单咨询</strong><p>下单前确认游戏、时长和陪玩要求，避免信息遗漏。</p></article><article><strong>支付与退款</strong><p>支付凭证、退款原因和处理结果都会保留记录。</p></article><article><strong>服务异常</strong><p>迟到、掉线或服务不足，可提交售后申请并填写说明。</p></article></div>`;
    footer?.before(help);
  }
  if (parsed.mode === 'public' && parsed.page === 'overview' && section !== '#games') requestAnimationFrame(() => home.querySelector(section)?.scrollIntoView({ block: 'start' }));
}

function renderPublicStandalone(page) {
  const home = document.querySelector('.public-home');
  if (!home) return;
  const hero = home.querySelector('.public-hero');
  const members = home.querySelector('#members');
  const rules = home.querySelector('#rules');
  const help = home.querySelector('#help');
  const footer = home.querySelector('.public-footer');
  [hero, members, rules, help, footer].forEach(el => { if (el) el.hidden = true; });
  const active = page === 'companions' ? members : rules;
  if (!active) return;
  active.hidden = false;
  active.classList.add('public-standalone-section');
  // Standalone pages start directly with their content section; the former intro banner was visually redundant.
  if (page === 'guarantees' && !active.querySelector('.guarantee-detail-grid')) {
    active.insertAdjacentHTML('beforeend', `<div class="guarantee-detail-grid"><article class="guarantee-detail-card"><h3>下单确认</h3><p>确认游戏、区服、服务时长、预约时间和陪玩要求后再支付，订单内容会保留在订单详情中。</p></article><article class="guarantee-detail-card"><h3>计时与验收</h3><p>服务开始和结束节点由平台记录，完成后由你确认服务结果；如有异议请及时提交说明。</p></article><article class="guarantee-detail-card"><h3>支付凭证</h3><p>支付成功后可在个人中心查看订单金额和支付记录，客服可据此核对款项。</p></article><article class="guarantee-detail-card"><h3>售后申请</h3><p>遇到迟到、掉线、时长不足等情况，可在订单售后入口提交原因和凭证，客服会跟进处理。</p></article></div><div class="guarantee-steps"><h3>处理流程</h3><ol><li>提交订单与服务要求</li><li>陪玩接单并确认时间</li><li>开始服务与计时记录</li><li>完成验收并评价</li><li>异常时提交售后或退款申请</li></ol></div><div class="guarantee-faq"><h3>常见问题</h3><details><summary>什么时候可以申请退款？</summary><p>服务尚未开始或出现可核实的服务问题时，可提交退款申请，客服将根据订单记录和双方说明处理。</p></details><details><summary>售后需要准备什么？</summary><p>请提供订单号、问题描述及相关截图或支付凭证，便于客服快速核对。</p></details></div>`);
  }
}

function renderPublicRoute(workspace, page = 'overview') {
  // Reuse the complete auth-state renderers on both navigation and reload.
  if (!workspace?.user) return renderLogin();
  return renderPublicHome(workspace, page);
}

async function openCompanionChat(profile) {
  if (!state.workspace?.user) { document.querySelector('.nav-login-link[data-action="openLogin"]')?.click(); return; }
  if (state.mode === 'management' || openCompanionChat.pending) return;
  const view = captureView();
  openCompanionChat.pending = true;
  try {
    let fresh = await personalSnapshot(view);
    if (!fresh) return;
    let chat = fresh.conversations?.find(item => item.escortId === profile.escortId && item.state !== '已结束');
    if (!chat) {
      chat = await api('/conversations', { escortId: profile.escortId, message: `你好，我想咨询 ${profile.game} 的${profile.service}服务。` }, { background: true });
      if (!currentView(view)) return;
      fresh = await personalSnapshot(view);
      if (!fresh) return;
    }
    state.workspace = fresh;
    openCompanionMessenger({
      workspace: fresh, initialChatId: chat.id, profile, api,
      onWorkspace: updated => { if (currentView(view) && updated.user.id === view.userId && updated.revision >= state.workspace.revision) { state.workspace = updated; pendingRender = true; } },
      onNavigate: async (target, bookingProfile) => {
        if (!currentView(view)) return;
        try {
          if (target === 'guarantees') renderPublicHome(state.workspace, 'guarantees');
          else if (target === 'book') await openPersonalOrder(bookingProfile || profile);
          else if (target === 'afterSales') openPersonalSupport();
          else await openWorkspace('personal', 'memberOrders');
        } catch (error) { toast(error.message); }
      },
    });
  } catch (error) { viewError(view, error, '暂时无法发起会话'); }
  finally { openCompanionChat.pending = false; }
}
async function openHeaderChat({ consultationOnly = false } = {}) {
  if (!state.workspace?.user || state.mode === 'management' || openHeaderChat.pending) return;
  const view = captureView();
  openHeaderChat.pending = true;
  try {
    let fresh = await personalSnapshot(view);
    if (!fresh) return;
    let chats = (fresh.conversations || []).filter(chat => chat.state !== '已结束' && (!consultationOnly || chat.type === 'consultation' && ['俱乐部客服', '在线客服'].includes(chat.escortName) && !chat.orderId));
    chats.sort((a, b) => {
      const unread = Number(b.unread || 0) - Number(a.unread || 0);
      if (unread) return unread;
      return (Date.parse(b.updatedAt || b.messages?.at(-1)?.at || '') || 0) - (Date.parse(a.updatedAt || a.messages?.at(-1)?.at || '') || 0);
    });
    let chat = chats[0];
    if (!chat) {
      chat = await api('/conversations', { type: 'consultation', escortName: '俱乐部客服', message: '你好，我想咨询陪玩服务，请客服协助。' }, { background: true });
      if (!currentView(view)) return;
      fresh = await personalSnapshot(view);
      if (!fresh) return;
      chat = fresh.conversations?.find(item => item.id === chat.id) || chat;
    }
    state.workspace = fresh;
    openCompanionMessenger({
      workspace: fresh,
      initialChatId: chat.id,
      profile: chat.escortId ? findCompanionProfile(chat.escortId, fresh) : undefined,
      api,
      onWorkspace: updated => { if (currentView(view) && updated.user.id === view.userId && updated.revision >= state.workspace.revision) { state.workspace = updated; pendingRender = true; } },
      onNavigate: async (target, bookingProfile) => {
        if (!currentView(view)) return;
        try {
          if (target === 'guarantees') renderPublicHome(state.workspace, 'guarantees');
          else if (target === 'book') await openPersonalOrder(bookingProfile);
          else if (target === 'afterSales') openPersonalSupport();
          else await openWorkspace('personal', 'memberOrders');
        } catch (error) { toast(error.message); }
      },
    });
  } catch (error) { viewError(view, error, '暂时无法打开聊天'); }
  finally { openHeaderChat.pending = false; }
}
function renderPublicHome(workspace, page = 'overview') {
  if (!workspace?.user) return renderLogin();
  if (state.mode !== 'public' || state.page !== page || state.workspace?.user.id !== workspace.user.id) viewEpoch++;
  closeDialog(); leaveOwner(); state.workspace = workspace; state.mode = 'public'; state.page = page;
  startWorkspaceSync();
  history.replaceState(null, '', page === 'overview' ? '#/' : `#/public/${page}`);
  document.querySelector('#app').innerHTML = loginMarkup(workspace);
  enhancePublicHome(workspace);
  if (page !== 'overview') renderPublicStandalone(page);
  const user = workspace?.user;
  const membership = workspace?.membership;
  const canEnterManagement = Boolean(membership?.active && membership.role !== 'member');
  const actions = document.querySelector('.public-nav-actions');
  if (user && actions) {
    const displayName = user.name || user.username || '用户';
    const unread = (workspace.conversations || []).reduce((sum, item) => sum + (Number(item.unread) || 0), 0);
    const onlineAction = membership?.active && membership.role === 'escort' ? `<button type="button" role="menuitem" data-action="headerOnline">${icon('headset', 18)}<span>${user.online ? '当前在线' : '当前离线'}</span><small class="account-status-dot ${user.online ? 'is-online' : ''}">${user.online ? '在线' : '离线'}</small></button>` : '';
    actions.innerHTML = `<button class="public-header-message" type="button" data-action="headerMessages" aria-label="消息与售后${unread ? `，${unread}条未读` : ''}">${icon('message', 20)}${unread ? `<span class="public-header-dot">${unread > 99 ? '99+' : unread}</span>` : ''}</button><div class="public-account-wrap"><button class="public-account-trigger" type="button" data-action="headerAccount" aria-haspopup="menu" aria-expanded="false"><span class="public-account-avatar">${e(displayName.slice(0, 1))}</span><span class="public-account-copy"><small>用户</small><strong>${e(displayName)}</strong></span>${icon('chevron', 14)}</button><div class="public-account-menu" role="menu" hidden><div class="public-account-menu-head"><span class="public-account-avatar">${e(displayName.slice(0, 1))}</span><div><strong>${e(displayName)}</strong><small>${e(user.username || user.phone || '')}</small></div></div><div class="public-account-menu-separator"></div>${onlineAction}<button type="button" role="menuitem" data-action="headerPersonal">${icon('users', 18)}<span>个人中心</span>${icon('arrow', 14)}</button><button type="button" role="menuitem" data-action="headerProfile">${icon('users', 18)}<span>设置</span>${icon('arrow', 14)}</button>${canEnterManagement ? `<button type="button" role="menuitem" data-action="enterManagement">${icon('building', 18)}<span>进入后台管理</span>${icon('arrow', 14)}</button>` : ''}<div class="public-account-menu-separator"></div><button type="button" role="menuitem" class="is-danger" data-action="headerLogout">${icon('arrow', 18)}<span>退出登录</span></button></div></div>`;
    actions.querySelector('[data-action="headerMessages"]').onclick = () => openHeaderChat();
    const accountButton = actions.querySelector('[data-action="headerAccount"]');
    const menu = actions.querySelector('.public-account-menu');
    const closeMenu = () => { menu.hidden = true; accountButton.setAttribute('aria-expanded', 'false'); };
    accountButton.onclick = event => { event.stopPropagation(); menu.hidden = !menu.hidden; accountButton.setAttribute('aria-expanded', String(!menu.hidden)); };
    actions.querySelector('[data-action="headerPersonal"]').onclick = () => openWorkspace('personal', 'memberProfile');
    actions.querySelector('[data-action="headerOnline"]')?.addEventListener('click', async () => {
      const button = actions.querySelector('[data-action="headerOnline"]');
      if (button) button.disabled = true;
      try {
        const updated = await api('/online', { online: !state.workspace.user.online });
        state.workspace.user = { ...state.workspace.user, ...updated };
        renderPublicHome(state.workspace, state.page || 'overview');
        toast(updated.online ? '已上线，可以接单' : '已离线，暂不接新单');
      } catch (error) { toast(error.message); if (button) button.disabled = false; }
    });
    actions.querySelector('[data-action="headerProfile"]').onclick = () => openWorkspace('personal', 'memberHome');
    actions.querySelector('[data-action="enterManagement"]')?.addEventListener('click', () => perform({ dataset: { action: 'enterManagement' } }));
    actions.querySelector('[data-action="headerLogout"]').onclick = () => perform({ dataset: { action: 'logout' } });
    document.addEventListener('click', closeMenu, { once: true });
  }
  const hero = document.querySelector('.hero-login');
  if (user && hero) {
    const orderCount = Array.isArray(workspace.orders) ? workspace.orders.length : 0;
    const balance = money(workspace.wallet?.balanceCents || 0);
    hero.innerHTML = `<div class="login-card-head"><div class="login-logo">${icon('users', 21)}</div><div><strong>${e(user.name || user.username)}</strong></div></div><h2>个人信息</h2><div class="public-profile-grid"><div><span>用户 ID</span><strong>${e(user.id)}</strong></div><div><span>账户余额</span><strong>${balance} <button type="button" class="balance-topup-link" data-action="personalTopup">充值</button></strong></div><div><span>累计点单</span><strong>${orderCount} 笔</strong></div></div><div class="public-personal-actions"><button class="login-submit" type="button" data-action="personalOrder">我要点单 ${icon('arrow', 16)}</button><button class="public-secondary-action" type="button" data-action="personalAfterSales">我要售后 ${icon('headset', 15)}</button><button class="public-center-action" type="button" data-action="personalCenter">${icon('users', 18)}<span>个人中心</span>${icon('arrow', 16)}</button></div>${canEnterManagement ? `<button class="public-management-action" type="button" data-action="enterManagement">进入后台管理 ${icon('building', 15)}</button>` : ''}<div class="personal-shortcuts"><button data-action="personalOrders">我的点单</button><button data-action="personalWallet">我的钱包</button><button data-action="personalAfterSalesRecords">消息与售后</button></div>`;
  }
  document.querySelectorAll('[data-action="enterManagement"]').forEach(el => el.onclick = () => perform(el));
  document.querySelectorAll('[data-action="personalOrder"]').forEach(el => el.onclick = () => openPersonalOrder());
  document.querySelectorAll('[data-action="personalTopup"]').forEach(el => el.onclick = () => perform({ dataset: { action: 'personalTopup' } }));
  document.querySelectorAll('[data-action="personalCenter"]').forEach(el => el.onclick = () => openWorkspace('personal', 'memberProfile'));
  document.querySelectorAll('[data-action="personalOrders"]').forEach(el => el.onclick = () => openWorkspace('personal', 'memberOrders'));
  document.querySelectorAll('[data-action="personalWallet"]').forEach(el => el.onclick = () => openWorkspace('personal', 'memberWallet'));
  document.querySelectorAll('[data-action="personalAfterSales"]').forEach(el => el.onclick = () => openPersonalSupport());
  document.querySelectorAll('[data-action="personalAfterSalesRecords"]').forEach(el => el.onclick = () => openWorkspace('personal', 'memberAfterSales'));
  document.querySelectorAll('[data-action="logout"]').forEach(el => el.onclick = () => perform(el));
  document.querySelectorAll('[data-action="openLogin"]').forEach(el => el.onclick = () => el.closest('#help') ? perform({dataset:{action:'supportChat'}}) : el.textContent.includes('开始下单') ? openPersonalOrder() : openWorkspace('personal','memberProfile'));
}
async function openPersonalOrder(preferredEscort) {
  if (!state.workspace?.user || state.mode === 'management' || openPersonalOrder.pending) return;
  const view = captureView();
  openPersonalOrder.pending = true;
  try {
    // The public homepage can be rendered from a staff workspace as well.
    // Always resolve the personal view before opening the customer order form.
    const workspace = await personalSnapshot(view);
    if (!workspace) return;
    state.workspace = workspace;
    await perform({ dataset: { action: 'newOrder', preferredEscort: preferredEscort ? JSON.stringify(preferredEscort) : '' } });
  } catch (error) { viewError(view, error, '暂时无法打开下单窗口'); }
  finally { openPersonalOrder.pending = false; }
}
function openPersonalSupport() {
  if (!state.workspace?.user) { document.querySelector('.nav-login-link[data-action="openLogin"]')?.click(); return; }
  if (state.mode === 'management') return;
  const view = captureView();
  return openSupportPicker({
    loadWorkspace: () => personalSnapshot(view),
    connect: async (orderId, closePicker) => {
      let fresh = await personalSnapshot(view);
      if (!fresh) { closePicker(); return; }
      if (orderId && !fresh.orders?.some(order => order.id === orderId)) throw new Error('订单已变更，请返回后重新选择。');
      const chat = await api('/conversations', { type: 'support', ...(orderId ? { orderId } : {}), context: 'personal' }, { background: true });
      if (!currentView(view)) { closePicker(); return; }
      // The created conversation is already usable if the subsequent sync is
      // briefly unavailable. Keep it locally, then let the messenger refresh.
      fresh = { ...fresh, conversations: [chat, ...(fresh.conversations || []).filter(item => item.id !== chat.id)] };
      state.workspace = fresh; pendingRender = true;
      closePicker();
      openCompanionMessenger({
        workspace: fresh, initialChatId: chat.id, api,
        onWorkspace: updated => { if (currentView(view) && updated.user.id === view.userId && updated.revision >= state.workspace.revision) { state.workspace = updated; pendingRender = true; } },
        onNavigate: async (target, bookingProfile) => {
          if (!currentView(view)) return;
          try {
            if (target === 'afterSales') openPersonalSupport();
            else if (target === 'book') await openPersonalOrder(bookingProfile);
            else if (target === 'guarantees') renderPublicHome(state.workspace, 'guarantees');
            else await openWorkspace('personal', 'memberOrders');
          } catch (error) { toast(error.message); }
        },
      });
    },
  });
}
function renderApp() {
  const w = state.workspace; if (!w) return renderLogin();
  startWorkspaceSync();
  if (!w.role.pages.includes(state.page)) { state.page = 'overview'; history.replaceState(null, '', route('overview')); }
  if (resolveRoute(state.mode, state.page).mode === 'public') return renderPublicHome(w);
  if (state.mode === 'personal') {
    leaveOwner();
    document.querySelector('#app').innerHTML = personalShellMarkup(w, state.page, pageContent());
    bindSharedActions();
    const accountNav = document.querySelector('.account-sidebar nav');
    const activeNav = accountNav?.querySelector('[aria-current="page"]');
    if (activeNav && accountNav.scrollWidth > accountNav.clientWidth) accountNav.scrollLeft = activeNav.getBoundingClientRect().left - accountNav.getBoundingClientRect().left - (accountNav.clientWidth - activeNav.offsetWidth) / 2;
    return;
  }
  renderOwner({ state, api, navigate, refresh, dialog, orderDetail, toast, legacyContent: pageContent });
  bindSharedActions();
}
function bindSharedActions() {
  bindRealName({ state, api, refresh, toast, dialog });
 document.querySelectorAll('[data-page]').forEach(el => el.onclick = () => navigate(el.dataset.page));
  document.querySelectorAll('[data-action]').forEach(el => el.onclick = () => perform(el));
  document.querySelectorAll('[data-filter]').forEach(el => el.onclick = () => { state.filter = el.dataset.filter; renderApp(); });
  document.querySelector('#listSearch')?.addEventListener('input', event => {
    state.query = event.target.value;
    const query = state.query.trim().toLowerCase(); let count = 0;
    const panel = event.target.closest('.panel');
    const searchable = document.querySelectorAll('[data-searchable]');
    const records = searchable.length ? searchable : panel?.querySelectorAll('tbody tr:not(:has(.empty-state))') || [];
    records.forEach(item => { const visible = item.textContent.toLowerCase().includes(query); item.hidden = !visible; if (visible) count++; });
    if (!document.querySelector('#noSearchResults') && panel) panel.insertAdjacentHTML('beforeend', '<div id="noSearchResults" class="empty-state" hidden>没有找到匹配的记录</div>');
    const emptyResults = document.querySelector('#noSearchResults');
    if (emptyResults) emptyResults.hidden = count > 0 || !query;
  });
  if (state.query) document.querySelector('#listSearch')?.dispatchEvent(new Event('input'));
  document.querySelectorAll('[data-profile-avatar]').forEach(button => button.addEventListener('click', () => {
    const form = button.closest('form');
    form?.querySelector('[name="avatar"]')?.setAttribute('value', button.dataset.profileAvatar || '');
    if (form) form.querySelector('[name="avatar"]').value = button.dataset.profileAvatar || '';
    form?.querySelector('#profileAvatarPreview')?.setAttribute('src', button.dataset.profileAvatar || '');
    form?.querySelectorAll('[data-profile-avatar]').forEach(item => item.classList.toggle('is-selected', item === button));
  }));
  document.querySelector('#profileAvatarFile')?.addEventListener('change', event => {
    const file = event.target.files?.[0]; const form = event.target.form; if (!file || !form) return;
    const feedback = form.querySelector('.profile-editor-feedback');
    if (!file.type.startsWith('image/')) { if (feedback) feedback.textContent = '请选择图片文件'; return; }
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas'); const size = 256; canvas.width = size; canvas.height = size;
        const scale = Math.max(size / image.width, size / image.height); const width = image.width * scale; const height = image.height * scale;
        canvas.getContext('2d').drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', .82);
        if (dataUrl.length > 90000) { if (feedback) feedback.textContent = '头像图片过大，请选择较小的图片'; return; }
        form.elements.avatar.value = dataUrl; form.querySelector('#profileAvatarPreview').src = dataUrl;
        form.querySelectorAll('[data-profile-avatar]').forEach(item => item.classList.remove('is-selected'));
        if (feedback) feedback.textContent = '';
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
  document.querySelector('#profileEditorForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const feedback = form.querySelector('.profile-editor-feedback');
    const name = String(form.elements.name.value || '').trim();
    const tags = String(form.elements.tags.value || '').split(/[、,，]/).map(item => item.trim()).filter(Boolean);
    try {
      const updated = await api('/profile', { name, avatar: form.elements.avatar.value, bio: form.elements.bio.value, tags });
      state.workspace.user = { ...state.workspace.user, ...updated };
      renderApp(); toast('个人主页已保存');
    } catch (error) { if (feedback) feedback.textContent = error.message; }
  });
}
function pageContent() {
  if (state.page === 'realName') return realNameMarkup(state.workspace);
  if (state.mode === 'personal') return ({ overview: personalOverview, memberProfile: () => personalCenterMarkup(state.workspace), memberHome: () => personalHomeMarkup(state.workspace), placeOrder: placeOrderPage, memberOrders: memberOrdersPage, memberAfterSales: memberAfterSalesPage, memberWallet: memberWalletPage })[state.page]();
  const pages = { memberProfile: () => personalCenterMarkup(state.workspace), memberHome: () => personalHomeMarkup(state.workspace), examinerCandidates: examinerCandidatesPage, overview, placeOrder: placeOrderPage, orders: () => orderPage(false), orderList: () => orderPage(false), transferOrders: () => orderPage(false), dispatchOrders: dispatchPage, myOrders: () => orderPage(true), dispatch: dispatchPage, availableOrders: availablePage, conversations: conversationPage, myEarnings: earningsPage, accounts: accountsPage, escorts: membersPage, catalog: catalogPage, flows: flowPage, topups: topupsPage, settlements: settlementsPage, memberOrders: memberOrdersPage, memberAfterSales: memberAfterSalesPage, memberWallet: memberWalletPage };
  return pages[state.page]();
}
const assessmentStatus = value => {
  const status = value || '待安排';
  const tone = ['已通过', '合格', '通过'].includes(status) ? 'active' : ['待考核', '待复核', '进行中', '待安排'].includes(status) ? 'warning' : 'muted';
  return `<span class="status ${tone}"><i></i>${e(status)}</span>`;
};
const assessmentMemberId = a => a.memberId || a.candidateId || a.escortId || a.userId;
function assessmentRecords() {
  return Array.isArray(state.workspace.assessments) ? state.workspace.assessments : [];
}
function assessmentFor(memberId) {
  return assessmentRecords().filter(a => assessmentMemberId(a) === memberId).sort((a, b) => Date.parse(b.createdAt || b.at || 0) - Date.parse(a.createdAt || a.at || 0));
}
function assessmentSummary(memberId) {
  const latest = assessmentFor(memberId)[0];
  if (!latest) return '<span class="muted-text">暂无记录</span>';
  const kind = latest.type === 'quality' || latest.kind === '质检' ? '质检' : '入店考核';
  return `<span>${kind} · ${assessmentStatus(latest.status)}</span><small>${latest.score == null ? '未评分' : `评分 ${e(latest.score)}`} · ${date(latest.completedAt || latest.createdAt || latest.at)}</small>`;
}
function examinerCandidatesPage() {
  const w = state.workspace; const members = w.members || []; const records = assessmentRecords();
  const pending = records.filter(a => ['待考核', '进行中', '待复核'].includes(a.status)).length;
  const candidates = members.map(u => row([`<div class="member-cell"><strong>${e(u.name)}</strong><small>${e(u.memberNo || u.id)}</small></div>`, e(u.levelName || '—'), e((u.games || []).join(' / ') || '未配置'), badge(u.active ? '启用' : '停用'), assessmentSummary(u.id), `<div class="row-actions">${u.role === 'member' ? button('newAssessment', '入店考核', u.id, true) : ''}${u.role === 'escort' && u.active ? button('qualityCheck', '发起质检', u.id, true) : ''}</div>`], 'data-searchable'));
  const history = records.slice().sort((a,b) => Date.parse(b.createdAt || b.at || 0) - Date.parse(a.createdAt || a.at || 0)).map(a => {
    const member = members.find(m => m.id === assessmentMemberId(a));
    const kind = a.type === 'quality' || a.kind === '质检' ? '质检' : '入店考核';
    const game = a.game || a.subject || member?.games?.[0] || '—';
    return row([e(member?.name || a.memberName || '已离店成员'), e(kind), e(game), assessmentStatus(a.status), a.score == null ? '—' : e(a.score), date(a.createdAt || a.at), a.note || a.notes ? `<span title="${e(a.note || a.notes)}">${e(String(a.note || a.notes).slice(0, 22))}</span>` : '—', ['待考核', '进行中', '待复核'].includes(a.status) ? button('assessmentReview', '填写结果', a.id, true) : '—']);
  });
  return intro('考核与质检', '为申请入店的打手建立考核记录；在店打手水平波动时发起质检并保留复核依据。') + `<section class="stats">${metric('待处理考核', pending, '按预约时间推进并记录结果', 'orange', 'calendar')}${metric('在店打手', members.filter(m => m.active).length, '可发起周期性服务质量检查', 'green', 'users')}${metric('考核记录', records.length, '所有考核与质检留痕', 'blue', 'receipt')}</section>` + panel('陪玩考核对象', '入店考核与质检使用同一档案，历史成绩不会被覆盖', `<label class="list-search">${icon('search', 16)}<input id="listSearch" type="search" placeholder="搜索成员、用户 ID 或游戏" aria-label="搜索考核对象" value="${e(state.query)}"></label>${table(['成员', '等级', '支持游戏', '账号状态', '最近记录', '操作'], candidates)}<div id="noSearchResults" class="empty-state" hidden>没有找到匹配的成员</div>`) + panel('考核记录', '建议记录游戏、评分、结论和改进要求，质检可关联最近服务订单', table(['成员', '类型', '考核游戏', '结论', '评分', '时间', '备注', '操作'], history));
}
function overview() {
  const w = state.workspace; const mine = w.user.role === 'escort';
  if(w.user.role==='examiner') { const records = assessmentRecords(); return intro('考官工作台','处理入店考核与在店质检，所有结论均保留操作记录。') + `<section class="stats">${metric('待处理考核',records.filter(a=>['待考核','进行中','待复核'].includes(a.status)).length,'优先处理新入店申请','orange','calendar')}${metric('待质检',records.filter(a=>a.type==='quality' && ['待考核','进行中','待复核'].includes(a.status)).length,'跟进水平下降或周期复检','purple','trend')}${metric('历史记录',records.length,'可追溯评分与改进建议','blue','receipt')}</section>` + panel('今日工作', '按成员档案进入考核与质检', `<div class="owner-subnav"><button data-page="examinerCandidates">进入考核与质检 →</button></div>`); }
  if(w.user.role==='afterSales') { const linked = w.conversations.filter(c=>c.orderId || c.order); return intro('售后工作台','围绕订单处理异议、退款和服务质量问题；非订单诉求直接在会话中跟进。') + `<section class="stats">${metric('退款待跟进',w.orders.filter(o=>o.status==='退款审核').length,'及时处理售后申请','orange','receipt')}${metric('待验收订单',w.orders.filter(o=>o.status==='待验收').length,'核对服务完成情况','green','trend')}${metric('待跟进会话',w.conversations.filter(c=>c.state!=='已结束').length,'回复客户并记录结果','blue','users')}${metric('订单关联会话',linked.length,'可直接查看接单打手和订单记录','purple','headset')}</section>` + panel('售后业务','订单争议与非订单意见统一从会话进入',`<div class="owner-subnav"><button data-page="conversations">打开会话中心 →</button><button data-page="orders">查看订单记录 →</button></div>`); }
  if(w.user.role==='finance') return intro('财务工作台','处理所有与金钱相关的充值、退款赔偿、资金流水与提现结算。') + `<section class="stats">${metric('待审核充值',w.topups.filter(t=>t.state==='待审核').length,'核实实际收款后入账','blue','wallet')}${metric('待处理退款',w.refunds.filter(r=>['待审核','待线下退款'].includes(r.status)).length,'确认赔付金额与返还渠道','pink','receipt')}${metric('待审核提现',w.withdrawals.filter(t=>t.status==='待审核').length,'审核后安排线下打款','orange','receipt')}${metric('资金流水',w.ledger.length,'所有账户变动均可追溯','green','trend')}</section>` + panel('财务业务','按实际凭证核验并留存审核说明',`<div class="owner-subnav"><button data-page="topups">充值 / 退款审核</button><button data-page="flows">资金流水</button><button data-page="settlements">提现与结算</button></div>`);
  if(['user','member'].includes(w.user.role)) {
    const orders = w.orders || []; const spent = orders.reduce((sum, o) => sum + Number(o.amountCents || 0), 0);
    return intro('用户个人中心', '余额、点单与售后进度集中展示，服务状态和资金变动一目了然。', button('newOrder', '开始点单', '', true)) + `<section class="stats">${metric('账户余额', money(w.wallet?.balanceCents), '可用于支付俱乐部订单', 'purple', 'wallet')}${metric('累计点单', orders.length, '全部历史订单', 'blue', 'receipt')}${metric('进行中', orders.filter(o => ['待接单','待确认','待服务','陪玩中','待验收'].includes(o.status)).length, '正在处理的服务', 'orange', 'trend')}${metric('累计消费', money(spent), '订单实付金额合计', 'green', 'receipt')}</section>` + panel('快捷入口', '从下单到售后全程可追踪', `<div class="owner-subnav"><button data-action="newOrder">开始点单 →</button><button data-page="memberOrders">查看点单记录 →</button><button data-page="memberAfterSales">查看售后记录 →</button></div>`) + panel('最近点单', '按创建时间展示最新订单', orderList(orders.slice(0, 4), false));
  }
  if(w.user.role==='member') return intro('俱乐部成员', '') + panel('成员资料', '', `<div class="detail-grid"><div><span>用户 ID</span><strong>${e(w.user.id)}</strong></div><div><span>用户编号</span><strong>${e(w.user.memberNo || '—')}</strong></div><div><span>昵称</span><strong>${e(w.user.name)}</strong></div><div><span>俱乐部职务</span><strong>普通成员</strong></div><div><span>业务权限</span><strong>待最高管理员分配</strong></div></div>`);
  const pending = w.orders.filter(o => ['待接单', '待确认', '待服务'].includes(o.status));
  const live = w.orders.filter(o => o.status === '陪玩中');
  const review = w.orders.filter(o => o.status === '待验收');
  const day = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  const stats = mine ? metric('可接订单', w.availableOrders.length, '匹配你的游戏项目', 'orange', 'game') + metric('我的待办', pending.length, '待确认或待开始服务', 'purple', 'receipt') + metric('可提现收益', money(w.wallet.balanceCents), '验收通过后入账', 'green', 'wallet') + metric('进行中的服务', live.length, '同一时段专心服务一单', 'blue', 'headset') : metric('待派单', w.orders.filter(o => o.status === '待接单').length, '已收款，等待匹配成员', 'orange', 'game') + metric('服务进行中', live.length, '及时跟进服务状态', 'purple', 'headset') + metric('完单待验收', review.length, '核验后计入成员收益', 'green', 'receipt') + metric('待跟进会话', w.conversations.filter(c => c.state !== '已结束').length, '客户咨询与服务安排', 'blue', 'users');
  return `<section class="welcome"><div><p class="eyebrow">${day}</p><h1>欢迎回来，${e(w.user.name)}<span>。</span></h1><p class="subline">${mine ? '你的接单、服务与收益，都在这里。' : '从客户咨询到服务验收，让每一单都有着落。'}</p></div><span class="workspace-tag">${mine ? '我的专属工作台' : '俱乐部运营概况'}</span></section><section class="stats">${stats}</section><section class="grid-row">${panel(mine ? '我的服务待办' : '需要跟进的订单', '按订单状态推进下一步', orderList([...review, ...live, ...pending].slice(0, 4), mine), `<button class="text-btn" data-page="${mine ? 'myOrders' : 'orders'}">查看全部 →</button>`)}${panel(mine ? '接单机会' : '协作流程', mine ? '只展示你支持的游戏' : '职责独立，订单信息同步', mine ? (w.availableOrders.slice(0, 3).map(o => `<div class="dispatch-mini-row"><div class="event-date ${o.tone || 'purple'}">${icon('game')}</div><div class="event-info"><strong>${e(o.game)} · ${e(o.product)}</strong><span>${o.hours} 小时 · ${money(o.amountCents)}</span></div><button class="text-btn" data-page="availableOrders">查看 →</button></div>`).join('') || empty('暂时没有匹配的新订单')) : `<div class="workflow"><div><b>01</b><strong>老板下单，客服接收</strong><span>确认游戏、时长和收款</span></div><div><b>02</b><strong>邀请报名，老板选择</strong><span>符合条件的打手均可参与</span></div><div><b>03</b><strong>打手服务与完单</strong><span>记录服务过程，提交完单说明</span></div><div><b>04</b><strong>客服验收，收益入账</strong><span>管理员独立审核充值和提现</span></div></div>`)}</section>`;
}
function orderList(list, mine) {
  if (!list.length) return empty('暂无待处理订单');
  return `<div class="order-list">${list.map(o => `<article class="order-line" data-searchable><div><div class="order-line-title"><strong>${e(o.game)} · ${e(o.product)}</strong>${badge(o.status)}</div><p>${e(o.id)} · ${e(o.boss)} · ${o.hours} 小时</p><small>${mine ? '我的预计分成 ' + money(myIncome(o)) : '陪玩：' + e(o.participants.map(p => p.name).join(' / ') || (o.applications?.length ? `${o.applications.length} 位候选，待老板选择` : '等待打手报名')) + ' · 订单金额 ' + money(o.amountCents)}</small></div><div class="row-actions">${orderButtons(o, mine)}</div></article>`).join('')}</div>`;
}
function myIncome(order) { if (!order.participants.length) return order.expectedIncomeCents || 0; const p = order.participants.find(p => p.userId === state.workspace.user.id); return p?.earningCents ?? Math.round(order.amountCents * (p?.shareBps || 0) / 10000); }
function orderButtons(o, mine) {
  let actions = button('detail', '详情', o.id);
  if (['user','member'].includes(state.workspace.user.role)) {
    if (o.status === '待验收') actions += button('customerConfirm', '确认完成', o.id, true);
    if (o.status === '待接单' && o.applications?.length) actions += button('selectApplicant', '选择打手', o.id, true);
    if (['待接单', '待确认', '待服务', '陪玩中', '已完成', '待验收'].includes(o.status)) actions += button('refundRequest', '申请退款', o.id);
    return actions;
  }
  if (mine) {
    const p = o.participants.find(p => p.userId === state.workspace.user.id);
    if (o.status === '待确认' && !p.accepted) actions += button('accept', '确认接单', o.id, true);
    if (['待确认', '待服务'].includes(o.status)) actions += button('reject', '退回', o.id);
    if (o.status === '待服务') actions += button('start', '开始服务', o.id, true);
    if (o.status === '陪玩中' && !p.finished) actions += button('finish', '提交完单', o.id, true);
    if (p.finished && o.status === '陪玩中') actions += '<span class="muted-text">等待其他成员完单</span>';
  } else if (state.workspace.user.role !== 'user') {
    if (['待确认', '待服务', '陪玩中'].includes(o.status) && has('order:dispatch')) actions += button('transfer', '转单', o.id);
    if (o.status === '待接单' && has('order:dispatch')) actions += button('dispatch', buyerChoice(o) ? '拉打手 / 候选名单' : '派单', o.id, true);
    if (o.status === '待验收' && has('order:review')) actions += button('review', '验收订单', o.id, true);
    if (o.status === '退款审核' && (has('order:review') || has('refund:manage'))) actions += button('refundReview', '处理退款', o.id, true);
    if (['待接单', '待确认', '待服务', '陪玩中', '已完成', '待验收'].includes(o.status) && (has('order:review') || has('refund:manage'))) actions += button('refundRequest', '发起退款', o.id);
  }
  return actions;
}
function placeOrderPage() { return personalCenterMarkup(state.workspace); }
function orderPage(mine) {
  const statuses = ['全部', '待接单', '待确认', '待服务', '陪玩中', '待验收', '已完成', '退款审核', '已退款', '已取消'].filter(s => !mine || s !== '待接单');
  const orders = state.workspace.orders.filter(o => state.filter === '全部' || o.status === state.filter);
  return intro(mine ? '我的订单' : '订单管理', mine ? '只显示分配给你的订单；完单后由客服验收，收益按接单时的分成计算。' : '创建、派单、服务、验收，完整记录每一步。', !mine && has('order:create') ? button('newOrder','新建订单','',true) : '') + `<div class="filter-strip"><div class="filter-tabs">${statuses.map(s => `<button data-filter="${s}" class="${s === state.filter ? 'active' : ''}">${s} <b>${state.workspace.orders.filter(o => s === '全部' || o.status === s).length}</b></button>`).join('')}</div></div>${panel(mine ? '我的服务记录' : '俱乐部订单', `共 ${orders.length} 笔`, `<label class="list-search">${icon('search', 16)}<input id="listSearch" type="search" placeholder="搜索订单号、老板、游戏" aria-label="搜索订单" value="${e(state.query)}"></label>${orderList(orders, mine)}<div id="noSearchResults" class="empty-state" hidden>没有找到匹配的订单</div>`)}`;
}
function personalOverview() {
  const w = state.workspace, orders = w.orders;
  const spent = orders.filter(o => !['已取消','未支付','待支付'].includes(o.status)).reduce((sum, o) => sum + Math.max(0, o.amountCents - (o.refundedCents || 0)), 0);
  return intro('个人中心', '') + `<section class="personal-profile"><span class="personal-avatar">${e(w.user.name.slice(0,1))}</span><div><h2>${e(w.user.name)}</h2><p>用户 ID <strong>${e(w.user.id)}</strong>${w.user.memberNo ? ` <small>编号 ${e(w.user.memberNo)}</small>` : ''}</p></div><div class="personal-membership"><span>用户</span><span>${w.membership ? `俱乐部成员 · ${e(w.membership.label)}` : '尚未加入俱乐部'}</span></div></section><section class="stats">${metric('账户余额', money(w.wallet.balanceCents), '消费余额', 'blue', 'wallet')}${metric('累计点单', orders.length, '笔', 'green', 'receipt')}${metric('服务进行中', orders.filter(o => ['待接单','待确认','待服务','陪玩中','待验收'].includes(o.status)).length, '笔', 'orange', 'headset')}${metric('累计消费', money(spent), '已扣除退款', 'pink', 'trend')}</section>` + panel('最近点单', '', orderList(orders.slice(0, 4), false), '<button class="text-btn" data-page="memberOrders">全部点单记录 →</button>');
}
function memberWalletPage() {
  const topups = state.workspace.topups || [];
  const recent = topups.length ? `<div class="personal-topup-list">${topups.map(item => `<article><div><strong>${money(item.amountCents)}</strong>${badge(item.state)}</div><p>${e(item.id)} · ${date(item.requestedAt)}</p>${item.state === '已驳回' ? `<p class="topup-rejection">驳回原因：${e(item.proof)}</p>` : ''}${item.note ? `<p>付款说明：${e(item.note)}</p>` : ''}</article>`).join('')}</div>` : '<p class="muted-text">暂无充值申请</p>';
  return intro('我的钱包', '') + `<section class="personal-balance"><span>账户余额</span><div class="personal-balance-row"><strong>${money(state.workspace.wallet.balanceCents)}</strong><button type="button" class="primary-action" data-action="personalTopup">充值</button></div></section>` + panel('充值记录', '充值到账后由财务审核入账', recent) + panel('余额明细', '', ledgerTable(state.workspace.ledger));
}
function memberOrdersPage() {
  const w = state.workspace; const orders = w.orders || [];
  const statuses = ['全部', '进行中', '待接单', '待确认', '待服务', '陪玩中', '待验收', '已完成', '退款审核', '已退款', '已取消'];
  const matches = (order, status) => status === '全部' || (status === '进行中' ? personalActiveOrderStatuses.includes(order.status) : order.status === status);
  const filtered = orders.filter(o => matches(o, state.filter));
  return intro('我的点单记录', '') + `<div class="filter-strip"><div class="filter-tabs">${statuses.map(s => `<button data-filter="${s}" class="${s === state.filter ? 'active' : ''}">${s} <b>${orders.filter(o => matches(o, s)).length}</b></button>`).join('')}</div></div>` + panel('订单明细', `共 ${filtered.length} 笔`, `<label class="list-search">${icon('search', 16)}<input id="listSearch" type="search" placeholder="搜索订单号、游戏或陪玩" aria-label="搜索点单记录" value="${e(state.query)}"></label>${orderList(filtered, false)}<div id="noSearchResults" class="empty-state" hidden>没有找到匹配的订单</div>`);
}
function memberAfterSalesPage() {
  const w = state.workspace; const refunds = w.refunds || []; const conversations = w.conversations || [];
  const refundRows = refunds.map(r => { const o = (w.orders || []).find(order => order.id === r.orderId); return row([e(r.id), e(r.orderId), e(o?.game || '—'), money(r.amountCents), badge(r.status), date(r.requestedAt), e([r.reason, r.reviewNote, r.payoutRef && `退款流水：${r.payoutRef}`].filter(Boolean).join(' · ') || '—')]); });
  const chatRows = conversations.map(c => row([e(c.escortName || '客服'), e(c.channel || '站内信'), e(c.last || c.messages?.at(-1)?.text || '—'), badge(c.state || '处理中'), c.unread ? `<span class="unread">${c.unread} 条未读</span>` : '已读', button('conversation','继续沟通',c.id)]));
  return intro('消息与售后', '查看客服回复、跟进退款进度；订单问题可从我的点单发起。', button('supportChat','联系客服','',true)) + panel('退款与赔偿', '', table(['申请单号','订单号','游戏','申请金额','处理状态','申请时间','原因'], refundRows)) + panel('客服沟通记录', '', table(['服务对象','渠道','最近消息','状态','消息','操作'], chatRows));
}
function dispatchPage() {
  const queue = state.workspace.orders.filter(o => o.status === '待接单').sort((a,b) => a.createdAt.localeCompare(b.createdAt));
  return intro('派单台', '客服邀请与打手报名同步进行；老板下单后由老板从候选名单最终选择。成员需在线、未冻结且满足游戏及等级要求。') + `<div class="dispatch-page-list">${queue.map(o => `<article class="panel dispatch-card"><div class="dispatch-card-top"><div><span class="flow-id">${e(o.id)}</span><h2>${e(o.game)} · ${e(o.product)}</h2><p>${e(o.boss)} · ${e(o.requirement)}</p></div>${badge('待接单')}</div><div class="dispatch-card-meta"><span>订单金额<strong>${money(o.amountCents)}</strong></span><span>服务时长<strong>${o.hours} 小时</strong></span><span>候选打手<strong>${o.applications?.length || 0} 人</strong></span><span>可邀请成员<strong>${eligible(o).length} 人</strong></span></div>${button('dispatch', buyerChoice(o) ? '拉打手 / 查看候选 →' : '选择成员并派单 →', o.id, true)}</article>`).join('') || empty('派单队列已处理完毕')}</div>`;
}
function eligible(order) { const w=state.workspace; const rank=id=>w.levels.find(l=>l.id===id)?.rank||0; return w.members.filter(m => m.realNameVerification?.status === 'verified' && m.active && !m.escortFrozen && m.online && !(order.excludedEscortIds || []).includes(m.id) && (!order.preferredEscortId || order.preferredEscortId === m.id) && m.games.includes(order.game) && rank(m.levelId)>=rank(order.levelId)); }
function availablePage() {
  const w = state.workspace;
  return intro('接单大厅', '根据你的游戏和等级展示订单，可接本级及以下订单。报名后由老板选择打手，已有服务未结束时无法开始另一单。', button('online', w.user.online ? '在线接单中 · 点击休息' : '当前离线 · 上线接单')) + `<div class="available-order-grid">${w.availableOrders.map(o => { const applied = o.applications?.some(a => a.userId === w.user.id); return `<article class="panel available-order-card" data-searchable><div class="available-order-top"><span class="event-date ${o.tone || 'purple'}">${icon('game', 20)}</span>${badge('待接单')}</div><h2>${e(o.game)} · ${e(o.product)}</h2><p>${e(o.requirement)}</p><div class="available-order-meta"><span>${o.hours} 小时 · ${e(o.boss)}</span><strong>${money(o.amountCents)}</strong></div><small class="muted-text">${e(o.levelName)}及以上 · 预计分成 ${o.expectedShareBps/100}%（按最低服务人数估算）</small>${applied ? '<span class="muted-text">已进入候选名单，等待老板选择</span>' : button('claim', '报名这个订单 →', o.id, true, w.user.online ? '' : 'disabled title="请先切换为在线"')}</article>`; }).join('') || empty('暂无与你的游戏匹配的订单')}</div>`;
}
function conversationPage() {
  const orders = state.workspace.orders || [];
  const conversations = state.workspace.conversations || [];
  const role = state.workspace.user.role;
  const title = role === 'afterSales' ? '售后会话' : role === 'service' ? '客服会话' : '客户会话';
  const description = role === 'afterSales' ? '处理订单售后、退款争议和非订单售后问题，保留独立聊天与跟进记录。' : role === 'service' ? '处理服务咨询、下单安排和服务协调，保留独立聊天与跟进记录。' : '查看客服咨询与售后会话，按会话类型区分处理职责。';
  const orderFor = c => c.order || orders.find(o => o.id === c.orderId);
  return intro(title, description) + panel(title, '客户消息与内部跟进记录，按会话分别保留', `<label class="list-search">${icon('search', 16)}<input id="listSearch" type="search" placeholder="搜索用户 ID、昵称、订单号或会话内容" aria-label="搜索会话" value="${e(state.query)}"></label><div class="conversation-full-list">${conversations.map(c => { const order = orderFor(c); const escorts = order?.participants?.map(p => p.name).join(' / '); return `<div class="conversation-full-row" data-searchable><div class="mini-avatar orange">${e((c.boss || '客').slice(0, 1))}</div><div class="conversation-body"><div><strong>${e(c.boss || c.customerName || '未命名客户')}</strong><span class="channel-tag">${c.type === 'support' ? '售后' : '客服咨询'}</span><span class="channel-tag">${e(c.channel || '站内信')}</span>${order ? `<span class="order-link-tag">订单 ${e(order.id)} · ${e(order.game)}</span>` : '<span class="channel-tag neutral">非订单</span>'}${c.unread ? `<em class="unread">${c.unread} 条待跟进</em>` : ''}${c.slaOverdue ? '<em class="unread">SLA 超时</em>' : ''}</div><p>${e(c.last || c.messages?.at(-1)?.text || '暂无消息')}${escorts ? ` · 接单：${e(escorts)}` : ''}</p></div><div class="conversation-meta">${badge(c.state || '处理中')}${button('conversation', '查看会话', c.id)}</div></div>`; }).join('')}</div><div id="noSearchResults" class="empty-state" hidden>没有找到匹配的会话</div>`);
}
function earningsPage() {
  const w = state.workspace;
  const now = Date.now(); const dayStart = new Date(new Date().setHours(0,0,0,0)).getTime(); const weekStart = dayStart - ((new Date().getDay() + 6) % 7) * 86400000; const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const income = since => (w.ledger || []).filter(l => ['订单分成','退款冲回分成','退款分成冲回'].includes(l.label) && Date.parse(l.at) >= since && Date.parse(l.at) <= now).reduce((sum, l) => sum + Number(l.deltaCents || 0), 0);
  return intro('我的收益', '订单验收后入账。提现申请会冻结对应金额，审核驳回后返还。', button('withdraw', '申请提现', '', true)) + `<section class="stats">${metric('可提现金额', money(w.wallet.balanceCents), '已入账，可申请提现', 'purple', 'wallet')}${metric('今日流水', money(income(dayStart)), '今日已验收订单分成', 'blue', 'trend')}${metric('本周流水', money(income(weekStart)), '周一至今天累计入账', 'green', 'receipt')}${metric('本月流水', money(income(monthStart)), '本月累计订单分成', 'orange', 'wallet')}</section><section class="stats">${metric('提现冻结金额', money(w.wallet.frozenCents), '包含待审核与待线下打款', 'orange', 'receipt')}${metric('服务待验收', money(w.orders.filter(o => o.status === '待验收').reduce((a,o) => a + myIncome(o), 0)), '验收前不计入可提现余额', 'blue', 'trend')}${metric('当前押金', money(w.wallet.depositCents), '提现要求押金至少 ¥1,000', 'green', 'wallet')}</section>` + panel('我的资金明细', '仅包含当前成员的账户变动', ledgerTable(w.ledger)) + panel('我的提现申请', '审核通过后等待俱乐部线下打款', withdrawalTable(w.withdrawals, false));
}
function ledgerTable(list) { return table(['时间', '账户', '业务', '余额变动', '线下实付', '变动后余额', '关联单号 / 交易流水'], list.map(l => row([date(l.at), e(l.account), e(l.label), l.deltaCents === 0 ? money(0) : '<strong class="' + (l.deltaCents < 0 ? 'negative' : 'positive') + '">' + (l.deltaCents > 0 ? '+' : '−') + ' ' + money(Math.abs(l.deltaCents)) + '</strong>', l.externalAmountCents == null ? '—' : money(Math.abs(l.externalAmountCents)), l.afterCents == null ? '—' : money(l.afterCents), e([l.source, l.payoutRef || l.receiptReference].filter(Boolean).join(' · '))]))); }
function withdrawalTable(list, review) { return table(['申请单号', '成员', '金额', '状态', '申请时间', '操作'], list.map(w => row([e(w.id), e(w.name), money(w.amountCents), badge(w.status), date(w.at), review && w.status === '待审核' ? button('withdrawReview', '审核', w.id) : review && w.status === '待线下打款' ? button('withdrawPaid', '登记打款', w.id, true) + button('withdrawCancel', '撤销并退回', w.id) : e(w.reason || w.payoutRef || '—')]))); }
function accountsPage() {
  return intro('成员与权限', '成员只属于星河游戏俱乐部。调整职责或停用账号后，已有登录会话立即失效。', button('newAccount', '新增成员账号', '', true)) + `<section class="role-matrix"><article><span class="role-badge purple">最高负责人</span><p>俱乐部业务、财务审核、成员与权限配置</p></article><article><span class="role-badge orange">客服</span><p>订单、会话、派单、完单验收</p></article><article><span class="role-badge green">打手</span><p>接单、本人订单、本人收益与提现申请</p></article></section>` + panel('俱乐部账号', '账号职责由管理员分配，成员登录时无需选择', table(['成员', '账号', '职责', '状态', '游戏', '操作'], state.workspace.accounts.map(u => row([e(u.name), e(u.username), `<span class="role-badge ${u.tone}">${e(u.roleLabel)}</span>`, badge(u.active ? '启用' : '停用'), e(u.games.join(' / ') || '—'), button('editAccount', '编辑权限', u.id)]))));
}
function membersPage() { return intro('陪玩成员', '查看成员在线状态、支持的游戏与默认分成。订单按派单时的分成比例留存。', has('account:manage') ? button('accounts', '管理成员与权限') : '') + panel('陪玩档案', `共 ${state.workspace.members.length} 位成员`, table(['成员', '账号状态', '接单状态', '游戏', '基础分成', '操作'], state.workspace.members.map(m => row([e(m.name), badge(m.active ? '启用' : '停用'), badge(m.online ? '在线' : '离线'), e(m.games.join(' / ')), `${m.shareBps / 100}%`, has('account:manage') ? button('editAccount', '编辑', m.id) : '只读'])))); }
function catalogPage() { return catalogMarkup(state.workspace); }
function flowPage() { return intro('资金流水', '记录订单消费、充值入账、完单分成与提现冻结，资金变动与业务单号关联。') + panel('账户变动记录', '本次系统启用后的实际操作流水', `<label class="list-search">${icon('search', 16)}<input id="listSearch" type="search" placeholder="搜索用户 ID、昵称或业务单号" aria-label="搜索资金流水" value="${e(state.query)}"></label>${ledgerTable(state.workspace.ledger)}`); }
function topupsPage() { const w = state.workspace; const pendingRefunds = (w.refunds || []).filter(r => ['待审核', '待线下退款'].includes(r.status)); return intro('充值与退款审核', '所有涉及老板资金的充值、退款与赔偿统一由财务复核，凭证、原因和原支付方式必须留痕。') + `<section class="stats">${metric('待审核充值', (w.topups || []).filter(t => t.state === '待审核').length, '核验到账后再入账', 'blue', 'wallet')}${metric('待处理退款', pendingRefunds.length, '确认赔付金额与渠道', 'orange', 'receipt')}${metric('资金流水', (w.ledger || []).length, '充值、订单与提现全量记录', 'green', 'trend')}</section>` + panel('充值申请', '请根据实际收款凭证核验后审核', `<label class="list-search">${icon('search', 16)}<input id="listSearch" type="search" placeholder="搜索充值单号、用户 ID 或昵称" aria-label="搜索充值申请" value="${e(state.query)}"></label>${table(['充值单号', '老板', '金额', '充值前余额', '充值后余额', '状态', '操作'], (w.topups || []).map(t => row([e(t.id), e(t.user), e(t.amount), e(t.before), t.state === '已通过' ? e(t.after) : '待审核后计算', badge(t.state), t.state === '待审核' ? button('topupReview', '审核', t.id) : e(t.proof)])))}`) + panel('退款 / 赔偿申请', '余额退款通过后到账；线下退款需财务登记实际退款流水后完成', table(['申请单号', '订单', '老板', '金额', '渠道', '状态', '操作'], (w.refunds || []).map(r => row([e(r.id), e(r.orderId), e(r.customer), money(r.amountCents), e(r.channel || '—'), badge(r.status), ['待审核', '待线下退款'].includes(r.status) ? button('refundReview', r.status === '待线下退款' ? '登记退款 / 撤回' : '审核', r.orderId, true) : e(r.payoutRef || r.reviewNote || r.reason || '已处理')]))) ); }
function settlementsPage() { return intro('提现与结算', '独立复核成员提现申请。通过审核后待线下打款，不代表已经付款。') + panel('成员提现申请', '可提现余额已在申请时冻结', `<label class="list-search">${icon('search', 16)}<input id="listSearch" type="search" placeholder="搜索用户 ID、昵称或提现单号" aria-label="搜索提现申请" value="${e(state.query)}"></label>${withdrawalTable(state.workspace.withdrawals, true)}`) + panel('历史结算批次', '参考项目中的历史示例记录', table(['批次', '周期', '成员数', '金额', '状态'], state.workspace.settlements.map(s => row([e(s.id), e(s.period), s.escorts, e(s.amount), badge(s.state)])))); }

function closeDialog(modal = document.querySelector('#actionDialog')) {
  if (modal?.open) modal.close();
  modal?.remove(); queueMicrotask(flushSyncedView);
}
function dialog(title, body, submit, onSubmit, secondary = '') {
  closeDialog();
  const el = document.createElement('dialog'); el.id = 'actionDialog';
  el.innerHTML = `<form id="actionForm"><div class="dialog-head"><h2 id="dialogTitle">${e(title)}</h2><button type="button" class="icon-btn close-dialog" aria-label="关闭弹窗">×</button></div><div class="dialog-body">${body}</div><p class="form-error" role="alert" id="actionError"></p><div class="dialog-actions">${secondary}<button type="button" class="ghost-btn close-dialog">关闭</button>${submit ? `<button type="submit" class="primary-action">${submit}</button>` : ''}</div></form>`;
  el.setAttribute('aria-labelledby', 'dialogTitle'); document.body.append(el); el.showModal();
  const form = el.querySelector('form'), errorBox = el.querySelector('#actionError');
  let submitting = false;
  const dismiss = () => { if (!submitting) closeDialog(el); };
  el.querySelectorAll('.close-dialog').forEach(b => b.onclick = dismiss);
  el.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
  el.addEventListener('click', event => {
    const choice = event.target.closest('[data-order-candidate-action]');
    if (choice && !submitting) { void perform(choice); return; }
    if (event.target !== el) return;
    const bounds = el.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dismiss();
  });
  const submitAction = async secondaryAction => {
    if (submitting || !onSubmit || !el.isConnected || !form.reportValidity()) return;
    const data = new FormData(form), view = captureView();
    submitting = true; errorBox.textContent = '';
    const unlock = lockForm(form);
    try {
      await onSubmit(data, secondaryAction);
      closeDialog(el);
      if (!currentView(view)) return;
      try { await refresh(); if (currentView(view)) toast('操作成功，业务状态已更新'); }
      catch (error) { toast(`操作已成功，但页面暂未刷新：${error.message}`); }
    } catch (error) {
      if (!currentView(view)) return;
      errorBox.textContent = error.message;
      if (error.status === 409) {
        try { await refresh(false); }
        catch (refreshError) { if (el.isConnected) errorBox.textContent = `${error.message}；${refreshError.message}`; }
      }
      if (!el.isConnected) toast(error.message);
    } finally { submitting = false; unlock(); }
  };
  form.onsubmit = event => { event.preventDefault(); void submitAction(); };
  el.querySelectorAll('[data-dialog-action]').forEach(b => b.onclick = () => void submitAction(b.dataset.dialogAction));
  return el;
}
const field = (label, name, type = 'text', value = '', attributes = '') => `<label class="form-field">${label}<input name="${name}" type="${type}" value="${e(value)}" ${attributes} required></label>`;
const textarea = (label, name, placeholder = '') => `<label class="form-field">${label}<textarea name="${name}" rows="3" placeholder="${placeholder}" maxlength="1000" required></textarea></label>`;
function getOrder(id) { return [...(state.workspace.orders || []), ...(state.workspace.availableOrders || [])].find(o => o.id === id); }
async function updateOrder(order, action, input = {}) {
  const view = captureView();
  const submit = version => api(`/orders/${order.id}/${action}`, { ...input, version });
  try { return await submit(order.version); }
  catch (error) {
    const recruitmentAction = action === 'apply' || action === 'selectApplicant' || action === 'dispatch' && buyerChoice(order);
    if (error.status !== 409 || !recruitmentAction || !currentView(view)) throw error;
    await refresh(false);
    const current = getOrder(order.id);
    // Another nomination can advance the version while this form is open.
    // Retry only with unchanged terms and an order still awaiting selection.
    const terms = value => JSON.stringify(['game', 'product', 'hours', 'amountCents', 'refundedCents', 'levelName', 'participantMin', 'participantMax', 'requirement', 'preferredEscortId', 'appointmentAt'].map(key => value[key] ?? null));
    if (!currentView(view) || !current || current.status !== '待接单' || current.participants.length || terms(current) !== terms(order)) throw error;
    const ids = action === 'apply' ? [state.workspace.user.id] : input.memberIds || [];
    if (action !== 'selectApplicant' && ids.length && ids.every(id => current.applications?.some(item => item.userId === id))) return current;
    if (current.version === order.version) throw error;
    return submit(current.version);
  }
}
function candidateSummary(order) {
  if (order.status !== '待接单') return '';
  const applications = order.applications || [];
  const personal = state.mode !== 'management';
  const escort = !personal && state.workspace.user.role === 'escort';
  const action = personal && applications.length ? button('selectApplicant', '选择打手', order.id, true) : escort && !applications.length ? button('claim', '报名这个订单', order.id, true, state.workspace.user.online ? '' : 'disabled') : '';
  return `<section class="order-candidates"><h3>${escort ? '我的报名' : `候选打手（${applications.length}）`}</h3>${applications.map(a => `<div class="detail-note"><strong>${e(a.name)}</strong> · ${e(a.levelName || '已认证')} · ${a.source === 'service' ? '客服推荐' : '自主报名'}${a.eligible === false ? ' · 暂不可选' : ''}</div>`).join('') || '<p class="muted-text">暂无候选打手，客服正在联系，符合要求的打手可自主报名。</p>'}${escort && applications.length ? '<p class="muted-text">已进入候选名单，等待老板选择。</p>' : ''}${action.replace('<button ', '<button type="button" data-order-candidate-action ' )}</section>`;
}
function orderDetail(o) {
  const mine = state.mode === 'management' && state.workspace.user.role === 'escort';
  const personal = state.mode !== 'management';
  const steps=['待接单','待确认','待服务','陪玩中','待验收','已完成'];
  const stage=steps.indexOf(o.status);
  const stepLabels=['提交订单','匹配接单','开始服务','服务验收','完成结算'];
  const position = stage<0?-1:stage<=1?stage:stage===2?1:stage===3?2:stage===4?3:4;
  const hints={ '待接单': personal && o.applications?.length ? `已有 ${o.applications.length} 位符合要求的打手报名，请选择心仪的打手。` : '等待客服匹配陪玩，符合条件的陪玩也可以自主报名。', '待确认':'已派单，等待服务成员确认接单。', '待服务':'陪玩已确认，请按约定时间开始服务。', '陪玩中':'服务进行中，完成后由陪玩提交服务说明。', '待验收':'服务说明已提交。确认服务达标后再验收，有问题可申请退款或补充服务。', '已完成':'订单已验收，收益已按派单时锁定的比例结算。', '退款审核':'退款申请正在审核，确认处理结果后再继续结算。', '已退款':'退款已完成，可在余额明细或退款记录中核对。', '已取消':'订单已取消。' };
  return `<ol class="order-progress" aria-label="订单进度">${stepLabels.map((label,i)=>`<li class="${i<position?'done':i===position?'current':''}" ${i===position?'aria-current="step"':''}><b>${i<position?'✓':i+1}</b><span>${label}</span></li>`).join('')}</ol><p class="order-next-step">${e(hints[o.status] || '请查看下方订单记录，核对最新处理进度。')}</p><div class="detail-grid"><div><span>订单编号</span><strong>${e(o.id)}</strong></div><div><span>当前状态</span>${badge(o.status)}</div><div><span>下单用户</span><strong>${e(o.boss)}</strong></div><div><span>游戏商品</span><strong>${e(o.game)} · ${e(o.product)}</strong></div><div><span>订单等级</span><strong>${e(o.levelName||'金牌')}及以上</strong></div><div><span>服务时长</span><strong>${o.hours} 小时</strong></div><div><span>订单总额</span><strong>${money(o.amountCents)}</strong></div><div><span>已退金额</span><strong>${money(o.refundedCents)}</strong></div>${mine?`<div><span>我的预计分成</span><strong>${money(myIncome(o))}</strong></div>`:`<div><span>支付方式</span><strong>${e(o.pay==='在线支付'?'余额支付':o.pay)}</strong></div>`}${o.appointmentAt?`<div><span>预约时间</span><strong>${date(o.appointmentAt)}</strong></div>`:''}${o.region?`<div><span>游戏区服</span><strong>${e(o.region)}</strong></div>`:''}</div><p class="detail-note">服务要求：${e(o.requirement)}</p>${candidateSummary(o)}<h3>服务成员</h3>${o.participants.map(p=>`<div class="detail-note"><strong>${e(p.name)}</strong> · ${p.accepted?'已接单':'待确认'} · ${p.finished?'已提交完单':'待完成'}${!personal && (!mine || p.userId===state.workspace.user.id) && p.shareBps!=null?` · 分成 ${p.shareBps/100}%`:''}${p.evidence?`<p>完单说明：${e(p.evidence)}</p>`:''}</div>`).join('')||'<p class="muted-text">等待派单</p>'}<h3>订单记录</h3><div class="timeline">${(o.history||[]).map(h=>`<div><i></i><strong>${e(h.action)}</strong><small>${h.by?e(h.by)+' · ':''}${date(h.at)}</small>${h.note?`<p>${e(h.note)}</p>`:''}</div>`).join('')}</div>`;
}
async function perform(el) {
  if (el.disabled || state.busy) return;
  const { action, id } = el.dataset;
  const w = state.workspace; const o = getOrder(id);
  try {
    if (action === 'realName' || action === 'verifyRealName') return await switchWorkspace('personal', 'realName');
    const personalOrder = action === 'newOrder' && (state.mode !== 'management' || ['user', 'member'].includes(w.user.role));
    const escortOnline = action === 'online' && !w.user.online;
    if ((personalOrder || escortOnline || ['personalTopup', 'withdraw', 'claim', 'accept', 'start', 'selectApplicant'].includes(action)) && w.user.realNameVerification?.status !== 'verified') {
      await switchWorkspace('personal', 'realName');
      toast('请先完成实名认证，审核通过后可继续操作');
      return;
    }
    if (action === 'logout') { await api('/logout', {}); closeDialog(); renderLogin(); return; }
    if (action === 'personalProfile') return dialog('账户资料', personalProfileMarkup(w));
    if (action === 'personalTopup') {
      const requestId = crypto.randomUUID();
      const modal = dialog('账户充值', '<p class="detail-note">请先联系客服确认收款方式并完成付款，财务核验到账后充值将计入余额。</p>' + field('充值金额（元）', 'amount', 'number', '', 'min="1" max="1000000" step="0.01" placeholder="请输入充值金额"') + '<label class="form-field">付款说明（选填）<textarea name="note" rows="3" maxlength="200"></textarea></label>', '提交充值申请', form => api('/topups', { amountCents: Math.round(Number(form.get('amount')) * 100), note: String(form.get('note') || '').trim(), requestId, context: 'personal' }), '<button type="button" class="ghost-btn" data-topup-support>联系客服</button>');
      modal.querySelector('[data-topup-support]').onclick = () => { closeDialog(modal); openHeaderChat({ consultationOnly: true }); };
      return modal;
    }
    if (action === 'personalOrderStatus' && ['进行中', '待验收'].includes(id)) return navigate('memberOrders', id);
    if (action === 'enterManagement') return await switchWorkspace('management');
    if (action === 'enterHome' || action === 'enterPersonal') return await switchWorkspace('public');
    if (action === 'refresh') { state.busy = true; await refresh(); toast('已获取最新业务状态'); return; }
    if (action === 'accounts') return navigate('accounts');
    if (action === 'online') { state.busy = true; await api('/online', { online: !w.user.online }); await refresh(); toast(state.workspace.user.online ? '已上线，可以接单' : '已休息，暂不接新单'); return; }
    if (action === 'detail') { const modal = dialog('订单详情', orderDetail(o)); modal.dataset.liveOrderId = o.id; return modal; }
    if (action === 'customerConfirm') return dialog('确认服务完成', orderDetail(o) + '<p class="detail-note">确认后订单完成，陪玩分成将按规则结算；如有问题可在售后记录中申请处理。</p>', '确认完成', () => updateOrder(o, 'approve'));
    if (action === 'claim') return dialog('报名订单', `<p>报名 ${e(o.boss)} 的「${e(o.game)} · ${e(o.product)}」订单？</p><p>${o.hours} 小时 · 订单总额 <strong>${money(o.amountCents)}</strong></p><p>我的分成 ${o.expectedShareBps / 100}% · 预计到手 <strong>${money(o.expectedIncomeCents)}</strong></p><p>${e(o.requirement)}</p><p class="detail-note">报名后由老板从符合要求的打手中选择，报名不会立即锁定订单。</p>`, '确认报名', () => updateOrder(o, 'apply'));
    if (action === 'selectApplicant') {
      const applicants = o.applications || []; const game = orderLimits(o);
      const html = `<p>${e(o.id)} · ${e(o.game)} · ${e(o.product)}</p><p class="detail-note">请选择 ${countLabel(game)}候选打手，选定后订单会派给对方确认。</p><div class="candidate-list">${applicants.map(a => `<label><input type="${game.max === 1 ? 'radio' : 'checkbox'}" name="memberIds" value="${e(a.userId)}" ${a.eligible === false ? 'disabled' : ''}><span class="mini-avatar green">${e(a.name.slice(0,1))}</span><span><strong>${e(a.name)}</strong><small>${e(a.levelName || '已认证')} · ${a.source === 'service' ? '客服推荐' : '自主报名'}${a.eligible === false ? ' · 当前暂不可选' : ''}</small></span></label>`).join('')}</div>`;
      return dialog('选择打手', html, applicants.some(a => a.eligible !== false) ? '确认选择' : '', form => { const ids = form.getAll('memberIds'); if (ids.length < game.min || ids.length > game.max) throw new Error(`请选择 ${countLabel(game)}打手`); return updateOrder(o, 'selectApplicant', { memberIds: ids }); });
    }
    if (action === 'accept') return dialog('确认派单', orderDetail(o), '确认接单', () => updateOrder(o, 'accept'));
    if (action === 'start') return dialog('开始服务', `<p>确认开始 ${e(o.game)} 的 ${o.hours} 小时服务？</p><p class="detail-note">开始后将记录服务时间。同一成员不能同时开始其他订单。</p>`, '开始服务', () => updateOrder(o, 'start'));
    if (action === 'finish') return dialog('提交完单', `<p>${e(o.id)} · ${e(o.game)}</p>${textarea('完单说明', 'evidence', '请记录服务内容、完成情况及需要客服核验的信息（至少 5 个字符）')}<p class="detail-note">由客服验收后入账，提交不会直接增加可提现余额。</p>`, '提交验收', form => updateOrder(o, 'finish', { evidence: form.get('evidence') }));
    if (action === 'reject') return dialog('退回派单池', textarea('退回原因', 'reason', '说明无法服务的原因，客服将重新匹配成员'), '确认退回', form => updateOrder(o, 'reject', { reason: form.get('reason') }));
    if (action === 'transfer') {
      const candidates = eligible(o).filter(m => !o.participants.some(p => p.userId === m.id)); const game = orderLimits(o);
      const html = `<p>${e(o.id)} · 当前陪玩：${e(o.participants.map(p => p.name).join(' / ') || '待分配')}</p><p class="detail-note">请选择新的陪玩成员（${game.min}–${game.max} 人），转单后原成员将退出本单，订单历史会保留。${buyerChoice(o) ? '新成员加入候选名单，须由老板重新选择。' : ''}下方为成员基础分成比例，确认转单后会按参与人数平分并锁定。</p>${textarea('转单原因', 'reason', '说明更换打手的原因')}<div class="candidate-list">${candidates.map(m => `<label><input type="checkbox" name="memberIds" value="${e(m.id)}"><span class="mini-avatar green">${e(m.name.slice(0,1))}</span><span><strong>${e(m.name)}</strong><small>${e(w.levels.find(l=>l.id===m.levelId)?.name)} · ${e(m.games.join(' / '))}</small></span><b>基础分成 ${m.shareBps/100}%</b></label>`).join('') || empty('暂无符合条件的在线成员')}</div>`;
      return dialog('转派订单', html, candidates.length ? '确认转单' : '', form => updateOrder(o, 'transfer', { memberIds: form.getAll('memberIds'), reason: form.get('reason') }));
    }
    if (action === 'review') return dialog('完单验收', orderDetail(o) + '<label class="form-field">验收备注 / 退回原因<textarea name="reason" rows="2" maxlength="200"></textarea></label>', '验收通过并入账', (form, secondary) => updateOrder(o, secondary === 'return' ? 'return' : 'approve', { reason: form.get('reason') }), '<button type="button" class="ghost-btn" data-dialog-action="return">退回补充</button>');
    if (action === 'dispatch') {
      const candidates = eligible(o); const game = orderLimits(o); const applicantIds = new Set((o.applications || []).map(a => a.userId));
      const html = `<p>${e(o.id)} · ${e(o.game)} · ${money(o.amountCents)}</p><p class="detail-note">${e(o.requirement)}<br>订单要求：${e(o.levelName)}及以上。${buyerChoice(o) ? `可邀请多位候选打手，最终由老板选择 ${countLabel(game)}；邀请期间其他打手仍可自主报名。` : `选择 ${countLabel(game)}成员；分成按参与人数分摊并锁定。`}</p><div class="candidate-list">${candidates.map(m => { const applied = applicantIds.has(m.id); return `<label class="${applied ? 'is-selected' : ''}"><input type="checkbox" name="memberIds" value="${e(m.id)}" ${applied ? 'disabled checked' : ''}><span class="mini-avatar green">${e(m.name.slice(0,1))}</span><span><strong>${e(m.name)}</strong><small>${e(w.levels.find(l=>l.id===m.levelId)?.name)} · ${e(m.games.join(' / '))}${applied ? ' · 已在候选名单' : ''}</small></span><b>基础分成 ${m.shareBps/100}%</b></label>`; }).join('') || empty('暂无符合条件的在线成员')}</div>`;
      const addableCount = candidates.filter(member => !applicantIds.has(member.id)).length;
      return dialog(buyerChoice(o) ? '拉打手 · 老板最终选择' : '选择陪玩成员', candidateSummary(o) + html, addableCount ? (buyerChoice(o) ? '加入候选名单' : '确认派单') : '', form => updateOrder(o, 'dispatch', { memberIds: form.getAll('memberIds') }));
    }
    if (action === 'newAssessment' || action === 'qualityCheck') {
      const member = (w.members || []).find(m => m.id === id);
      if (!member) throw new Error('陪玩成员不存在');
      const quality = action === 'qualityCheck';
      const recentOrders = (w.orders || []).filter(order => order.participants?.some(p => p.userId === id)).slice(0, 8);
      const type = quality ? 'quality' : 'onboarding';
      const options = (member.games || []).filter(name => gamesOf(w).some(game => game.name === name)).map(game => `<option value="${e(game)}">${e(game)}</option>`).join('');
      return dialog(quality ? '发起在店质检' : '创建入店考核', `<p><strong>${e(member.name)}</strong> · ${e(member.levelName || '未定级')} · ${e((member.games || []).join(' / ') || '未配置游戏')}</p><label class="form-field">考核游戏<select name="game" ${options ? '' : 'disabled'}>${options || '<option value="">暂无已配置游戏</option>'}</select></label>${quality && recentOrders.length ? `<label class="form-field">关联服务订单（可选）<select name="orderId"><option value="">不关联订单</option>${recentOrders.map(order => `<option value="${e(order.id)}">${e(order.id)} · ${e(order.game)} · ${e(order.status)}</option>`).join('')}</select></label>` : ''}${field('预约时间', 'scheduledAt', 'datetime-local', '', 'required')}<label class="form-field">考核说明<textarea name="note" rows="3" maxlength="500" placeholder="${quality ? '记录触发质检的原因、需重点观察的服务表现' : '记录考核范围、段位要求和注意事项'}" required></textarea></label><p class="detail-note">提交后生成${quality ? '质检' : '入店考核'}记录，完成时再补充评分与结论。</p>`, '创建记录', form => api('/assessments', { memberId: id, type, game: form.get('game'), orderId: form.get('orderId') || undefined, scheduledAt: form.get('scheduledAt'), note: form.get('note'), status: '待考核' }));
    }
    if (action === 'assessmentReview') {
      const assessment = assessmentRecords().find(a => a.id === id);
      if (!assessment) throw new Error('考核记录不存在或已刷新');
      const statFields = ['wins:胜场','losses:败场','kills:击杀','deaths:死亡','mvp:MVP次数'].map(item => { const [name,label] = item.split(':'); return `<label class="form-field">${label}<input name="${name}" type="number" value="${e(assessment[name] ?? '')}" min="0" step="1"></label>`; }).join('');
      return dialog('填写考核结果', `<p><strong>${e(assessment.memberName || assessment.candidateName || assessment.memberId || '')}</strong> · ${e(assessment.type === 'quality' || assessment.kind === '质检' ? '在店质检' : '入店考核')} · ${e(assessment.game || '—')}</p>${field('评分（0–100）', 'score', 'number', assessment.score ?? '', 'min="0" max="100" step="1"')}<div class="form-grid-2">${statFields}</div><label class="form-field">结论<select name="result"><option value="通过">通过</option><option value="待复核">待复核</option><option value="不通过">不通过</option></select></label><label class="form-field">战绩凭证<input name="evidence" value="${e(assessment.evidence || '')}" maxlength="1000"></label>${textarea('考核记录 / 改进要求', 'note', '补充关键表现、问题与后续安排')}<p class="detail-note">提交后会记录操作人和时间；未通过的入店考核不会自动开通接单权限，质检不改变历史订单。</p>`, '保存结果', form => api(`/assessments/${id}`, { score: Number(form.get('score')), result: form.get('result'), wins: form.get('wins') ? Number(form.get('wins')) : undefined, losses: form.get('losses') ? Number(form.get('losses')) : undefined, kills: form.get('kills') ? Number(form.get('kills')) : undefined, deaths: form.get('deaths') ? Number(form.get('deaths')) : undefined, mvp: form.get('mvp') ? Number(form.get('mvp')) : undefined, evidence: form.get('evidence') || undefined, note: form.get('note') }));
    }
    if (action === 'newOrder') {
      const products = w.products.filter(p => p.state === '启用' && gamesOf(w).some(g => g.name === p.game && g.state === '上架'));
      if (!products.length) return dialog('暂无可售服务', '<p>目前没有上架的游戏商品，请稍后再试或联系客服。</p>');
      if (['user','member'].includes(w.user.role)) {
        return openOrderPicker({
          workspace: w,
          productId: el.dataset.productId,
          preferredEscort: el.dataset.preferredEscort ? JSON.parse(el.dataset.preferredEscort) : undefined,
          api,
          onSuccess: async () => {
            await refresh();
            toast('订单已创建，客服将尽快安排陪玩');
          },
        });
      }
      const form = dialog('新建陪玩订单', `${field('老板称呼', 'boss', 'text', '', 'maxlength="30" list="customerList"')}<datalist id="customerList">${w.customers.map(c => `<option value="${e(c.name)}">余额 ${money(c.balanceCents)}</option>`).join('')}</datalist><label class="form-field">游戏商品<select name="productId">${products.map(p => `<option value="${p.id}">${e(p.game)} · ${e(p.name)}</option>`).join('')}</select></label><label class="form-field">订单等级<select name="levelId">${w.levels.map(l=>`<option value="${l.id}" ${l.id==='gold'?'selected':''}>${l.name}及以上</option>`).join('')}</select></label>${field('服务时长（小时）','hours','number',1,'min="1" max="24" step="1"')}<div class="form-total">订单金额 <strong id="orderQuote"></strong></div><label class="form-field">支付方式<select name="pay"><option>线下已收款</option><option>余额支付</option></select></label><label class="form-field">Tag 标签（可选，用逗号分隔）<input name="tags" maxlength="240" placeholder="例如：娱乐、上分、新人"></label>${textarea('服务要求', 'requirement', '例如：开麦沟通、游戏区服、服务时间和段位要求')}<p class="detail-note">选择“线下已收款”表示客服已经核实收款；余额支付会即时扣减老板余额。</p>`, '创建订单', submitOrder);
      let requestSignature = '', requestId = '';
      function orderUnitPrice(productId, levelId) {
        const product = products.find(item => item.id === productId);
        const gamePrice = w.gameLevelConfigs?.[product?.game]?.levels?.find(item => item.id === levelId)?.priceCents;
        const base = Number.isSafeInteger(gamePrice) ? gamePrice : product?.game === '三角洲行动' ? w.levels.find(item => item.id === levelId)?.priceCents : product?.priceCents;
        return base * (product?.game === '三角洲行动' ? escortCountOf(product) : 1);
      }
      function submitOrder(data) {
        const input = Object.fromEntries(data);
        const payload = { ...input, expectedUnitPriceCents: orderUnitPrice(input.productId, input.levelId) };
        const signature = JSON.stringify(payload);
        if (signature !== requestSignature) { requestSignature = signature; requestId = crypto.randomUUID(); }
        return api('/orders', { ...payload, requestId });
      }
      const quote = () => {
        const unitPrice = orderUnitPrice(form.querySelector('[name=productId]').value, form.querySelector('[name=levelId]').value);
        form.querySelector('#orderQuote').textContent = money(Math.round(unitPrice * Number(form.querySelector('[name=hours]').value)));
      };
      form.addEventListener('input', quote); quote(); return;
    }
    if (action === 'supportChat') return openHeaderChat({ consultationOnly: true });
    if (action === 'conversation') return await openConversation(id, { state, api, refresh, toast, onClose: renderApp });
    if (action === 'catalogPrices' || action === 'levelPrices' || action.startsWith('catalog')) return catalogAction(action, id, { workspace:w, dialog, api, refresh });
    if (action === 'refundReview') {
      const refund = (w.refunds || []).find(item => item.orderId === id && ['待审核', '待线下退款'].includes(item.status));
      if (!refund) throw new Error('没有待处理的退款申请');
      const awaitingPayout = refund.status === '待线下退款';
      const canPay = has('finance:manage');
      const paymentField = awaitingPayout && canPay ? '<label class="form-field">实际退款流水号<input name="payoutRef" maxlength="80" placeholder="已完成退款后的真实交易单号"></label>' : '';
      const hint = awaitingPayout ? '审核已通过，财务核对实际退款后登记流水号；尚未付款时可以撤回申请。' : refund.channel === '余额原路' ? '通过后返还消费余额，并同步调整订单收益。' : '通过后进入待线下退款，财务登记实际付款后才完成。';
      return dialog(awaitingPayout ? '处理线下退款' : '退款审核', '<p>' + e(refund.id) + ' · ' + e(refund.customer) + ' · <strong>' + money(refund.amountCents) + '</strong></p><p class="detail-note">' + e(refund.reason) + ' · ' + e(refund.channel) + '</p><p class="detail-note">' + hint + '</p>' + paymentField + textarea('处理说明 / 驳回原因', 'reason', '请填写处理依据'), awaitingPayout ? (canPay ? '确认已退款' : '') : '通过审核', (form, secondary) => api('/refunds/' + refund.id, { action: secondary === 'reject' ? 'reject' : awaitingPayout ? 'markPaid' : 'approve', reason: form.get('reason'), payoutRef: form.get('payoutRef') }), '<button type="button" class="ghost-btn" data-dialog-action="reject">' + (awaitingPayout ? '尚未付款，撤回申请' : '驳回') + '</button>');
    }
    if (action === 'refundRequest') return dialog('发起退款申请', `<p>${e(o.id)} · ${e(o.boss)} · ${money(o.amountCents)}</p>${field('退款金额（元）', 'amount', 'number', (o.amountCents - (o.refundedCents || 0)) / 100, `min="0.01" max="${(o.amountCents - (o.refundedCents || 0)) / 100}" step="0.01"`)}${textarea('退款原因', 'reason', '记录客户诉求、服务问题或协商结果')}`, '提交退款申请', form => api('/refunds', { orderId: o.id, amountCents: Math.round(Number(form.get('amount')) * 100), reason: form.get('reason') }));
    if (action === 'withdrawCancel') return dialog('撤销未打款提现', '<p>仅在实际未付款时撤销，冻结金额将退回成员收益账户。</p>' + textarea('撤销原因', 'reason', '例如：收款信息有误，尚未实际打款'), '确认未付款并退回', form => api('/withdrawals/' + id, { action: 'reject', reason: form.get('reason') }));
    if (action === 'withdrawPaid') {
      const item = (w.withdrawals || []).find(item => item.id === id);
      return dialog('登记线下打款', `<p>${e(item?.id)} · ${e(item?.name)} · <strong>${money(item?.amountCents)}</strong></p>${field('打款流水号', 'payoutRef', 'text', '', 'maxlength="80"')}<p class="detail-note">登记后该提现进入已打款，流水号用于财务对账。</p>`, '确认已打款', form => api(`/withdrawals/${id}`, { action: 'markPaid', payoutRef: form.get('payoutRef') }));
    }
    if (action === 'withdraw') return dialog('申请提现', `<p>当前可提现 <strong>${money(w.wallet.balanceCents)}</strong></p>${field('提现金额（元）','amount','number','','min="1" step="0.01" max="'+w.wallet.balanceCents/100+'"')}<p class="detail-note">提交后冻结申请金额。管理员审核通过后安排线下打款。</p>`, '提交申请', form => api('/withdrawals', { amount: form.get('amount') }));
    if (action === 'withdrawReview' || action === 'topupReview') {
      const isTopup = action === 'topupReview'; const item = (isTopup ? w.topups : w.withdrawals).find(t => t.id === id);
      return dialog(isTopup ? '充值凭证审核' : '提现审核', `<p>${e(item.id)} · ${e(item.user || item.name)} · <strong>${money(item.amountCents)}</strong></p>${isTopup ? `<p class="detail-note">申请时间：${date(item.requestedAt)}<br>付款说明：${e(item.note || '未填写')}</p><label class="form-field">实际收款交易单号<input name="receiptReference" value="${e(item.receiptReference || '')}" maxlength="100" placeholder="批准入账时必须填写，驳回可留空"></label>` : ''}${textarea(isTopup ? '收款核验说明 / 驳回原因' : '审核说明 / 驳回原因', 'reason', '请填写核验结果')}<p class="detail-note">${isTopup ? '确认实际收到款项后再通过，系统会更新余额并记录流水。' : '通过后变为待线下打款；驳回会返还冻结金额。'}</p>`, isTopup ? '确认通过并入账' : '通过 · 待线下打款', (form, secondary) => api(`/${isTopup ? 'topups' : 'withdrawals'}/${id}`, { action: secondary === 'reject' ? 'reject' : 'approve', reason: form.get('reason'), ...(isTopup ? { receiptReference: form.get('receiptReference') } : {}) }), '<button type="button" class="ghost-btn" data-dialog-action="reject">驳回</button>');
    }
    if (action === 'newAccount' || action === 'editAccount') {
      const u = w.accounts.find(u => u.id === id) || { name: '', role: 'escort', active: true, games: [], shareBps: 7000 };
      const form = dialog(id ? '编辑成员权限' : '新增成员账号', `${field('成员名称','name','text',u.name,'maxlength="30"')}${id ? `<p class="detail-note">账号：${e(u.username)}</p>` : field('登录账号','username','text','','minlength="3" maxlength="30" pattern="[a-zA-Z0-9_]+" autocomplete="off"') + field('初始密码','password','password','','minlength="8" maxlength="128" autocomplete="new-password"')}<label class="form-field">职责<select name="role"><option value="admin">最高负责人</option><option value="service">客服</option><option value="escort">打手</option></select></label><label class="form-field">账号状态<select name="active"><option value="true">启用</option><option value="false">停用</option></select></label><div id="escortFields"><h3>支持的游戏</h3><div class="game-checkboxes">${gamesOf(w).map(g => `<label><input type="checkbox" name="games" value="${e(g.name)}" ${u.games.includes(g.name) ? 'checked' : ''}>${e(g.name)}</label>`).join('')}</div>${field('基础分成（%）','share','number',u.shareBps/100,'min="0" max="100" step="0.01"')}</div><p class="detail-note">停用或调整职责会使该成员已有会话失效；新打手初始为离线。</p>`, '保存成员', data => api(`/accounts${id ? '/'+id : ''}`, { ...Object.fromEntries(data), active: data.get('active') === 'true', games: data.getAll('games'), shareBps: Math.round(Number(data.get('share')) * 100) }));
      form.querySelector('[name=role]').value = u.role; form.querySelector('[name=active]').value = String(u.active);
      const change = () => { const isEscort = form.querySelector('[name=role]').value === 'escort'; form.querySelector('#escortFields').hidden = !isEscort; form.querySelector('[name=share]').required = isEscort; }; form.querySelector('[name=role]').onchange = change; change(); return;
    }
  } catch (error) { toast(error.message); }
  finally { state.busy = false; }
}
window.addEventListener('hashchange', async () => {
  const { mode, page } = parseRoute(location.hash, location.pathname);
  try {
    if (mode === 'public') {
      if (state.workspace?.user && state.mode === 'public') renderPublicRoute(state.workspace, page);
      else {
        let workspace = null; try { workspace = await api('/me'); } catch (error) { if (error.status !== 401) throw error; }
        renderPublicRoute(workspace, page);
      }
    } else if (!state.workspace || state.mode !== mode) await switchWorkspace(mode, page);
    else navigate(page);
  } catch (error) {
    if (error.status !== 401) toast(error.message);
  }
});
window.addEventListener('pageshow', event => { if (event.persisted) boot(); });
async function boot() {
  const epoch = ++viewEpoch;
  const { mode: requestedMode, page: desired } = parseRoute(location.hash, location.pathname);
  state.mode = requestedMode;
  document.querySelector('#app').innerHTML = '<div class="loading-screen"><span class="brand-mark">C</span><p>正在载入俱乐部工作台…</p></div>';
  try {
    if (requestedMode === 'public') {
      let workspace = null; try { workspace = await api('/me', undefined, { background: true }); } catch (error) { if (error.status !== 401) throw error; }
      if (epoch !== viewEpoch) return;
      renderPublicRoute(workspace, desired);
    } else {
      await refresh(false);
      if (epoch !== viewEpoch) return;
      navigate(state.workspace.role.pages.includes(desired) ? desired : 'overview');
    }
  }
  catch (error) {
    if (epoch !== viewEpoch) return;
    if (error.status === 401) renderLogin();
    else { document.querySelector('#app').innerHTML = `<div class="loading-screen"><h1>暂时无法连接俱乐部</h1><p>${e(error.message)}</p><button class="primary-action" id="retryBoot">重新连接</button></div>`; document.querySelector('#retryBoot').onclick = boot; }
  }
}
boot();
