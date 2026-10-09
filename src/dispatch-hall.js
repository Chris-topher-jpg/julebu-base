import { escapeHtml as e, icon } from './ui.js';
import { requestJson } from './request.js';
import { createRoomVoice } from './dispatch-voice.js';
import { productNeedsLevel, productUnitPrice } from './product-config.js';

const money = value => `¥${(Number(value || 0) / 100).toFixed(2)}`;
const mic = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>';
const channelIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m11 5-6 4H2v6h3l6 4zM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/></svg>';
const menuIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
const api = (path, body, options = {}) => requestJson(`/api${path}`, {
  credentials: 'same-origin', ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), ...options,
});
const setHtml = (element, html) => { if (element && element.innerHTML !== html) element.innerHTML = html; };

export function dispatchHallMarkup() {
  return `<section class="dispatch-hall" aria-label="派单大厅频道工作区" data-view="lobby" data-panel="none">
    <nav class="dh-server-rail" aria-label="俱乐部快捷入口"><button class="dh-server-icon is-current" data-dh="lobby" aria-label="星河派单大厅" title="星河派单大厅">${icon('game', 26)}</button><span class="dh-rail-divider"></span><a class="dh-rail-link" href="#/public/companions" aria-label="寻找大神陪玩" title="寻找大神陪玩">${icon('users', 21)}</a><button class="dh-rail-link" data-dh="orders" aria-label="我的点单" title="我的点单">${icon('receipt', 21)}</button><button class="dh-rail-link dh-rail-support" data-dh="support" aria-label="文字联系客服" title="文字联系客服">${icon('headset', 21)}</button></nav>
    <aside class="dh-sidebar" id="dhChannels" aria-label="频道列表">
      <div class="dh-server-heading"><div><strong>星河游戏俱乐部</strong><span>派单大厅 · 语音接待</span></div><span class="dh-server-badge">${icon('check', 14)}</span><button class="dh-icon-button dh-panel-close" data-dh="closePanel" aria-label="关闭频道列表">${icon('x', 18)}</button></div>
      <div class="dh-server-banner"><span>${icon('game', 22)} 一起开黑，一起赢</span><small>星河 · 语音派单社区</small></div>
      <div class="dh-channel-list"><div class="dh-channel-group-title">${icon('chevron', 12)} 信息频道</div><button class="dh-text-channel is-selected" data-dh="lobby" aria-current="page"><span>#</span> 接待大厅 <i class="dh-unread-dot"></i></button><button class="dh-text-channel" data-dh="support"><span>${icon('message', 17)}</span> 文字客服</button>
        <div class="dh-channel-group-title dh-voice-group">${icon('chevron', 12)} 语音频道 <small data-dh-channel-count>5</small></div><div class="dh-filters" role="group" aria-label="筛选语音房">${['全部', '接待', '试音', '可加入'].map((name, index) => `<button data-dh-filter="${name}" aria-pressed="${index === 0}">${name}</button>`).join('')}</div><div class="dh-rooms" data-dh-rooms><p class="dh-empty">正在加载频道…</p></div>
        <div class="dh-channel-note">${icon('lock', 14)}<span>先到大厅语音等候<br>客服会为你安排专属接待</span></div><nav class="dh-mobile-links" aria-label="俱乐部导航"><a href="#/public/overview">俱乐部首页</a><a href="#/public/companions">大神陪玩</a><a href="#/public/guarantees">服务保障</a><button data-dh="orders">我的点单</button></nav></div>
      <div class="dh-voice-dock"><div class="dh-connection"><span class="dh-connection-icon">${channelIcon}</span><div><strong data-dh-connection>尚未加入语音</strong><span data-dh-connected-room>选择一个房间开始交流</span></div><button class="dh-icon-button dh-disconnect" data-dh="leave" disabled aria-label="退出语音房" title="退出语音房">${icon('x', 19)}</button></div><div class="dh-device-controls"><button class="dh-icon-button" data-dh="mic" aria-pressed="false" aria-label="开启麦克风" title="开启麦克风" disabled>${mic}</button><button class="dh-icon-button" data-dh="speaker" aria-pressed="false" aria-label="静音扬声器" title="静音扬声器" disabled>${icon('headset', 19)}</button><button class="dh-icon-button" data-dh="play" aria-label="播放声音" title="播放声音" disabled>${channelIcon}</button><button class="dh-icon-button" data-dh="reconnect" aria-label="重连语音" title="重连语音" disabled>${icon('trend', 19)}</button></div></div>
      <div class="dh-self" data-dh-self></div>
    </aside>
    <div class="dh-workspace" aria-labelledby="dispatchTitle"><header class="dh-workspace-header"><button class="dh-icon-button dh-channel-toggle" data-dh="channels" aria-label="打开频道列表" aria-controls="dhChannels" aria-expanded="false">${menuIcon}</button><span class="dh-header-symbol" data-dh-header-symbol>#</span><h1 id="dispatchTitle" data-dh-title>接待大厅</h1><span class="dh-header-description" data-dh-subtitle>聊聊需求，找到合拍的队友</span><button class="dh-icon-button dh-members-toggle" data-dh="members" aria-label="查看房内成员与接待信息" aria-controls="dhInspector" aria-expanded="false">${icon('users', 20)}</button></header>
      <p class="dh-feedback" data-dh-feedback role="status" aria-live="polite"></p>
      <div class="dh-main-scroll"><div class="dh-welcome" data-dh-welcome><div class="dh-welcome-icon">#</div><p class="dh-eyebrow">你的组队时刻，从这里开始</p><h2>欢迎来到 # 接待大厅</h2><p class="dh-welcome-description">找队友、聊需求，先来语音里打个招呼。<br>客服会为你安排接待、邀请试音，陪你找到合拍的队友。</p><div class="dh-welcome-actions"><button class="dh-button dh-primary" data-dh="quick">${channelIcon} 加入接待大厅语音 ${icon('arrow', 16)}</button><button class="dh-button" data-dh="support">${icon('message', 16)} 先聊文字</button></div>
        <div class="dh-start-guide"><div><span>${channelIcon}</span><p><strong>加入语音</strong><small>进大厅，告诉客服你的需求</small></p></div><div><span>${icon('headset', 20)}</span><p><strong>认识队友</strong><small>专属接待，自由沟通与试音</small></p></div><div><span>${icon('receipt', 20)}</span><p><strong>确认点单</strong><small>核对服务与金额，再确认付款</small></p></div></div><div class="dh-message-divider"><span>频道指南</span></div><div class="dh-system-note"><span class="dh-system-avatar">${icon('game', 22)}</span><div><strong>星河接待助手 <small>官方</small></strong><p>欢迎来到星河！进房时麦克风默认关闭，准备好后再开启。试听与聊天不会扣款，正式服务以你确认的订单为准。</p><div class="dh-service-tips"><span>${mic} 默认静音</span><span>${icon('lock', 13)} 私享接待</span><span>${icon('receipt', 13)} 确认后付款</span></div></div></div></div>
      <div data-dh-active hidden></div><section class="dh-orders" data-dh-orders hidden><div class="dh-section-title"><h2>待确认与近期拟单</h2><span>请核对服务内容与金额</span></div><div data-dh-proposals></div></section></div>
      <div class="dh-lobby-composer" data-dh-lobby-composer><span>${icon('message', 20)} 接待大厅支持语音等候，客服会为你分配下方接待厅</span><button class="dh-button" data-dh="joinLobby">加入大厅语音</button></div>
    </div>
    <aside class="dh-inspector" id="dhInspector" aria-label="成员与接待信息"><div class="dh-inspector-header"><strong data-dh-inspector-title>接待信息</strong><button class="dh-icon-button dh-panel-close" data-dh="closePanel" aria-label="关闭成员列表">${icon('x', 18)}</button></div><div class="dh-inspector-tabs" data-dh-side-tabs hidden><button data-dh-side-tab="members" aria-pressed="true">房内成员</button><button data-dh-side-tab="service" aria-pressed="false">客服接待台</button></div><div class="dh-inspector-scroll"><div data-dh-roster></div><div data-dh-host-tools hidden></div><div class="dh-inspector-note" data-dh-room-notes><span>${channelIcon} 大厅开放进入</span><p>接待大厅可多人进入语音等候，有人在场也可加入。</p><span>${icon('lock', 17)} 接待厅私享接待</span><p>其他厅有人正在接待时，不对其他用户开放；客服及受邀打手可加入。</p><span>${icon('receipt', 17)} 服务有据可查</span><p>重要约定请写入订单，客服拟单后由你确认支付。</p><button class="dh-button" data-dh="support">${icon('message', 16)} 文字联系客服</button></div></div></aside>
    <button class="dh-panel-scrim" data-dh="closePanel" aria-label="关闭侧栏" hidden></button>
    <div data-dh-audio hidden></div>
  </section>`;
}

