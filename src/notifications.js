import { escapeHtml as e, icon } from './ui.js';

const MAX_ITEMS = 100;
const displayTime = value => {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime())
    ? date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    : '';
};
const actionLabel = item => item.orderId || /order|assign/.test(String(item.kind || '')) ? '查看订单' : '查看详情';

/** The caller owns authentication, transport, and navigation; this module only presents notifications. */
export function createNotificationCenter({ openItem, markRead, openSupport, onError } = {}) {
  let root, items = [], unreadCount = 0, status = '正在连接', initialized = false;
  let panelOpen = false, busy = false, generation = 0, toast = null, errorText = '';
  const seen = new Set();
  const rows = new Map();

  const findItem = id => items.find(item => String(item.id) === String(id));
  const setText = (node, value) => {
    const text = String(value ?? '');
    if (node.textContent !== text) node.innerHTML = e(text);
  };
  const unreadIds = () => items.filter(item => !item.readAt).map(item => item.id).slice(0, MAX_ITEMS);

  function render() {
    if (!root?.isConnected) return;
    const trigger = root.querySelector('[data-nc-toggle]');
    trigger.setAttribute('aria-expanded', String(panelOpen));
    trigger.setAttribute('aria-label', `通知中心，${unreadCount} 条未读通知`);
    setText(root.querySelector('.nc-count'), unreadCount > 99 ? '99+' : unreadCount);
    root.querySelector('.nc-count').hidden = unreadCount === 0;
    setText(root.querySelector('.nc-status'), status);
    setText(root.querySelector('.nc-panel-status'), status);
    setText(root.querySelector('.nc-unread-summary'), unreadCount ? `${unreadCount} 条未读` : '所有通知已读');
    root.querySelector('.nc-panel').hidden = !panelOpen;
    root.querySelector('.nc-panel').setAttribute('aria-busy', String(busy));
    root.querySelector('[data-nc-read-all]').disabled = busy || !unreadIds().length;
    setText(root.querySelector('[data-nc-read-all]'), busy ? '处理中…' : '本页全部已读');
    root.querySelector('.nc-error').hidden = !errorText;
    setText(root.querySelector('.nc-error-text'), errorText);

    const list = root.querySelector('.nc-list');
    const validIds = new Set(items.map(item => String(item.id)));
    for (const [id, row] of rows) {
      if (!validIds.has(id)) { row.remove(); rows.delete(id); }
    }
    root.querySelector('.nc-empty').hidden = items.length > 0;
    let previous = null;
    for (const item of items) {
      const id = String(item.id);
      let row = rows.get(id);
      if (!row) {
        row = document.createElement('li');
        row.className = 'nc-item';
        row.innerHTML = `<div class="nc-item-top"><span class="nc-item-icon" aria-hidden="true">${icon('bell', 16)}</span><div class="nc-item-copy"><strong class="nc-item-title"></strong><span class="nc-item-context"></span></div><span class="nc-unread-dot" aria-label="未读"></span></div><p class="nc-item-body"></p><div class="nc-item-bottom"><time class="nc-item-time"></time><div class="nc-item-actions"><button type="button" class="nc-read" data-nc-read="${e(id)}">标记已读</button><button type="button" class="nc-view" data-nc-open="${e(id)}"></button></div></div>`;
        rows.set(id, row);
      }
      // Keep existing nodes in place so background updates do not steal keyboard focus.
      const target = previous ? previous.nextElementSibling : list.firstElementChild;
      if (target !== row) list.insertBefore(row, target);
      previous = row;
      row.classList.toggle('is-unread', !item.readAt);
      setText(row.querySelector('.nc-item-title'), item.title || '新的通知');
      setText(row.querySelector('.nc-item-context'), item.mode === 'management' ? '管理工作台' : '个人中心');
      setText(row.querySelector('.nc-item-body'), item.body || '点击查看详情');
      setText(row.querySelector('.nc-item-time'), displayTime(item.createdAt));
      const readButton = row.querySelector('[data-nc-read]');
      readButton.hidden = Boolean(item.readAt);
      readButton.disabled = busy;
      row.querySelector('.nc-unread-dot').hidden = Boolean(item.readAt);
      const viewButton = row.querySelector('[data-nc-open]');
      viewButton.disabled = busy;
      setText(viewButton, actionLabel(item));
    }
    const toastNode = root.querySelector('.nc-toast');
    toastNode.hidden = !toast || panelOpen;
    if (toast) {
      setText(toastNode.querySelector('.nc-toast-title'), toast.summary ? '有未读通知等待处理' : toast.item.title || '新的通知');
      setText(toastNode.querySelector('.nc-toast-body'), toast.summary ? `你有 ${unreadCount} 条未读通知，可以在通知中心查看。` : toast.item.body || '点击查看最新进展');
      setText(toastNode.querySelector('.nc-toast-extra'), toast.extra ? `另有 ${toast.extra} 条新通知` : '');
      toastNode.querySelector('.nc-toast-extra').hidden = !toast.extra;
      const view = toastNode.querySelector('[data-nc-toast-open]');
      setText(view, toast.summary ? '查看通知' : actionLabel(toast.item));
      view.disabled = busy;
    }
  }

  function reportError(error) {
    errorText = error?.message || '操作未成功，请稍后重试。';
    render();
    try { onError?.(error); } catch { /* UI errors must not become unhandled rejections. */ }
  }

  async function acknowledge(ids) {
    const uniqueIds = [...new Set(ids)].slice(0, MAX_ITEMS);
    if (!uniqueIds.length) return;
    if (typeof markRead !== 'function') throw new Error('通知服务暂时不可用，请稍后重试。');
    const operationGeneration = generation;
    await markRead(uniqueIds);
    if (operationGeneration !== generation) return;
    const idSet = new Set(uniqueIds.map(String));
    const count = items.filter(item => idSet.has(String(item.id)) && !item.readAt).length;
    items = items.map(item => idSet.has(String(item.id)) ? { ...item, readAt: item.readAt || new Date().toISOString() } : item);
    unreadCount = Math.max(0, unreadCount - count);
    if (toast && (toast.summary ? !unreadCount : idSet.has(String(toast.item.id)))) toast = null;
  }

  async function runAction(callback) {
    if (busy) return;
    const operationGeneration = generation;
    busy = true;
    errorText = '';
    render();
    try { await callback(operationGeneration); }
    catch (error) { if (operationGeneration === generation) reportError(error); }
    finally {
      if (operationGeneration === generation) { busy = false; render(); }
    }
  }

  function viewItem(item) {
    if (!item) return;
    return runAction(async operationGeneration => {
      if (typeof openItem !== 'function') throw new Error('当前通知暂时无法打开，请稍后重试。');
      const opened = await openItem(item);
      if (operationGeneration !== generation || opened === false) return;
      if (!findItem(item.id)?.readAt) await acknowledge([item.id]);
      if (operationGeneration !== generation) return;
      panelOpen = false;
      toast = null;
    });
  }

  function onClick(event) {
    const button = event.target.closest('button');
    if (!button || !root?.contains(button) || button.disabled) return;
    if (button.hasAttribute('data-nc-toggle')) { panelOpen = !panelOpen; if (panelOpen) toast = null; render(); }
    else if (button.hasAttribute('data-nc-close')) { panelOpen = false; render(); }
    else if (button.hasAttribute('data-nc-support')) void runAction(async () => { if (typeof openSupport !== 'function') throw new Error('客服服务暂时不可用，请稍后重试。'); await openSupport(); });
    else if (button.hasAttribute('data-nc-dismiss')) { toast = null; render(); }
    else if (button.hasAttribute('data-nc-clear-error')) { errorText = ''; render(); }
    else if (button.hasAttribute('data-nc-read-all')) void runAction(() => acknowledge(unreadIds()));
    else if (button.hasAttribute('data-nc-read')) {
      const item = findItem(button.dataset.ncRead);
      if (item && !item.readAt) void runAction(() => acknowledge([item.id]));
    } else if (button.hasAttribute('data-nc-open')) void viewItem(findItem(button.dataset.ncOpen));
    else if (button.hasAttribute('data-nc-toast-open') && toast) {
      if (toast.summary) { panelOpen = true; toast = null; render(); }
      else void viewItem(findItem(toast.item.id) || toast.item);
    }
  }

  function onKeyDown(event) {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    panelOpen = false;
    toast = null;
    errorText = '';
    render();
  }

  function mount(target) {
    if (root?.isConnected) {
      if (target && root.parentElement !== target) target.append(root);
      return root;
    }
    if (!root) {
      root = document.createElement('aside');
      root.className = 'notification-center';
      root.setAttribute('aria-label', '订单与业务通知');
      root.innerHTML = `<div class="nc-error" role="alert" hidden><span class="nc-error-text"></span><button type="button" data-nc-clear-error aria-label="关闭错误提示">${icon('x', 16)}</button></div>
        <section class="nc-toast" aria-label="新通知" hidden><div class="nc-toast-head"><span class="nc-toast-symbol" aria-hidden="true">${icon('bell', 19)}</span><strong class="nc-toast-title"></strong><button type="button" class="nc-icon-button" data-nc-dismiss aria-label="关闭通知提醒">${icon('x', 17)}</button></div><p class="nc-toast-body"></p><div class="nc-toast-bottom"><span class="nc-toast-extra"></span><button type="button" class="nc-view" data-nc-toast-open>查看详情</button></div></section>
        <section class="nc-panel" id="syncNotificationPanel" aria-labelledby="syncNotificationTitle" hidden><header class="nc-panel-head"><div><h2 id="syncNotificationTitle">通知中心</h2><span class="nc-unread-summary"></span></div><button type="button" class="nc-icon-button" data-nc-close aria-label="关闭通知中心">${icon('x', 19)}</button></header><div class="nc-toolbar"><span><i aria-hidden="true"></i><span class="nc-panel-status"></span></span><button type="button" data-nc-read-all>本页全部已读</button></div><div class="nc-list-scroll"><ul class="nc-list" aria-label="最近通知"></ul><div class="nc-empty">${icon('bell', 27)}<strong>暂时没有通知</strong><p>订单和服务进展会在这里同步。</p></div></div><footer class="nc-panel-footer">最近 ${MAX_ITEMS} 条通知 · 仅展示与你相关的信息</footer></section>
        <button type="button" class="nc-support-launcher" data-nc-support aria-label="联系客服">${icon('headset', 18)}<span>联系客服</span></button><button type="button" class="nc-launcher" data-nc-toggle aria-controls="syncNotificationPanel" aria-expanded="false"><span class="nc-launcher-icon" aria-hidden="true">${icon('bell', 21)}<b class="nc-count" hidden></b></span><span class="nc-launcher-copy"><strong>通知中心</strong><small class="nc-status"></small></span></button><span class="nc-announcement" role="status" aria-live="polite" aria-atomic="true"></span>`;
      root.addEventListener('click', onClick);
      document.addEventListener('keydown', onKeyDown);
    }
    (target || document.body).append(root);
    render();
    return root;
  }

  function update({ items: incoming = [], unreadCount: count } = {}, { announce = false } = {}) {
    const received = Array.isArray(incoming) ? incoming.filter(item => item && item.id != null) : [];
    const unique = new Map();
    received.forEach(item => { if (!unique.has(String(item.id))) unique.set(String(item.id), { ...item }); });
    items = [...unique.values()].sort((a, b) => Number(Boolean(a.readAt)) - Number(Boolean(b.readAt)) || (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)).slice(0, MAX_ITEMS);
    const parsedCount = Number(count);
    unreadCount = count != null && Number.isFinite(parsedCount) ? Math.max(0, Math.floor(parsedCount)) : unreadIds().length;
    const newlyUnread = items.filter(item => !item.readAt && !seen.has(String(item.id)));
    if (!initialized) {
      initialized = true;
      if (unreadCount) toast = { summary: true };
    } else if (announce && newlyUnread.length) {
      if (!toast || toast.summary) toast = { item: newlyUnread[0], extra: newlyUnread.length - 1 };
      else toast.extra = (toast.extra || 0) + newlyUnread.length;
      if (root?.isConnected) setText(root.querySelector('.nc-announcement'), `${newlyUnread.length} 条新通知。${newlyUnread[0].title || '业务进展已更新'}`);
    }
    items.forEach(item => seen.add(String(item.id)));
    if (toast && !toast.summary) {
      const current = findItem(toast.item.id);
      if (!current || current.readAt) toast = null;
      else toast.item = current;
    }
    if (toast?.summary && !unreadCount) toast = null;
    render();
  }

  function setStatus(text) { status = String(text || '正在连接'); render(); }

  function reset() {
    generation += 1;
    root?.remove();
    root = undefined;
    document.removeEventListener('keydown', onKeyDown);
    rows.clear();
    seen.clear();
    items = [];
    unreadCount = 0;
    status = '正在连接';
    initialized = panelOpen = busy = false;
    toast = null;
    errorText = '';
  }

  return { update, setStatus, reset, mount };
}
