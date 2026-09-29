const app = document.querySelector('#app');
const state = {
  services: [], games: [], workspace: null, dialog: null, demo: false, paymentContact: '',
  filter: '全部', search: '', page: 1, catalogCategory: '全部', catalogGameId: '', catalogSearch: '',
  catalogSort: 'default', settingsTab: 'games', pendingService: null,
};
const statuses = ['待支付', '待核款', '待派单', '待服务', '服务中', '待验收', '已完成', '已取消'];
const pageSize = 8;
const currency = cents => `¥${(Number(cents) / 100).toFixed(2)}`;
const date = value => value ? new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '—';
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const isStaff = () => ['admin', 'service'].includes(state.workspace?.user.role);
const isOperator = () => state.workspace && state.workspace.user.role !== 'customer';
const closed = order => ['已完成', '已取消'].includes(order.status);
const fields = form => Object.fromEntries(new FormData(form));
const orderById = id => state.workspace?.orders.find(order => order.id === id);
const activeOrders = () => state.workspace.orders.filter(order => !closed(order));
const count = status => state.workspace.orders.filter(order => order.status === status).length;
const routeName = () => location.hash.replace(/^#\/?/, '') || '';
const shortId = id => id.replace(/^o_/, '').slice(-8).toUpperCase();
const iconPaths = {
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
  home: '<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  order: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  game: '<path d="M7 7h10c3 0 5 11 2 12-2 1-4-3-5-3h-4c-1 0-3 4-5 3C2 18 4 7 7 7Z"/><path d="M8 10v4M6 12h4M15 11h.1M18 13h.1"/>',
  people: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 5v2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  shield: '<path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  refresh: '<path d="M20 7V3m0 4h-4M4 17v4m0-4h4M4 10a8 8 0 0 1 14-5l2 2M20 14a8 8 0 0 1-14 5l-2-2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="m14 5 5 5M4 20l5-1L21 7l-5-5L4 14Z"/>',
  exit: '<path d="M10 4H4v16h6M10 12h11m-4-4 4 4-4 4"/>',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || iconPaths.star}</svg>`;
const badge = status => `<span class="status ${['已完成', '服务中'].includes(status) ? 'positive' : status === '已取消' ? 'neutral' : ''}"><i></i>${esc(status)}</span>`;
function empty(title, description, action = '') {
  return `<div class="empty"><span class="empty-icon">${icon('order')}</span><h3>${title}</h3><p>${description}</p>${action}</div>`;
}
async function api(path, body) {
  const response = await fetch(`/api${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.error || '请求未完成'), { status: response.status });
  return result;
}
function toast(message) {
  document.querySelector('#toast')?.remove();
  const el = document.createElement('div');
  el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); el.textContent = message;
  document.body.append(el); setTimeout(() => el.remove(), 4000);
}
async function run(button, task) {
  if (button?.disabled) return;
  if (button) button.disabled = true;
  try { await task(); } catch (error) {
    if (error.status === 401 && state.workspace) { state.workspace = null; state.dialog = { type: 'auth' }; render(); }
    const output = document.querySelector('dialog .form-error');
    if (output) { output.textContent = error.message; output.scrollIntoView({ block: 'nearest' }); }
    else toast(error.message);
  } finally { if (button) button.disabled = false; }
}
async function refresh() {
  const catalog = await api('/public/services');
  state.services = catalog.services; state.games = catalog.games; state.demo = catalog.demo; state.paymentContact = catalog.paymentContact;
  if (state.catalogGameId && !state.games.some(game => String(game.id) === state.catalogGameId)) state.catalogGameId = '';
  if (state.catalogCategory !== '全部' && !state.games.some(game => game.category === state.catalogCategory)) state.catalogCategory = '全部';
  try { state.workspace = await api('/me'); } catch (error) { if (error.status !== 401) throw error; state.workspace = null; }
}
function brand() { return `<a class="brand" href="#/">${icon('game')}<span>星河俱乐部<small>游戏陪伴 · 服务管理</small></span></a>`; }
function header(route) {
  const user = state.workspace?.user;
  return `<header class="topbar">${brand()}<nav aria-label="主导航"><a ${!route ? 'aria-current="page"' : ''} href="#/">服务大厅</a><a ${route === 'orders' ? 'aria-current="page"' : ''} href="${isOperator() ? '#/dashboard' : '#/orders'}">${isOperator() ? '管理工作台' : '我的订单'}</a><button class="nav-link" data-open="contact">联系客服</button></nav><div class="account">${user ? `<span class="avatar">${esc(user.name.slice(0, 1))}</span><span class="account-name">${esc(user.name)}<small>${esc(user.roleLabel)}</small></span><button class="icon-button" data-open="password" aria-label="修改密码" title="修改密码">${icon('shield')}</button><button class="icon-button" data-logout aria-label="退出登录" title="退出登录">${icon('exit')}</button>` : '<button class="primary small" data-open="auth">登录 / 注册</button>'}</div></header>`;
}
function sidebar(route) {
  const user = state.workspace.user;
  const nav = [['dashboard', 'grid', '工作台概览'], ['manage', 'order', '订单管理'], ...(user.role === 'admin' ? [['settings', 'game', '游戏与服务']] : [])];
  return `<aside class="sidebar">${brand()}<div class="workspace-label">俱乐部管理中心</div><nav aria-label="后台导航">${nav.map(([path, symbol, text]) => `<a href="#/${path}" ${route === path ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${text}</span>${path === 'manage' && activeOrders().length ? `<b>${activeOrders().length}</b>` : ''}</a>`).join('')}</nav><div class="sidebar-bottom"><span class="edition">基础运营版</span><p>下单、核款、派单、履约<br />一条完整的服务链路</p><a href="#/">${icon('home')}返回服务大厅</a></div></aside>`;
}
function home() {
  return `<section class="hero"><div class="hero-copy"><p class="eyebrow">STAR RIVER CLUB</p><h1>下一局，<br />找到你的好搭档。</h1><p>上分、练习，或是轻松开黑。<br />选好游戏和服务，把需求交给我们。</p><div class="hero-actions"><button class="primary" data-browse>探索服务 ${icon('arrow')}</button><button class="hero-link" data-open="contact">联系俱乐部客服</button></div><div class="hero-facts"><span>${icon('clock')}明码标价</span><span>${icon('people')}人工安排</span><span>${icon('shield')}流程可查</span></div></div><div class="hero-photo"><img src="/src/assets/gaming.jpg" alt="朋友一起使用手柄体验游戏" width="900" height="600" /><div class="photo-caption"><span class="live-dot"></span>一起开黑，让每局都有陪伴<small>星河游戏俱乐部</small></div></div></section>
    <div class="journey"><div><b>01</b><span>选择游戏与服务<small>价格、时长一目了然</small></span></div><div><b>02</b><span>下单与核款<small>线下付款，客服核实</small></span></div><div><b>03</b><span>安排陪玩<small>客服派单，约定时间</small></span></div><div><b>04</b><span>完成验收<small>服务结束，确认完成</small></span></div></div>
    <section class="catalog" id="catalog"><div class="section-heading"><div><p class="eyebrow">找到适合你的游戏</p><h2>今天，想怎么玩？</h2></div><label class="search-field">${icon('search')}<input id="catalog-search" type="search" aria-label="搜索服务" placeholder="搜索游戏或服务" value="${esc(state.catalogSearch)}" /></label></div>
    <div class="catalog-toolbar"><div class="chips" aria-label="游戏类别">${['全部', ...new Set(state.games.map(game => game.category))].map(category => `<button data-category="${esc(category)}" class="chip ${state.catalogCategory === category ? 'selected' : ''}" aria-pressed="${state.catalogCategory === category}">${esc(category)}</button>`).join('')}</div><label class="sort-control">排序<select id="catalog-sort" aria-label="服务排序"><option value="default" ${state.catalogSort === 'default' ? 'selected' : ''}>默认排序</option><option value="price" ${state.catalogSort === 'price' ? 'selected' : ''}>价格从低到高</option><option value="duration" ${state.catalogSort === 'duration' ? 'selected' : ''}>时长从短到长</option></select></label></div>
    <div class="game-picker" aria-label="选择游戏"><button class="game-choice ${state.catalogGameId ? '' : 'selected'}" data-game-id="" aria-pressed="${!state.catalogGameId}">${icon('grid')}<span>全部游戏<small>浏览所有可用服务</small></span></button>${state.games.filter(game => state.catalogCategory === '全部' || game.category === state.catalogCategory).map(game => `<button class="game-choice ${state.catalogGameId === String(game.id) ? 'selected' : ''}" data-game-id="${game.id}" aria-pressed="${state.catalogGameId === String(game.id)}">${icon('game')}<span>${esc(game.name)}<small>${esc(game.category)}</small></span></button>`).join('')}</div>
    <div class="catalog-results"><h3>${state.catalogGameId ? `${esc(state.games.find(game => String(game.id) === state.catalogGameId)?.name)}的服务` : '全部服务'}</h3><span id="catalog-count">${catalogServices().length} 个匹配项目</span></div><div class="service-grid" id="catalog-list">${catalogList()}</div></section>
    <section class="help-section"><div><p class="eyebrow">下单前，先了解</p><h2>常见问题</h2><p>还有其他需求？<br />联系客服确认后再下单。</p><button class="text-button" data-open="contact">查看联系方式 ${icon('arrow')}</button></div><div class="faq"><details><summary>下单以后，如何付款？</summary><p>通过客服提供的线下渠道付款，在订单中填写付款备注。客服核实实际到账后，为你安排陪玩。</p></details><details><summary>可以预约服务时间吗？</summary><p>下单时选择游戏、填写期望时间和区服。客服会联系你确认安排，预约以双方确认为准。</p></details><details><summary>怎样查询服务进度？</summary><p>登录后进入“我的订单”，可以查看派单信息、履约状态和完整流程记录。</p></details><details><summary>订单可以取消吗？</summary><p>未提交付款报备的待支付订单可以取消。报备或付款后如需变更，请联系俱乐部客服线下处理。</p></details></div></section>`;
}
function catalogServices() {
  const query = state.catalogSearch.trim().toLowerCase();
  const games = state.games.filter(game => (state.catalogCategory === '全部' || game.category === state.catalogCategory) && (!state.catalogGameId || String(game.id) === state.catalogGameId));
  let services = state.services.filter(s => games.some(game => (!s.gameId || s.gameId === game.id) && `${s.name} ${s.category} ${s.description} ${game.name} ${game.category}`.toLowerCase().includes(query)));
  if (state.catalogSort === 'price') services.sort((a, b) => a.priceCents - b.priceCents);
  if (state.catalogSort === 'duration') services.sort((a, b) => a.durationHours - b.durationHours);
  return services;
}
function catalogList() {
  const services = catalogServices();
  return services.length ? services.map(s => `<article class="service-card"><div class="service-art art-${s.id % 3}"><span class="category">${esc(s.gameName || '通用服务')}</span><span class="art-symbol">${icon(s.id % 3 === 1 ? 'game' : s.id % 3 === 2 ? 'star' : 'people')}</span><span class="art-label">${esc(s.gameName || s.category)}</span><small>${esc(s.gameCategory || '多款游戏可选')}</small></div><div class="service-copy"><h3>${esc(s.name)}</h3><p>${esc(s.description)}</p><div class="service-meta"><span>${icon('clock')}${s.durationHours} 小时 / 次</span><span>${esc(s.gameName || '下单时选择游戏')}</span></div><div class="card-footer"><span><strong>${currency(s.priceCents)}</strong><small> / 次</small></span><button class="secondary small" data-service-detail="${s.id}">查看详情 ${icon('arrow')}</button></div></div></article>`).join('') : empty('没有找到相关服务', '试试其他关键词，或查看所有服务。', '<button class="secondary" data-reset-catalog>查看全部</button>');
}
function nextStep(order) {
  return ({ 待支付: '完成线下付款后，提交付款报备。', 待核款: '客服正在核实收款，请保留转账记录。', 待派单: '收款已确认，等待客服安排陪玩。', 待服务: '陪玩已安排，请确认服务时间后开始。', 服务中: '服务进行中，结束后由陪玩提交完成。', 待验收: '服务已结束，等待客户确认验收。', 已完成: '本次服务已完成，感谢你的信任。', 已取消: '这笔订单已取消，欢迎重新选择服务。' })[order.status];
}
function progress(order) {
  const stage = ({ 待支付: 0, 待核款: 1, 待派单: 2, 待服务: 3, 服务中: 3, 待验收: 4, 已完成: 5 })[order.status];
  if (stage === undefined) return '';
  return `<ol class="progress" aria-label="订单进度">${['提交订单', '付款核实', '客服派单', '陪玩履约', '客户验收'].map((label, i) => `<li class="${i < stage ? 'complete' : i === stage ? 'current' : ''}" ${i === stage ? 'aria-current="step"' : ''}><b>${i < stage ? icon('check') : i + 1}</b><span>${label}</span></li>`).join('')}</ol>`;
}
function actions(order) {
  const role = state.workspace.user.role;
  if (role === 'customer' && order.status === '待支付') return '<button class="primary" data-order-action="pay">报备已付款</button><button class="text-button" data-order-action="cancel">取消订单</button>';
  if (role === 'customer' && order.status === '待验收') return '<button class="primary" data-order-action="accept">确认验收</button>';
  if (isStaff() && ['待支付', '待核款'].includes(order.status)) return `<button class="primary" data-order-action="confirm-payment">确认收款</button>${order.status === '待核款' ? '<button class="secondary" data-order-action="reject-payment">退回报备</button>' : ''}`;
  if (isStaff() && order.status === '待派单') return `<label class="inline-select">分配陪玩<select data-dispatch-select aria-label="分配陪玩">${state.workspace.escorts.length ? state.workspace.escorts.map(e => `<option value="${esc(e.id)}">${esc(e.name)} · ${state.workspace.orders.filter(o => o.escort_id === e.id && !closed(o)).length} 单进行中</option>`).join('') : '<option value="">暂无可用陪玩</option>'}</select></label><button class="primary" data-order-action="dispatch" ${!state.workspace.escorts.length ? 'disabled' : ''}>确认派单</button>`;
  if (role === 'escort' && order.status === '待服务') return '<button class="primary" data-order-action="start">开始服务</button>';
  if (role === 'escort' && order.status === '服务中') return '<button class="primary" data-order-action="finish">提交完成</button>';
  return '';
}
function metrics(items) {
  return `<div class="metrics">${items.map(([label, number, symbol, filter, description]) => `<button class="metric" data-filter="${filter}"><span class="metric-label">${icon(symbol)}${label}</span><strong>${number}<small>单</small></strong><span class="metric-description">${description}${icon('arrow')}</span></button>`).join('')}</div>`;
}
function dashboard() {
  const user = state.workspace.user;
  const relevant = user.role === 'escort' ? ['待服务', '服务中'] : ['待核款', '待派单'];
  const pending = state.workspace.orders.filter(o => relevant.includes(o.status));
  const recentEvents = state.workspace.orders.flatMap(order => order.events.map(event => ({ ...event, order }))).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  const cards = user.role === 'escort'
    ? [['待开始', count('待服务'), 'clock', '待服务', '确认服务时间并开始'], ['服务中', count('服务中'), 'game', '服务中', '正在履约的订单'], ['待验收', count('待验收'), 'shield', '待验收', '等待客户确认完成'], ['已完成', count('已完成'), 'check', '已完成', '查看已完成的服务']]
    : [['待核款', count('待核款'), 'shield', '待核款', '核实客户付款报备'], ['待派单', count('待派单'), 'people', '待派单', '为已收款订单安排陪玩'], ['服务中', count('服务中'), 'game', '服务中', '查看当前履约进度'], ['待验收', count('待验收'), 'check', '待验收', '等待客户确认完成']];
  return `<section class="page-heading"><div><p class="eyebrow">${new Intl.DateTimeFormat('zh-CN', { dateStyle: 'full' }).format(new Date())}</p><h1>${esc(user.name)}，欢迎回来</h1><p class="page-description">${pending.length ? `有 ${pending.length} 笔订单等待你处理。` : '当前没有待处理任务，可以查看订单进度。'}</p></div><button class="secondary" data-refresh>${icon('refresh')}刷新工作台</button></section>${metrics(cards)}<div class="dashboard-grid"><section class="panel"><div class="panel-heading"><div><h2>待办订单 <span class="count-badge">${pending.length}</span></h2><p>优先处理需要你操作的订单</p></div><a class="text-button" href="#/manage">全部订单 ${icon('arrow')}</a></div>${pending.length ? orderTable(pending.slice(0, 5)) : empty('待办已处理完毕', '新的付款报备或派单任务会显示在这里。', '<a class="secondary" href="#/manage">查看所有订单</a>')}</section><aside class="panel activity-panel"><div class="panel-heading"><div><h2>最近动态</h2><p>来自真实订单的流程记录</p></div></div>${recentEvents.length ? `<ol class="activity-list">${recentEvents.map(event => `<li><i></i><div><b>${esc(event.action)}</b><span>${esc(event.actor)} · ${date(event.createdAt)}</span><button class="text-button" data-order-detail="${esc(event.order.id)}">${esc(event.order.service_name)} #${shortId(event.order.id)}</button></div></li>`).join('')}</ol>` : '<p class="quiet-empty">订单创建后，将在这里显示最新动态。</p>'}</aside></div><div class="quick-links"><a href="#/manage">${icon('order')}<span>订单管理<small>查询、跟进与处理服务订单</small></span>${icon('arrow')}</a>${user.role === 'admin' ? `<a href="#/settings">${icon('game')}<span>游戏与服务<small>添加游戏类别，维护服务和业务账号</small></span>${icon('arrow')}</a>` : `<a href="#/">${icon('home')}<span>查看服务大厅<small>查看当前在售服务项目</small></span>${icon('arrow')}</a>`}</div>`;
}
function orderTable(orders) {
  return `<div class="table-scroll"><table class="order-table"><thead><tr><th>订单 / 服务</th><th>客户 / 陪玩</th><th>金额</th><th>状态</th><th class="align-right">操作</th></tr></thead><tbody>${orders.map(order => `<tr><td><b>${esc(order.service_name)}</b><small>${esc(order.game_name || '历史订单')}${order.game_category ? ` · ${esc(order.game_category)}` : ''}</small><small>#${shortId(order.id)} · ${date(order.created_at)}</small></td><td>${esc(order.customer)}<small>${esc(order.escort || '暂未分配陪玩')}</small></td><td class="numeric">${currency(order.price_cents)}<small>${order.duration_hours} 小时</small></td><td>${badge(order.status)}</td><td class="align-right"><button class="text-button" data-order-detail="${esc(order.id)}">${closed(order) ? '查看详情' : '处理订单'} ${icon('arrow')}</button></td></tr>`).join('')}</tbody></table></div>`;
}
function orderCard(order) {
  return `<article class="order-card" data-order-id="${esc(order.id)}"><div class="order-card-top"><small>#${shortId(order.id)} · ${date(order.created_at)}</small>${badge(order.status)}</div><div class="order-card-service"><span class="service-icon">${icon('game')}</span><div><h3>${esc(order.service_name)}</h3><span>${order.game_name ? `${esc(order.game_name)} · ` : ''}${order.duration_hours} 小时 · ${esc(order.escort || '等待安排陪玩')}</span></div><strong>${currency(order.price_cents)}</strong></div><p class="order-hint">${nextStep(order)}</p><div class="order-card-bottom"><button class="text-button" data-order-detail="${esc(order.id)}">订单详情 ${icon('arrow')}</button><div>${actions(order)}</div></div></article>`;
}
function filteredOrders() {
  const search = state.search.trim().toLowerCase();
  return state.workspace.orders.filter(o => (state.filter === '全部' || o.status === state.filter) && [o.id, o.customer, o.contact, o.service_name, o.escort, o.game_name, o.game_category].some(value => String(value).toLowerCase().includes(search)));
}
function orderList() {
  const orders = filteredOrders(), pages = Math.max(1, Math.ceil(orders.length / pageSize));
  state.page = Math.min(state.page, pages);
  const shown = orders.slice((state.page - 1) * pageSize, state.page * pageSize);
  return `${shown.length ? isOperator() ? orderTable(shown) : `<div class="order-grid">${shown.map(orderCard).join('')}</div>` : empty('暂无符合条件的订单', state.search || state.filter !== '全部' ? '可以调整关键词或清除筛选条件。' : '提交订单后，在这里跟踪服务进度。', state.search || state.filter !== '全部' ? '<button class="secondary" data-clear-orders>清除筛选</button>' : '<a class="secondary" href="#/">浏览服务</a>')}<div class="pagination"><span>共 ${orders.length} 条 · 第 ${state.page} / ${pages} 页</span><div><button class="secondary small" data-page="${state.page - 1}" ${state.page === 1 ? 'disabled' : ''}>上一页</button><button class="secondary small" data-page="${state.page + 1}" ${state.page === pages ? 'disabled' : ''}>下一页</button></div></div>`;
}
function orders() {
  return `<section class="page-heading"><div><p class="eyebrow">${isOperator() ? '订单中心' : '我的服务'}</p><h1>${isOperator() ? '订单管理' : '我的订单'}</h1><p class="page-description">${isOperator() ? '查看订单进度，完成从核款到验收的每一次交接。' : '每一笔订单，进度都清清楚楚。'}</p></div><button class="secondary" data-refresh>${icon('refresh')}刷新订单</button></section><section class="panel orders-panel"><div class="order-tabs" aria-label="订单状态">${['全部', ...statuses].map(status => `<button class="order-tab ${state.filter === status ? 'selected' : ''}" aria-pressed="${state.filter === status}" data-filter="${status}">${status}<b>${status === '全部' ? state.workspace.orders.length : count(status)}</b></button>`).join('')}</div><div class="order-toolbar"><label class="search-field">${icon('search')}<input id="order-search" type="search" value="${esc(state.search)}" aria-label="搜索订单" placeholder="搜索订单号、游戏、客户或服务" /></label><span class="muted">按创建时间由新到旧排列</span></div><div id="order-list">${orderList()}</div></section>`;
}
function settings() {
  const services = state.workspace.services, users = state.workspace.users, games = state.workspace.games;
  const gameTab = state.settingsTab === 'games';
  const serviceTab = state.settingsTab === 'services';
  return `<section class="page-heading"><div><p class="eyebrow">基础配置</p><h1>游戏与服务</h1><p class="page-description">先添加游戏与类别，再配置对应服务、价格和业务账号。</p></div><button class="primary" data-open="${gameTab ? 'game' : serviceTab ? 'service' : 'staff'}">${icon('plus')}${gameTab ? '新增游戏' : serviceTab ? '新增服务' : '新增账号'}</button></section><div class="settings-summary"><span>${icon('game')}<b>${games.filter(g => g.active).length}</b> 在架游戏</span><span>${icon('game')}<b>${state.services.length}</b> 在售服务</span><span>${icon('people')}<b>${users.filter(u => u.active && u.role === 'escort').length}</b> 可用陪玩</span><span>${icon('shield')}<b>${users.filter(u => u.active && u.role === 'service').length}</b> 客服账号</span></div><section class="panel"><div class="order-tabs" aria-label="管理内容"><button class="order-tab ${gameTab ? 'selected' : ''}" data-settings-tab="games" aria-pressed="${gameTab}">游戏目录 <b>${games.length}</b></button><button class="order-tab ${serviceTab ? 'selected' : ''}" data-settings-tab="services" aria-pressed="${serviceTab}">服务项目 <b>${services.length}</b></button><button class="order-tab ${state.settingsTab === 'staff' ? 'selected' : ''}" data-settings-tab="staff" aria-pressed="${state.settingsTab === 'staff'}">业务人员 <b>${users.length}</b></button></div>${gameTab ? gameTable(games, services) : serviceTab ? `<div class="table-scroll"><table><thead><tr><th>服务项目</th><th>所属游戏 / 服务分类</th><th>价格 / 时长</th><th>状态</th><th class="align-right">操作</th></tr></thead><tbody>${services.map(service => `<tr><td><b>${esc(service.name)}</b><small class="description-cell">${esc(service.description)}</small></td><td>${esc(service.gameName || '通用服务')}<small>${esc(service.category)}</small></td><td class="numeric">${currency(service.priceCents)}<small>${service.durationHours} 小时 / 次</small></td><td><span class="status ${service.active && (!service.gameId || games.some(g => g.id === service.gameId && g.active)) ? 'positive' : 'neutral'}"><i></i>${!service.active ? '已下架' : service.gameId && !games.some(g => g.id === service.gameId && g.active) ? '游戏已下架' : '在售'}</span></td><td class="align-right"><div class="row-actions"><button class="text-button" data-edit-service="${service.id}">${icon('edit')}编辑</button><button class="text-button" data-toggle-service="${service.id}" data-active="${service.active ? '0' : '1'}">${service.active ? '下架' : '上架'}</button></div></td></tr>`).join('')}</tbody></table></div>${!services.length ? empty('还没有服务项目', '添加名称、价格与时长，即可在大厅展示。', '<button class="secondary" data-open="service">新增服务</button>') : ''}` : `<div class="table-scroll"><table><thead><tr><th>人员</th><th>登录账号</th><th>角色</th><th>进行中订单</th><th>状态</th><th class="align-right">操作</th></tr></thead><tbody>${users.map(user => `<tr><td><div class="person"><span class="avatar">${esc(user.name.slice(0, 1))}</span><b>${esc(user.name)}</b></div></td><td>${esc(user.username)}</td><td>${esc(user.roleLabel)}</td><td>${user.role === 'escort' ? state.workspace.orders.filter(o => o.escort_id === user.id && !closed(o)).length : '—'}</td><td><span class="status ${user.active ? 'positive' : 'neutral'}"><i></i>${user.active ? '启用' : '已停用'}</span></td><td class="align-right"><button class="text-button" data-toggle-staff="${esc(user.id)}">${user.active ? '停用账号' : '启用账号'}</button></td></tr>`).join('')}</tbody></table></div>${!users.length ? empty('添加你的第一位业务人员', '创建客服或陪玩账号，用于处理和履约订单。', '<button class="secondary" data-open="staff">新增账号</button>') : ''}`}<div class="panel-note">${icon('shield')}${gameTab ? '下架游戏后，对应服务暂停接单；已有订单可继续核款、派单和履约。' : serviceTab ? '调价仅影响新订单，已有订单保留原价格和服务信息。' : '停用后账号无法登录；陪玩有未完成订单时不能停用。'}</div></section>`;
}
function gameTable(games, services) {
  if (!games.length) return empty('添加第一款游戏', '填写游戏名称和类别，支持自定义类别。', '<button class="secondary" data-open="game">新增游戏</button>');
  return `<div class="table-scroll"><table class="game-table"><thead><tr><th>游戏名称</th><th>游戏类别</th><th>专属服务</th><th>状态</th><th class="align-right">操作</th></tr></thead><tbody>${games.map(game => `<tr><td><div class="person"><span class="service-icon">${icon('game')}</span><b>${esc(game.name)}</b></div></td><td>${esc(game.category)}</td><td>${services.filter(s => s.gameId === game.id).length} 项<small>另可使用通用服务</small></td><td><span class="status ${game.active ? 'positive' : 'neutral'}"><i></i>${game.active ? '已上架' : '已下架'}</span></td><td class="align-right"><div class="row-actions"><button class="text-button" data-edit-game="${game.id}">${icon('edit')}编辑</button><button class="text-button" data-toggle-game="${game.id}" data-active="${game.active ? '0' : '1'}">${game.active ? '下架' : '上架'}</button></div></td></tr>`).join('')}</tbody></table></div>`;
}
function field(label, name, options = {}) {
  return `<label>${label}<input name="${name}" ${options.type ? `type="${options.type}"` : ''} ${options.attrs || ''} value="${esc(options.value ?? '')}" ${options.optional ? '' : 'required'} /></label>`;
}
function detail(order) {
  return `<div data-order-id="${esc(order.id)}"><div class="detail-title"><div><p class="eyebrow">订单 #${shortId(order.id)}</p><h2 id="dialog-title">${esc(order.service_name)}</h2></div>${badge(order.status)}</div><div class="detail-hint">${icon('clock')}<span>${nextStep(order)}</span></div>${progress(order)}<dl class="detail-info"><div><dt>游戏</dt><dd>${esc(order.game_name || '历史订单未记录游戏')}</dd></div><div><dt>游戏类别</dt><dd>${esc(order.game_category || '—')}</dd></div><div><dt>订单金额</dt><dd class="price">${currency(order.price_cents)}</dd></div><div><dt>服务时长</dt><dd>${order.duration_hours} 小时</dd></div><div><dt>客户</dt><dd>${esc(order.customer)}</dd></div><div><dt>陪玩</dt><dd>${esc(order.escort || '待安排')}</dd></div><div><dt>联系方式</dt><dd>${esc(order.contact)}</dd></div><div><dt>下单时间</dt><dd>${date(order.created_at)}</dd></div></dl><section class="detail-section"><h3>需求备注</h3><p class="order-note">${esc(order.note || '暂无额外需求')}</p></section>${state.workspace.user.role === 'customer' && order.status === '待支付' ? `<p class="payment-contact">收款联系：${esc(state.paymentContact)}</p>` : ''}<section class="detail-section"><div class="section-heading"><h3>流程记录</h3>${isOperator() && !closed(order) ? '<button class="text-button" data-order-action="note">添加跟进</button>' : ''}</div><ol class="timeline">${order.events.map(event => `<li><i></i><div><b>${esc(event.action)}</b><small>${esc(event.actor)} · ${date(event.createdAt)}</small>${event.note ? `<p>${esc(event.note)}</p>` : ''}</div></li>`).join('')}</ol></section><p class="form-error" role="alert"></p><div class="detail-actions">${actions(order)}${!isOperator() && closed(order) && state.services.some(s => s.id === order.service_id) ? `<button class="primary" data-order-service="${order.service_id}" data-reorder="${esc(order.id)}">再来一单</button>` : ''}<button class="secondary" data-close>关闭详情</button></div><p class="full-id">完整订单号：${esc(order.id)}</p></div>`;
}
function modal() {
  const { type, id, mode } = state.dialog;
  if (type === 'detail') return `<dialog class="detail-dialog" aria-labelledby="dialog-title"><button class="close" type="button" data-close aria-label="关闭">×</button>${detail(orderById(id))}</dialog>`;
  let title = '', body = '', submit = '保存', form = true;
  if (type === 'auth') {
    const register = mode === 'register';
    title = register ? '加入星河俱乐部' : '欢迎回来'; submit = register ? '注册并登录' : '登录';
    body = `<p class="muted">${register ? '创建账号，开启你的第一场陪玩服务。' : '登录后查看订单，或进入你的工作台。'}</p>${field('账号', 'username', { attrs: 'minlength="3" maxlength="30" autocomplete="username"' })}${register ? field('称呼', 'name', { attrs: 'maxlength="30"' }) : ''}${field('密码', 'password', { type: 'password', attrs: `minlength="${register ? 8 : 6}" maxlength="128" autocomplete="${register ? 'new-password' : 'current-password'}"` })}<button type="button" class="text-button" data-switch-auth>${register ? '已有账号，去登录' : '没有账号？立即注册'}</button>`;
  } else if (type === 'service-detail') {
    const s = state.services.find(s => s.id === id); title = s.name; form = false;
    body = `<span class="category">${esc(s.gameName || '通用游戏服务')} · ${esc(s.category)}</span><div class="service-detail-price"><strong>${currency(s.priceCents)}</strong><span> / ${s.durationHours} 小时</span></div><p class="service-description">${esc(s.description)}</p><div class="info-box"><h3>下单说明</h3><ul><li>填写游戏、区服和期望时间，客服会与你确认。</li><li>线下付款并报备，客服核实后安排陪玩。</li><li>服务结束后，在“我的订单”中确认验收。</li></ul></div><button class="primary full-width" data-order-service="${s.id}">预约这项服务 ${icon('arrow')}</button>`;
  } else if (type === 'order') {
    const s = state.services.find(s => s.id === id); title = '填写服务需求'; submit = '确认下单';
    const games = state.games.filter(g => !s.gameId || g.id === s.gameId);
    const selectedGame = s.gameId || state.dialog.gameId || state.catalogGameId;
    body = `<div class="booking-summary"><span class="service-icon">${icon('game')}</span><div><b>${esc(s.name)}</b><small>${s.durationHours} 小时 · ${esc(s.category)}</small></div><strong>${currency(s.priceCents)}</strong></div><label>选择游戏<select name="gameId" required><option value="">请选择本次服务的游戏</option>${games.map(g => `<option value="${g.id}" ${String(selectedGame) === String(g.id) ? 'selected' : ''}>${esc(g.name)} · ${esc(g.category)}</option>`).join('')}</select></label>${field('联系方式', 'contact', { attrs: 'minlength="2" maxlength="80" placeholder="微信号或手机号"' })}<div class="form-pair">${field('区服（选填）', 'region', { optional: true, attrs: 'maxlength="60" placeholder="如：微信区 / 亚洲服"' })}${field('期望时间（选填）', 'appointment', { optional: true, attrs: 'maxlength="60" placeholder="如：今晚 20:00"' })}</div><label>其他需求（选填）<textarea name="note" maxlength="160" placeholder="想练习的位置、组队人数或其他需求"></textarea></label><p class="form-tip">预约时间以客服确认为准。下单后请联系收款客服，再报备付款。</p>`;
  } else if (type === 'pay') {
    title = '提交付款报备'; submit = '提交核款';
    body = `<p class="summary">应付 ${currency(orderById(id).price_cents)}</p><p class="payment-contact">${esc(state.paymentContact)}</p><p class="muted">此操作不会扣款。线下付款后填写备注，到账以客服核实为准。</p>${field('付款备注', 'reference', { attrs: 'minlength="2" maxlength="100" placeholder="付款人、时间或转账单号"' })}`;
  } else if (['note', 'reject-payment'].includes(type)) {
    title = type === 'note' ? '添加服务跟进' : '退回付款报备'; submit = type === 'note' ? '保存跟进' : '确认退回';
    body = `<p class="muted">${type === 'note' ? '跟进内容会显示在订单流程记录中，客户可见。' : '退回后客户可补充付款信息并重新提交。请说明需要核对的问题。'}</p><label>${type === 'note' ? '跟进内容' : '退回原因'}<textarea name="note" required minlength="2" maxlength="${type === 'note' ? 300 : 200}"></textarea></label>`;
  } else if (type === 'confirm') {
    title = ({ 'confirm-payment': '确认款项已到账', accept: '确认验收完成', cancel: '取消未付款订单', dispatch: '确认派单', start: '开始本次服务', finish: '提交服务完成' })[state.dialog.action]; submit = '确认';
    body = `<p class="summary">${esc(orderById(id).service_name)} · ${currency(orderById(id).price_cents)}</p><p class="muted">${esc(({ 'confirm-payment': '请核对实际到账金额，确认后将开放派单。', accept: '请确认约定服务已经完成，验收后订单结束。', cancel: '确认取消这笔未付款订单？取消后可以重新下单。', dispatch: `本次分配给 ${state.workspace.escorts.find(e => e.id === state.dialog.escortId)?.name || ''}。请提前确认服务时间。`, start: '请确认已联系客户，并按约定开始履约。', finish: '确认服务已按约定完成，提交后等待客户验收。' })[state.dialog.action])}</p>`;
  } else if (type === 'staff-status') {
    const member = state.workspace.users.find(u => u.id === id); title = `${member.active ? '停用' : '启用'}业务账号`; submit = '确认';
    body = `<p>${esc(member.name)} · ${esc(member.username)}</p><p class="muted">${member.active ? '停用后会立即退出已有登录，账号将无法登录。正在履约的陪玩需要先完成订单。' : '启用后，该人员可以重新登录并处理订单。'}</p>`;
  } else if (type === 'game') {
    const game = state.workspace.games.find(g => g.id === id) || {}; title = id ? '编辑游戏' : '新增游戏';
    body = `${field('游戏名称', 'name', { value: game.name, attrs: 'minlength="2" maxlength="40" placeholder="如：王者荣耀"' })}${field('游戏类别', 'category', { value: game.category, attrs: 'minlength="2" maxlength="30" list="game-category-options" placeholder="如：MOBA、射击竞技、休闲娱乐"' })}<datalist id="game-category-options">${[...new Set(['MOBA', '射击竞技', '休闲娱乐', '角色扮演', ...state.workspace.games.map(g => g.category)])].map(c => `<option value="${esc(c)}"></option>`).join('')}</datalist><p class="form-tip">可选择已有类别或直接输入新类别。保存后游戏会出现在服务大厅，已有订单保留原游戏信息。</p>`;
  } else if (type === 'game-status') {
    const game = state.workspace.games.find(g => g.id === id); title = game.active ? '下架游戏' : '上架游戏'; submit = '确认';
    body = `<p class="summary">${esc(game.name)}</p><p class="muted">${game.active ? '下架后，该游戏及其专属服务不再接受新订单。已有订单仍可继续履约。' : '上架后，客户可以选择该游戏，并购买处于在售状态的服务。'}</p>`;
  } else if (type === 'service') {
    const s = state.workspace.services.find(s => s.id === id) || {}; title = id ? '编辑服务项目' : '新增服务项目';
    body = `${field('服务名称', 'name', { value: s.name, attrs: 'minlength="2" maxlength="50"' })}<label>所属游戏<select name="gameId"><option value="">通用服务 · 所有在架游戏</option>${state.workspace.games.filter(g => g.active || g.id === s.gameId).map(g => `<option value="${g.id}" ${g.id === s.gameId ? 'selected' : ''}>${esc(g.name)} · ${esc(g.category)}${g.active ? '' : '（已下架）'}</option>`).join('')}</select></label>${field('服务分类', 'category', { value: s.category, attrs: 'minlength="2" maxlength="30" list="category-options"' })}<datalist id="category-options">${[...new Set(state.workspace.services.map(s => s.category))].map(category => `<option value="${esc(category)}"></option>`).join('')}</datalist><div class="form-pair">${field('价格（元）', 'price', { value: s.priceCents ? s.priceCents / 100 : '', type: 'number', attrs: 'min="1" max="100000" step="0.01"' })}${field('时长（小时）', 'duration', { value: s.durationHours || 1, type: 'number', attrs: 'min="1" max="24" step="1"' })}</div><label>服务说明<textarea name="description" required minlength="5" maxlength="200">${esc(s.description || '')}</textarea></label><p class="form-tip">保存后同步到服务大厅，已创建的订单保持原价格。</p>`;
  } else if (type === 'staff') {
    title = '新增业务账号';
    body = `${field('账号', 'username', { attrs: 'minlength="3" maxlength="30" autocomplete="off"' })}${field('称呼', 'name', { attrs: 'maxlength="30"' })}<label>角色<select name="role"><option value="escort">陪玩 · 处理本人履约订单</option><option value="service">客服 · 核款与派单</option></select></label>${field('初始密码', 'password', { type: 'password', attrs: 'minlength="8" maxlength="128" autocomplete="new-password"' })}`;
  } else if (type === 'password') {
    title = '修改密码';
    body = `${field('当前密码', 'currentPassword', { type: 'password', attrs: 'autocomplete="current-password" maxlength="128"' })}${field('新密码', 'password', { type: 'password', attrs: 'minlength="8" maxlength="128" autocomplete="new-password"' })}`;
  } else if (type === 'contact') {
    title = '联系俱乐部客服'; form = false;
    body = `<span class="contact-symbol">${icon('people')}</span><p class="contact-text">${esc(state.paymentContact)}</p><p class="muted">咨询时请提供服务名称；已有订单请附上订单编号，方便客服查询。</p><button class="secondary full-width" data-close>我知道了</button>`;
  }
  return `<dialog aria-labelledby="dialog-title"><button class="close" type="button" data-close aria-label="关闭">×</button><h2 id="dialog-title">${esc(title)}</h2>${form ? `<form id="dialog-form" class="stack">${body}<p class="form-error" role="alert"></p><button class="primary" type="submit">${submit}</button></form>` : body}${type === 'auth' && state.demo ? '<details class="demo-note"><summary>演示环境测试账号</summary><p>管理员 admin · 客服 service<br />陪玩 escort · 用户 user<br />密码均为 123456</p></details>' : ''}</dialog>`;
}
function render() {
  const route = routeName(), backoffice = isOperator() && ['dashboard', 'manage', 'settings'].includes(route);
  let page = home();
  if (['dashboard', 'orders', 'manage', 'settings'].includes(route)) {
    if (!state.workspace) page = empty('登录后继续', '进入你的订单或工作台，查看服务的最新进度。', '<button class="primary" data-open="auth">登录 / 注册</button>');
    else if (route === 'settings') page = state.workspace.user.role === 'admin' ? settings() : empty('此页面仅限管理员', '可以返回订单页继续处理自己的任务。', '<a class="secondary" href="#/orders">返回订单</a>');
    else if (route === 'dashboard' && isOperator()) page = dashboard();
    else page = orders();
  }
  const previousDialog = document.querySelector('dialog');
  if (previousDialog?.open) previousDialog.close();
  app.innerHTML = backoffice ? `<div class="admin-layout">${sidebar(route)}<div class="admin-body"><header class="admin-topbar"><div><span>工作空间</span><b>${({ dashboard: '工作台概览', manage: '订单管理', settings: '游戏与服务' })[route]}</b></div><div class="account"><span class="avatar">${esc(state.workspace.user.name.slice(0, 1))}</span><span class="account-name">${esc(state.workspace.user.name)}<small>${esc(state.workspace.user.roleLabel)}</small></span><button class="icon-button" data-open="password" aria-label="修改密码" title="修改密码">${icon('shield')}</button><button class="icon-button" data-logout aria-label="退出登录" title="退出登录">${icon('exit')}</button></div></header><main>${page}</main><footer>星河俱乐部 · 基础运营版</footer></div></div>` : `${header(route)}<main class="public-main">${page}</main><footer><b>星河俱乐部</b><span>游戏陪伴 · 服务管理</span><button class="text-button" data-open="contact">联系客服</button></footer>`;
  if (state.dialog) {
    app.insertAdjacentHTML('beforeend', modal());
    const dialog = document.querySelector('dialog'); dialog.showModal();
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
  }
}
function openDialog(dialog) { state.dialog = dialog; render(); }
function closeDialog() { const returnTo = state.dialog?.returnTo; state.dialog = returnTo ? { type: 'detail', id: returnTo } : null; render(); }
function goOrders(filter) { state.filter = filter; state.search = ''; state.page = 1; const route = isOperator() ? '#/manage' : '#/orders'; if (location.hash !== route) location.hash = route; else render(); }
function book(id, gameId) {
  if (!state.services.some(s => s.id === id) || !state.games.length) return toast('暂无可预约的游戏或服务，请联系客服。');
  if (!state.workspace) { state.pendingService = id; return openDialog({ type: 'auth' }); }
  if (state.workspace.user.role !== 'customer') return toast('请使用用户账号下单；业务人员可在工作台处理订单。');
  openDialog({ type: 'order', id, gameId });
}
app.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  const data = button.dataset;
  if ('open' in data) return openDialog({ type: data.open });
  if ('close' in data) return closeDialog();
  if ('switchAuth' in data) return openDialog({ type: 'auth', mode: state.dialog.mode === 'register' ? 'login' : 'register' });
  if ('logout' in data) return run(button, async () => { await api('/logout', {}); state.workspace = null; state.dialog = null; state.pendingService = null; state.filter = '全部'; state.search = ''; state.page = 1; location.hash = '#/'; render(); });
  if ('refresh' in data) return run(button, async () => { await refresh(); render(); toast('已更新最新数据'); });
  if ('browse' in data) return document.querySelector('#catalog')?.scrollIntoView({ block: 'start' });
  if ('category' in data) { state.catalogCategory = data.category; state.catalogGameId = ''; render(); return; }
  if ('gameId' in data) { state.catalogGameId = data.gameId; render(); return; }
  if ('resetCatalog' in data) { state.catalogCategory = '全部'; state.catalogGameId = ''; state.catalogSearch = ''; state.catalogSort = 'default'; render(); return; }
  if ('serviceDetail' in data) return openDialog({ type: 'service-detail', id: Number(data.serviceDetail) });
  if ('orderService' in data) return book(Number(data.orderService), data.reorder ? state.games.find(g => g.name === orderById(data.reorder)?.game_name)?.id : undefined);
  if ('orderDetail' in data) return openDialog({ type: 'detail', id: data.orderDetail });
  if ('filter' in data) return goOrders(data.filter);
  if ('clearOrders' in data) return goOrders('全部');
  if ('page' in data) { state.page = Number(data.page); document.querySelector('#order-list').innerHTML = orderList(); return; }
  if ('settingsTab' in data) { state.settingsTab = data.settingsTab; render(); return; }
  if ('editGame' in data) return openDialog({ type: 'game', id: Number(data.editGame) });
  if ('toggleGame' in data) return openDialog({ type: 'game-status', id: Number(data.toggleGame) });
  if ('editService' in data) return openDialog({ type: 'service', id: Number(data.editService) });
  if ('toggleStaff' in data) return openDialog({ type: 'staff-status', id: data.toggleStaff });
  if ('toggleService' in data) return run(button, async () => { await api(`/services/${data.toggleService}`, { active: data.active === '1' }); await refresh(); render(); toast('服务状态已更新'); });
  if ('orderAction' in data) {
    const card = button.closest('[data-order-id]'), id = card.dataset.orderId, action = data.orderAction;
    const returnTo = state.dialog?.type === 'detail' ? id : null;
    if (['pay', 'note', 'reject-payment'].includes(action)) return openDialog({ type: action, id, returnTo });
    return openDialog({ type: 'confirm', id, action, returnTo, escortId: card.querySelector('[data-dispatch-select]')?.value });
  }
});
app.addEventListener('input', event => {
  if (event.target.id === 'order-search') { state.search = event.target.value; state.page = 1; document.querySelector('#order-list').innerHTML = orderList(); }
  if (event.target.id === 'catalog-search') { state.catalogSearch = event.target.value; document.querySelector('#catalog-list').innerHTML = catalogList(); document.querySelector('#catalog-count').textContent = `${catalogServices().length} 个匹配项目`; }
});
app.addEventListener('change', event => {
  if (event.target.id === 'catalog-sort') { state.catalogSort = event.target.value; document.querySelector('#catalog-list').innerHTML = catalogList(); }
});
app.addEventListener('submit', event => {
  if (event.target.id !== 'dialog-form') return;
  event.preventDefault();
  const form = event.target, data = fields(form), dialog = { ...state.dialog };
  run(form.querySelector('[type="submit"]'), async () => {
    if (dialog.type === 'auth') await api(dialog.mode === 'register' ? '/register' : '/login', data);
    else if (dialog.type === 'order') {
      const note = [data.region ? `区服：${data.region.trim()}` : '', data.appointment ? `期望时间：${data.appointment.trim()}` : '', data.note?.trim()].filter(Boolean).join('\n');
      await api('/orders', { serviceId: dialog.id, gameId: Number(data.gameId), contact: data.contact, note });
    } else if (['pay', 'confirm', 'note', 'reject-payment'].includes(dialog.type)) await api(`/orders/${encodeURIComponent(dialog.id)}/actions`, { action: dialog.type === 'confirm' ? dialog.action : dialog.type, escortId: dialog.escortId, ...data });
    else if (dialog.type === 'service') await api(`/services${dialog.id ? `/${dialog.id}` : ''}`, { ...data, priceCents: Math.round(Number(data.price) * 100), durationHours: Number(data.duration) });
    else if (dialog.type === 'game') await api(`/games${dialog.id ? `/${dialog.id}` : ''}`, data);
    else if (dialog.type === 'game-status') await api(`/games/${dialog.id}`, { active: !state.workspace.games.find(g => g.id === dialog.id).active });
    else if (dialog.type === 'staff') await api('/staff', data);
    else if (dialog.type === 'staff-status') await api(`/staff/${encodeURIComponent(dialog.id)}`, { active: !state.workspace.users.find(u => u.id === dialog.id).active });
    else if (dialog.type === 'password') await api('/password', data);
    await refresh();
    state.dialog = dialog.returnTo ? { type: 'detail', id: dialog.returnTo } : null;
    if (dialog.type === 'auth') {
      state.filter = '全部'; state.search = ''; state.page = 1;
      const pending = state.pendingService; state.pendingService = null;
      if (pending && !isOperator() && state.games.length && state.services.some(s => s.id === pending)) { location.hash = '#/'; state.dialog = { type: 'order', id: pending }; }
      else location.hash = isOperator() ? '#/dashboard' : '#/orders';
    }
    if (dialog.type === 'order') { state.filter = '全部'; state.search = ''; state.page = 1; location.hash = '#/orders'; }
    render(); toast(dialog.type === 'auth' ? '登录成功' : '操作成功');
  });
});
addEventListener('hashchange', () => { if (state.dialog?.type !== 'order') state.dialog = null; render(); });
refresh().then(render).catch(error => { app.innerHTML = `<p class="empty">${esc(error.message)}，请刷新页面重试。</p>`; });
