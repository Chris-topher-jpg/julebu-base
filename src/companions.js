import { escapeHtml as e, icon } from './ui.js';

// Public showcase profiles; these are not live account or review statistics.
const profiles = [
  ['玥玥', '王者荣耀', '明星', '技术陪玩', 88, 342, 98, true, '辅助位 / 巅峰赛', '擅长辅助位和团队配合，重视沟通与节奏。可以一起排位，也可以在结束后聊聊对局思路。'],
  ['阿布', '和平精英', '魔王', '技术陪玩', 68, 286, 99, false, '指挥带队 / 四排', '熟悉海岛与沙漠地图，擅长四排指挥和路线规划。开麦交流，配合你的游戏节奏。'],
  ['小鹿', '英雄联盟', '明星', '技术陪玩', 78, 219, 100, true, '打野 / 排位', '主打野位，喜欢团队协作和赛后复盘。提前确认区服与位置，一起认真打好每一局。'],
  ['Koi', '无畏契约', '巅峰', '技术陪玩', 98, 176, 98, false, '决斗位 / 枪法陪练', '擅长决斗位与回合决策，可一起练习地图思路、交叉火力和基础枪法。'],
  ['奶糖', '王者荣耀', '金牌', '娱乐陪玩', 58, 198, 99, false, '娱乐开黑 / 开麦', '喜欢轻松的娱乐局，耐心沟通，适合在忙碌之后一起放松开黑。'],
  ['星野', '和平精英', '魔王', '技术陪玩', 72, 154, 100, false, '王牌冲刺 / 战术', '耐心陪练，重视细节沟通与团队执行。一起熟悉地形，练习转点与配合。'],
  ['米粒', '王者荣耀', '明星', '技术陪玩', 68, 581, 98, true, '射手 / 配合', '擅长射手位和双人配合，可以根据阵容补位。服务前会确认你的区服、位置和目标。'],
  ['小满', '英雄联盟', '明星', '技术陪玩', 78, 492, 98, true, '中单 / 双排', '中单玩家，喜欢研究对线和支援。可以认真双排，也可以一起练习新英雄。'],
  ['阿九', '三角洲行动', '魔王', '技术陪玩', 88, 532, 100, true, '战术沟通 / 组队', '擅长队伍沟通和路线规划，提前沟通装备与目标，配合你的行动节奏。'],
  ['七喜', '王者荣耀', '金牌', '娱乐陪玩', 58, 583, 99, false, '娱乐模式 / 耐心', '开麦友好，重视每一局的体验。休闲模式或组队开黑都可以提前沟通。'],
  ['青禾', '无畏契约', '巅峰', '技术陪玩', 88, 267, 100, true, '控场位 / 地图思路', '擅长控场位，注重技能配合与信息交流。可以一起练习地图点位和回合运营。'],
  ['北辰', '三角洲行动', '明星', '技术陪玩', 98, 459, 100, false, '协同作战 / 复盘', '重视队伍配合和有效沟通，服务前确认行动目标，结束后可以复盘关键决策。'],
  ['可乐', '和平精英', '巅峰', '技术陪玩', 68, 284, 99, false, '双排 / 团队协作', '喜欢双排和小队配合，耐心交流路线、物资与战术安排，享受组队过程。'],
  ['晚星', '三角洲行动', '金牌', '娱乐陪玩', 58, 176, 99, true, '休闲组队 / 开麦', '轻松组队，开麦沟通。欢迎提前说明你的偏好与需求，一起安排合适的服务。'],
].map(([name, game, level, service, price, orders, rating, online, tags, bio], index) => ({
  id: `showcase-${index + 1}`, number: String(80351914 + index), name, game, level, service,
  price, orders, rating, online, tags: tags.split(' / '), bio,
  image: `/src/escort-${String(index + 1).padStart(2, '0')}.jpg`, reviews: [],
}));

export function companionProfiles(workspace = {}) {
  const games = new Set((workspace?.catalogGames || workspace?.games || []).map(game => game.name));
  return profiles.filter(profile => games.has(profile.game));
}

