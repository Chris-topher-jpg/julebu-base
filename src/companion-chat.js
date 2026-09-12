import { escapeHtml as e, icon } from './ui.js';
import { findCompanionProfile } from './companions.js';

const SUPPORT_NAME = '俱乐部客服';
const stamp = (value, options) => {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', options) : '';
};
const time = value => stamp(value, { hour: '2-digit', minute: '2-digit', hour12: false });
const day = value => stamp(value, { month: 'long', day: 'numeric' });
const nameOf = chat => chat.escortName || '俱乐部客服';
const isSupport = chat => !chat.escortName || chat.escortName === SUPPORT_NAME;
const avatar = (name, profile, support = false) => `<span class="cc-avatar ${support ? 'cc-avatar-support' : ''}" aria-hidden="true">${profile?.image ? `<img src="${e(profile.image)}" alt="">` : support ? icon('headset', 20) : e(Array.from(name || '客')[0])}</span>`;

export function openCompanionMessenger({ workspace, initialChatId, profile, api: request, onNavigate, onWorkspace }) {
  document.querySelector('#companionChatDialog')?.close();
  const previousFocus = document.activeElement;
  const viewer = workspace.user;
  const modal = document.createElement('dialog');
  const api = async (...args) => {
    try { return await request(...args); }
    catch (error) { if (error.status === 401) modal.close(); throw error; }
  };
  modal.id = 'companionChatDialog';
  modal.className = 'cc-dialog';
  modal.setAttribute('aria-labelledby', 'ccTitle');
  modal.innerHTML = `<div class="cc-layout">
    <aside class="cc-sidebar" id="ccSidebar" aria-label="会话列表">
      <header class="cc-sidebar-head">${icon('message', 21)}<h2 id="ccTitle">全部会话</h2><span class="cc-total"></span><button type="button" class="cc-icon cc-mobile-close" data-cc-close aria-label="关闭消息中心">${icon('x', 19)}</button></header>
      <div class="cc-list-controls"><label class="cc-search">${icon('search', 15)}<input type="search" placeholder="搜索联系人或消息" aria-label="搜索会话"></label><div class="cc-filters" role="group" aria-label="会话分类">${[['all', '全部'], ['companion', '陪玩'], ['support', '客服']].map(([id, label]) => `<button type="button" data-cc-filter="${id}" aria-pressed="${id === 'all'}">${label}</button>`).join('')}</div></div>
      <div class="cc-contacts"></div><footer class="cc-sidebar-foot">${icon('game', 16)} 星河游戏俱乐部<span>服务沟通，一处掌握</span></footer>
    </aside>
    <section class="cc-main" aria-label="当前会话">
      <header class="cc-peer-head"><button type="button" class="cc-icon cc-list-toggle" data-cc-list aria-controls="ccSidebar" aria-expanded="false" aria-label="打开会话列表">${icon('message', 19)}</button><div class="cc-peer"></div><button type="button" class="cc-support-button" data-cc-support aria-label="联系平台客服">${icon('headset', 16)}<span>联系平台客服</span></button><button type="button" class="cc-icon cc-info-toggle" data-cc-info aria-controls="ccDetails" aria-expanded="false" aria-label="查看会话资料">${icon('users', 18)}</button><button type="button" class="cc-icon" data-cc-close aria-label="关闭消息中心">${icon('x', 20)}</button></header>
      <div class="cc-notice">${icon('lock', 14)}<span>服务时间、游戏区服和特殊要求，请在下单前与对方确认。</span></div>
      <div class="cc-history" role="log" aria-label="会话消息" aria-live="polite" aria-relevant="additions text"></div>
      <div class="cc-sync" role="status">${icon('check', 13)}<span>消息已同步</span><small>站内沟通 · 记录可查</small></div>
      <section class="cc-composer"><div class="cc-quick-heading">${icon('message', 14)}<strong>快捷提问</strong><span>点击填入，编辑后发送</span></div><div class="cc-quick-questions">${['如何确认服务时间？', '付款后多久可以开始？', '我想修改游戏区服'].map(text => `<button type="button" data-cc-quick="${e(text)}">${e(text)}</button>`).join('')}</div>
        <form class="cc-form"><textarea id="ccMessage" name="message" rows="3" maxlength="1000" aria-label="消息内容" placeholder="输入你想咨询的问题，可附上订单编号…"></textarea><div class="cc-compose-bottom"><span class="cc-char-count">0 / 1000</span><span class="cc-key-hint">Enter 发送 · Shift + Enter 换行</span><button type="submit" class="cc-send">${icon('arrow', 16)}<span>发送</span></button></div><p class="cc-error" role="alert"></p></form>
      </section>
    </section>
    <aside class="cc-details" id="ccDetails" aria-label="会话资料"><button type="button" class="cc-icon cc-details-close" data-cc-info aria-label="收起会话资料">${icon('x', 19)}</button><section class="cc-account">${avatar(viewer.name)}<div><small>当前咨询账号</small><strong>${e(viewer.name || viewer.username)}</strong></div><p>服务沟通与订单进度，一处查看。</p></section>
      <section class="cc-links"><h3>快捷入口</h3>${[['orders', 'receipt', '我的订单', '查看服务与支付进度'], ['afterSales', 'headset', '售后服务', '退款、补做与问题反馈'], ['guarantees', 'lock', '服务保障', '了解交易与售后规则']].map(([action, symbol, title, note]) => `<button type="button" data-cc-navigate="${action}">${icon(symbol, 19)}<span><strong>${title}</strong><small>${note}</small></span>${icon('arrow', 15)}</button>`).join('')}</section>
      <section class="cc-profile"></section><aside class="cc-safety">${icon('lock', 17)}<div><strong>安全提醒</strong><p>请通过平台下单与支付，勿向他人提供账号密码和验证码。</p></div></aside>
    </aside>
  </div>`;
  document.body.append(modal);
  document.body.classList.add('cc-modal-open');
  const input = modal.querySelector('#ccMessage');
  const history = modal.querySelector('.cc-history');
  const error = modal.querySelector('.cc-error');
  const drafts = new Map();
  let chats = workspace.conversations || [], activeId = initialChatId;
  let filter = 'all', query = '', busy = false, syncing = false, version = 0, timer;
  let listSignature = '', peerSignature = '', messageSignature = '', profileSignature = '';
  const active = () => chats.find(chat => chat.id === activeId);
  const getProfile = chat => chat?.id === initialChatId ? profile : findCompanionProfile(chat?.escortName);
  const syncText = text => modal.querySelector('.cc-sync > span').textContent = text;
  const remember = () => { workspace = { ...workspace, conversations: chats }; onWorkspace?.(workspace); };
  const replaceChat = chat => {
    const index = chats.findIndex(item => item.id === chat.id);
    if (index < 0) chats = [chat, ...chats]; else chats = chats.map(item => item.id === chat.id ? chat : item);
    remember();
  };
  function updateComposer() {
    modal.querySelector('.cc-char-count').textContent = `${input.value.length} / 1000`;
    modal.querySelector('.cc-send').disabled = busy || !active() || !input.value.trim();
    modal.querySelector('.cc-send span').textContent = busy ? '处理中…' : '发送';
    input.readOnly = busy;
    modal.querySelectorAll('[data-cc-support], [data-cc-quick], [data-cc-navigate]').forEach(button => button.disabled = busy);
  }
  function draw(scroll = false) {
    if (!modal.isConnected) return;
    const chat = active();
    const visible = chats.filter(item => (filter === 'all' || (filter === 'support' ? isSupport(item) : !isSupport(item))) && `${nameOf(item)} ${(item.messages || []).map(message => message.text).join(' ')} ${item.last || ''}`.toLowerCase().includes(query.toLowerCase().trim()));
    const list = visible.map(item => `<button type="button" class="cc-contact" data-cc-chat="${e(item.id)}" ${item.id === activeId ? 'aria-current="true"' : ''} aria-label="打开与${e(nameOf(item))}的会话">${avatar(nameOf(item), getProfile(item), isSupport(item))}<span class="cc-contact-copy"><strong>${e(nameOf(item))}</strong><span>${e(item.last || item.messages?.at(-1)?.text || '暂无消息')}</span><small>${isSupport(item) ? '平台客服' : '陪玩咨询'} · ${e(item.state || '处理中')}</small></span><span class="cc-contact-meta"><time>${e(time(item.updatedAt || item.messages?.at(-1)?.at))}</time>${item.unread ? `<b>${e(item.unread > 99 ? '99+' : item.unread)}</b>` : ''}</span></button>`).join('') || `<div class="cc-empty-list">${icon('search', 24)}<p>${query ? '没有匹配的会话' : '暂无此类会话'}</p></div>`;
    if (list !== listSignature) { modal.querySelector('.cc-contacts').innerHTML = list; listSignature = list; }
    modal.querySelector('.cc-total').textContent = chats.length;
    if (!chat) {
      history.innerHTML = '<p class="cc-empty-history">当前会话已不可访问，请选择其他会话。</p>';
      modal.querySelector('.cc-peer').innerHTML = '';
      modal.querySelector('.cc-profile').innerHTML = '';
      modal.querySelector('[data-cc-support]').hidden = true;
      peerSignature = messageSignature = profileSignature = '';
      updateComposer(); return;
    }
    const p = getProfile(chat);
    const peer = `${avatar(nameOf(chat), p, isSupport(chat))}<div><h3>${e(nameOf(chat))}</h3><p><i class="${p?.online === false ? 'is-offline' : ''}"></i>${isSupport(chat) ? '平台客服' : p ? (p.online ? '在线 · 陪玩咨询' : '离线 · 支持预约') : '陪玩咨询'} · ${e(chat.state || '处理中')}</p></div>`;
    if (peer !== peerSignature) { modal.querySelector('.cc-peer').innerHTML = peer; peerSignature = peer; }
    modal.querySelector('[data-cc-support]').hidden = isSupport(chat);
    const signature = JSON.stringify([activeId, chat.messages]);
    if (messageSignature !== signature) {
      const nearBottom = history.scrollHeight - history.scrollTop - history.clientHeight < 70;
      let lastDay = '';
      history.innerHTML = (chat.messages || []).map(message => {
        const mine = message.authorId === viewer.id;
        const currentDay = day(message.at);
        const divider = currentDay !== lastDay ? `<div class="cc-day"><span>${e(currentDay)}</span></div>` : '';
        lastDay = currentDay;
        return `${divider}<article class="cc-message ${mine ? 'is-mine' : ''}">${avatar(message.author || nameOf(chat), !mine && message.author === chat.escortName ? p : null)}<div class="cc-message-content"><small>${e(message.author || (mine ? viewer.name : nameOf(chat)))}</small><p>${e(message.text)}</p><time>${e(time(message.at))}</time></div></article>`;
      }).join('') || '<p class="cc-empty-history">暂无消息，发送一条消息开始沟通。</p>';
      messageSignature = signature;
      if (scroll || nearBottom) history.scrollTop = history.scrollHeight;
    } else if (scroll) history.scrollTop = history.scrollHeight;
    const profileHtml = `<h3>${isSupport(chat) ? '客服服务' : '咨询对象'}</h3><div class="cc-profile-person">${avatar(nameOf(chat), p, isSupport(chat))}<div><strong>${e(nameOf(chat))}</strong><small>${e(p ? `${p.game} · ${p.service}` : isSupport(chat) ? '订单咨询 / 服务协调 / 售后跟进' : '服务详情请与对方确认')}</small></div></div>${p ? `<dl><div><dt>陪玩等级</dt><dd>${e(p.level)}</dd></div><div><dt>参考价格</dt><dd>¥ ${e(p.price)}<small> / 小时</small></dd></div></dl><p class="cc-profile-note">展示档案 · 服务内容与金额以下单确认为准</p><button type="button" class="cc-book" data-cc-navigate="book">预约下单 ${icon('arrow', 15)}</button>` : '<p class="cc-profile-note">说明你的游戏区服、预约时间或订单问题，方便安排后续服务。</p>'}`;
    if (profileHtml !== profileSignature) { modal.querySelector('.cc-profile').innerHTML = profileHtml; profileSignature = profileHtml; }
    updateComposer();
  }
  function togglePanel(panel, open) {
    modal.classList.toggle(`cc-${panel}-open`, open);
    modal.querySelector(`[data-cc-${panel}]`).setAttribute('aria-expanded', String(open));
  }
  async function markRead(id) {
    const readVersion = version;
    if (!active()?.unread) return;
    try {
      const read = await api(`/conversations/${id}`, {});
      if (modal.isConnected && readVersion === version) { replaceChat(read); draw(); }
    } catch { if (modal.isConnected) syncText('已读状态暂未同步'); }
  }
  function chooseChat(id) {
    if (busy || !chats.some(chat => chat.id === id)) return;
    drafts.set(activeId, input.value); activeId = id; version++;
    input.value = drafts.get(id) || ''; error.textContent = '';
    togglePanel('list', false); draw(true); syncText('消息已同步');
    void markRead(id);
  }
  modal.querySelector('.cc-search input').oninput = event => { query = event.target.value; draw(); };
  modal.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-cc-close')) { modal.close(); return; }
    if (button.hasAttribute('data-cc-list')) { togglePanel('info', false); togglePanel('list', !modal.classList.contains('cc-list-open')); return; }
    if (button.hasAttribute('data-cc-info')) { togglePanel('list', false); const open = !modal.classList.contains('cc-info-open'); togglePanel('info', open); if (open) modal.querySelector('.cc-details-close').focus(); else modal.querySelector('.cc-info-toggle').focus(); return; }
    if (button.dataset.ccFilter) { filter = button.dataset.ccFilter; modal.querySelectorAll('[data-cc-filter]').forEach(item => item.setAttribute('aria-pressed', String(item === button))); draw(); return; }
    if (button.dataset.ccChat) { chooseChat(button.dataset.ccChat); return; }
    if (busy) return;
    if (button.dataset.ccQuick) { input.value = input.value ? `${input.value}\n${button.dataset.ccQuick}`.slice(0, 1000) : button.dataset.ccQuick; updateComposer(); input.focus(); return; }
    if (button.dataset.ccNavigate) { const target = button.dataset.ccNavigate; modal.close(); await onNavigate(target); return; }
    if (button.hasAttribute('data-cc-support')) {
      const existing = chats.find(chat => isSupport(chat) && chat.state !== '已结束');
      if (existing) { filter = 'all'; modal.querySelector('[data-cc-filter="all"]').click(); chooseChat(existing.id); return; }
      busy = true; version++; updateComposer(); error.textContent = '';
      try {
        const support = await api('/conversations', { escortName: SUPPORT_NAME, message: `你好，我需要咨询与${nameOf(active())}相关的陪玩服务，请客服协助。` });
        if (modal.isConnected) { replaceChat(support); busy = false; filter = 'all'; modal.querySelector('[data-cc-filter="all"]').click(); chooseChat(support.id); }
      } catch (err) { if (modal.isConnected) error.textContent = err.message; }
      finally { busy = false; version++; if (modal.isConnected) updateComposer(); }
    }
  });
  const form = modal.querySelector('.cc-form');
  form.onsubmit = async event => {
    event.preventDefault();
    const message = input.value.trim(), id = activeId;
    if (!message || busy || !active()) return;
    busy = true; version++; updateComposer(); error.textContent = '';
    try {
      const sent = await api(`/conversations/${id}/messages`, { message });
      if (!modal.isConnected) return;
      replaceChat(sent); drafts.delete(id); input.value = ''; draw(true); syncText('消息已发送');
    } catch (err) { if (modal.isConnected) error.textContent = `发送失败：${err.message}`; }
    finally { busy = false; version++; if (modal.isConnected) { updateComposer(); input.focus(); } }
  };
  input.oninput = updateComposer;
  input.onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); form.requestSubmit(); } };
  modal.addEventListener('cancel', event => {
    if (modal.classList.contains('cc-info-open') || modal.classList.contains('cc-list-open')) { event.preventDefault(); togglePanel('info', false); togglePanel('list', false); input.focus(); }
  });
  modal.addEventListener('click', event => {
    if (event.target !== modal) return;
    const rect = modal.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) modal.close();
  });
  modal.addEventListener('close', () => { clearTimeout(timer); modal.remove(); if (!document.querySelector('.cc-dialog[open]')) { document.body.classList.remove('cc-modal-open'); if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); } }, { once: true });
  async function sync() {
    if (syncing || busy || document.hidden) return;
    syncing = true;
    const syncVersion = version;
    try {
      const fresh = await api('/me');
      if (!modal.isConnected || syncVersion !== version || busy) return;
      if (fresh.user.id !== viewer.id) { modal.close(); return; }
      workspace = fresh; chats = fresh.conversations || []; remember(); draw(); syncText('消息已同步');
      await markRead(activeId);
    } catch (err) { if (modal.isConnected) syncText(`同步失败：${err.message}`); }
    finally { syncing = false; }
  }
  const schedule = () => { timer = setTimeout(async () => { if (!modal.isConnected) return; await sync(); if (modal.isConnected) schedule(); }, 8000); };
  modal.showModal(); draw(true); void markRead(activeId); schedule();
  return modal;
}
