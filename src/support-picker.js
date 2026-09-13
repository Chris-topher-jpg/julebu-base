import { escapeHtml as e, icon } from './ui.js';

const money = cents => `¥ ${(Number(cents || 0) / 100).toFixed(2)}`;
const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '';

export function openSupportPicker({ loadWorkspace, connect }) {
  const existing = document.querySelector('#supportPickerDialog[open]');
  if (existing) return existing;
  const previousFocus = document.activeElement;
  const modal = document.createElement('dialog');
  modal.id = 'supportPickerDialog';
  modal.className = 'sp-dialog';
  modal.setAttribute('aria-labelledby', 'spTitle');
  modal.innerHTML = `<header class="sp-header"><button type="button" class="sp-back" aria-label="返回售后类型" hidden>${icon('arrow', 18)}</button><h2 id="spTitle">选择售后类型</h2><button type="button" class="sp-close" aria-label="关闭售后窗口">${icon('x', 24)}</button></header>
    <div class="sp-body"><section class="sp-types" aria-label="售后类型">
      <button type="button" class="sp-type" data-sp-type="order" aria-label="订单问题，去联系"><span class="sp-type-icon sp-blue">${icon('receipt', 29)}</span><span class="sp-type-copy"><strong>订单问题</strong><small>订单售后问题</small></span><span class="sp-contact">去联系</span></button>
      <button type="button" class="sp-type" data-sp-type="general" aria-label="非订单类，去联系"><span class="sp-type-icon sp-pink">${icon('headset', 30)}</span><span class="sp-type-copy"><strong>非订单类</strong><small>非订单类的售后问题</small></span><span class="sp-contact">去联系</span></button>
    </section><section class="sp-orders" hidden aria-label="选择售后订单"><p class="sp-intro">选择需要售后的订单，客服会结合订单记录为你处理。</p><label class="sp-search">${icon('search', 17)}<input type="search" aria-label="搜索售后订单" placeholder="搜索订单号、游戏或服务"></label><p class="sp-loading" role="status" hidden>正在加载你的订单…</p><div class="sp-order-list"></div><p class="sp-empty" hidden></p><button type="button" class="sp-general" data-sp-type="general">其他问题，联系在线客服 ${icon('arrow', 14)}</button></section><p class="sp-error" role="alert" hidden></p><p class="sp-connecting" role="status" hidden>正在连接在线客服…</p></div>`;
  document.body.append(modal);
  const $ = selector => modal.querySelector(selector);
  let orders = [], pending = false, generation = 0;
  const showError = message => { $('.sp-error').textContent = message; $('.sp-error').hidden = !message; };
  const close = () => { if (!pending) modal.close(); };
  const active = () => modal.isConnected && modal.open;
  function showTypes() {
    generation++; showError('');
    modal.classList.remove('sp-orders-open');
    $('#spTitle').textContent = '选择售后类型';
    $('.sp-types').hidden = false; $('.sp-orders').hidden = true; $('.sp-back').hidden = true;
    $('[data-sp-type="order"]').focus();
  }
  function renderOrders() {
    const query = $('.sp-search input').value.trim().toLowerCase();
    const visible = orders.filter(order => `${order.id} ${order.game} ${order.product} ${order.status}`.toLowerCase().includes(query));
    $('.sp-order-list').innerHTML = visible.map(order => `<button type="button" class="sp-order" data-sp-order="${e(order.id)}" aria-label="联系订单 ${e(order.id)} 的客服"><span class="sp-order-heading"><strong>${e(order.game)} · ${e(order.product)}</strong><span class="sp-status">${e(order.status)}</span></span><span class="sp-order-id">${e(order.id)}</span><span class="sp-order-details"><span>${e(order.hours)} 小时 · ${money(order.amountCents)}<small>${e(date(order.createdAt))}</small></span><span class="sp-order-contact">联系客服 ${icon('arrow', 14)}</span></span></button>`).join('');
    $('.sp-empty').textContent = orders.length ? '没有找到匹配的订单，试试其他关键词。' : '你还没有订单，可选择非订单问题联系在线客服。';
    $('.sp-empty').hidden = visible.length > 0;
  }
  async function showOrders() {
    const requestGeneration = ++generation;
    modal.classList.add('sp-orders-open');
    $('#spTitle').textContent = '选择售后订单';
    $('.sp-types').hidden = true; $('.sp-orders').hidden = false; $('.sp-back').hidden = false;
    $('.sp-search input').value = ''; $('.sp-order-list').innerHTML = ''; $('.sp-empty').hidden = true;
    $('.sp-loading').hidden = false; showError('');
    try {
      const workspace = await loadWorkspace();
      if (!active() || requestGeneration !== generation) return;
      if (!workspace) { modal.close(); return; }
      orders = [...(workspace.orders || [])].sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
      renderOrders(); $('.sp-search input').focus();
    } catch (error) { if (active() && requestGeneration === generation) showError(error.message || '订单加载失败，请返回后重试。'); }
    finally { if (active() && requestGeneration === generation) $('.sp-loading').hidden = true; }
  }
  async function contact(orderId) {
    if (pending) return;
    pending = true; generation++; showError('');
    $('.sp-loading').hidden = true; $('.sp-connecting').hidden = false;
    modal.setAttribute('aria-busy', 'true');
    modal.querySelectorAll('button, input').forEach(control => { control.disabled = true; });
    try {
      // The callback opens the chat synchronously after closing this dialog,
      // keeping the homepage and its current scroll position in place.
      await connect(orderId, () => modal.close());
    } catch (error) { if (active()) showError(error.message || '暂时无法连接客服，请重试。'); }
    finally {
      pending = false;
      if (active()) { modal.removeAttribute('aria-busy'); $('.sp-connecting').hidden = true; modal.querySelectorAll('button, input').forEach(control => { control.disabled = false; }); }
    }
  }
  $('.sp-close').onclick = close;
  $('.sp-back').onclick = showTypes;
  $('.sp-search input').oninput = renderOrders;
  modal.addEventListener('click', event => {
    if (pending) return;
    const button = event.target.closest('button');
    if (button?.dataset.spType === 'order') void showOrders();
    if (button?.dataset.spType === 'general') void contact();
    if (button?.dataset.spOrder) void contact(button.dataset.spOrder);
    if (event.target === modal) {
      const bounds = modal.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
    }
  });
  modal.addEventListener('cancel', event => { if (pending) event.preventDefault(); else if (modal.classList.contains('sp-orders-open')) { event.preventDefault(); showTypes(); } });
  modal.addEventListener('close', () => { generation++; modal.remove(); if (!document.querySelector('dialog[open]') && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); }, { once: true });
  modal.showModal();
  return modal;
}