export function mountDispatchHall(root, { workspace, login, onOrders, onDispatch, onSupport, onSessionEnd }) {
  const currentUser = workspace?.user;
  // Keep the voice dock outside the collapsible channel drawer on small screens.
  root.append(root.querySelector('.dh-voice-dock'));
  let disposed = false, lobby = null, active = null, voice = null, filter = '全部', sideTab = 'members', view = 'lobby', lobbyTimer, pollTimer;
  let fetchingLobby = false, polling = false, joining = false, micBusy = false, generation = 0, conversationAtBottom = true, assignmentTransfer = false;
  let voiceState = { muted: true, deafened: false, peers: {} };
  const clientId = globalThis.crypto.randomUUID();
  const feedback = message => { if (!disposed) root.querySelector('[data-dh-feedback]').textContent = message; };
  const fail = error => { if (disposed) return; feedback(error.message || '暂时无法连接，请稍后重试'); if (error.status === 401) onSessionEnd?.(); };
  const roomApi = (session, action, body = {}) => api(`/dispatch/rooms/${session.roomId}/${action}`, { peerId: session.peerId, ...body });
  function panel(name = 'none') {
    const previous = root.dataset.panel;
    root.dataset.panel = name;
    root.querySelector('.dh-panel-scrim').hidden = name === 'none';
    root.querySelector('[data-dh="channels"]').setAttribute('aria-expanded', String(name === 'channels'));
    root.querySelector('[data-dh="members"]').setAttribute('aria-expanded', String(name === 'members'));
    if (name !== 'none' && name !== previous) root.querySelector(`${name === 'channels' ? '.dh-sidebar' : '.dh-inspector'} .dh-panel-close`).focus({ preventScroll: true });
    if (name === 'none' && previous !== 'none') root.querySelector(`[data-dh="${previous}"]`)?.focus({ preventScroll: true });
  }
  function selectSideTab(name) {
    sideTab = active?.canHost ? name : 'members';
    root.querySelector('[data-dh-roster]').hidden = sideTab !== 'members';
    root.querySelector('[data-dh-host-tools]').hidden = sideTab !== 'service';
    root.querySelector('[data-dh-room-notes]').hidden = sideTab !== 'members';
    root.querySelectorAll('[data-dh-side-tab]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.dhSideTab === sideTab)));
  }
  function renderRoster() {
    const members = active?.members || [];
    root.querySelector('[data-dh-inspector-title]').textContent = active ? `房内成员 — ${members.length}` : '接待信息';
    const groups = ['客服', '打手', '用户'].map(role => {
      const people = members.filter(member => member.role === role);
      if (!people.length) return '';
      return `<section class="dh-member-group"><h3>${role} — ${people.length}</h3>${people.map(member => {
        const mine = member.id === active.peerId, muted = mine ? voiceState.muted : member.muted;
        return `<div class="dh-member"><span class="dh-member-avatar ${role === '客服' ? 'is-host' : ''}">${e(Array.from(member.name)[0])}<i></i></span><div><strong>${e(member.name)}${mine ? '（我）' : ''}</strong><span>${muted ? '麦克风已关闭' : '麦克风已开启'}</span></div><span class="dh-member-mic ${muted ? 'is-muted' : ''}" aria-label="${muted ? '麦克风已关闭' : '麦克风已开启'}">${mic}</span></div>`;
      }).join('')}</section>`;
    }).join('');
    const staffCount = lobby?.rooms.reduce((sum, room) => sum + room.staffCount, 0) || 0;
    const memberCount = lobby?.rooms.reduce((sum, room) => sum + room.count, 0) || 0;
    const lobbyRoom = lobby?.rooms.find(room => room.id === 'lobby');
    setHtml(root.querySelector('[data-dh-roster]'), active ? groups : `<div class="dh-hall-presence"><span class="dh-service-emblem">${icon('headset', 25)}</span><strong>客服语音接待</strong><p>${staffCount ? `${staffCount} 位客服正在房间中` : '加入房间后通知客服接待'}</p><div><span>当前在房</span><b>${lobby ? `${memberCount} 人` : '加载中'}</b></div><div><span>语音频道</span><b>${lobby?.rooms.length ?? '—'}</b></div><div><span>大厅席位</span><b>${lobbyRoom ? `${lobbyRoom.count} / ${lobbyRoom.capacity}` : '—'}</b></div></div><p class="dh-member-placeholder">${icon('users', 26)}<span>你的队友将在这里出现<br>加入语音，开始认识彼此</span></p>`);
  }
  function renderView() {
    const inRoom = Boolean(active && view === 'room');
    const conversation = root.querySelector('.dh-conversation-scroll');
    if (root.dataset.view === 'room' && conversation) conversationAtBottom = conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight < 60;
    root.dataset.view = inRoom ? 'room' : 'lobby';
    root.querySelector('[data-dh-welcome]').hidden = inRoom;
    root.querySelector('[data-dh-active]').hidden = !inRoom;
    root.querySelector('[data-dh-lobby-composer]').hidden = inRoom;
    root.querySelector('[data-dh-title]').textContent = inRoom ? active.name : '接待大厅';
    setHtml(root.querySelector('[data-dh-header-symbol]'), inRoom ? channelIcon : '#');
    root.querySelector('[data-dh-subtitle]').textContent = inRoom ? '语音接待 · 房内文字交流' : '聊聊需求，找到合拍的队友';
    const lobbyButton = root.querySelector('.dh-text-channel[data-dh="lobby"]');
    lobbyButton.classList.toggle('is-selected', !inRoom);
    if (inRoom) lobbyButton.removeAttribute('aria-current'); else lobbyButton.setAttribute('aria-current', 'page');
    for (const button of root.querySelectorAll('.dh-channel-select')) {
      if (inRoom && button.dataset.room === active.roomId) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    }
    for (const button of root.querySelectorAll('.dh-voice-dock button')) button.disabled = !active;
    root.querySelector('[data-dh-connection]').textContent = active ? '已加入语音房' : '尚未加入语音';
    root.querySelector('[data-dh-connected-room]').textContent = active?.name || '选择一个房间开始交流';
    root.querySelector('.dh-voice-dock').classList.toggle('is-connected', Boolean(active));
    root.querySelector('[data-dh-side-tabs]').hidden = !active?.canHost;
    selectSideTab(sideTab); renderRoster();
    renderProposals();
    if (inRoom && conversationAtBottom && conversation) conversation.scrollTop = conversation.scrollHeight;
    if (active) updateSeats();
  }
  function renderRooms() {
    if (!lobby || disposed) return;
    root.querySelector('[data-dh-channel-count]').textContent = lobby.rooms.length;
    const rooms = lobby.rooms.filter(room => filter === '全部' || filter === '可加入' && room.joinable || room.kind === filter).sort((a, b) => Number(b.id === 'lobby') - Number(a.id === 'lobby'));
    setHtml(root.querySelector('[data-dh-rooms]'), rooms.map(room => {
      const isActive = active?.roomId === room.id;
      const status = isActive ? '已加入' : room.id === 'lobby' ? room.staffCount ? '客服在大厅' : '多人语音等候' : room.invited ? '邀请你试音' : room.count >= room.capacity ? '房间已满' : room.occupied ? '正在接待' : room.staffCount ? '客服在房' : '等待接待';
      const disabled = Boolean(active && !isActive || currentUser && !room.joinable && !isActive);
      return `<article class="dh-room ${isActive ? 'is-active' : ''} ${room.id === 'lobby' ? 'is-reception-lobby' : ''}"><button class="dh-channel-select" data-dh="join" data-room="${e(room.id)}" aria-label="${e(room.name)}，${status}，${room.count} / ${room.capacity} 人" ${isActive && view === 'room' ? 'aria-current="page"' : ''} ${disabled || joining ? 'disabled' : ''}><span class="dh-channel-icon">${channelIcon}</span><span class="dh-channel-copy"><strong>${e(room.name)}</strong><small class="${room.invited ? 'is-invited' : ''}">${currentUser && lobby.role === '打手' && !room.joinable && !isActive ? '等待客服邀请' : status}</small></span><span class="dh-channel-count">${room.count}/${room.capacity}</span></button>${isActive ? `<div class="dh-channel-members">${active.members.map(member => `<div><span>${e(Array.from(member.name)[0])}</span><strong>${e(member.name)}</strong>${member.role === '客服' ? '<small>客服</small>' : ''}${member.muted ? '<i>−</i>' : '<i class="is-speaking">♪</i>'}</div>`).join('')}</div>` : ''}</article>`;
    }).join('') || '<p class="dh-empty">暂无符合筛选的频道</p>');
    renderRoster();
  }
  function proposalMarkup(proposal) {
    const expired = Date.now() - Date.parse(proposal.createdAt) >= 30 * 60000;
    const pending = proposal.status === 'pending' && !expired;
    const mine = currentUser?.id === proposal.buyerId;
    return `<article class="dh-proposal"><div><span class="dh-label">${e(proposal.staffName)} 为 ${e(proposal.buyerName)} 拟单</span><h3>${e(proposal.game)} · ${e(proposal.productName)}</h3><p>${proposal.input.hours} 小时${proposal.levelName ? ` · ${e(proposal.levelName)}` : ''} · ${e(proposal.escortName || '客服安排打手')}</p><p class="dh-requirement">${e(proposal.input.requirement)}</p><small>${proposal.status === 'confirmed' ? `已生成订单 ${e(proposal.orderId)}` : proposal.status === 'replaced' ? '已更新，请查看新的拟单' : expired ? '拟单已过期，请联系客服重新拟单' : '拟单保留 30 分钟，使用账户余额支付'}</small></div><div class="dh-proposal-action"><strong>${money(proposal.amountCents)}</strong>${pending && mine ? `<button class="dh-button dh-primary" data-dh="confirm" data-id="${e(proposal.id)}">核对并确认付款</button>` : proposal.status === 'confirmed' && mine ? '<button class="dh-button" data-dh="orders">查看我的点单</button>' : `<span>${pending ? '等待用户确认' : proposal.status === 'confirmed' ? '已确认付款' : '已失效'}</span>`}</div></article>`;
  }
  function renderProposals() {
    const proposals = (lobby?.proposals || []).filter(item => item.status !== 'replaced' && currentUser?.id === item.buyerId);
    root.querySelector('[data-dh-orders]').hidden = Boolean(active && view === 'room') || !proposals.length;
    setHtml(root.querySelector('[data-dh-proposals]'), proposals.slice(0, 5).map(proposalMarkup).join(''));
  }
  async function refreshLobby() {
    if (disposed || fetchingLobby) return;
    fetchingLobby = true;
    try {
      const result = await api(currentUser ? '/dispatch' : '/public/dispatch');
      if (disposed) return;
      if (currentUser && result.userId !== currentUser.id) { onSessionEnd?.(); return; }
      lobby = result; renderRooms(); renderProposals();
    } catch (error) { fail(error); }
    finally { fetchingLobby = false; }
  }
  function options(select, items, first) {
    if (!select) return;
    const value = select.value;
    setHtml(select, (first ? `<option value="">${e(first)}</option>` : '') + items.map(item => `<option value="${e(item.id)}">${e(item.name)}</option>`).join(''));
    if ([...select.options].some(option => option.value === value)) select.value = value;
  }
  function updateSeats() {
    if (!active || disposed) return;
    const states = { new: '连接中', connecting: '连接中', connected: '语音已连接', disconnected: '连接中断', failed: '连接失败', closed: '连接已关闭' };
    setHtml(root.querySelector('[data-dh-seats]'), active.members.map(member => {
      const mine = member.id === active.peerId;
      const muted = mine ? voiceState.muted : member.muted;
      return `<div class="dh-seat ${member.role === '客服' ? 'is-host' : ''}"><span class="dh-seat-avatar">${e(Array.from(member.name)[0])}<i class="${muted ? 'muted' : 'open'}">${muted ? '−' : '♪'}</i></span><strong>${e(member.name)}${mine ? '（我）' : ''}</strong><span>${e(member.role)} · ${muted ? '麦克风已关' : '麦克风已开'}</span><small>${mine ? '本机' : states[voiceState.peers?.[member.id]] || '等待语音连接'}</small></div>`;
    }).join(''));
    const micButton = root.querySelector('[data-dh="mic"]');
    if (micButton) {
      const label = voiceState.acquiring ? '等待麦克风授权…' : voiceState.muted ? '开启麦克风' : '关闭麦克风';
      micButton.innerHTML = mic; micButton.title = label; micButton.setAttribute('aria-label', label);
      micButton.classList.toggle('is-muted', voiceState.muted); micButton.setAttribute('aria-pressed', String(!voiceState.muted)); micButton.disabled = micBusy || voiceState.acquiring;
    }
    const speaker = root.querySelector('[data-dh="speaker"]');
    if (speaker) { const label = voiceState.deafened ? '开启扬声器' : '静音扬声器'; speaker.title = label; speaker.setAttribute('aria-label', label); speaker.classList.toggle('is-muted', voiceState.deafened); speaker.setAttribute('aria-pressed', String(voiceState.deafened)); }
    const connected = Object.values(voiceState.peers || {}).filter(state => state === 'connected').length;
    root.querySelector('[data-dh-connection]').textContent = connected ? '语音已连接' : active.members.length > 1 ? '正在连接语音…' : '已加入语音房';
    renderRoster();
  }
  async function transferTo(roomId, roomName) {
    if (!active || assignmentTransfer || active.roomId === roomId) return;
    assignmentTransfer = true;
    const session = active;
    generation++;
    active = null;
    clearInterval(pollTimer);
    voice?.close(); voice = null;
    try { await roomApi(session, 'leave'); } catch { /* lease expiry is safe to recover from */ }
    if (disposed) return;
    root.querySelector('[data-dh-active]').innerHTML = '';
    root.querySelector('[data-dh-host-tools]').innerHTML = '';
    renderView(); renderRooms();
    feedback(`客服已分配你到${roomName || '接待厅'}，正在进入语音房…`);
    await join(roomId);
  }
  function updateRoom(snapshot) {
    active = { ...active, ...snapshot };
    voice?.sync(active.members);
    for (const signal of snapshot.signals || []) voice?.receive(signal);
    updateSeats();
    root.querySelector('[data-dh-room-state]').textContent = active.members.some(member => member.role === '客服') ? '客服已在房，可开启麦克风交流' : '已通知客服，你可以先填写需求或等待接待';
    const messages = root.querySelector('[data-dh-messages]');
    const conversation = root.querySelector('.dh-conversation-scroll');
    if (view === 'room') conversationAtBottom = conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight < 60;
    const html = active.messages.map(message => `<div class="dh-message ${message.userId === currentUser.id ? 'is-mine' : ''}"><span>${e(message.name)} · ${e(message.role)} <time>${new Date(message.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></span><p>${e(message.text)}</p></div>`).join('') || '<p class="dh-empty">可以先告诉客服：想玩什么、玩多久、对队友有什么偏好。</p>';
    setHtml(messages, html);
    if (active.canHost && active.roomId === 'lobby') {
      options(root.querySelector('[name="customerId"]'), active.lobbyCustomers || [], '选择大厅中的老板');
      options(root.querySelector('[name="serviceId"]'), active.lobbyStaff || [], '选择接待客服');
      options(root.querySelector('[name="roomId"]'), (active.receptionRooms || []).filter(room => !room.occupied && room.count < 6), '选择下方接待厅');
    } else if (active.canHost) {
      options(root.querySelector('[name="inviteEscort"]'), active.escorts.filter(escort => !active.members.some(member => member.userId === escort.id)), '选择在线打手');
      options(root.querySelector('[name="escortId"]'), active.escorts, '客服安排 / 多人服务');
    }
    setHtml(root.querySelector('[data-dh-room-proposals]'), (active.proposals || []).filter(item => item.status !== 'replaced').slice(0, 2).map(proposalMarkup).join('') + (active.canHost && active.proposals?.some(item => item.status === 'confirmed') ? '<div class="dh-dispatch-next"><p>用户已付款，前往派单台邀请匹配打手并跟进接单。</p><button class="dh-button dh-primary" data-dh="dispatch">前往派单台</button></div>' : ''));
    if (view === 'room' && conversationAtBottom) conversation.scrollTop = conversation.scrollHeight;
    renderRooms();
    if (active.roomId === 'lobby' && active.assignment && !assignmentTransfer) void transferTo(active.assignment.roomId, active.assignment.roomName);
  }
  function quotePrice() {
    const form = root.querySelector('[data-dh-form="proposal"]'); if (!form) return;
    const product = workspace.products?.find(item => item.id === form.elements.productId.value);
    form.elements.levelId.disabled = !productNeedsLevel(product);
    const price = productUnitPrice(product, form.elements.levelId.value, workspace.gameLevelConfigs, workspace.levels);
    form.querySelector('[data-dh-price]').textContent = price > 0 ? `预计 ${money(price * Number(form.elements.hours.value))} · 最终以拟单金额为准` : '选择服务后查看金额';
  }
  function roomMarkup(session) {
    return `<section class="dh-live" aria-labelledby="dhRoomTitle"><div class="dh-live-heading"><div><h2 id="dhRoomTitle">${e(session.name)}</h2><p data-dh-room-state></p></div><span class="dh-live-badge">${channelIcon} 语音频道</span></div><div class="dh-seats" data-dh-seats></div><p class="dh-privacy">${icon('lock', 12)} 仅房内成员可听见声音，离开房间会关闭麦克风。</p><div class="dh-chat"><h3>${icon('message', 16)} 房间交流 <span>消息仅保留至本次接待结束</span></h3><div class="dh-conversation-scroll"><div class="dh-messages" data-dh-messages role="log" aria-label="房间消息"></div><div class="dh-room-proposals" data-dh-room-proposals></div></div><form data-dh-form="message"><label class="dh-sr-only" for="dhMessage">发送房间消息</label><textarea id="dhMessage" name="text" maxlength="500" required placeholder="发送消息，告诉客服你的需求…"></textarea><div><span>重要约定请写入订单</span><button class="dh-button dh-primary" type="submit">发送 ${icon('arrow', 15)}</button></div></form></div></section>`;
  }
  function hostMarkup(session) {
    if (session.roomId === 'lobby') return `<div class="dh-host-tools"><form data-dh-form="assign"><h3>${icon('users', 17)} 分配接待厅</h3><p class="dh-price-hint">老板和客服都会收到分配结果，并自动进入下方接待厅。</p><label>老板<select name="customerId" required><option value="">选择大厅中的老板</option></select></label><label>接待客服<select name="serviceId" required><option value="">选择接待客服</option></select></label><label>目标接待厅<select name="roomId" required><option value="">选择下方接待厅</option></select></label><button class="dh-button dh-primary" type="submit">分配并进入接待厅</button></form></div>`;
    const products = (workspace.products || []).filter(product => product.state === '启用' && (workspace.catalogGames || workspace.games || []).some(game => game.name === product.game && game.state === '上架'));
    return `<div class="dh-host-tools"><form data-dh-form="invite"><h3>${icon('headset', 17)} 邀请打手试音</h3><label>在线打手<select name="inviteEscort" required><option value="">选择在线打手</option></select></label><button class="dh-button" type="submit">发送试音邀请</button></form><form data-dh-form="proposal"><h3>${icon('receipt', 17)} 为本房用户拟单</h3><label>服务<select name="productId" required>${products.map(product => `<option value="${e(product.id)}">${e(product.game)} · ${e(product.name)}</option>`).join('')}</select></label><div class="dh-field-row"><label>等级<select name="levelId">${(workspace.levels || []).map(level => `<option value="${e(level.id)}" ${level.id === 'gold' ? 'selected' : ''}>${e(level.name)}</option>`).join('')}</select></label><label>时长（小时）<input name="hours" type="number" min="1" max="24" step="1" value="1" required></label></div><label>指定打手<select name="escortId"><option value="">客服安排 / 多人服务</option></select></label><label>服务要求<textarea name="requirement" maxlength="300" required placeholder="记录与用户确认的服务内容"></textarea></label><p class="dh-price-hint" data-dh-price></p><button class="dh-button dh-primary" type="submit" ${products.length ? '' : 'disabled'}>发送拟单</button>${products.length ? '' : '<p>暂无可售服务，请先在后台配置。</p>'}</form></div>`;
  }
  async function poll() {
    if (!active || disposed || polling) return;
    const session = active;
    polling = true;
    try {
      const snapshot = await roomApi(session, 'poll', { after: session.cursor || 0, muted: voice?.muted ?? true });
      if (active?.peerId === session.peerId && !disposed) updateRoom(snapshot);
    } catch (error) {
      if (active?.peerId !== session.peerId || disposed) return;
      if ([401, 409].includes(error.status)) { leave(false); feedback(error.status === 409 ? '本次房间接待已结束，或连接已过期，请重新加入。' : error.message); }
      else feedback('房间同步暂时中断，正在重新连接…');
      if (error.status === 401) onSessionEnd?.();
    } finally { polling = false; }
  }
  function release(session) {
    if (session) void roomApi(session, 'leave').catch(() => {});
  }
  function leave(notify = true) {
    generation++;
    const session = active; active = null; view = 'lobby'; voice?.close(); voice = null;
    clearInterval(pollTimer);
    if (notify) release(session);
    if (!disposed) { root.querySelector('[data-dh-active]').innerHTML = ''; root.querySelector('[data-dh-host-tools]').innerHTML = ''; renderView(); renderRooms(); void refreshLobby(); }
  }
  async function join(id) {
    if (!currentUser) { login(); return; }
    if (active?.roomId === id) { view = 'room'; renderView(); panel(); return; }
    if (active || joining) return;
    joining = true; renderRooms();
    const epoch = ++generation;
    try {
      const snapshot = await api(`/dispatch/rooms/${id}/join`, { clientId });
      if (disposed || epoch !== generation) { release(snapshot); return; }
      active = snapshot; view = 'room'; conversationAtBottom = true; assignmentTransfer = false; sideTab = snapshot.canHost ? 'service' : 'members'; voiceState = { muted: true, deafened: false, peers: {} };
      root.querySelector('[data-dh-active]').innerHTML = roomMarkup(snapshot);
      root.querySelector('[data-dh-host-tools]').innerHTML = snapshot.canHost ? hostMarkup(snapshot) : '';
      renderView(); panel();
      voice = createRoomVoice({ peerId: snapshot.peerId, iceServers: snapshot.iceServers, audioRoot: root.querySelector('[data-dh-audio]'),
        send: (to, signal) => roomApi(snapshot, 'signal', { to, signal }),
        onChange: state => { if (active?.peerId === snapshot.peerId) { voiceState = state; updateSeats(); } },
        onError: message => { if (active?.peerId === snapshot.peerId) feedback(message); },
      });
      feedback('已加入房间。麦克风默认关闭，可在底部语音控制栏开启。');
      updateRoom(snapshot); quotePrice();
      pollTimer = setInterval(() => void poll(), 1500);
      root.querySelector('.dh-main-scroll').scrollTop = 0;
      void refreshLobby();
    } catch (error) { fail(error); }
    finally { joining = false; renderRooms(); }
  }
  async function confirm(id, trigger) {
    const proposal = [...(active?.proposals || []), ...(lobby?.proposals || [])].find(item => item.id === id);
    if (!proposal) return;
    const modal = document.createElement('dialog'); modal.className = 'dh-confirm-dialog';
    modal.setAttribute('aria-labelledby', 'dhConfirmTitle');
    modal.innerHTML = `<form><h2 id="dhConfirmTitle">确认订单与余额支付</h2><p>${e(proposal.game)} · ${e(proposal.productName)} · ${proposal.input.hours} 小时</p><p>${e(proposal.levelName)} · ${e(proposal.escortName || '客服安排打手')}</p><p>${e(proposal.input.requirement)}</p><strong>${money(proposal.amountCents)}</strong><p>确认后从你的账户余额扣款，订单进入派单流程。拟单内容与金额由服务端再次校验。</p><p class="dh-error" role="alert"></p><div><button class="dh-button" type="button" data-cancel>返回核对</button><button class="dh-button dh-primary" type="submit">确认支付 ${money(proposal.amountCents)}</button></div></form>`;
    document.body.append(modal); modal.showModal();
    modal.querySelector('[data-cancel]').onclick = () => modal.close();
    modal.addEventListener('close', () => { modal.remove(); trigger?.focus(); }, { once: true });
    modal.querySelector('form').onsubmit = async event => {
      event.preventDefault();
      const submit = modal.querySelector('[type="submit"]'); if (submit.disabled) return; submit.disabled = true;
      try {
        const result = await api(`/dispatch/proposals/${id}/confirm`, {});
        if (disposed) return;
        modal.close(); feedback(`订单 ${result.orderId} 已创建，可在“我的点单”查看派单进度。`);
        await refreshLobby(); await poll();
      } catch (error) { if (modal.isConnected) modal.querySelector('.dh-error').textContent = error.message; }
      finally { submit.disabled = false; }
    };
  }
  async function click(event) {
    const sideButton = event.target.closest('[data-dh-side-tab]');
    if (sideButton) { selectSideTab(sideButton.dataset.dhSideTab); return; }
    const filterButton = event.target.closest('[data-dh-filter]');
    if (filterButton) {
      filter = filterButton.dataset.dhFilter;
      root.querySelectorAll('[data-dh-filter]').forEach(button => button.setAttribute('aria-pressed', String(button === filterButton)));
      renderRooms(); return;
    }
    const button = event.target.closest('[data-dh]'); if (!button || button.disabled) return;
    try {
      switch (button.dataset.dh) {
        case 'lobby': view = 'lobby'; renderView(); panel(); return;
        case 'channels': panel(root.dataset.panel === 'channels' ? 'none' : 'channels'); return;
        case 'members': panel(root.dataset.panel === 'members' ? 'none' : 'members'); return;
        case 'closePanel': panel(); return;
        case 'join': return await join(button.dataset.room);
        case 'joinLobby': return await join('lobby');
        case 'quick': {
          if (!currentUser) return login();
          if (active) { view = 'room'; renderView(); panel(); return; }
          return await join('lobby');
        }
        case 'leave': leave(); feedback('已退出房间，麦克风已关闭。'); return;
        case 'mic': micBusy = true; updateSeats(); try { await voice?.toggleMic(); await poll(); } finally { micBusy = false; updateSeats(); } return;
        case 'speaker': voice?.toggleSpeaker(); return;
        case 'play': await voice?.play(); feedback('已尝试播放房间声音。'); return;
        case 'reconnect': voice?.reconnect(); feedback('正在重新连接房间语音…'); return;
        case 'confirm': return await confirm(button.dataset.id, button);
        case 'orders': return currentUser ? onOrders() : login();
        case 'dispatch': return onDispatch();
        case 'support': return currentUser ? onSupport() : login();
      }
    } catch (error) { fail(error); }
  }
  async function submit(event) {
    const form = event.target.closest('[data-dh-form]'); if (!form) return;
    event.preventDefault(); if (!active) return;
    const button = form.querySelector('[type="submit"]'); if (button.disabled) return; button.disabled = true;
    const session = active;
    try {
      const values = Object.fromEntries(new FormData(form));
      const kind = form.dataset.dhForm;
      const body = kind === 'invite' ? { userId: values.inviteEscort } : kind === 'assign' ? { customerId: values.customerId, serviceId: values.serviceId, roomId: values.roomId } : values;
      await roomApi(session, kind, body);
      if (disposed || active?.peerId !== session.peerId) return;
      if (kind === 'message' && form.elements.text.value === values.text) form.elements.text.value = '';
      feedback(kind === 'invite' ? '试音邀请已发送，对方可通过通知进入房间。' : kind === 'proposal' ? '拟单已发送，等待用户核对并确认支付。' : kind === 'assign' ? '接待厅已分配，相关人员正在转入新房间。' : '');
      await poll(); await refreshLobby();
    } catch (error) { fail(error); }
    finally { button.disabled = false; }
  }
  const wake = () => { void poll(); void refreshLobby(); };
  const pagehide = () => {
    if (active) void api(`/dispatch/rooms/${active.roomId}/leave`, { peerId: active.peerId }, { keepalive: true }).catch(() => {});
    voice?.close();
  };
  const dismissPanel = event => { if (event.key === 'Escape') panel(); };
  const nav = root.closest('.public-home')?.querySelector('.public-nav');
  const updateHeight = () => root.style.setProperty('--dh-nav-height', `${nav?.getBoundingClientRect().height ?? 0}px`);
  const resize = new ResizeObserver(updateHeight);
  updateHeight();
  if (nav) resize.observe(nav);
  setHtml(root.querySelector('[data-dh-self]'), `<span class="dh-self-avatar">${e(Array.from(currentUser?.name || '访')[0])}<i></i></span><div><strong>${e(currentUser?.name || '访客')}</strong><span>${currentUser ? '星河游戏俱乐部' : '登录后可加入语音'}</span></div>${currentUser ? icon('headset', 17) : '<button class="dh-self-login" data-dh="quick">登录</button>'}`);
  renderView();
  root.addEventListener('click', click); root.addEventListener('submit', submit); root.addEventListener('input', quotePrice); root.addEventListener('keydown', dismissPanel);
  window.addEventListener('online', wake); window.addEventListener('focus', wake); window.addEventListener('pagehide', pagehide);
  void refreshLobby(); lobbyTimer = setInterval(() => void refreshLobby(), 5000);
  return () => {
    disposed = true; leave(); clearInterval(lobbyTimer);
    resize.disconnect();
    root.removeEventListener('click', click); root.removeEventListener('submit', submit); root.removeEventListener('input', quotePrice); root.removeEventListener('keydown', dismissPanel);
    window.removeEventListener('online', wake); window.removeEventListener('focus', wake); window.removeEventListener('pagehide', pagehide);
    document.querySelectorAll('.dh-confirm-dialog').forEach(modal => { modal.close(); modal.remove(); });
  };
}
