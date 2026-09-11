import { escapeHtml as e, icon, loginMarkup } from './ui.js';
import { renderOwner, leaveOwner } from './owner.js';

const labels = { overview: '工作台', orders: '订单管理', dispatch: '派单台', conversations: '会话中心', escorts: '陪玩成员', catalog: '游戏与商品', topups: '充值审核', flows: '资金流水', settlements: '提现与结算', accounts: '成员与权限', availableOrders: '接单大厅', myOrders: '我的订单', myEarnings: '我的收益' };
const symbols = { overview: 'grid', orders: 'receipt', dispatch: 'trend', conversations: 'users', escorts: 'headset', catalog: 'game', topups: 'wallet', flows: 'trend', settlements: 'wallet', accounts: 'users', availableOrders: 'game', myOrders: 'receipt', myEarnings: 'wallet' };
const state = { workspace: null, page: 'overview', filter: '全部', query: '', busy: false };
const money = cents => `¥ ${(Number(cents || 0) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = value => value ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
const has = permission => state.workspace?.role.permissions.includes(permission);
const badge = status => `<span class="status ${['已完成','已通过','在线','启用'].includes(status) ? 'active' : ['待接单','待确认','待服务','陪玩中','待验收','待审核','待线下打款'].includes(status) ? 'warning' : 'muted'}"><i></i>${e(status)}</span>`;
const button = (action, text, id = '', primary = false, extra = '') => `<button class="${primary ? 'primary-action' : 'ghost-btn'}" data-action="${action}" data-id="${e(id)}" ${extra}>${text}</button>`;
const empty = message => `<div class="empty-state">${icon('receipt', 28)}<strong>${e(message)}</strong><span>新的业务动态会显示在这里</span></div>`;
const intro = (title, description, action = '') => `<section class="page-intro"><div><p class="eyebrow">星河游戏俱乐部 / ${e(state.workspace.user.roleLabel)}</p><h1>${title}</h1><p class="subline">${description}</p></div>${action}</section>`;
const metric = (title, value, note, tone, symbol) => `<article class="stat-card"><div class="stat-head">${e(title)}<span class="stat-icon ${tone}">${icon(symbol)}</span></div><div class="stat-value">${value}</div><div class="stat-foot">${e(note)}</div></article>`;
const panel = (title, sub, body, action = '') => `<article class="panel data-panel"><div class="panel-head"><div><h2>${title}</h2><p>${sub}</p></div>${action}</div>${body}</article>`;
const table = (headers, rows) => `<div class="table-scroll"><table class="business-table"><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${headers.length}">${empty('暂无记录')}</td></tr>`}</tbody></table></div>`;
const row = cells => `<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
function toast(message) {
  let el = document.querySelector('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.append(el); }
  el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 3500);
}
async function api(path, body) {
  let response;
  try { response = await fetch(`/api${path}`, { credentials: 'same-origin', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch { throw new Error('无法连接俱乐部服务，请检查服务是否已启动后重试'); }
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== '/login') { closeDialog(); state.workspace = null; renderLogin(); }
    throw Object.assign(new Error(result.error || '操作失败，请重试'), { status: response.status });
  }
  return result;
}
async function refresh(render = true) { state.workspace = await api('/workspace'); if (render) renderApp(); }
function navigate(page) {
  if(state.workspace?.user.role==='admin') page=({memberManagement:'clubMembers',accounts:'clubMembers',escorts:'clubEscorts'})[page]||page;
  if (!state.workspace?.role.pages.includes(page)) { page = 'overview'; toast('你没有访问该板块的权限'); }
  state.page = page; state.filter = '全部'; state.query = '';
  history.replaceState(null, '', `#/${page}`); renderApp();
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function renderLogin() {
  leaveOwner();
  state.workspace = null; history.replaceState(null, '', '#/login');
  document.querySelector('#app').innerHTML = loginMarkup();
  document.querySelector('#loginError').setAttribute('role', 'alert');
  document.querySelectorAll('.demo-account').forEach(el => el.onclick = () => {
    document.querySelector('#loginUsername').value = el.dataset.username;
    document.querySelector('#loginPassword').value = '123456';
    document.querySelectorAll('.demo-account').forEach(b => b.classList.toggle('selected', b === el));
    document.querySelector('#loginError').textContent = '';
  });
  document.querySelector('#loginForm').onsubmit = async event => {
    event.preventDefault(); const form = event.currentTarget; const submit = form.querySelector('button');
    if (submit.disabled) return;
    submit.disabled = true; submit.textContent = '正在验证身份…'; document.querySelector('#loginError').textContent = '';
    try {
      await api('/login', { username: document.querySelector('#loginUsername').value.trim(), password: document.querySelector('#loginPassword').value });
      await refresh(false); navigate('overview');
    } catch (error) { if (document.querySelector('#loginError')) document.querySelector('#loginError').textContent = error.message; }
    finally { submit.disabled = false; submit.textContent = '登录工作台 →'; }
  };
}
function renderApp() {
  const w = state.workspace; if (!w) return renderLogin();
  if (!w.role.pages.includes(state.page)) { state.page = 'overview'; history.replaceState(null, '', '#/overview'); }
  const u = w.user;
  if (u.role === 'admin') {
    renderOwner({ state, api, navigate, refresh, dialog, orderDetail, toast, legacyContent: pageContent });
    bindSharedActions();
    return;
  }
  leaveOwner();
  const sidebar = w.role.pages.map(p => `<button class="nav-item ${state.page === p ? 'active' : ''}" data-page="${p}" aria-label="${labels[p]}" ${state.page === p ? 'aria-current="page"' : ''}>${icon(symbols[p], 18)}<span>${labels[p]}</span>${p === 'dispatch' ? `<em>${w.orders.filter(o => o.status === '待接单').length}</em>` : ''}</button>`).join('');
  document.querySelector('#app').innerHTML = `<div class="shell role-shell"><aside class="sidebar"><div class="brand"><span class="brand-mark">C</span><span>clubhouse</span></div><div class="club-switch"><div class="club-avatar">星</div><div><strong>星河游戏俱乐部</strong><small>专属俱乐部工作空间</small></div></div><nav class="nav" aria-label="主导航"><div class="nav-label">${e(u.roleLabel)}工作台</div>${sidebar}</nav><div class="sidebar-footer"><div class="help-icon">✓</div><div><strong>职责清晰 · 协作有序</strong><small>仅显示当前账号授权的业务</small></div></div><div class="profile"><div class="avatar ${u.tone}">${e(u.name.slice(0, 1))}</div><div><strong>${e(u.name)}</strong><small>${e(u.roleLabel)}</small></div><button class="icon-btn logout-btn" data-action="logout" aria-label="退出登录">退出</button></div></aside><main class="main"><header class="topbar"><div class="crumb"><span>${e(u.roleLabel)}</span><b>/</b><strong id="pageTitle">${labels[state.page]}</strong></div><div class="top-actions"><div class="role-badge ${u.tone}">${icon(symbols[state.page], 14)} ${e(u.roleLabel)}</div><button class="ghost-btn" data-action="refresh">${icon('trend', 15)} 刷新</button>${u.role === 'escort' ? button('online', `${badge(u.online ? '在线' : '离线')}`) : has('order:create') ? button('newOrder', `${icon('plus', 15)} 新建订单`, '', true) : ''}</div></header><div class="content">${pageContent()}</div></main></div>`;
  bindSharedActions();
}
function bindSharedActions() {
  document.querySelectorAll('[data-page]').forEach(el => el.onclick = () => navigate(el.dataset.page));
  document.querySelectorAll('[data-action]').forEach(el => el.onclick = () => perform(el));
  document.querySelectorAll('[data-filter]').forEach(el => el.onclick = () => { state.filter = el.dataset.filter; renderApp(); });
  document.querySelector('#listSearch')?.addEventListener('input', event => {
    state.query = event.target.value;
    const query = state.query.trim().toLowerCase(); let count = 0;
    document.querySelectorAll('[data-searchable]').forEach(item => { const visible = item.textContent.toLowerCase().includes(query); item.hidden = !visible; if (visible) count++; });
    document.querySelector('#noSearchResults').hidden = count > 0 || !query;
  });
}
function pageContent() {
  const pages = { overview, orders: () => orderPage(false), myOrders: () => orderPage(true), dispatch: dispatchPage, availableOrders: availablePage, conversations: conversationPage, myEarnings: earningsPage, accounts: accountsPage, escorts: membersPage, catalog: catalogPage, flows: flowPage, topups: topupsPage, settlements: settlementsPage };
  return pages[state.page]();
}
function overview() {
  const w = state.workspace; const mine = w.user.role === 'escort';
  if(w.user.role==='finance') return intro('财务工作台','处理充值审核、资金流水与提现结算。') + `<section class="stats">${metric('待审核充值',w.topups.filter(t=>t.state==='待审核').length,'核实实际收款后入账','blue','wallet')}${metric('待审核提现',w.withdrawals.filter(t=>t.status==='待审核').length,'审核后安排线下打款','orange','receipt')}</section>` + panel('财务业务','按实际凭证核验',`<div class="owner-subnav"><button data-page="topups">充值审核</button><button data-page="flows">资金流水</button><button data-page="settlements">提现与结算</button></div>`);
  if(w.user.role==='member') return intro('我的成员信息','你已加入星河游戏俱乐部。') + panel('当前身份',w.user.roleLabel,`<p>成员：${e(w.user.name)}</p><p>用户ID：${e(w.user.memberNo)}</p><p>业务权限由俱乐部会长设置，开通陪玩后可使用接单功能。</p>`);
  const pending = w.orders.filter(o => ['待接单', '待确认', '待服务'].includes(o.status));
  const live = w.orders.filter(o => o.status === '陪玩中');
  const review = w.orders.filter(o => o.status === '待验收');
  const day = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  const stats = mine ? metric('可接订单', w.availableOrders.length, '匹配你的游戏项目', 'orange', 'game') + metric('我的待办', pending.length, '待确认或待开始服务', 'purple', 'receipt') + metric('可提现收益', money(w.wallet.balanceCents), '验收通过后入账', 'green', 'wallet') + metric('进行中的服务', live.length, '同一时段专心服务一单', 'blue', 'headset') : metric('待派单', w.orders.filter(o => o.status === '待接单').length, '已收款，等待匹配成员', 'orange', 'game') + metric('服务进行中', live.length, '及时跟进服务状态', 'purple', 'headset') + metric('完单待验收', review.length, '核验后计入成员收益', 'green', 'receipt') + metric('待跟进会话', w.conversations.filter(c => c.state !== '已结束').length, '客户咨询与售后记录', 'blue', 'users');
  return `<section class="welcome"><div><p class="eyebrow">${day}</p><h1>欢迎回来，${e(w.user.name)}<span>。</span></h1><p class="subline">${mine ? '你的接单、服务与收益，都在这里。' : '从客户咨询到服务验收，让每一单都有着落。'}</p></div><span class="workspace-tag">${mine ? '我的专属工作台' : '俱乐部运营概况'}</span></section><section class="stats">${stats}</section><section class="grid-row">${panel(mine ? '我的服务待办' : '需要跟进的订单', '按订单状态推进下一步', orderList([...review, ...live, ...pending].slice(0, 4), mine), `<button class="text-btn" data-page="${mine ? 'myOrders' : 'orders'}">查看全部 →</button>`)}${panel(mine ? '接单机会' : '协作流程', mine ? '只展示你支持的游戏' : '职责独立，订单信息同步', mine ? (w.availableOrders.slice(0, 3).map(o => `<div class="dispatch-mini-row"><div class="event-date ${o.tone || 'purple'}">${icon('game')}</div><div class="event-info"><strong>${e(o.game)} · ${e(o.product)}</strong><span>${o.hours} 小时 · ${money(o.amountCents)}</span></div><button class="text-btn" data-page="availableOrders">查看 →</button></div>`).join('') || empty('暂时没有匹配的新订单')) : `<div class="workflow"><div><b>01</b><strong>客服创建订单</strong><span>确认游戏、时长和收款</span></div><div><b>02</b><strong>匹配与确认接单</strong><span>按游戏技能匹配在线成员</span></div><div><b>03</b><strong>打手服务与完单</strong><span>记录服务过程，提交完单说明</span></div><div><b>04</b><strong>客服验收，收益入账</strong><span>管理员独立审核充值和提现</span></div></div>`)}</section>${panel('我的权限', '由俱乐部管理员统一分配', `<div class="permission-chips">${w.role.pages.map(p => `<span>${labels[p]}</span>`).join('')}</div>`)}`;
}
function orderList(list, mine) {
  if (!list.length) return empty('暂无待处理订单');
  return `<div class="order-list">${list.map(o => `<article class="order-line" data-searchable><div><div class="order-line-title"><strong>${e(o.game)} · ${e(o.product)}</strong>${badge(o.status)}</div><p>${e(o.id)} · ${e(o.boss)} · ${o.hours} 小时</p><small>${mine ? '我的预计分成 ' + money(myIncome(o)) : '陪玩：' + e(o.participants.map(p => p.name).join(' / ') || '待分配') + ' · 订单金额 ' + money(o.amountCents)}</small></div><div class="row-actions">${orderButtons(o, mine)}</div></article>`).join('')}</div>`;
}
function myIncome(order) { const p = order.participants.find(p => p.userId === state.workspace.user.id); return p?.earningCents ?? Math.round(order.amountCents * (p?.shareBps || 0) / 10000); }
function orderButtons(o, mine) {
  let actions = button('detail', '详情', o.id);
  if (mine) {
    const p = o.participants.find(p => p.userId === state.workspace.user.id);
    if (o.status === '待确认' && !p.accepted) actions += button('accept', '确认接单', o.id, true);
    if (['待确认', '待服务'].includes(o.status)) actions += button('reject', '退回', o.id);
    if (o.status === '待服务') actions += button('start', '开始服务', o.id, true);
    if (o.status === '陪玩中' && !p.finished) actions += button('finish', '提交完单', o.id, true);
    if (p.finished && o.status === '陪玩中') actions += '<span class="muted-text">等待其他成员完单</span>';
  } else {
    if (o.status === '待接单') actions += button('dispatch', '派单', o.id, true);
    if (o.status === '待验收') actions += button('review', '验收订单', o.id, true);
  }
  return actions;
}
function orderPage(mine) {
  const statuses = ['全部', '待接单', '待确认', '待服务', '陪玩中', '待验收', '已完成', '退款审核'].filter(s => !mine || s !== '待接单');
  const orders = state.workspace.orders.filter(o => state.filter === '全部' || o.status === state.filter);
  return intro(mine ? '我的订单' : '订单管理', mine ? '只显示分配给你的订单；完单后由客服验收，收益按接单时的分成计算。' : '创建、派单、服务、验收，完整记录每一步。') + `<div class="filter-strip"><div class="filter-tabs">${statuses.map(s => `<button data-filter="${s}" class="${s === state.filter ? 'active' : ''}">${s} <b>${state.workspace.orders.filter(o => s === '全部' || o.status === s).length}</b></button>`).join('')}</div></div>${panel(mine ? '我的服务记录' : '俱乐部订单', `共 ${orders.length} 笔`, `<label class="list-search">${icon('search', 16)}<input id="listSearch" type="search" placeholder="搜索订单号、老板、游戏" aria-label="搜索订单" value="${e(state.query)}"></label>${orderList(orders, mine)}<div id="noSearchResults" class="empty-state" hidden>没有找到匹配的订单</div>`)}`;
}
function dispatchPage() {
  const queue = state.workspace.orders.filter(o => o.status === '待接单').sort((a,b) => a.createdAt.localeCompare(b.createdAt));
  return intro('派单台', '优先处理等待较久的订单。成员需在线、未冻结、支持该游戏，且等级不低于订单要求。') + `<div class="dispatch-page-list">${queue.map(o => `<article class="panel dispatch-card"><div class="dispatch-card-top"><div><span class="flow-id">${e(o.id)}</span><h2>${e(o.game)} · ${e(o.product)}</h2><p>${e(o.boss)} · ${e(o.requirement)}</p></div>${badge('待接单')}</div><div class="dispatch-card-meta"><span>订单金额<strong>${money(o.amountCents)}</strong></span><span>服务时长<strong>${o.hours} 小时</strong></span><span>可选成员<strong>${eligible(o).length} 人</strong></span></div>${button('dispatch', '选择成员并派单 →', o.id, true)}</article>`).join('') || empty('派单队列已处理完毕')}</div>`;
}
function eligible(order) { const w=state.workspace; const rank=id=>w.levels.find(l=>l.id===id)?.rank||0; return w.members.filter(m => m.active && !m.escortFrozen && m.online && m.games.includes(order.game) && rank(m.levelId)>=rank(order.levelId)); }
function availablePage() {
  const w = state.workspace;
  return intro('接单大厅', '根据你的游戏技能和等级展示订单，可接本级及以下订单。接单后进入我的订单，已有服务未结束时无法开始另一单。', button('online', w.user.online ? '在线接单中 · 点击休息' : '当前离线 · 上线接单')) + `<div class="available-order-grid">${w.availableOrders.map(o => `<article class="panel available-order-card" data-searchable><div class="available-order-top"><span class="event-date ${o.tone || 'purple'}">${icon('game', 20)}</span>${badge('待接单')}</div><h2>${e(o.game)} · ${e(o.product)}</h2><p>${e(o.requirement)}</p><div class="available-order-meta"><span>${o.hours} 小时 · ${e(o.boss)}</span><strong>${money(o.amountCents)}</strong></div><small class="muted-text">${e(o.levelName)}及以上 · 预计分成 ${o.expectedShareBps/100}%</small>${button('claim', '查看并接单 →', o.id, true, w.user.online ? '' : 'disabled title="请先切换为在线"')}</article>`).join('') || empty('暂无与你的游戏技能匹配的订单')}</div>`;
}
function conversationPage() {
  return intro('会话中心', '查看客户咨询与售后记录，记录跟进结果。') + panel('客户会话', '历史会话与人工跟进记录', `<div class="conversation-full-list">${state.workspace.conversations.map(c => `<div class="conversation-full-row"><div class="mini-avatar orange">${e(c.boss.slice(0, 1))}</div><div class="conversation-body"><div><strong>${e(c.boss)}</strong><span class="channel-tag">${e(c.channel)}</span>${c.unread ? `<em class="unread">${c.unread} 条待跟进</em>` : ''}</div><p>${e(c.last)}</p></div><div class="conversation-meta">${badge(c.state)}${button('conversation', '查看会话', c.id)}</div></div>`).join('')}</div>`);
}
function earningsPage() {
  const w = state.workspace;
  return intro('我的收益', '订单验收后入账。提现申请会冻结对应金额，审核驳回后返还。', button('withdraw', '申请提现', '', true)) + `<section class="stats">${metric('可提现金额', money(w.wallet.balanceCents), '已入账，可申请提现', 'purple', 'wallet')}${metric('提现审核中', money(w.wallet.frozenCents), '已从可提现金额中冻结', 'orange', 'receipt')}${metric('服务待验收', money(w.orders.filter(o => o.status === '待验收').reduce((a,o) => a + myIncome(o), 0)), '验收前不计入可提现余额', 'blue', 'trend')}${metric('当前押金', money(w.wallet.depositCents), '提现要求押金至少 ¥1,000', 'green', 'wallet')}</section>` + panel('我的资金明细', '仅包含当前成员的账户变动', ledgerTable(w.ledger)) + panel('我的提现申请', '审核通过后等待俱乐部线下打款', withdrawalTable(w.withdrawals, false));
}
function ledgerTable(list) { return table(['时间', '账户', '业务', '变动金额', '变动后余额', '关联单号'], list.map(l => row([date(l.at), e(l.account), e(l.label), `<strong class="${l.deltaCents < 0 ? 'negative' : 'positive'}">${l.deltaCents > 0 ? '+' : '−'} ${money(Math.abs(l.deltaCents))}</strong>`, money(l.afterCents), e(l.source)]))); }
function withdrawalTable(list, review) { return table(['申请单号', '成员', '金额', '状态', '申请时间', '操作'], list.map(w => row([e(w.id), e(w.name), money(w.amountCents), badge(w.status), date(w.at), review && w.status === '待审核' ? button('withdrawReview', '审核', w.id) : e(w.reason || '—')]))); }
function accountsPage() {
  return intro('成员与权限', '成员只属于星河游戏俱乐部。调整职责或停用账号后，已有登录会话立即失效。', button('newAccount', '新增成员账号', '', true)) + `<section class="role-matrix"><article><span class="role-badge purple">最高负责人</span><p>俱乐部业务、财务审核、成员与权限配置</p></article><article><span class="role-badge orange">客服</span><p>订单、会话、派单、完单验收</p></article><article><span class="role-badge green">打手</span><p>接单、本人订单、本人收益与提现申请</p></article></section>` + panel('俱乐部账号', '账号职责由管理员分配，成员登录时无需选择', table(['成员', '账号', '职责', '状态', '游戏技能', '操作'], state.workspace.accounts.map(u => row([e(u.name), e(u.username), `<span class="role-badge ${u.tone}">${e(u.roleLabel)}</span>`, badge(u.active ? '启用' : '停用'), e(u.games.join(' / ') || '—'), button('editAccount', '编辑权限', u.id)]))));
}
function membersPage() { return intro('陪玩成员', '查看成员在线状态、支持的游戏与默认分成。订单按派单时的分成比例留存。', has('account:manage') ? button('accounts', '管理成员与权限') : '') + panel('陪玩档案', `共 ${state.workspace.members.length} 位成员`, table(['成员', '账号状态', '接单状态', '游戏技能', '基础分成', '操作'], state.workspace.members.map(m => row([e(m.name), badge(m.active ? '启用' : '停用'), badge(m.online ? '在线' : '离线'), e(m.games.join(' / ')), `${m.shareBps / 100}%`, has('account:manage') ? button('editAccount', '编辑', m.id) : '只读'])))); }
function catalogPage() {
  const w = state.workspace;
  return intro('游戏与商品', '游戏维护时不可新建订单或接单；派单会校验人数边界和游戏分成倍率。') + panel('游戏配置', '当前俱乐部的游戏服务范围', table(['游戏', '分成倍率', '陪玩人数', '状态'], w.games.map(g => row([e(g.name), e(g.multiplier), `${g.min}–${g.max} 人`, badge(g.state)])))) + panel('服务商品', '价格 = 商品单价 × 服务时长', table(['商品', '游戏', '单价', '状态'], w.products.map(p => row([e(p.name), e(p.game), `${money(p.priceCents)} / 小时`, badge(p.state)]))));
}
function flowPage() { return intro('资金流水', '记录订单消费、充值入账、完单分成与提现冻结，资金变动与业务单号关联。') + panel('账户变动记录', '本次系统启用后的实际操作流水', ledgerTable(state.workspace.ledger)); }
function topupsPage() { return intro('充值审核', '充值审核通过后才更新老板余额，同一笔充值只能入账一次。') + panel('充值申请', '请根据实际收款凭证核验后审核', table(['充值单号', '老板', '金额', '充值前余额', '充值后余额', '状态', '操作'], state.workspace.topups.map(t => row([e(t.id), e(t.user), e(t.amount), e(t.before), t.state === '已通过' ? e(t.after) : '待审核后计算', badge(t.state), t.state === '待审核' ? button('topupReview', '审核', t.id) : e(t.proof)])))); }
function settlementsPage() { return intro('提现与结算', '独立复核成员提现申请。通过审核后待线下打款，不代表已经付款。') + panel('成员提现申请', '可提现余额已在申请时冻结', withdrawalTable(state.workspace.withdrawals, true)) + panel('历史结算批次', '参考项目中的历史示例记录', table(['批次', '周期', '成员数', '金额', '状态'], state.workspace.settlements.map(s => row([e(s.id), e(s.period), s.escorts, e(s.amount), badge(s.state)])))); }