export function findCompanionProfile(name, workspace) {
  return companionProfiles(workspace).find(profile => profile.name === name);
}

function savedSet(key) {
  try { const value = JSON.parse(localStorage.getItem(key) || '[]'); return new Set(Array.isArray(value) ? value.filter(id => typeof id === 'string') : []); }
  catch { return new Set(); }
}
function saveSet(key, values) { try { localStorage.setItem(key, JSON.stringify([...values])); } catch { /* Preferences may be unavailable in private storage. */ } }
function chatStore() {
  try {
    const value = JSON.parse(localStorage.getItem('club.profile.chats') || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch { return {}; }
}
function saveChats(value) { try { localStorage.setItem('club.profile.chats', JSON.stringify(value)); } catch { /* Storage may be unavailable. */ } }
const availability = profile => `<span class="pro-availability ${profile.online ? 'is-online' : ''}"><i></i>${profile.online ? '在线' : '离线'}</span>`;
const price = profile => `<strong class="pro-price"><span>¥</span> ${profile.price.toFixed(0)}<small>/ 小时</small></strong>`;

export function mountCompanions(container, { workspace = {}, requestService, openChat, onlineOnly = false, compact = false } = {}) {
  const availableProfiles = companionProfiles(workspace);
  const followed = savedSet('club.profile.follows');
  const blocked = savedSet('club.profile.blocks');
  const games = [...new Set((workspace?.catalogGames || workspace?.games || []).map(game => game.name))];
  const filters = { game: '', query: '', online: Boolean(onlineOnly), collection: 'all', sort: 'default' };
  container.className = `pro-directory${onlineOnly ? ' pro-directory-online-only' : ''}${compact ? ' pro-directory-compact' : ''}`;
  const heading = compact ? '' : `<div class="pro-directory-heading"><div><span class="pro-eyebrow">星河俱乐部</span><h2>大神陪玩</h2></div><span class="pro-showcase-label">展示档案</span></div>`;
  const controls = compact ? '' : `<div class="pro-filters"><div class="pro-game-filters" role="group" aria-label="陪玩游戏">${['', ...games].map(game => `<button type="button" data-pro-game="${e(game)}" aria-pressed="${!game}">${e(game || '全部游戏')}</button>`).join('')}</div>
    <label class="pro-search">${icon('search', 16)}<input type="search" placeholder="搜索昵称、游戏" aria-label="搜索大神陪玩"></label></div>
    <div class="pro-list-toolbar"><span class="pro-result-count" role="status"></span><div><label class="pro-online-filter"><input type="checkbox" ${onlineOnly ? 'checked disabled' : ''}>仅看在线</label><select aria-label="陪玩收藏筛选"><option value="all">全部陪玩</option><option value="following">我的关注</option><option value="blocked">已屏蔽</option></select><select aria-label="陪玩排序"><option value="default">综合排序</option><option value="priceLow">价格从低到高</option><option value="priceHigh">价格从高到低</option><option value="orders">服务单量优先</option></select></div></div>`;
  container.innerHTML = `<div class="pro-directory-inner">${heading}${controls}
    <div class="pro-grid"></div><div class="pro-empty" hidden>${icon('search', 28)}<h3>暂无符合条件的陪玩</h3><button type="button" class="pro-button" data-pro-reset>重置筛选</button></div>
  </div>`;

  function draw() {
    const list = availableProfiles.filter(p => (!filters.game || p.game === filters.game) && (!filters.online || p.online) &&
      [p.name, p.game, ...p.tags].join(' ').toLowerCase().includes(filters.query.toLowerCase().trim()) &&
      (filters.collection === 'blocked' ? blocked.has(p.id) : !blocked.has(p.id) && (filters.collection !== 'following' || followed.has(p.id))));
    if (filters.sort === 'priceLow') list.sort((a, b) => a.price - b.price);
    if (filters.sort === 'priceHigh') list.sort((a, b) => b.price - a.price);
    if (filters.sort === 'orders') list.sort((a, b) => b.orders - a.orders);
    container.querySelector('.pro-result-count')?.replaceChildren(document.createTextNode(`共 ${list.length} 位陪玩`));
    container.querySelector('.pro-empty').hidden = list.length > 0;
    container.querySelector('.pro-grid').innerHTML = list.map(p => `<article class="pro-card" data-pro-id="${p.id}">
      <button type="button" class="pro-card-open" aria-label="查看${e(p.name)}的陪玩介绍" data-pro-open="${p.id}">
        <div class="pro-cover"><img src="${p.image}" alt="${e(p.name)}的头像" loading="lazy" width="214" height="155"><span class="pro-cover-state ${p.online ? 'is-online' : ''}">${icon('headset', 12)}${p.online ? '空闲中' : '可预约'}</span><span class="pro-cover-stats">${icon('receipt', 12)} ${p.orders}<i></i><span class="pro-star">${icon('star', 12)}</span> 好评率 ${p.rating}%</span></div>
        <div class="pro-card-info"><h3>${e(p.name)}${followed.has(p.id) ? `<span class="pro-follow-mark">${icon('heart', 13)}</span>` : ''}</h3><p>${e(p.game)} / ${e(p.service)} / ${e(p.level)}陪</p></div>
      </button>
      <div class="pro-card-bottom"><div class="pro-card-price">${availability(p)}${price(p)}</div><div class="pro-card-actions"><button type="button" class="pro-button" data-pro-open="${p.id}">去下单</button><button type="button" class="pro-button primary" data-pro-open="${p.id}" data-intent="consult">${icon('message', 14)}聊一聊</button></div></div>
    </article>`).join('');
  }

  container.addEventListener('click', event => {
    const gameButton = event.target.closest('[data-pro-game]');
    if (gameButton) {
      filters.game = gameButton.dataset.proGame;
      container.querySelectorAll('[data-pro-game]').forEach(button => button.setAttribute('aria-pressed', String(button === gameButton)));
      draw();
    }
    const opener = event.target.closest('[data-pro-open]');
    if (opener) showProfile(availableProfiles.find(p => p.id === opener.dataset.proOpen), opener.dataset.intent || 'profile', opener);
    if (event.target.closest('[data-pro-reset]')) {
      Object.assign(filters, { game: '', query: '', online: Boolean(onlineOnly), collection: 'all', sort: 'default' });
      if (container.querySelector('input[type=search]')) container.querySelector('input[type=search]').value = '';
      if (container.querySelector('input[type=checkbox]')) container.querySelector('input[type=checkbox]').checked = Boolean(onlineOnly);
      container.querySelectorAll('select').forEach(select => select.selectedIndex = 0);
      container.querySelectorAll('[data-pro-game]').forEach(button => button.setAttribute('aria-pressed', String(!button.dataset.proGame)));
      draw();
    }
  });
  container.querySelector('input[type=search]')?.addEventListener('input', event => { filters.query = event.target.value; draw(); });
  container.querySelector('input[type=checkbox]')?.addEventListener('change', event => { filters.online = event.target.checked; draw(); });
  container.querySelector('[aria-label="陪玩收藏筛选"]')?.addEventListener('change', event => { filters.collection = event.target.value; draw(); });
  container.querySelector('[aria-label="陪玩排序"]')?.addEventListener('change', event => { filters.sort = event.target.value; draw(); });

  function showProfile(profile, intent, opener) {
    if (!profile) return;
    document.querySelector('#companionDialog')?.close();
    const modal = document.createElement('dialog');
    modal.id = 'companionDialog';
    modal.className = 'pro-profile';
    modal.setAttribute('aria-labelledby', 'proProfileName');
    const tabs = [['home', '个人主页'], ['skills', '游戏技能'], ['reviews', '评价列表']];
    modal.innerHTML = `<div class="pro-profile-head">
      <button type="button" class="pro-icon-button pro-close" aria-label="关闭陪玩介绍" title="关闭">${icon('x', 22)}</button>
      <img class="pro-avatar" src="${profile.image}" alt="${e(profile.name)}的头像" width="88" height="88">
      <div class="pro-identity"><div class="pro-name-line"><h2 id="proProfileName">${e(profile.name)}</h2>${availability(profile)}<span class="pro-showcase-label">展示档案</span></div><p>ID: ${profile.number}<button type="button" class="pro-icon-button" data-copy-id aria-label="复制陪玩编号" title="复制编号">${icon('copy', 13)}</button></p><div class="pro-identity-tags"><span>${icon('game', 14)}${e(profile.game)}</span><span>${e(profile.level)}陪</span>${profile.tags.map(tag => `<span>${e(tag)}</span>`).join('')}</div></div>
      <div class="pro-profile-actions"><button type="button" class="pro-button" data-follow></button><button type="button" class="pro-button" data-block></button><button type="button" class="pro-button primary" data-contact>${icon('message', 15)}聊一聊</button></div>
    </div><div class="pro-profile-tabs" role="tablist" aria-label="陪玩资料">${tabs.map(([id, label]) => `<button type="button" id="pro-tab-${id}" role="tab" data-pro-tab="${id}" aria-controls="pro-panel-${id}" aria-selected="${id === 'home'}" tabindex="${id === 'home' ? 0 : -1}">${label}</button>`).join('')}</div>
    <div class="pro-profile-body">
      <section role="tabpanel" id="pro-panel-home" aria-labelledby="pro-tab-home" class="pro-home-panel">
        <aside class="pro-portrait"><img src="${profile.image}" alt="${e(profile.name)}的个人形象" width="214" height="155"><h3>个人介绍</h3><p>${e(profile.bio)}</p></aside>
        <div class="pro-profile-main"><div class="pro-service-layout"><section class="pro-skill"><h3>游戏技能 <span>${e(profile.game)}</span></h3><div class="pro-skill-heading">${icon('game', 26)}<div><strong>${e(profile.game)}</strong><p>${e(profile.tags.join(' · '))}</p></div></div><dl class="pro-skill-facts"><div><dt>服务类型</dt><dd>${e(profile.service)}</dd></div><div><dt>陪玩等级</dt><dd>${e(profile.level)}陪</dd></div><div><dt>累计订单</dt><dd>${profile.orders}</dd></div><div><dt>好评率</dt><dd class="pro-accent">${profile.rating}%</dd></div></dl></section>
        <aside class="pro-booking"><span>陪玩单价</span>${price(profile)}<p>区服、时长与预约时间以订单确认为准</p><button type="button" class="pro-button primary" data-book>立即下单 ${icon('arrow', 16)}</button></aside></div>
        <section class="pro-profile-about"><h3>服务偏好</h3><div><span>语音方式<strong>游戏内语音 / 按约定</strong></span><span>服务时间<strong>支持预约，接单前确认</strong></span></div></section>
        <section class="pro-reviews-preview"><div><h3>评价列表</h3><button type="button" class="pro-text-button" data-all-reviews>查看全部 ${icon('chevron', 13)}</button></div><p class="pro-empty-reviews">${icon('message', 21)}暂无公开评价</p></section></div>
      </section>
      <section role="tabpanel" id="pro-panel-skills" aria-labelledby="pro-tab-skills" hidden><h3>${e(profile.game)} · ${e(profile.service)}</h3><p>${e(profile.bio)}</p><div class="pro-skill-detail">${profile.tags.map(tag => `<span>${icon('check', 17)}${e(tag)}</span>`).join('')}</div><dl class="pro-service-terms"><div><dt>价格</dt><dd>¥ ${profile.price.toFixed(2)} / 小时</dd></div><div><dt>游戏与区服</dt><dd>下单时填写，接单前确认</dd></div><div><dt>服务要求</dt><dd>可备注位置偏好、语音方式与预约时间</dd></div></dl><button type="button" class="pro-button primary" data-book>预约这位陪玩 ${icon('arrow', 16)}</button></section>
      <section role="tabpanel" id="pro-panel-reviews" aria-labelledby="pro-tab-reviews" hidden><h3>服务评价</h3><div class="pro-review-summary"><strong>${profile.rating}%</strong><span>展示好评率</span><strong>${profile.orders}</strong><span>展示订单数</span></div><div class="pro-empty-reviews">${icon('message', 28)}暂无公开评价</div></section>
      <section class="pro-contact" hidden><h3>预约咨询 · ${e(profile.name)}</h3><p>请在预约需求中注明游戏区服、服务时长与可服务时间。</p><button type="button" class="pro-button primary" data-consult>填写预约需求 ${icon('arrow', 16)}</button></section>
      <p class="pro-profile-feedback" role="status" aria-live="polite"></p>
    </div>`;
    document.body.append(modal);
    document.body.classList.add('companion-modal-open');
    modal.showModal();
    function updatePreferences() {
      const follow = modal.querySelector('[data-follow]');
      follow.innerHTML = `${icon('heart', 15)}${followed.has(profile.id) ? '已关注' : '关注'}`;
      follow.setAttribute('aria-pressed', String(followed.has(profile.id)));
      const block = modal.querySelector('[data-block]');
      block.innerHTML = `${icon('ban', 15)}${blocked.has(profile.id) ? '取消屏蔽' : '屏蔽'}`;
      block.setAttribute('aria-pressed', String(blocked.has(profile.id)));
    }
    const message = text => modal.querySelector('.pro-profile-feedback').textContent = text;
    function selectTab(id, focus = false) {
      modal.querySelectorAll('[data-pro-tab]').forEach(button => {
        const selected = button.dataset.proTab === id;
        button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
        if (selected && focus) button.focus();
      });
      modal.querySelectorAll('[role=tabpanel]').forEach(panel => panel.hidden = panel.id !== `pro-panel-${id}`);
      modal.querySelector('.pro-contact').hidden = true;
    }
    const contact = () => { modal.close(); showChat(profile); };
    modal.addEventListener('keydown', event => {
      const current = event.target.closest('[role=tab]');
      if (!current || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = tabs.findIndex(([id]) => id === current.dataset.proTab);
      selectTab(tabs[event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3][0], true);
    });
    modal.addEventListener('click', async event => {
      const target = event.target.closest('button');
      if (!target) return;
      if (target.classList.contains('pro-close')) modal.close();
      if (target.dataset.proTab) selectTab(target.dataset.proTab);
      if (target.hasAttribute('data-all-reviews')) selectTab('reviews', true);
      if (target.hasAttribute('data-contact')) { if (openChat) { modal.close(); openChat(profile); } else contact(); }
      if (target.hasAttribute('data-follow')) { followed.has(profile.id) ? followed.delete(profile.id) : followed.add(profile.id); saveSet('club.profile.follows', followed); updatePreferences(); message(followed.has(profile.id) ? '已加入我的关注' : '已取消关注'); }
      if (target.hasAttribute('data-block')) { blocked.has(profile.id) ? blocked.delete(profile.id) : blocked.add(profile.id); saveSet('club.profile.blocks', blocked); updatePreferences(); message(blocked.has(profile.id) ? '已屏蔽，将从默认列表隐藏' : '已取消屏蔽'); }
      if (target.hasAttribute('data-copy-id')) {
        try { await navigator.clipboard.writeText(profile.number); message('编号已复制'); } catch { message(`陪玩编号：${profile.number}`); }
      }
      if (target.hasAttribute('data-book') || target.hasAttribute('data-consult')) { modal.close(); requestService(profile); }
    });
    modal.addEventListener('click', event => {
      if (event.target !== modal) return;
      const rect = modal.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) modal.close();
    });
    modal.addEventListener('close', () => {
      modal.remove(); document.body.classList.remove('companion-modal-open'); draw();
      const trigger = container.querySelector(`[data-pro-open="${profile.id}"]`);
      (trigger || container.querySelector('input[type=search]'))?.focus({ preventScroll: true });
    }, { once: true });
    updatePreferences();
    if (intent === 'consult') { if (openChat) { modal.close(); openChat(profile); } else contact(); }
  }

  function showChat(profile) {
    if (!profile) return;
    document.querySelector('#companionChatDialog')?.close();
    const dialog = document.createElement('dialog');
    dialog.id = 'companionChatDialog';
    dialog.className = 'pro-chat-dialog';
    dialog.setAttribute('aria-labelledby', 'proChatTitle');
    const chats = chatStore();
    let activeId = profile.id;
    const contacts = availableProfiles.filter(item => !blocked.has(item.id));
    const ensureMessages = id => {
      if (!Array.isArray(chats[id])) chats[id] = [{ id: `welcome-${id}`, from: 'them', text: `你好，我是${availableProfiles.find(item => item.id === id)?.name || '陪玩'}。可以先告诉我想玩的游戏、区服和时间，我会尽快回复你。`, at: Date.now() }];
      return chats[id];
    };
    const render = () => {
      const active = availableProfiles.find(item => item.id === activeId) || profile;
      const messages = ensureMessages(active.id);
      dialog.innerHTML = `<div class="pro-chat-shell">
        <header class="pro-chat-head"><div><span class="pro-eyebrow">星河陪玩 · 在线咨询</span><h2 id="proChatTitle">和大神聊一聊</h2></div><button type="button" class="pro-icon-button pro-close" aria-label="关闭聊天">${icon('x', 22)}</button></header>
        <div class="pro-chat-layout"><aside class="pro-chat-contacts"><div class="pro-chat-list-title">我的咨询 <span>${contacts.length}</span></div>${contacts.map(item => { const latest = ensureMessages(item.id).at(-1); return `<button type="button" class="pro-chat-contact ${item.id === active.id ? 'is-active' : ''}" data-chat-contact="${item.id}"><img src="${item.image}" alt=""><span><strong>${e(item.name)}</strong><small>${e(item.game)} · ${item.online ? '在线' : '可预约'}</small><em>${e(latest?.text || '')}</em></span><i class="pro-chat-dot ${item.online ? 'is-online' : ''}"></i></button>`; }).join('')}</aside>
          <section class="pro-chat-main"><div class="pro-chat-user"><img src="${active.image}" alt="${e(active.name)}"><div><strong>${e(active.name)}</strong><span>${availability(active)} · ${e(active.game)} · ${e(active.service)}</span></div><button type="button" class="pro-button" data-chat-order>去下单</button></div>
            <div class="pro-chat-messages" aria-live="polite">${messages.map(message => `<div class="pro-chat-message ${message.from === 'me' ? 'is-me' : ''}"><div class="pro-chat-bubble">${e(message.text).replace(/\n/g, '<br>')}</div><time>${new Date(message.at || Date.now()).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></div>`).join('')}</div>
            <form class="pro-chat-compose"><textarea name="message" rows="2" maxlength="500" placeholder="输入消息，说明游戏区服、时间或想要的陪玩方式" required></textarea><div><span>消息会保存在当前设备，方便继续沟通</span><button type="submit" class="pro-button primary">发送 ${icon('arrow', 14)}</button></div></form>
          </section></div></div>`;
      const messagesEl = dialog.querySelector('.pro-chat-messages'); if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
    };
    render(); document.body.append(dialog); document.body.classList.add('companion-modal-open'); dialog.showModal();
    dialog.addEventListener('click', event => {
      const target = event.target.closest('button'); if (!target) return;
      if (target.classList.contains('pro-close')) dialog.close();
      if (target.dataset.chatContact) { activeId = target.dataset.chatContact; render(); }
      if (target.hasAttribute('data-chat-order')) { dialog.close(); requestService(availableProfiles.find(item => item.id === activeId)); }
    });
    dialog.addEventListener('submit', event => {
      if (!event.target.matches('.pro-chat-compose')) return;
      event.preventDefault(); const input = event.target.elements.message; const text = input.value.trim(); if (!text) return;
      ensureMessages(activeId).push({ id: `message-${Date.now()}`, from: 'me', text, at: Date.now() }); saveChats(chats); render();
    });
    dialog.addEventListener('click', event => { if (event.target !== dialog) return; const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); });
    dialog.addEventListener('close', () => { dialog.remove(); document.body.classList.remove('companion-modal-open'); });
  }
  draw();
}
