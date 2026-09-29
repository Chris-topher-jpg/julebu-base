const app = document.querySelector('#app');
const state = { services: [], workspace: null, dialog: null, demo: false, paymentContact: '', filter: '全部', search: '' };
const statuses = ['待支付', '待核款', '待派单', '待服务', '服务中', '待验收', '已完成', '已取消'];
const currency = cents => `¥${(Number(cents) / 100).toFixed(2)}`;
const date = value => value ? new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '';
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const isStaff = () => ['admin', 'service'].includes(state.workspace?.user.role);
const fields = form => Object.fromEntries(new FormData(form));
async function api(path, body) {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.error || '请求未完成'), { status: response.status });
  return result;
}
function toast(message) {
  document.querySelector('#toast')?.remove();
  const el = document.createElement('div');
  el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.remove(), 4000);
}
async function run(button, task) {
  if (button?.disabled) return;
  if (button) button.disabled = true;
  try { await task(); } catch (error) {
    if (error.status === 401 && state.workspace) { state.workspace = null; state.dialog = { type: 'auth' }; render(); }
    const output = document.querySelector('dialog .form-error');
    if (output) output.textContent = error.message;
    else toast(error.message);
  } finally { if (button) button.disabled = false; }
}
async function refresh() {
  const catalog = await api('/public/services');
  state.services = catalog.services; state.demo = catalog.demo; state.paymentContact = catalog.paymentContact;
  try { state.workspace = await api('/me'); } catch (error) { if (error.status !== 401) throw error; state.workspace = null; }
}
const badge = status => `<span class="status ${['已完成', '服务中'].includes(status) ? 'positive' : status === '已取消' ? 'muted' : ''}">${esc(status)}</span>`;
function header(route) {
  const user = state.workspace?.user;
  return `<header class="topbar"><a class="brand" href="#/">星河<span>游戏俱乐部</span><small>基础版</small></a><nav aria-label="主导航"><a ${!route ? 'aria-current="page"' : ''} href="#/">服务大厅</a><a ${route === 'orders' || route === 'manage' ? 'aria-current="page"' : ''} href="${user && user.role !== 'customer' ? '#/manage' : '#/orders'}">${user && user.role !== 'customer' ? '订单工作台' : '我的订单'}</a>${user?.role === 'admin' ? `<a ${route === 'settings' ? 'aria-current="page"' : ''} href="#/settings">基础维护</a>` : ''}</nav><div class="account">${user ? `<span>${esc(user.name)} · ${esc(user.roleLabel)}</span><button class="text-button" data-open="password">改密</button><button class="text-button" data-logout>退出</button>` : '<button class="primary small" data-open="auth">登录 / 注册</button>'}</div></header>`;
}
function home() {
  return `<section class="catalog-heading"><div><p class="eyebrow">服务大厅</p><h1>星河游戏俱乐部</h1></div><span class="muted">${state.services.length} 个在售项目</span></section><div class="service-grid">${state.services.length ? state.services.map(service => `<article class="service-card"><img class="service-image" src="/src/assets/gaming.jpg" alt="游戏手柄与游戏设备" width="600" height="220" /><div class="service-copy"><span class="category">${esc(service.category)}</span><h2>${esc(service.name)}</h2><p>${esc(service.description)}</p><div class="card-footer"><span><strong>${currency(service.priceCents)}</strong><small> / ${service.durationHours} 小时</small></span><button class="primary" data-order-service="${service.id}">立即下单</button></div></div></article>`).join('') : '<p class="empty">暂无在售服务。</p>'}</div>`;
}
function actions(order) {
  const user = state.workspace.user;
  if (user.role === 'customer' && order.status === '待支付') return '<button class="primary" data-order-action="pay">报备已付款</button><button class="text-button" data-order-action="cancel">取消订单</button>';
  if (user.role === 'customer' && order.status === '待验收') return '<button class="primary" data-order-action="accept">确认验收</button>';
  if (isStaff() && ['待支付', '待核款'].includes(order.status)) return '<button class="primary" data-order-action="confirm-payment">确认收款</button>';
  if (isStaff() && order.status === '待派单') return `<label class="inline-select">陪玩<select data-dispatch-select aria-label="分配陪玩">${state.workspace.escorts.length ? state.workspace.escorts.map(escort => `<option value="${esc(escort.id)}">${esc(escort.name)}</option>`).join('') : '<option value="">暂无陪玩人员</option>'}</select></label><button class="primary" data-order-action="dispatch" ${!state.workspace.escorts.length ? 'disabled' : ''}>确认派单</button>`;
  if (user.role === 'escort' && order.status === '待服务') return '<button class="primary" data-order-action="start">开始服务</button>';
  if (user.role === 'escort' && order.status === '服务中') return '<button class="primary" data-order-action="finish">提交完成</button>';
  return `<span class="muted">${({ 待核款: '等待客服核实收款', 待派单: '等待客服安排陪玩', 待服务: '等待陪玩开始服务', 服务中: '服务进行中', 待验收: '等待客户验收', 已完成: '订单已完成', 已取消: '订单已取消' })[order.status] || '等待付款'}</span>`;
}
function orderCard(order) {
  return `<article class="order-card" data-order-id="${esc(order.id)}"><div class="order-heading"><div><p>${esc(order.id)}</p><h2>${esc(order.service_name)}</h2></div>${badge(order.status)}</div><dl><div><dt>客户</dt><dd>${esc(order.customer)}</dd></div><div><dt>陪玩</dt><dd>${esc(order.escort || '待安排')}</dd></div><div><dt>金额 / 时长</dt><dd>${currency(order.price_cents)} / ${order.duration_hours} 小时</dd></div><div><dt>联系方式</dt><dd>${esc(order.contact)}</dd></div></dl><p class="order-note">${esc(order.note || '无额外备注')}</p>${state.workspace.user.role === 'customer' && order.status === '待支付' ? `<p class="payment-contact">收款联系：${esc(state.paymentContact)}</p>` : ''}<div class="order-actions">${actions(order)}</div><details><summary>流程记录 · ${date(order.created_at)}</summary><ol class="timeline">${order.events.map(event => `<li><span>${esc(event.action)}</span><small>${esc(event.actor)} · ${date(event.createdAt)}${event.note ? ` · ${esc(event.note)}` : ''}</small></li>`).join('')}</ol></details></article>`;
}
function orderList() {
  const search = state.search.trim().toLowerCase();
  const orders = state.workspace.orders.filter(order => (state.filter === '全部' || order.status === state.filter) && [order.id, order.customer, order.contact, order.service_name].some(value => value.toLowerCase().includes(search)));
  return orders.length ? orders.map(orderCard).join('') : '<p class="empty">暂无符合条件的订单。</p>';
}
function orders() {
  const user = state.workspace.user;
  return `<section class="page-heading"><div><p class="eyebrow">${esc(user.roleLabel)}</p><h1>${user.role === 'customer' ? '我的订单' : user.role === 'escort' ? '我的履约订单' : '订单工作台'}</h1></div><button class="secondary" data-refresh>刷新订单</button></section><div class="toolbar"><label>订单状态<select id="status-filter">${['全部', ...statuses].map(status => `<option ${state.filter === status ? 'selected' : ''}>${status}</option>`).join('')}</select></label><label class="search">搜索<input id="order-search" type="search" value="${esc(state.search)}" placeholder="订单号、客户、联系方式、服务" /></label><span class="muted">共 ${state.workspace.orders.length} 单</span></div><section class="order-grid" id="order-list" aria-label="订单列表">${orderList()}</section>`;
}
function settings() {
  return `<section class="page-heading"><div><p class="eyebrow">管理员</p><h1>基础维护</h1></div></section><section class="settings-section"><div class="section-head"><h2>服务项目</h2><button class="primary" data-open="service">新增服务</button></div><div class="service-rows">${state.workspace.services.map(service => `<div class="service-row"><div><b>${esc(service.name)}</b><small>${esc(service.category)} · ${currency(service.priceCents)} / ${service.durationHours} 小时 · ${service.active ? '在售' : '已下架'}</small></div><div class="row-actions"><button class="text-button" data-edit-service="${service.id}">编辑</button><button class="text-button" data-toggle-service="${service.id}" data-active="${service.active ? '0' : '1'}">${service.active ? '下架' : '上架'}</button></div></div>`).join('') || '<p class="empty">暂无服务项目。</p>'}</div></section><section class="settings-section"><div class="section-head"><h2>业务账号</h2><button class="secondary" data-open="staff">新增账号</button></div><div class="service-rows">${state.workspace.users.map(user => `<div class="service-row"><div><b>${esc(user.name)}</b><small>${esc(user.username)}</small></div><span class="category">${esc(user.roleLabel)}</span></div>`).join('') || '<p class="empty">暂无客服或陪玩账号。</p>'}</div></section>`;
}
function field(label, name, options = {}) {
  return `<label>${label}<input name="${name}" ${options.type ? `type="${options.type}"` : ''} ${options.attrs || ''} value="${esc(options.value || '')}" required /></label>`;
}
function modal() {
  const { type, id, mode } = state.dialog;
  let title = '', body = '', submit = '保存';
  if (type === 'auth') {
    const register = mode === 'register';
    title = register ? '注册账号' : '登录'; submit = register ? '注册' : '登录';
    body = `${field('账号', 'username', { attrs: 'minlength="3" maxlength="30" autocomplete="username"' })}${register ? field('称呼', 'name', { attrs: 'maxlength="30"' }) : ''}${field('密码', 'password', { type: 'password', attrs: `minlength="${register ? 8 : 6}" maxlength="128" autocomplete="${register ? 'new-password' : 'current-password'}"` })}<button type="button" class="text-button" data-switch-auth>${register ? '已有账号，去登录' : '注册新账号'}</button>`;
  } else if (type === 'order') {
    const service = state.services.find(item => item.id === id);
    title = service.name; submit = '提交订单';
    body = `<p class="summary">${currency(service.priceCents)} / ${service.durationHours} 小时</p>${field('联系方式', 'contact', { attrs: 'minlength="2" maxlength="80" placeholder="微信号或手机号"' })}<label>需求备注<textarea name="note" maxlength="300" placeholder="游戏区服、预约时间等"></textarea></label>`;
  } else if (type === 'pay') {
    title = '报备已付款'; submit = '提交核款';
    const order = state.workspace.orders.find(order => order.id === id);
    body = `<p class="summary">应付 ${currency(order.price_cents)}</p><p class="payment-contact">${esc(state.paymentContact)}</p><p class="muted">线下付款后提交，到账以客服核实为准。</p>${field('付款备注', 'reference', { attrs: 'minlength="2" maxlength="100" placeholder="付款人、付款时间或转账单号"' })}`;
  } else if (type === 'confirm') {
    title = ({ 'confirm-payment': '确认款项已到账', accept: '确认验收完成', cancel: '取消未付款订单' })[state.dialog.action];
    submit = '确认';
    const order = state.workspace.orders.find(order => order.id === id);
    body = `<p>${esc(order.service_name)} · ${currency(order.price_cents)}</p>${state.dialog.action === 'confirm-payment' ? '<p class="muted">请核对实际到账金额，确认后将开放派单。</p>' : ''}`;
  } else if (type === 'service') {
    const service = state.workspace.services.find(item => item.id === id) || {};
    title = id ? '编辑服务' : '新增服务';
    body = `${field('服务名称', 'name', { value: service.name, attrs: 'minlength="2" maxlength="50"' })}${field('分类', 'category', { value: service.category, attrs: 'minlength="2" maxlength="30"' })}<div class="form-pair">${field('价格（元）', 'price', { value: service.priceCents ? service.priceCents / 100 : '', type: 'number', attrs: 'min="1" max="100000" step="0.01"' })}${field('时长（小时）', 'duration', { value: service.durationHours || 1, type: 'number', attrs: 'min="1" max="24" step="1"' })}</div><label>服务说明<textarea name="description" required minlength="5" maxlength="200">${esc(service.description || '')}</textarea></label>`;
  } else if (type === 'staff') {
    title = '新增业务账号';
    body = `${field('账号', 'username', { attrs: 'minlength="3" maxlength="30" autocomplete="off"' })}${field('称呼', 'name', { attrs: 'maxlength="30"' })}<label>角色<select name="role"><option value="escort">陪玩</option><option value="service">客服</option></select></label>${field('初始密码', 'password', { type: 'password', attrs: 'minlength="8" maxlength="128" autocomplete="new-password"' })}`;
  } else if (type === 'password') {
    title = '修改密码';
    body = `${field('当前密码', 'currentPassword', { type: 'password', attrs: 'autocomplete="current-password" maxlength="128"' })}${field('新密码', 'password', { type: 'password', attrs: 'minlength="8" maxlength="128" autocomplete="new-password"' })}`;
  }
  return `<dialog aria-labelledby="dialog-title"><button class="close" type="button" data-close aria-label="关闭" title="关闭">×</button><h2 id="dialog-title">${title}</h2><form id="dialog-form" class="stack">${body}<p class="form-error" role="alert"></p><button class="primary" type="submit">${submit}</button></form>${type === 'auth' && state.demo ? '<p class="demo-note">演示账号：admin / service / escort / user<br />演示密码：123456</p>' : ''}</dialog>`;
}
function render() {
  const route = location.hash.replace(/^#\/?/, '') || '';
  let page = home();
  if (['orders', 'manage', 'settings'].includes(route)) {
    if (!state.workspace) page = '<section class="empty"><h1>请先登录</h1><button class="primary" data-open="auth">登录 / 注册</button></section>';
    else if (route === 'settings') page = state.workspace.user.role === 'admin' ? settings() : '<p class="empty">此页面仅限管理员访问。</p>';
    else page = orders();
  }
  app.innerHTML = `${header(route)}<main>${page}</main><footer>星河游戏俱乐部 · 基础版</footer>${state.dialog ? modal() : ''}`;
  bind();
  const dialog = document.querySelector('dialog');
  if (dialog) {
    dialog.showModal();
    dialog.addEventListener('cancel', event => { event.preventDefault(); state.dialog = null; render(); });
  }
}
function openDialog(dialog) { state.dialog = dialog; render(); }
function bindOrderActions() {
  document.querySelectorAll('[data-order-action]').forEach(button => button.addEventListener('click', () => {
    const card = button.closest('[data-order-id]'), id = card.dataset.orderId, action = button.dataset.orderAction;
    if (action === 'pay') return openDialog({ type: 'pay', id });
    if (['confirm-payment', 'accept', 'cancel'].includes(action)) return openDialog({ type: 'confirm', id, action });
    run(button, async () => {
      await api(`/orders/${encodeURIComponent(id)}/actions`, { action, escortId: card.querySelector('[data-dispatch-select]')?.value });
      await refresh(); render(); toast('订单状态已更新');
    });
  }));
}
function bind() {
  document.querySelectorAll('[data-open]').forEach(button => button.addEventListener('click', () => openDialog({ type: button.dataset.open })));
  document.querySelector('[data-close]')?.addEventListener('click', () => { state.dialog = null; render(); });
  document.querySelector('[data-switch-auth]')?.addEventListener('click', () => openDialog({ type: 'auth', mode: state.dialog.mode === 'register' ? 'login' : 'register' }));
  document.querySelector('[data-logout]')?.addEventListener('click', event => run(event.currentTarget, async () => {
    await api('/logout', {}); state.workspace = null; state.dialog = null; state.filter = '全部'; state.search = ''; location.hash = '#/'; render();
  }));
  document.querySelector('[data-refresh]')?.addEventListener('click', event => run(event.currentTarget, async () => { await refresh(); render(); toast('已刷新'); }));
  document.querySelectorAll('[data-order-service]').forEach(button => button.addEventListener('click', () => {
    if (!state.workspace) return openDialog({ type: 'auth' });
    if (state.workspace.user.role !== 'customer') return toast('请使用用户账号下单');
    openDialog({ type: 'order', id: Number(button.dataset.orderService) });
  }));
  document.querySelectorAll('[data-edit-service]').forEach(button => button.addEventListener('click', () => openDialog({ type: 'service', id: Number(button.dataset.editService) })));
  document.querySelectorAll('[data-toggle-service]').forEach(button => button.addEventListener('click', () => run(button, async () => {
    await api(`/services/${button.dataset.toggleService}`, { active: button.dataset.active === '1' }); await refresh(); render();
  })));
  document.querySelector('#status-filter')?.addEventListener('change', event => { state.filter = event.target.value; render(); });
  document.querySelector('#order-search')?.addEventListener('input', event => {
    state.search = event.target.value; document.querySelector('#order-list').innerHTML = orderList(); bindOrderActions();
  });
  bindOrderActions();
  document.querySelector('#dialog-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget, data = fields(form), dialog = { ...state.dialog };
    run(form.querySelector('[type="submit"]'), async () => {
      if (dialog.type === 'auth') await api(dialog.mode === 'register' ? '/register' : '/login', data);
      else if (dialog.type === 'order') await api('/orders', { serviceId: dialog.id, ...data });
      else if (dialog.type === 'pay' || dialog.type === 'confirm') await api(`/orders/${encodeURIComponent(dialog.id)}/actions`, { action: dialog.type === 'pay' ? 'pay' : dialog.action, ...data });
      else if (dialog.type === 'service') await api(`/services${dialog.id ? `/${dialog.id}` : ''}`, { ...data, priceCents: Math.round(Number(data.price) * 100), durationHours: Number(data.duration) });
      else if (dialog.type === 'staff') await api('/staff', data);
      else if (dialog.type === 'password') await api('/password', data);
      await refresh(); state.dialog = null;
      if (dialog.type === 'auth') { state.filter = '全部'; state.search = ''; location.hash = state.workspace.user.role === 'customer' ? '#/' : '#/manage'; }
      if (dialog.type === 'order') location.hash = '#/orders';
      render(); toast(dialog.type === 'auth' ? '登录成功' : '操作成功');
    });
  });
}
addEventListener('hashchange', () => { state.dialog = null; render(); });
refresh().then(render).catch(error => { app.innerHTML = `<p class="empty">${esc(error.message)}，请刷新页面重试。</p>`; });