function closeDialog() { document.querySelector('#actionDialog')?.remove(); }
function dialog(title, body, submit, onSubmit, secondary = '') {
  closeDialog();
  const el = document.createElement('dialog'); el.id = 'actionDialog';
  el.innerHTML = `<form id="actionForm"><div class="dialog-head"><h2 id="dialogTitle">${e(title)}</h2><button type="button" class="icon-btn close-dialog" aria-label="关闭弹窗">×</button></div><div class="dialog-body">${body}</div><p class="form-error" role="alert" id="actionError"></p><div class="dialog-actions">${secondary}<button type="button" class="ghost-btn close-dialog">关闭</button>${submit ? `<button type="submit" class="primary-action">${submit}</button>` : ''}</div></form>`;
  el.setAttribute('aria-labelledby', 'dialogTitle'); document.body.append(el); el.showModal();
  el.querySelectorAll('.close-dialog').forEach(b => b.onclick = closeDialog);
  el.addEventListener('click', event => { if (event.target === el) closeDialog(); });
  el.querySelector('form').onsubmit = async event => {
    event.preventDefault(); const btn = event.submitter; if (btn?.disabled) return;
    if (btn) btn.disabled = true;
    el.querySelector('#actionError').textContent = '';
    try { await onSubmit(new FormData(event.currentTarget)); closeDialog(); await refresh(); toast('操作成功，业务状态已更新'); }
    catch (error) { const errorBox = el.querySelector('#actionError'); if (errorBox) errorBox.textContent = error.message; if (error.status === 409) await refresh(); }
    finally { if (btn) btn.disabled = false; }
  };
  el.querySelectorAll('[data-dialog-action]').forEach(b => b.onclick = async () => { b.disabled = true; try { await onSubmit(new FormData(el.querySelector('form')), b.dataset.dialogAction); closeDialog(); await refresh(); toast('已更新'); } catch (error) { el.querySelector('#actionError').textContent = error.message; } finally { b.disabled = false; } });
  return el;
}
const field = (label, name, type = 'text', value = '', attributes = '') => `<label class="form-field">${label}<input name="${name}" type="${type}" value="${e(value)}" ${attributes} required></label>`;
const textarea = (label, name, placeholder = '') => `<label class="form-field">${label}<textarea name="${name}" rows="3" placeholder="${placeholder}" maxlength="1000" required></textarea></label>`;
function getOrder(id) { return [...(state.workspace.orders || []), ...(state.workspace.availableOrders || [])].find(o => o.id === id); }
async function updateOrder(order, action, input = {}) { return api(`/orders/${order.id}/${action}`, { ...input, version: order.version }); }
function orderDetail(o) {
  const mine = state.workspace.user.role === 'escort';
  return `<div class="detail-grid"><div><span>订单编号</span><strong>${e(o.id)}</strong></div><div><span>当前状态</span>${badge(o.status)}</div><div><span>老板</span><strong>${e(o.boss)}</strong></div><div><span>游戏商品</span><strong>${e(o.game)} · ${e(o.product)}</strong></div><div><span>订单等级</span><strong>${e(o.levelName||'金牌')}及以上</strong></div><div><span>服务时长</span><strong>${o.hours} 小时</strong></div><div><span>订单总额</span><strong>${money(o.amountCents)}</strong></div>${mine ? `<div><span>我的预计分成</span><strong>${money(myIncome(o))}</strong></div>` : `<div><span>支付方式</span><strong>${e(o.pay)}</strong></div>`}</div><p class="detail-note">服务要求：${e(o.requirement)}</p><h3>服务成员</h3>${o.participants.map(p => `<div class="detail-note"><strong>${e(p.name)}</strong> · ${p.accepted ? '已接单' : '待确认'} · ${p.finished ? '已提交完单' : '待完成'}${!mine || p.userId === state.workspace.user.id ? ` · 分成 ${p.shareBps / 100}%` : ''}${p.evidence ? `<p>完单说明：${e(p.evidence)}</p>` : ''}</div>`).join('') || '<p class="muted-text">等待派单</p>'}<h3>订单记录</h3><div class="timeline">${o.history.map(h => `<div><i></i><strong>${e(h.action)}</strong><small>${e(h.by)} · ${date(h.at)}</small>${h.note ? `<p>${e(h.note)}</p>` : ''}</div>`).join('')}</div>`;
}
async function perform(el) {
  if (el.disabled || state.busy) return;
  const { action, id } = el.dataset;
  const w = state.workspace; const o = getOrder(id);
  try {
    if (action === 'logout') { await api('/logout', {}); closeDialog(); renderLogin(); return; }
    if (action === 'refresh') { state.busy = true; await refresh(); toast('已获取最新业务状态'); return; }
    if (action === 'accounts') return navigate('accounts');
    if (action === 'online') { state.busy = true; await api('/online', { online: !w.user.online }); await refresh(); toast(state.workspace.user.online ? '已上线，可以接单' : '已休息，暂不接新单'); return; }
    if (action === 'detail') return dialog('订单详情', orderDetail(o));
    if (action === 'claim') return dialog('确认接单', `<p>接下 ${e(o.boss)} 的「${e(o.game)} · ${e(o.product)}」订单？</p><p>${o.hours} 小时 · 订单总额 <strong>${money(o.amountCents)}</strong></p><p>我的分成 ${o.expectedShareBps / 100}% · 预计到手 <strong>${money(o.expectedIncomeCents)}</strong></p><p>${e(o.requirement)}</p><p class="detail-note">分成按陪玩等级计算，接单后锁定。开始服务前请确认可服务时间。</p>`, '确认接单', () => updateOrder(o, 'accept'));
    if (action === 'accept') return dialog('确认派单', orderDetail(o), '确认接单', () => updateOrder(o, 'accept'));
    if (action === 'start') return dialog('开始服务', `<p>确认开始 ${e(o.game)} 的 ${o.hours} 小时服务？</p><p class="detail-note">开始后将记录服务时间。同一成员不能同时开始其他订单。</p>`, '开始服务', () => updateOrder(o, 'start'));
    if (action === 'finish') return dialog('提交完单', `<p>${e(o.id)} · ${e(o.game)}</p>${textarea('完单说明', 'evidence', '请记录服务内容、完成情况及需要客服核验的信息（至少 5 个字符）')}<p class="detail-note">由客服验收后入账，提交不会直接增加可提现余额。</p>`, '提交验收', form => updateOrder(o, 'finish', { evidence: form.get('evidence') }));
    if (action === 'reject') return dialog('退回派单池', textarea('退回原因', 'reason', '说明无法服务的原因，客服将重新匹配成员'), '确认退回', form => updateOrder(o, 'reject', { reason: form.get('reason') }));
    if (action === 'review') return dialog('完单验收', orderDetail(o) + '<label class="form-field">验收备注 / 退回原因<textarea name="reason" rows="2" maxlength="200"></textarea></label>', '验收通过并入账', (form, secondary) => updateOrder(o, secondary === 'return' ? 'return' : 'approve', { reason: form.get('reason') }), '<button type="button" class="ghost-btn" data-dialog-action="return">退回补充</button>');
    if (action === 'dispatch') {
      const candidates = eligible(o); const game = w.games.find(g => g.name === o.game);
      const html = `<p>${e(o.id)} · ${e(o.game)} · ${money(o.amountCents)}</p><p class="detail-note">${e(o.requirement)}<br>订单要求：${e(o.levelName)}及以上。选择 ${game.min}–${game.max} 位成员，每人的等级分成除以参与人数后锁定。</p><div class="candidate-list">${candidates.map(m => `<label><input type="checkbox" name="memberIds" value="${e(m.id)}"><span class="mini-avatar green">${e(m.name.slice(0,1))}</span><span><strong>${e(m.name)}</strong><small>${e(w.levels.find(l=>l.id===m.levelId)?.name)} · ${e(m.games.join(' / '))}</small></span><b>${m.shareBps/100}% / 人数</b></label>`).join('') || empty('暂无符合条件的在线成员')}</div>`;
      return dialog('选择陪玩成员', html, candidates.length ? '确认派单' : '', form => updateOrder(o, 'dispatch', { memberIds: form.getAll('memberIds') }));
    }
    if (action === 'newOrder') {
      const products = w.products.filter(p => p.state === '启用' && w.games.some(g => g.name === p.game && g.state === '上架'));
      const form = dialog('新建陪玩订单', `${field('老板称呼', 'boss', 'text', '', 'maxlength="30" list="customerList"')}<datalist id="customerList">${w.customers.map(c => `<option value="${e(c.name)}">余额 ${money(c.balanceCents)}</option>`).join('')}</datalist><label class="form-field">游戏商品<select name="productId">${products.map(p => `<option value="${p.id}">${e(p.game)} · ${e(p.name)} · ${money(p.priceCents)}/小时</option>`).join('')}</select></label><label class="form-field">订单等级<select name="levelId">${w.levels.map(l=>`<option value="${l.id}" ${l.id==='gold'?'selected':''}>${l.name}及以上</option>`).join('')}</select></label>${field('服务时长（小时）','hours','number',1,'min="0.5" max="24" step="0.5"')}<div class="form-total">订单金额 <strong id="orderQuote"></strong></div><label class="form-field">支付方式<select name="pay"><option>线下已收款</option><option>余额支付</option></select></label><label class="form-field">Tag 标签（可选，用逗号分隔）<input name="tags" maxlength="240" placeholder="例如：娱乐、上分、新人"></label>${textarea('服务要求', 'requirement', '例如：开麦沟通、游戏区服、服务时间和段位要求')}<p class="detail-note">选择“线下已收款”表示客服已经核实收款；余额支付会即时扣减老板余额。</p>`, '创建订单', data => api('/orders', Object.fromEntries(data)));
      const quote = () => { const p = products.find(p => p.id === form.querySelector('[name=productId]').value); form.querySelector('#orderQuote').textContent = money((p?.priceCents || 0) * Number(form.querySelector('[name=hours]').value)); }; form.addEventListener('input', quote); quote(); return;
    }
    if (action === 'conversation') {
      const chat = w.conversations.find(c => c.id === id);
      await api(`/conversations/${id}`, {}); await refresh();
      return dialog(`${chat.boss} · 会话记录`, `<span class="channel-tag">${e(chat.channel)}历史记录</span><div class="chat-messages">${chat.messages.map(m => `<div><strong>${e(m.author)}</strong><p>${e(m.text)}</p></div>`).join('')}</div><h3>客服跟进记录</h3>${chat.notes.map(n => `<div class="detail-note">${e(n.text)}<small>${e(n.author)} · ${date(n.at)}</small></div>`).join('') || '<p class="muted-text">暂无跟进记录</p>'}${textarea('新增跟进记录', 'note', '记录已沟通的结果、改派安排或退款进展')}<label class="form-field">跟进状态<select name="state"><option value="处理中">处理中</option><option value="已结束">已结束</option></select></label><p class="detail-note">这里保存俱乐部内部跟进记录；客户消息渠道尚未连接。</p>`, '保存跟进', form => api(`/conversations/${id}`, Object.fromEntries(form)));
    }
    if (action === 'withdraw') return dialog('申请提现', `<p>当前可提现 <strong>${money(w.wallet.balanceCents)}</strong></p>${field('提现金额（元）','amount','number','','min="1" step="0.01" max="'+w.wallet.balanceCents/100+'"')}<p class="detail-note">提交后冻结申请金额。管理员审核通过后安排线下打款。</p>`, '提交申请', form => api('/withdrawals', { amount: form.get('amount') }));
    if (action === 'withdrawReview' || action === 'topupReview') {
      const isTopup = action === 'topupReview'; const item = (isTopup ? w.topups : w.withdrawals).find(t => t.id === id);
      return dialog(isTopup ? '充值凭证审核' : '提现审核', `<p>${e(item.id)} · ${e(item.user || item.name)} · <strong>${money(item.amountCents)}</strong></p>${textarea(isTopup ? '收款核验说明 / 驳回原因' : '审核说明 / 驳回原因', 'reason', '请填写核验结果')}<p class="detail-note">${isTopup ? '确认实际收到款项后再通过，系统会更新余额并记录流水。' : '通过后变为待线下打款；驳回会返还冻结金额。'}</p>`, isTopup ? '确认通过并入账' : '通过 · 待线下打款', (form, secondary) => api(`/${isTopup ? 'topups' : 'withdrawals'}/${id}`, { action: secondary === 'reject' ? 'reject' : 'approve', reason: form.get('reason') }), '<button type="button" class="ghost-btn" data-dialog-action="reject">驳回</button>');
    }
    if (action === 'newAccount' || action === 'editAccount') {
      const u = w.accounts.find(u => u.id === id) || { name: '', role: 'escort', active: true, games: [], shareBps: 7000 };
      const form = dialog(id ? '编辑成员权限' : '新增成员账号', `${field('成员名称','name','text',u.name,'maxlength="30"')}${id ? `<p class="detail-note">账号：${e(u.username)}</p>` : field('登录账号','username','text','','minlength="3" maxlength="30" pattern="[a-zA-Z0-9_]+" autocomplete="off"') + field('初始密码','password','password','','minlength="8" maxlength="128" autocomplete="new-password"')}<label class="form-field">职责<select name="role"><option value="admin">最高负责人</option><option value="service">客服</option><option value="escort">打手</option></select></label><label class="form-field">账号状态<select name="active"><option value="true">启用</option><option value="false">停用</option></select></label><div id="escortFields"><h3>支持的游戏</h3><div class="game-checkboxes">${w.games.map(g => `<label><input type="checkbox" name="games" value="${e(g.name)}" ${u.games.includes(g.name) ? 'checked' : ''}>${e(g.name)}</label>`).join('')}</div>${field('基础分成（%）','share','number',u.shareBps/100,'min="0" max="100" step="0.01"')}</div><p class="detail-note">停用或调整职责会使该成员已有会话失效；新打手初始为离线。</p>`, '保存成员', data => api(`/accounts${id ? '/'+id : ''}`, { ...Object.fromEntries(data), active: data.get('active') === 'true', games: data.getAll('games'), shareBps: Math.round(Number(data.get('share')) * 100) }));
      form.querySelector('[name=role]').value = u.role; form.querySelector('[name=active]').value = String(u.active);
      const change = () => { const isEscort = form.querySelector('[name=role]').value === 'escort'; form.querySelector('#escortFields').hidden = !isEscort; form.querySelector('[name=share]').required = isEscort; }; form.querySelector('[name=role]').onchange = change; change(); return;
    }
  } catch (error) { toast(error.message); }
  finally { state.busy = false; }
}
window.addEventListener('hashchange', () => { if (state.workspace) navigate(location.hash.slice(2)); });
window.addEventListener('pageshow', event => { if (event.persisted) boot(); });
async function boot() {
  const desired = location.hash.slice(2);
  document.querySelector('#app').innerHTML = '<div class="loading-screen"><span class="brand-mark">C</span><p>正在载入俱乐部工作台…</p></div>';
  try { await refresh(false); navigate(state.workspace.role.pages.includes(desired) ? desired : 'overview'); }
  catch (error) {
    if (error.status === 401) renderLogin();
    else { document.querySelector('#app').innerHTML = `<div class="loading-screen"><h1>暂时无法连接俱乐部</h1><p>${e(error.message)}</p><button class="primary-action" id="retryBoot">重新连接</button></div>`; document.querySelector('#retryBoot').onclick = boot; }
  }
}
boot();
