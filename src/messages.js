import { escapeHtml as e, icon } from './ui.js';

const dateTime = value => {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '时间未记录';
};
const money = value => value == null ? '未记录' : `¥ ${(Number(value) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const infoRow = (label, value) => `<div><dt>${e(label)}</dt><dd>${e(value || '未提供')}</dd></div>`;
const avatar = (name, className = 'service-chat-avatar') => `<span class="${className}" aria-hidden="true">${e(Array.from(name || '客')[0])}</span>`;

function peerFor(chat, personal) {
  if (personal) return { name: chat.escortName || '俱乐部客服', userId: chat.escortId || '', role: '服务联系人' };
  return { ...chat.peer, name: chat.peer?.name || chat.boss || chat.customerName || '客户', role: '客户' };
}

function profileMarkup(chat, personal) {
  const peer = peerFor(chat, personal);
  return `<h3>对方信息</h3><div class="chat-profile-identity">${avatar(peer.name)}<div><strong>${e(peer.name)}</strong><span>${e(peer.role)}</span></div></div><dl class="chat-info-list">${peer.userId ? infoRow('用户 ID', peer.userId) : infoRow('客户编号', peer.customerNo || peer.customerId)}${peer.username ? infoRow('登录账号', peer.username) : ''}${infoRow('联系手机', peer.phone)}${infoRow('会话渠道', chat.channel || '站内信')}${!personal && chat.escortName ? infoRow('咨询对象', chat.escortName) : ''}</dl>`;
}

function orderMarkup(order) {
  if (!order) return '';
  return `<div class="chat-card-heading"><h3>关联订单</h3><span class="chat-order-status">${e(order.status || '待处理')}</span></div><strong class="chat-order-game">${e([order.game, order.product].filter(Boolean).join(' · ') || '陪玩服务')}</strong><span class="chat-order-id">${e(order.id)}</span><dl class="chat-info-list">${infoRow('订单金额', money(order.amountCents))}${infoRow('服务时长', order.hours == null ? '未记录' : `${order.hours} 小时`)}${order.region ? infoRow('游戏区服', order.region) : ''}${order.appointmentAt ? infoRow('预约时间', dateTime(order.appointmentAt)) : ''}${order.pay ? infoRow('支付方式', order.pay) : ''}${order.paymentStatus ? infoRow('支付状态', order.paymentStatus) : ''}${order.refundedCents ? infoRow('已退金额', money(order.refundedCents)) : ''}${infoRow('接单陪玩', order.participants?.map(p => p.name).filter(Boolean).join(' / ') || '等待分配')}</dl><p class="chat-order-requirement"><strong>服务要求</strong>${e(order.requirement || '未填写额外要求')}</p>${order.history?.length ? `<details class="chat-order-history"><summary>订单记录 · ${order.history.length} 条</summary>${order.history.map(item => `<article class="chat-note"><p>${e(item.action)}${item.note ? `<br>${e(item.note)}` : ''}</p><small>${e([item.by, dateTime(item.at)].filter(Boolean).join(' · '))}</small></article>`).join('')}</details>` : ''}`;
}

export async function openConversation(id, ctx) {
  const { state, api, refresh } = ctx;
  const personal = state.mode !== 'management';
  const previousFocus = document.activeElement;
  await api(`/conversations/${id}`, {});
  await refresh(false);
  let chat = state.workspace.conversations?.find(c => c.id === id);
  if (!chat) throw new Error('会话已不可访问，请刷新后重试');
  const viewer = state.workspace.user;
  const mode = state.mode;
  document.querySelector('#actionDialog')?.remove();
  const modal = document.createElement('dialog');
  modal.id = 'actionDialog';
  modal.className = 'service-chat-dialog';
  modal.setAttribute('aria-labelledby', 'dialogTitle');
  modal.innerHTML = `<div class="service-chat-shell"><header class="service-chat-header"><div class="service-chat-heading">${avatar(peerFor(chat, personal).name)}<div><h2 id="dialogTitle">${e(peerFor(chat, personal).name)}</h2><p><span class="channel-tag">${e(chat.channel || '站内信')}</span><span id="chatState">${e(chat.state || '处理中')}</span></p></div></div><div class="service-chat-header-actions"><button type="button" class="chat-details-toggle" aria-controls="chatSidebar" aria-expanded="false">会话资料</button><button type="button" class="service-chat-close" aria-label="关闭会话">${icon('x', 20)}</button></div></header><div class="service-chat-layout"><section class="service-chat-main" aria-label="聊天"><div class="service-messages" id="serviceMessages" role="log" aria-label="会话消息" aria-live="polite" aria-relevant="additions text"></div><form class="message-compose"><label class="sr-only" for="replyMessage">${personal ? '发送消息' : '回复客户'}</label><textarea id="replyMessage" rows="3" maxlength="1000" placeholder="输入消息，Enter 发送，Shift + Enter 换行"></textarea><div class="message-compose-bottom"><span class="message-hint">Enter 发送 · Shift + Enter 换行</span><button type="submit" class="primary-action" id="sendMessage">发送 ${icon('arrow', 15)}</button></div><p id="messageError" class="message-error" role="alert"></p><p id="chatSync" class="message-sync" role="status">消息已同步</p></form></section><aside class="service-chat-sidebar" id="chatSidebar" aria-label="会话资料"><section class="chat-profile-card"></section><section class="chat-order-card" hidden></section>${personal ? '' : `<details class="internal-followup"><summary>内部跟进</summary><p class="message-hint">仅工作人员可见</p><div id="internalNotes"></div><form class="chat-followup-form"><label class="form-field">跟进记录<textarea name="note" rows="3" maxlength="1000" placeholder="记录处理依据、协商结果或下一步安排"></textarea></label><label class="form-field">处理状态<select name="state"><option value="处理中">处理中</option><option value="已结束">已结束</option></select></label><button type="submit" class="primary-action">保存跟进</button><p class="followup-feedback" role="status"></p></form></details>`}</aside></div></div>`;
  document.body.append(modal);
  const shell = modal.querySelector('.service-chat-shell');
  const messages = modal.querySelector('#serviceMessages');
  const input = modal.querySelector('#replyMessage');
  const send = modal.querySelector('#sendMessage');
  const error = modal.querySelector('#messageError');
  const followup = modal.querySelector('.chat-followup-form');
  const closeButton = modal.querySelector('.service-chat-close');
  let messageSignature = '', profileSignature = '', orderSignature = '', notesSignature = '';
  let syncing = false, sending = false, saving = false, followupDirty = false, changeVersion = 0, timer;
  const active = () => modal.isConnected && state.mode === mode && state.workspace?.user.id === viewer.id;
  const remember = () => {
    if (!active()) return;
    const index = state.workspace.conversations.findIndex(c => c.id === id);
    if (index >= 0) state.workspace.conversations[index] = chat;
  };
  const draw = (scroll = false) => {
    if (!active()) return;
    const nearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;
    const signature = JSON.stringify(chat.messages || []);
    if (signature !== messageSignature) {
      messages.innerHTML = (chat.messages || []).map(m => `<article class="service-message ${m.authorId === viewer.id ? 'is-mine' : ''}">${avatar(m.author, 'message-avatar')}<div class="message-content"><small>${e(m.author || '客户')} · ${e(dateTime(m.at))}</small><p>${e(m.text)}</p></div></article>`).join('') || '<div class="empty-state">暂无消息，发送一条消息开始沟通。</div>';
      messageSignature = signature;
      if (nearBottom || scroll) messages.scrollTop = messages.scrollHeight;
    }
    modal.querySelector('#chatState').textContent = chat.state || '处理中';
    const profile = profileMarkup(chat, personal);
    if (profile !== profileSignature) {
      modal.querySelector('.chat-profile-card').innerHTML = profile;
      modal.querySelector('#dialogTitle').textContent = peerFor(chat, personal).name;
      profileSignature = profile;
    }
    const order = state.workspace.orders?.find(o => o.id === chat.orderId) || chat.order;
    const orderContent = orderMarkup(order);
    if (orderContent !== orderSignature) {
      const card = modal.querySelector('.chat-order-card');
      const expanded = card.querySelector('details')?.open;
      card.innerHTML = orderContent;
      card.hidden = !order;
      if (expanded && card.querySelector('details')) card.querySelector('details').open = true;
      orderSignature = orderContent;
    }
    if (followup) {
      const notes = JSON.stringify(chat.notes || []);
      if (notes !== notesSignature) {
        modal.querySelector('#internalNotes').innerHTML = (chat.notes || []).map(n => `<article class="chat-note"><p>${e(n.text)}</p><small>${e(n.author)} · ${e(dateTime(n.at))}</small></article>`).join('') || '<p class="message-hint">暂无跟进记录</p>';
        notesSignature = notes;
      }
      if (!followupDirty) followup.elements.state.value = chat.state === '已结束' ? '已结束' : '处理中';
    }
  };
  const close = () => {
    if (sending || saving) return;
    const updateList = active();
    clearTimeout(timer);
    modal.close(); modal.remove();
    if (updateList) ctx.onClose?.();
    const focusTarget = previousFocus?.isConnected ? previousFocus : [...document.querySelectorAll('[data-action="conversation"]')].find(el => el.dataset.id === id);
    focusTarget?.focus();
  };
  closeButton.onclick = close;
  modal.addEventListener('cancel', event => { event.preventDefault(); close(); });
  modal.addEventListener('click', event => { if (event.target === modal) close(); });
  const observer = new MutationObserver(() => {
    if (!modal.isConnected) { clearTimeout(timer); observer.disconnect(); }
  });
  observer.observe(document.body, { childList: true });
  const detailsToggle = modal.querySelector('.chat-details-toggle');
  detailsToggle.onclick = () => {
    const expanded = shell.classList.toggle('is-details-open');
    detailsToggle.setAttribute('aria-expanded', String(expanded));
    detailsToggle.textContent = expanded ? '收起资料' : '会话资料';
  };
  const sync = async () => {
    if (syncing || sending || saving || !active()) return;
    syncing = true;
    const version = changeVersion;
    try {
      await refresh(false);
      if (!active()) return;
      if (version !== changeVersion || sending || saving) { remember(); return; }
      const fresh = state.workspace.conversations?.find(c => c.id === id);
      if (!fresh) throw new Error('当前会话已不可访问');
      chat = fresh; draw();
      if (chat.unread) {
        const read = await api(`/conversations/${id}`, {});
        if (active() && version === changeVersion && !sending && !saving) { chat = { ...chat, ...read }; remember(); draw(); }
      }
      if (active()) modal.querySelector('#chatSync').textContent = '消息已同步';
    } catch (err) { if (active()) modal.querySelector('#chatSync').textContent = `同步失败：${err.message}`; }
    finally { syncing = false; }
  };
  modal.querySelector('.message-compose').onsubmit = async event => {
    event.preventDefault();
    if (sending || saving || !active()) return;
    const message = input.value.trim();
    if (!message) { error.textContent = '请先填写消息内容'; input.focus(); return; }
    sending = true; changeVersion++; send.disabled = true; closeButton.disabled = true; input.readOnly = true; error.textContent = '';
    if (followup) followup.querySelector('button').disabled = true;
    try {
      const sent = await api(`/conversations/${id}/messages`, { message });
      if (!active()) return;
      chat = { ...chat, ...sent }; remember(); input.value = ''; draw(true);
      modal.querySelector('#chatSync').textContent = '消息已发送';
    } catch (err) { if (active()) error.textContent = err.message; }
    finally { sending = false; changeVersion++; send.disabled = false; closeButton.disabled = false; input.readOnly = false; if (followup) followup.querySelector('button').disabled = false; if (active()) input.focus(); }
  };
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); modal.querySelector('.message-compose').requestSubmit(); }
  });
  if (followup) {
    followup.addEventListener('input', () => { followupDirty = true; });
    followup.onsubmit = async event => {
      event.preventDefault();
      if (saving || sending || !active()) return;
      const note = followup.elements.note.value.trim();
      const status = followup.elements.state.value;
      const feedback = followup.querySelector('.followup-feedback');
      const button = followup.querySelector('button');
      saving = true; changeVersion++; button.disabled = true; send.disabled = true; closeButton.disabled = true; feedback.textContent = '';
      try {
        const updated = await api(`/conversations/${id}`, { note, state: status });
        if (!active()) return;
        chat = { ...chat, ...updated }; remember();
        // Preserve any newer draft typed while the save request was in flight.
        if (followup.elements.note.value.trim() === note && followup.elements.state.value === status) { followup.elements.note.value = ''; followupDirty = false; }
        draw(); feedback.textContent = '跟进已保存';
      } catch (err) { if (active()) feedback.textContent = err.message; }
      finally { saving = false; changeVersion++; button.disabled = false; send.disabled = false; closeButton.disabled = false; }
    };
  }
  modal.showModal(); draw(true); input.focus();
  const schedule = () => { timer = setTimeout(async () => { if (!active()) return; if (!document.hidden) await sync(); if (active()) schedule(); }, 8000); };
  schedule();
  return modal;
}
