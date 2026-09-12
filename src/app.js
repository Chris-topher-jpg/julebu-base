import { escapeHtml as e, icon, loginMarkup } from './ui.js';
import { renderOwner, leaveOwner } from './owner.js';
import { mountCompanions } from './companions.js';
import { parseRoute, resolveRoute } from './routes.js';

const labels = { overview: '工作台', serviceManagement: '客服管理', examinerCandidates: '考核与质检', orders: '订单管理', dispatch: '派单台', conversations: '会话中心', escorts: '陪玩成员', catalog: '游戏与商品', topups: '充值审核', flows: '资金流水', settlements: '提现与结算', accounts: '成员与权限', availableOrders: '接单大厅', myOrders: '我的订单', myEarnings: '我的收益', memberOrders: '我的点单', memberAfterSales: '售后记录' };
const symbols = { overview: 'grid', serviceManagement:'headset', examinerCandidates:'users', orders: 'receipt', dispatch: 'trend', conversations: 'users', escorts: 'headset', catalog: 'game', topups: 'wallet', flows: 'trend', settlements: 'wallet', accounts: 'users', availableOrders: 'game', myOrders: 'receipt', myEarnings: 'wallet', memberOrders: 'receipt', memberAfterSales: 'headset' };
const state = { workspace: null, mode: 'public', page: 'overview', filter: '全部', query: '', busy: false };
const money = cents => `¥ ${(Number(cents || 0) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = value => value ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
const has = permission => state.workspace?.role.permissions.includes(permission);
const badge = status => `<span class="status ${['已完成','已通过','已打款','在线','启用'].includes(status) ? 'active' : ['待接单','待确认','待服务','陪玩中','待验收','待审核','待线下打款','退款审核'].includes(status) ? 'warning' : 'muted'}"><i></i>${e(status)}</span>`;
const button = (action, text, id = '', primary = false, extra = '') => `<button class="${primary ? 'primary-action' : 'ghost-btn'}" data-action="${action}" data-id="${e(id)}" ${extra}>${text}</button>`;
const empty = message => `<div class="empty-state">${icon('receipt', 28)}<strong>${e(message)}</strong><span>新的业务动态会显示在这里</span></div>`;
const intro = (title, description, action = '') => `<section class="page-intro"><div><p class="eyebrow">星河游戏俱乐部 / ${e(state.workspace.user.roleLabel)}</p><h1>${title}</h1><p class="subline">${description}</p></div>${action}</section>`;
const metric = (title, value, note, tone, symbol) => `<article class="stat-card"><div class="stat-head">${e(title)}<span class="stat-icon ${tone}">${icon(symbol)}</span></div><div class="stat-value">${value}</div><div class="stat-foot">${e(note)}</div></article>`;
const panel = (title, sub, body, action = '') => `<article class="panel data-panel"><div class="panel-head"><div><h2>${title}</h2><p>${sub}</p></div>${action}</div>${body}</article>`;
const table = (headers, rows) => `<div class="table-scroll"><table class="business-table"><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${headers.length}">${empty('暂无记录')}</td></tr>`}</tbody></table></div>`;
const row = (cells, attrs = '') => `<tr ${attrs}>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
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
    if (response.status === 401 && !['/login', '/register'].includes(path)) { closeDialog(); state.workspace = null; renderLogin(); }
    throw Object.assign(new Error(result.error || '操作失败，请重试'), { status: response.status });
  }
  return result;
}
async function refresh(render = true) { state.workspace = await api(state.mode === 'management' ? '/workspace' : '/me'); if (render) renderApp(); }
const route = page => `#/${state.mode}/${page}`;
async function switchWorkspace(mode, page = 'overview') {
  ({ mode, page } = resolveRoute(mode, page));
  const workspace = await api(mode === 'management' ? '/workspace' : '/me');
  closeDialog(); leaveOwner(); state.mode = mode; state.workspace = workspace;
  navigate(page);
}
function navigate(page) {
  if(state.workspace?.user.role==='admin') page=({memberManagement:'clubMembers',accounts:'clubMembers',escorts:'clubEscorts'})[page]||page;
  if (!state.workspace?.role.pages.includes(page)) { page = 'overview'; toast('你没有访问该板块的权限'); }
  if (resolveRoute(state.mode, page).mode === 'public') return renderPublicHome(state.workspace);
  state.page = page; state.filter = '全部'; state.query = '';
  closeDialog(); history.replaceState(null, '', route(page)); renderApp();
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function renderLogin() {
  leaveOwner();
  state.workspace = null; state.mode = 'public';
  if (!['#games', '#members', '#rules'].includes(location.hash)) history.replaceState(null, '', '#/');
  document.querySelector('#app').innerHTML = loginMarkup();
  enhancePublicHome();
  const dialog = document.querySelector('#authDialog');
  const form = document.querySelector('#loginForm');
  form.innerHTML = `<button class="auth-close" type="button" data-action="closeLogin" aria-label="关闭登录弹窗">×</button><div class="auth-dialog-head"><div class="login-logo">${icon('game', 21)}</div><strong>星河游戏俱乐部</strong></div><h2 id="authTitle">手机号登录</h2><p class="login-subtitle">登录后查看订单进度、收藏账号和报价提醒</p><label>手机号<input id="loginUsername" autocomplete="tel" inputmode="tel" placeholder="请输入手机号" required minlength="3" maxlength="30"></label><label id="passwordField">密码<input id="loginPassword" type="password" autocomplete="current-password" placeholder="请输入密码" required maxlength="128"></label><label id="codeField" hidden>手机验证码<div class="code-input-row"><input id="loginCode" inputmode="numeric" placeholder="请输入 6 位验证码" maxlength="6"><button type="button" id="sendCode">获取验证码</button></div></label><button class="login-submit" type="submit" id="authSubmit">登录 / 注册 ${icon('arrow',16)}</button><p class="login-error" id="loginError" role="alert"></p><button class="auth-switch" type="button" id="authModeToggle">验证码登录</button><p class="auth-tip">未注册手机号登录后将自动创建账号</p>`;
  let verificationMode = false;
  const setAuthMode = value => {
    verificationMode = value;
    document.querySelector('#codeField').hidden = !value;
    document.querySelector('#passwordField').hidden = value;
    document.querySelector('#loginPassword').required = !value;
    document.querySelector('#loginCode').required = value;
    document.querySelector('#authTitle').textContent = value ? '验证码登录' : '手机号登录';
    document.querySelector('#authModeToggle').textContent = value ? '密码登录' : '验证码登录';
    document.querySelector('#loginError').textContent = '';
  };
  const openLogin = event => { event?.preventDefault(); setAuthMode(false); dialog?.showModal(); document.querySelector('#loginUsername')?.focus(); };
  document.querySelectorAll('[data-action="openLogin"]').forEach(el => el.onclick = openLogin);
  document.querySelector('[data-action="closeLogin"]')?.addEventListener('click', () => dialog?.close());
  dialog?.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  const toggle = document.querySelector('#authModeToggle');
  toggle?.addEventListener('click', () => setAuthMode(!verificationMode));
  document.querySelector('#sendCode')?.addEventListener('click', () => {
    const phone = document.querySelector('#loginUsername').value.trim();
    if (!phone) { document.querySelector('#loginError').textContent = '请先输入手机号'; return; }
    document.querySelector('#loginCode').value = '123456';
    document.querySelector('#loginError').textContent = '演示验证码已填入：123456';
  });
  const loginFoot = document.querySelector('.login-card-foot span');
  if (loginFoot) loginFoot.textContent = '首次使用？登录后自动创建账号';
  setAuthMode(false);
  document.querySelector('#loginError').setAttribute('role', 'alert');
  document.querySelector('#loginForm').onsubmit = async event => {
    event.preventDefault(); const form = event.currentTarget; const submit = document.querySelector('#authSubmit');
    if (submit.disabled) return;
    submit.disabled = true; submit.textContent = '正在验证身份…'; document.querySelector('#loginError').textContent = '';
    try {
      const code = document.querySelector('#loginCode')?.value.trim();
      if (verificationMode && code !== '123456') throw new Error('演示验证码为 123456');
      const username = document.querySelector('#loginUsername').value.trim();
      const password = verificationMode ? '123456' : document.querySelector('#loginPassword').value;
      try {
        await api('/login', { username, password });
      } catch (error) {
        // Public login doubles as registration for new accounts. Keep existing
        // staff/demo credentials on the normal login path and only register
        // when the supplied password meets the server's account requirements.
        if (error.status !== 401 || verificationMode || password.length < 8) throw error;
        await api('/register', { username, password, name: username });
      }
      dialog?.close();
      const personal = await api('/me');
      renderPublicHome(personal);
    } catch (error) { if (document.querySelector('#loginError')) document.querySelector('#loginError').textContent = error.message; }
    finally { submit.disabled = false; submit.innerHTML = `登录 / 注册 ${icon('arrow', 16)}`; }
  };
}
function enhancePublicHome() {
  const home = document.querySelector('.public-home');
  if (!home || home.dataset.enhanced === 'true') return;
  home.dataset.enhanced = 'true';
  const links = [...home.querySelectorAll('.public-nav nav a')];
  const markNavigation = hash => links.forEach(link => {
    if (link.hash === hash) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
  links.forEach(link => link.addEventListener('click', () => markNavigation(link.hash)));
  const section = ['#games', '#members', '#rules'].includes(location.hash) ? location.hash : '#games';
  markNavigation(section);
  const online = home.querySelector('.public-online');
  if (online) online.textContent = '星河陪玩';
  const members = home.querySelector('#members');
  if (members) mountCompanions(members, { requestService: () => {
    if (state.workspace?.user) {
      switchWorkspace('personal', 'placeOrder');
      return;
    }
    home.querySelector('.nav-login-link[data-action="openLogin"]')?.click();
  } });
  const footer = home.querySelector('.public-footer'); footer?.removeAttribute('id');
  if (!home.querySelector('#rules')) {
    const section = document.createElement('section'); section.className = 'guarantee-section'; section.id = 'rules';
    section.innerHTML = `<div class="section-heading"><div><span>服务保障</span><h1>每一单，都有清晰的进度和依据</h1><p class="section-caption">从支付到售后，平台记录关键节点，遇到问题可以随时追踪处理。</p></div><button class="filter-button" type="button" data-action="openLogin">开始下单 ${icon('arrow', 14)}</button></div><div class="guarantee-grid"><article class="guarantee-item"><span class="guarantee-icon blue">${icon('lock', 21)}</span><div><h3>支付托管</h3><p>支付成功后平台暂存订单金额，服务验收通过再进入结算。</p></div></article><article class="guarantee-item"><span class="guarantee-icon green">${icon('check', 21)}</span><div><h3>接单确认</h3><p>订单同步给客服与匹配打手，接单前可查看服务要求和时间。</p></div></article><article class="guarantee-item"><span class="guarantee-icon orange">${icon('clock', 21)}</span><div><h3>过程留痕</h3><p>预约、签到、开始服务、完单和验收均有记录，状态变化清楚可查。</p></div></article><article class="guarantee-item"><span class="guarantee-icon pink">${icon('headset', 21)}</span><div><h3>售后介入</h3><p>迟到、掉线、时长不足或质量争议，可提交证据申请补做或退款。</p></div></article></div><div class="process-strip"><div><b>01</b><span>提交需求</span></div><i></i><div><b>02</b><span>在线支付</span></div><i></i><div><b>03</b><span>接单服务</span></div><i></i><div><b>04</b><span>验收评价</span></div><i></i><div><b>05</b><span>售后保护</span></div></div>`;
    footer?.before(section);
  }
  if (section !== '#games') requestAnimationFrame(() => home.querySelector(section)?.scrollIntoView({ block: 'start' }));
}
function renderPublicHome(workspace) {
  if (!workspace) return renderLogin();
  closeDialog(); leaveOwner(); state.workspace = workspace; state.mode = 'public'; state.page = 'overview';
  history.replaceState(null, '', '#/');
  document.querySelector('#app').innerHTML = loginMarkup();
  enhancePublicHome();
  const user = workspace?.user;
  const membership = workspace?.membership;
  const canEnterManagement = Boolean(membership?.active && membership.role !== 'member');
  const actions = document.querySelector('.public-nav-actions');
  if (user && actions) {
    actions.innerHTML = `${canEnterManagement ? `<button class="nav-management-link" type="button" data-action="enterManagement">${icon('building', 14)} 进入后台管理</button>` : ''}<span class="public-user-name">${e(user.name || user.username)}</span><button class="nav-logout-link" type="button" data-action="logout">退出</button>`;
  }
  const hero = document.querySelector('.hero-login');
  if (user && hero) {
    const orderCount = Array.isArray(workspace.orders) ? workspace.orders.length : 0;
    const balance = money(workspace.wallet?.balanceCents || 0);
    hero.innerHTML = `<div class="login-card-head"><div class="login-logo">${icon('users', 21)}</div><div><strong>${e(user.name || user.username)}</strong><small>${e(membership?.label || '用户')}</small></div></div><h2>个人信息</h2><div class="public-profile-grid"><div><span>用户 ID</span><strong>${e(user.id)}</strong></div><div><span>账户余额</span><strong>${balance}</strong></div><div><span>累计点单</span><strong>${orderCount} 笔</strong></div><div><span>当前身份</span><strong>${e(membership?.label || '普通用户')}</strong></div></div><div class="public-personal-actions"><button class="login-submit" type="button" data-action="personalOrder">我要点单 ${icon('arrow', 16)}</button><button class="public-secondary-action" type="button" data-action="personalAfterSales">我要售后 ${icon('headset', 15)}</button></div>${canEnterManagement ? `<button class="public-management-action" type="button" data-action="enterManagement">进入后台管理 ${icon('building', 15)}</button>` : ''}<button class="public-secondary-action public-logout-action" type="button" data-action="logout">退出登录</button>`;
  }
  document.querySelectorAll('[data-action="enterManagement"]').forEach(el => el.onclick = () => perform(el));
  document.querySelectorAll('[data-action="personalOrder"]').forEach(el => el.onclick = () => switchWorkspace('personal', 'placeOrder'));
  document.querySelectorAll('[data-action="personalAfterSales"]').forEach(el => el.onclick = () => switchWorkspace('personal', 'memberAfterSales'));
  document.querySelectorAll('[data-action="logout"]').forEach(el => el.onclick = async () => { await api('/logout', {}); renderLogin(); });
  document.querySelectorAll('[data-action="openLogin"]').forEach(el => el.onclick = () => toast('你已登录，可直接进入后台管理或选择陪玩'));
}
function renderApp() {
  const w = state.workspace; if (!w) return renderLogin();
  if (!w.role.pages.includes(state.page)) { state.page = 'overview'; history.replaceState(null, '', route('overview')); }
  if (resolveRoute(state.mode, state.page).mode === 'public') return renderPublicHome(w);
  const u = w.user;
  renderOwner({ state, api, navigate, refresh, dialog, orderDetail, toast, legacyContent: pageContent });
  const personal = state.mode === 'personal';
  document.querySelector('.owner-shell').classList.toggle('personal-shell', personal);
  document.querySelector('.owner-top-actions').insertAdjacentHTML('afterbegin', `<button class="owner-link workspace-switch" data-action="enterHome">${icon('grid',16)} 返回首页</button>${personal && w.membership?.active && w.membership.role !== 'member' ? `<button class="owner-link" data-action="enterManagement">${icon('building',16)} 进入后台管理</button>` : ''}`);
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
    const emptyResults = document.querySelector('#noSearchResults');
    if (emptyResults) emptyResults.hidden = count > 0 || !query;
  });
  if (state.query) document.querySelector('#listSearch')?.dispatchEvent(new Event('input'));
}
function pageContent() {
  if (state.mode === 'personal') return ({ overview: personalOverview, placeOrder: placeOrderPage, memberOrders: memberOrdersPage, memberAfterSales: memberAfterSalesPage, memberWallet: memberWalletPage })[state.page]();
  const pages = { examinerCandidates: examinerCandidatesPage, overview, placeOrder: placeOrderPage, orders: () => orderPage(false), orderList: () => orderPage(false), transferOrders: () => orderPage(false), dispatchOrders: dispatchPage, myOrders: () => orderPage(true), dispatch: dispatchPage, availableOrders: availablePage, conversations: conversationPage, myEarnings: earningsPage, accounts: accountsPage, escorts: membersPage, catalog: catalogPage, flows: flowPage, topups: topupsPage, settlements: settlementsPage, memberOrders: memberOrdersPage, memberAfterSales: memberAfterSalesPage };
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
  if(w.user.role==='afterSales') { const linked = w.conversations.filter(c=>c.orderId || c.order || w.orders.some(o=>o.id===c.orderId || o.boss===c.boss)); return intro('售后工作台','围绕订单处理异议、退款和服务质量问题；非订单诉求直接在会话中跟进。') + `<section class="stats">${metric('退款待跟进',w.orders.filter(o=>o.status==='退款审核').length,'及时处理售后申请','orange','receipt')}${metric('待验收订单',w.orders.filter(o=>o.status==='待验收').length,'核对服务完成情况','green','trend')}${metric('待跟进会话',w.conversations.filter(c=>c.state!=='已结束').length,'回复客户并记录结果','blue','users')}${metric('订单关联会话',linked.length,'可直接查看接单打手和订单记录','purple','headset')}</section>` + panel('售后业务','订单争议与非订单意见统一从会话进入',`<div class="owner-subnav"><button data-page="conversations">打开会话中心 →</button><button data-page="orders">查看订单记录 →</button></div>`); }
  if(w.user.role==='finance') return intro('财务工作台','处理所有与金钱相关的充值、退款赔偿、资金流水与提现结算。') + `<section class="stats">${metric('待审核充值',w.topups.filter(t=>t.state==='待审核').length,'核实实际收款后入账','blue','wallet')}${metric('待处理退款',w.refunds.filter(r=>r.status==='待审核').length,'确认赔付金额与返还渠道','pink','receipt')}${metric('待审核提现',w.withdrawals.filter(t=>t.status==='待审核').length,'审核后安排线下打款','orange','receipt')}${metric('资金流水',w.ledger.length,'所有账户变动均可追溯','green','trend')}</section>` + panel('财务业务','按实际凭证核验并留存审核说明',`<div class="owner-subnav"><button data-page="topups">充值 / 退款审核</button><button data-page="flows">资金流水</button><button data-page="settlements">提现与结算</button></div>`);
  if(w.user.role==='user') {
    const orders = w.orders || []; const spent = orders.reduce((sum, o) => sum + Number(o.amountCents || 0), 0);
    return intro('用户个人中心', '余额、点单与售后进度集中展示，服务状态和资金变动一目了然。', button('newOrder', '开始点单', '', true)) + `<section class="stats">${metric('账户余额', money(w.wallet?.balanceCents), '可用于支付俱乐部订单', 'purple', 'wallet')}${metric('累计点单', orders.length, '全部历史订单', 'blue', 'receipt')}${metric('进行中', orders.filter(o => ['待接单','待确认','待服务','陪玩中','待验收'].includes(o.status)).length, '正在处理的服务', 'orange', 'trend')}${metric('累计消费', money(spent), '订单实付金额合计', 'green', 'receipt')}</section>` + panel('快捷入口', '从下单到售后全程可追踪', `<div class="owner-subnav"><button data-page="placeOrder">开始点单 →</button><button data-page="memberOrders">查看点单记录 →</button><button data-page="memberAfterSales">查看售后记录 →</button></div>`) + panel('最近点单', '按创建时间展示最新订单', orderList(orders.slice(0, 4), false));
  }
  if(w.user.role==='member') return intro('俱乐部成员', '') + panel('成员资料', '', `<div class="detail-grid"><div><span>用户 ID</span><strong>${e(w.user.id)}</strong></div><div><span>用户编号</span><strong>${e(w.user.memberNo || '—')}</strong></div><div><span>昵称</span><strong>${e(w.user.name)}</strong></div><div><span>俱乐部职务</span><strong>普通成员</strong></div><div><span>业务权限</span><strong>待最高管理员分配</strong></div></div>`);
  const pending = w.orders.filter(o => ['待接单', '待确认', '待服务'].includes(o.status));
  const live = w.orders.filter(o => o.status === '陪玩中');
  const review = w.orders.filter(o => o.status === '待验收');
  const day = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  const stats = mine ? metric('可接订单', w.availableOrders.length, '匹配你的游戏项目', 'orange', 'game') + metric('我的待办', pending.length, '待确认或待开始服务', 'purple', 'receipt') + metric('可提现收益', money(w.wallet.balanceCents), '验收通过后入账', 'green', 'wallet') + metric('进行中的服务', live.length, '同一时段专心服务一单', 'blue', 'headset') : metric('待派单', w.orders.filter(o => o.status === '待接单').length, '已收款，等待匹配成员', 'orange', 'game') + metric('服务进行中', live.length, '及时跟进服务状态', 'purple', 'headset') + metric('完单待验收', review.length, '核验后计入成员收益', 'green', 'receipt') + metric('待跟进会话', w.conversations.filter(c => c.state !== '已结束').length, '客户咨询与售后记录', 'blue', 'users');
  return `<section class="welcome"><div><p class="eyebrow">${day}</p><h1>欢迎回来，${e(w.user.name)}<span>。</span></h1><p class="subline">${mine ? '你的接单、服务与收益，都在这里。' : '从客户咨询到服务验收，让每一单都有着落。'}</p></div><span class="workspace-tag">${mine ? '我的专属工作台' : '俱乐部运营概况'}</span></section><section class="stats">${stats}</section><section class="grid-row">${panel(mine ? '我的服务待办' : '需要跟进的订单', '按订单状态推进下一步', orderList([...review, ...live, ...pending].slice(0, 4), mine), `<button class="text-btn" data-page="${mine ? 'myOrders' : 'orders'}">查看全部 →</button>`)}${panel(mine ? '接单机会' : '协作流程', mine ? '只展示你支持的游戏' : '职责独立，订单信息同步', mine ? (w.availableOrders.slice(0, 3).map(o => `<div class="dispatch-mini-row"><div class="event-date ${o.tone || 'purple'}">${icon('game')}</div><div class="event-info"><strong>${e(o.game)} · ${e(o.product)}</strong><span>${o.hours} 小时 · ${money(o.amountCents)}</span></div><button class="text-btn" data-page="availableOrders">查看 →</button></div>`).join('') || empty('暂时没有匹配的新订单')) : `<div class="workflow"><div><b>01</b><strong>客服创建订单</strong><span>确认游戏、时长和收款</span></div><div><b>02</b><strong>匹配与确认接单</strong><span>按游戏匹配在线成员</span></div><div><b>03</b><strong>打手服务与完单</strong><span>记录服务过程，提交完单说明</span></div><div><b>04</b><strong>客服验收，收益入账</strong><span>管理员独立审核充值和提现</span></div></div>`)}</section>`;
}
function orderList(list, mine) {
  if (!list.length) return empty('暂无待处理订单');
  return `<div class="order-list">${list.map(o => `<article class="order-line" data-searchable><div><div class="order-line-title"><strong>${e(o.game)} · ${e(o.product)}</strong>${badge(o.status)}</div><p>${e(o.id)} · ${e(o.boss)} · ${o.hours} 小时</p><small>${mine ? '我的预计分成 ' + money(myIncome(o)) : '陪玩：' + e(o.participants.map(p => p.name).join(' / ') || '待分配') + ' · 订单金额 ' + money(o.amountCents)}</small></div><div class="row-actions">${orderButtons(o, mine)}</div></article>`).join('')}</div>`;
}
function myIncome(order) { const p = order.participants.find(p => p.userId === state.workspace.user.id); return p?.earningCents ?? Math.round(order.amountCents * (p?.shareBps || 0) / 10000); }
function orderButtons(o, mine) {
  let actions = button('detail', '详情', o.id);
  if (state.workspace.user.role === 'user') {
    if (o.status === '待验收') actions += button('customerConfirm', '确认完成', o.id, true);
    if (['已完成', '待验收'].includes(o.status)) actions += button('refundRequest', '申请售后', o.id);
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
    if (o.status === '待接单' && has('order:dispatch')) actions += button('dispatch', '派单', o.id, true);
    if (o.status === '待验收' && has('order:review')) actions += button('review', '验收订单', o.id, true);
    if (o.status === '退款审核' && (has('order:review') || has('refund:manage'))) actions += button('refundReview', '处理退款', o.id, true);
    if (['已完成', '待验收'].includes(o.status) && (has('order:review') || has('refund:manage'))) actions += button('refundRequest', '发起退款', o.id);
  }
  return actions;
}
function placeOrderPage() {
  return intro('开始点单', '选择游戏、服务方式和预约要求，支付成功后订单会自动进入待接单并通知客服。', button('newOrder', '填写服务要求', '', true)) + panel('陪玩服务流程', '下单后可在我的点单中跟踪每一步', '<div class="workflow"><div><b>01</b><strong>选择服务</strong><span>按游戏、商品或指定打手点单</span></div><div><b>02</b><strong>在线支付</strong><span>平台暂存订单金额，等待接单</span></div><div><b>03</b><strong>匹配接单</strong><span>客服改派或打手直接接单</span></div><div><b>04</b><strong>服务验收</strong><span>完成后确认并进入售后保护期</span></div></div>');
}
function orderPage(mine) {
  const statuses = ['全部', '待接单', '待确认', '待服务', '陪玩中', '待验收', '已完成', '退款审核'].filter(s => !mine || s !== '待接单');
  const orders = state.workspace.orders.filter(o => state.filter === '全部' || o.status === state.filter);
  return intro(mine ? '我的订单' : '订单管理', mine ? '只显示分配给你的订单；完单后由客服验收，收益按接单时的分成计算。' : '创建、派单、服务、验收，完整记录每一步。') + `<div class="filter-strip"><div class="filter-tabs">${statuses.map(s => `<button data-filter="${s}" class="${s === state.filter ? 'active' : ''}">${s} <b>${state.workspace.orders.filter(o => s === '全部' || o.status === s).length}</b></button>`).join('')}</div></div>${panel(mine ? '我的服务记录' : '俱乐部订单', `共 ${orders.length} 笔`, `<label class="list-search">${icon('search', 16)}<input id="listSearch" type="search" placeholder="搜索订单号、老板、游戏" aria-label="搜索订单" value="${e(state.query)}"></label>${orderList(orders, mine)}<div id="noSearchResults" class="empty-state" hidden>没有找到匹配的订单</div>`)}`;
}
function personalOverview() {
  const w = state.workspace, orders = w.orders;
  const spent = orders.filter(o => !['已取消','未支付','待支付'].includes(o.status)).reduce((sum, o) => sum + Math.max(0, o.amountCents - o.refundedCents), 0);
  return intro('个人中心', '') + `<section class="personal-profile"><span class="personal-avatar">${e(w.user.name.slice(0,1))}</span><div><h2>${e(w.user.name)}</h2><p>用户 ID <strong>${e(w.user.id)}</strong>${w.user.memberNo ? ` <small>编号 ${e(w.user.memberNo)}</small>` : ''}</p></div><div class="personal-membership"><span>用户</span><span>${w.membership ? `俱乐部成员 · ${e(w.membership.label)}` : '尚未加入俱乐部'}</span></div></section><section class="stats">${metric('账户余额', money(w.wallet.balanceCents), '消费余额', 'blue', 'wallet')}${metric('累计点单', orders.length, '笔', 'green', 'receipt')}${metric('服务进行中', orders.filter(o => ['待接单','待确认','待服务','陪玩中','待验收'].includes(o.status)).length, '笔', 'orange', 'headset')}${metric('累计消费', money(spent), '已扣除退款', 'pink', 'trend')}</section>` + panel('最近点单', '', orderList(orders.slice(0, 4), false), '<button class="text-btn" data-page="memberOrders">全部点单记录 →</button>');
}
function memberWalletPage() {
  return intro('我的钱包', '') + `<section class="personal-balance"><span>账户余额</span><strong>${money(state.workspace.wallet.balanceCents)}</strong></section>` + panel('余额明细', '', ledgerTable(state.workspace.ledger));
}
function memberOrdersPage() {
  const w = state.workspace; const orders = w.orders || [];
  const statuses = ['全部', '待接单', '待确认', '待服务', '陪玩中', '待验收', '已完成', '退款审核', '已退款', '已取消'];
  const filtered = orders.filter(o => state.filter === '全部' || o.status === state.filter);
  return intro('我的点单记录', '') + `<div class="filter-strip"><div class="filter-tabs">${statuses.map(s => `<button data-filter="${s}" class="${s === state.filter ? 'active' : ''}">${s} <b>${orders.filter(o => s === '全部' || o.status === s).length}</b></button>`).join('')}</div></div>` + panel('订单明细', `共 ${filtered.length} 笔`, `<label class="list-search">${icon('search', 16)}<input id="listSearch" type="search" placeholder="搜索订单号、游戏或陪玩" aria-label="搜索点单记录" value="${e(state.query)}"></label>${orderList(filtered, false)}<div id="noSearchResults" class="empty-state" hidden>没有找到匹配的订单</div>`);
}
function memberAfterSalesPage() {
  const w = state.workspace; const refunds = w.refunds || []; const conversations = w.conversations || [];
  const refundRows = refunds.map(r => { const o = (w.orders || []).find(order => order.id === r.orderId); return row([e(r.id), e(r.orderId), e(o?.game || '—'), money(r.amountCents), badge(r.status), date(r.requestedAt), e(r.reason || '—')]); });
  const chatRows = conversations.map(c => row([e(c.id), e(c.channel || '站内信'), e(c.last || c.messages?.at(-1)?.text || '—'), badge(c.state || '处理中'), date(c.updatedAt || c.messages?.at(-1)?.at)]));
  return intro('售后记录', '') + panel('退款与赔偿', '', table(['申请单号','订单号','游戏','申请金额','处理状态','申请时间','原因'], refundRows)) + panel('客服沟通记录', '', table(['会话','渠道','最近消息','状态','更新时间'], chatRows));
}
function dispatchPage() {
  const queue = state.workspace.orders.filter(o => o.status === '待接单').sort((a,b) => a.createdAt.localeCompare(b.createdAt));
  return intro('派单台', '优先处理等待较久的订单。成员需在线、未冻结、支持该游戏，且等级不低于订单要求。') + `<div class="dispatch-page-list">${queue.map(o => `<article class="panel dispatch-card"><div class="dispatch-card-top"><div><span class="flow-id">${e(o.id)}</span><h2>${e(o.game)} · ${e(o.product)}</h2><p>${e(o.boss)} · ${e(o.requirement)}</p></div>${badge('待接单')}</div><div class="dispatch-card-meta"><span>订单金额<strong>${money(o.amountCents)}</strong></span><span>服务时长<strong>${o.hours} 小时</strong></span><span>可选成员<strong>${eligible(o).length} 人</strong></span></div>${button('dispatch', '选择成员并派单 →', o.id, true)}</article>`).join('') || empty('派单队列已处理完毕')}</div>`;
}
function eligible(order) { const w=state.workspace; const rank=id=>w.levels.find(l=>l.id===id)?.rank||0; return w.members.filter(m => m.active && !m.escortFrozen && m.online && m.games.includes(order.game) && rank(m.levelId)>=rank(order.levelId)); }
function availablePage() {
  const w = state.workspace;
  return intro('接单大厅', '根据你的游戏和等级展示订单，可接本级及以下订单。接单后进入我的订单，已有服务未结束时无法开始另一单。', button('online', w.user.online ? '在线接单中 · 点击休息' : '当前离线 · 上线接单')) + `<div class="available-order-grid">${w.availableOrders.map(o => `<article class="panel available-order-card" data-searchable><div class="available-order-top"><span class="event-date ${o.tone || 'purple'}">${icon('game', 20)}</span>${badge('待接单')}</div><h2>${e(o.game)} · ${e(o.product)}</h2><p>${e(o.requirement)}</p><div class="available-order-meta"><span>${o.hours} 小时 · ${e(o.boss)}</span><strong>${money(o.amountCents)}</strong></div><small class="muted-text">${e(o.levelName)}及以上 · 预计分成 ${o.expectedShareBps/100}%</small>${button('claim', '查看并接单 →', o.id, true, w.user.online ? '' : 'disabled title="请先切换为在线"')}</article>`).join('') || empty('暂无与你的游戏匹配的订单')}</div>`;
}
function conversationPage() {
  const orders = state.workspace.orders || [];
  const orderFor = c => c.order || orders.find(o => o.id === c.orderId);
  return intro('会话中心', '查看客户咨询与售后记录；订单争议显示关联订单和接单打手，非订单意见直接记录跟进结果。') + panel('客户会话', '历史会话与人工跟进记录', `<label class="list-search">${icon('search', 16)}<input id="listSearch" type="search" placeholder="搜索用户 ID、昵称、订单号或会话内容" aria-label="搜索会话" value="${e(state.query)}"></label><div class="conversation-full-list">${state.workspace.conversations.map(c => { const order = orderFor(c); const escorts = order?.participants?.map(p => p.name).join(' / '); return `<div class="conversation-full-row" data-searchable><div class="mini-avatar orange">${e((c.boss || '客').slice(0, 1))}</div><div class="conversation-body"><div><strong>${e(c.boss || c.customerName || '未命名客户')}</strong><span class="channel-tag">${e(c.channel || '站内信')}</span>${order ? `<span class="order-link-tag">订单 ${e(order.id)} · ${e(order.game)}</span>` : '<span class="channel-tag neutral">非订单</span>'}${c.unread ? `<em class="unread">${c.unread} 条待跟进</em>` : ''}${c.slaOverdue ? '<em class="unread">SLA 超时</em>' : ''}</div><p>${e(c.last || c.messages?.at(-1)?.text || '暂无消息')}${escorts ? ` · 接单：${e(escorts)}` : ''}</p></div><div class="conversation-meta">${badge(c.state || '处理中')}${button('conversation', '查看会话', c.id)}</div></div>`; }).join('')}</div><div id="noSearchResults" class="empty-state" hidden>没有找到匹配的会话</div>`);
}
function earningsPage() {
  const w = state.workspace;
  const now = Date.now(); const dayStart = new Date(new Date().setHours(0,0,0,0)).getTime(); const weekStart = dayStart - ((new Date().getDay() + 6) % 7) * 86400000; const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const income = since => (w.ledger || []).filter(l => l.label === '订单分成' && Date.parse(l.at) >= since && Date.parse(l.at) <= now).reduce((sum, l) => sum + Number(l.deltaCents || 0), 0);
  return intro('我的收益', '订单验收后入账。提现申请会冻结对应金额，审核驳回后返还。', button('withdraw', '申请提现', '', true)) + `<section class="stats">${metric('可提现金额', money(w.wallet.balanceCents), '已入账，可申请提现', 'purple', 'wallet')}${metric('今日流水', money(income(dayStart)), '今日已验收订单分成', 'blue', 'trend')}${metric('本周流水', money(income(weekStart)), '周一至今天累计入账', 'green', 'receipt')}${metric('本月流水', money(income(monthStart)), '本月累计订单分成', 'orange', 'wallet')}</section><section class="stats">${metric('提现审核中', money(w.wallet.frozenCents), '已从可提现金额中冻结', 'orange', 'receipt')}${metric('服务待验收', money(w.orders.filter(o => o.status === '待验收').reduce((a,o) => a + myIncome(o), 0)), '验收前不计入可提现余额', 'blue', 'trend')}${metric('当前押金', money(w.wallet.depositCents), '提现要求押金至少 ¥1,000', 'green', 'wallet')}</section>` + panel('我的资金明细', '仅包含当前成员的账户变动', ledgerTable(w.ledger)) + panel('我的提现申请', '审核通过后等待俱乐部线下打款', withdrawalTable(w.withdrawals, false));
}
function ledgerTable(list) { return table(['时间', '账户', '业务', '变动金额', '变动后余额', '关联单号'], list.map(l => row([date(l.at), e(l.account), e(l.label), `<strong class="${l.deltaCents < 0 ? 'negative' : 'positive'}">${l.deltaCents > 0 ? '+' : '−'} ${money(Math.abs(l.deltaCents))}</strong>`, money(l.afterCents), e(l.source)]))); }
function withdrawalTable(list, review) { return table(['申请单号', '成员', '金额', '状态', '申请时间', '操作'], list.map(w => row([e(w.id), e(w.name), money(w.amountCents), badge(w.status), date(w.at), review && w.status === '待审核' ? button('withdrawReview', '审核', w.id) : review && w.status === '待线下打款' ? button('withdrawPaid', '登记打款', w.id, true) : e(w.reason || w.payoutRef || '—')]))); }
function accountsPage() {
  return intro('成员与权限', '成员只属于星河游戏俱乐部。调整职责或停用账号后，已有登录会话立即失效。', button('newAccount', '新增成员账号', '', true)) + `<section class="role-matrix"><article><span class="role-badge purple">最高负责人</span><p>俱乐部业务、财务审核、成员与权限配置</p></article><article><span class="role-badge orange">客服</span><p>订单、会话、派单、完单验收</p></article><article><span class="role-badge green">打手</span><p>接单、本人订单、本人收益与提现申请</p></article></section>` + panel('俱乐部账号', '账号职责由管理员分配，成员登录时无需选择', table(['成员', '账号', '职责', '状态', '游戏', '操作'], state.workspace.accounts.map(u => row([e(u.name), e(u.username), `<span class="role-badge ${u.tone}">${e(u.roleLabel)}</span>`, badge(u.active ? '启用' : '停用'), e(u.games.join(' / ') || '—'), button('editAccount', '编辑权限', u.id)]))));
}
function membersPage() { return intro('陪玩成员', '查看成员在线状态、支持的游戏与默认分成。订单按派单时的分成比例留存。', has('account:manage') ? button('accounts', '管理成员与权限') : '') + panel('陪玩档案', `共 ${state.workspace.members.length} 位成员`, table(['成员', '账号状态', '接单状态', '游戏', '基础分成', '操作'], state.workspace.members.map(m => row([e(m.name), badge(m.active ? '启用' : '停用'), badge(m.online ? '在线' : '离线'), e(m.games.join(' / ')), `${m.shareBps / 100}%`, has('account:manage') ? button('editAccount', '编辑', m.id) : '只读'])))); }
function catalogPage() {
  const w = state.workspace;
  return intro('游戏与商品', '游戏维护时不可新建订单或接单；派单会校验人数边界和游戏分成倍率。') + panel('游戏配置', '当前俱乐部的游戏服务范围', table(['游戏', '分成倍率', '陪玩人数', '状态'], w.games.map(g => row([e(g.name), e(g.multiplier), `${g.min}–${g.max} 人`, badge(g.state)])))) + panel('服务商品', '价格 = 商品单价 × 服务时长', table(['商品', '游戏', '单价', '状态'], w.products.map(p => row([e(p.name), e(p.game), `${money(p.priceCents)} / 小时`, badge(p.state)]))));
}
function flowPage() { return intro('资金流水', '记录订单消费、充值入账、完单分成与提现冻结，资金变动与业务单号关联。') + panel('账户变动记录', '本次系统启用后的实际操作流水', `<label class="list-search">${icon('search', 16)}<input id="listSearch" type="search" placeholder="搜索用户 ID、昵称或业务单号" aria-label="搜索资金流水" value="${e(state.query)}"></label>${ledgerTable(state.workspace.ledger)}`); }
function topupsPage() { const w = state.workspace; const pendingRefunds = (w.refunds || []).filter(r => r.status === '待审核'); return intro('充值与退款审核', '所有涉及老板资金的充值、退款与赔偿统一由财务复核，凭证、原因和原支付方式必须留痕。') + `<section class="stats">${metric('待审核充值', (w.topups || []).filter(t => t.state === '待审核').length, '核验到账后再入账', 'blue', 'wallet')}${metric('待处理退款', pendingRefunds.length, '确认赔付金额与渠道', 'orange', 'receipt')}${metric('资金流水', (w.ledger || []).length, '充值、订单与提现全量记录', 'green', 'trend')}</section>` + panel('充值申请', '请根据实际收款凭证核验后审核', `<label class="list-search">${icon('search', 16)}<input id="listSearch" type="search" placeholder="搜索充值单号、用户 ID 或昵称" aria-label="搜索充值申请" value="${e(state.query)}"></label>${table(['充值单号', '老板', '金额', '充值前余额', '充值后余额', '状态', '操作'], (w.topups || []).map(t => row([e(t.id), e(t.user), e(t.amount), e(t.before), t.state === '已通过' ? e(t.after) : '待审核后计算', badge(t.state), t.state === '待审核' ? button('topupReview', '审核', t.id) : e(t.proof)])))}`) + panel('退款 / 赔偿申请', '审核通过后按原支付方式返还老板，驳回必须填写依据', table(['申请单号', '订单', '老板', '金额', '渠道', '状态', '操作'], (w.refunds || []).map(r => row([e(r.id), e(r.orderId), e(r.customer), money(r.amountCents), e(r.channel || '—'), badge(r.status), r.status === '待审核' ? button('refundReview', '审核', r.orderId, true) : e(r.reason || '已处理')]))) ); }
function settlementsPage() { return intro('提现与结算', '独立复核成员提现申请。通过审核后待线下打款，不代表已经付款。') + panel('成员提现申请', '可提现余额已在申请时冻结', `<label class="list-search">${icon('search', 16)}<input id="listSearch" type="search" placeholder="搜索用户 ID、昵称或提现单号" aria-label="搜索提现申请" value="${e(state.query)}"></label>${withdrawalTable(state.workspace.withdrawals, true)}`) + panel('历史结算批次', '参考项目中的历史示例记录', table(['批次', '周期', '成员数', '金额', '状态'], state.workspace.settlements.map(s => row([e(s.id), e(s.period), s.escorts, e(s.amount), badge(s.state)])))); }

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
    if (action === 'enterManagement') return await switchWorkspace('management');
    if (action === 'enterHome' || action === 'enterPersonal') return await switchWorkspace('public');
    if (action === 'refresh') { state.busy = true; await refresh(); toast('已获取最新业务状态'); return; }
    if (action === 'accounts') return navigate('accounts');
    if (action === 'online') { state.busy = true; await api('/online', { online: !w.user.online }); await refresh(); toast(state.workspace.user.online ? '已上线，可以接单' : '已休息，暂不接新单'); return; }
    if (action === 'detail') return dialog('订单详情', orderDetail(o));
    if (action === 'customerConfirm') return dialog('确认服务完成', orderDetail(o) + '<p class="detail-note">确认后订单完成，陪玩分成将按规则结算；如有问题可在售后记录中申请处理。</p>', '确认完成', () => updateOrder(o, 'approve'));
    if (action === 'claim') return dialog('确认接单', `<p>接下 ${e(o.boss)} 的「${e(o.game)} · ${e(o.product)}」订单？</p><p>${o.hours} 小时 · 订单总额 <strong>${money(o.amountCents)}</strong></p><p>我的分成 ${o.expectedShareBps / 100}% · 预计到手 <strong>${money(o.expectedIncomeCents)}</strong></p><p>${e(o.requirement)}</p><p class="detail-note">分成按陪玩等级计算，接单后锁定。开始服务前请确认可服务时间。</p>`, '确认接单', () => updateOrder(o, 'accept'));
    if (action === 'accept') return dialog('确认派单', orderDetail(o), '确认接单', () => updateOrder(o, 'accept'));
    if (action === 'start') return dialog('开始服务', `<p>确认开始 ${e(o.game)} 的 ${o.hours} 小时服务？</p><p class="detail-note">开始后将记录服务时间。同一成员不能同时开始其他订单。</p>`, '开始服务', () => updateOrder(o, 'start'));
    if (action === 'finish') return dialog('提交完单', `<p>${e(o.id)} · ${e(o.game)}</p>${textarea('完单说明', 'evidence', '请记录服务内容、完成情况及需要客服核验的信息（至少 5 个字符）')}<p class="detail-note">由客服验收后入账，提交不会直接增加可提现余额。</p>`, '提交验收', form => updateOrder(o, 'finish', { evidence: form.get('evidence') }));
    if (action === 'reject') return dialog('退回派单池', textarea('退回原因', 'reason', '说明无法服务的原因，客服将重新匹配成员'), '确认退回', form => updateOrder(o, 'reject', { reason: form.get('reason') }));
    if (action === 'transfer') {
      const candidates = eligible(o).filter(m => !o.participants.some(p => p.userId === m.id)); const game = w.games.find(g => g.name === o.game);
      const html = `<p>${e(o.id)} · 当前陪玩：${e(o.participants.map(p => p.name).join(' / ') || '待分配')}</p><p class="detail-note">请选择新的陪玩成员（${game.min}–${game.max} 人），转单后原成员将退出本单，订单历史会保留。</p>${textarea('转单原因', 'reason', '说明更换打手的原因')}<div class="candidate-list">${candidates.map(m => `<label><input type="checkbox" name="memberIds" value="${e(m.id)}"><span class="mini-avatar green">${e(m.name.slice(0,1))}</span><span><strong>${e(m.name)}</strong><small>${e(w.levels.find(l=>l.id===m.levelId)?.name)} · ${e(m.games.join(' / '))}</small></span><b>${m.shareBps/100}% / 人数</b></label>`).join('') || empty('暂无符合条件的在线成员')}</div>`;
      return dialog('转派订单', html, candidates.length ? '确认转单' : '', form => updateOrder(o, 'transfer', { memberIds: form.getAll('memberIds'), reason: form.get('reason') }));
    }
    if (action === 'review') return dialog('完单验收', orderDetail(o) + '<label class="form-field">验收备注 / 退回原因<textarea name="reason" rows="2" maxlength="200"></textarea></label>', '验收通过并入账', (form, secondary) => updateOrder(o, secondary === 'return' ? 'return' : 'approve', { reason: form.get('reason') }), '<button type="button" class="ghost-btn" data-dialog-action="return">退回补充</button>');
    if (action === 'dispatch') {
      const candidates = eligible(o); const game = w.games.find(g => g.name === o.game);
      const html = `<p>${e(o.id)} · ${e(o.game)} · ${money(o.amountCents)}</p><p class="detail-note">${e(o.requirement)}<br>订单要求：${e(o.levelName)}及以上。选择 ${game.min}–${game.max} 位成员，每人的等级分成除以参与人数后锁定。</p><div class="candidate-list">${candidates.map(m => `<label><input type="checkbox" name="memberIds" value="${e(m.id)}"><span class="mini-avatar green">${e(m.name.slice(0,1))}</span><span><strong>${e(m.name)}</strong><small>${e(w.levels.find(l=>l.id===m.levelId)?.name)} · ${e(m.games.join(' / '))}</small></span><b>${m.shareBps/100}% / 人数</b></label>`).join('') || empty('暂无符合条件的在线成员')}</div>`;
      return dialog('选择陪玩成员', html, candidates.length ? '确认派单' : '', form => updateOrder(o, 'dispatch', { memberIds: form.getAll('memberIds') }));
    }
    if (action === 'newAssessment' || action === 'qualityCheck') {
      const member = (w.members || []).find(m => m.id === id);
      if (!member) throw new Error('陪玩成员不存在');
      const quality = action === 'qualityCheck';
      const recentOrders = (w.orders || []).filter(order => order.participants?.some(p => p.userId === id)).slice(0, 8);
      const type = quality ? 'quality' : 'onboarding';
      const options = (member.games || []).map(game => `<option value="${e(game)}">${e(game)}</option>`).join('');
      return dialog(quality ? '发起在店质检' : '创建入店考核', `<p><strong>${e(member.name)}</strong> · ${e(member.levelName || '未定级')} · ${e((member.games || []).join(' / ') || '未配置游戏')}</p><label class="form-field">考核游戏<select name="game" ${options ? '' : 'disabled'}>${options || '<option value="">暂无已配置游戏</option>'}</select></label>${quality && recentOrders.length ? `<label class="form-field">关联服务订单（可选）<select name="orderId"><option value="">不关联订单</option>${recentOrders.map(order => `<option value="${e(order.id)}">${e(order.id)} · ${e(order.game)} · ${e(order.status)}</option>`).join('')}</select></label>` : ''}${field('预约时间', 'scheduledAt', 'datetime-local', '', 'required')}<label class="form-field">考核说明<textarea name="note" rows="3" maxlength="500" placeholder="${quality ? '记录触发质检的原因、需重点观察的服务表现' : '记录考核范围、段位要求和注意事项'}" required></textarea></label><p class="detail-note">提交后生成${quality ? '质检' : '入店考核'}记录，完成时再补充评分与结论。</p>`, '创建记录', form => api('/assessments', { memberId: id, type, game: form.get('game'), orderId: form.get('orderId') || undefined, scheduledAt: form.get('scheduledAt'), note: form.get('note'), status: '待考核' }));
    }
    if (action === 'assessmentReview') {
      const assessment = assessmentRecords().find(a => a.id === id);
      if (!assessment) throw new Error('考核记录不存在或已刷新');
      const statFields = ['wins:胜场','losses:败场','kills:击杀','deaths:死亡','mvp:MVP次数'].map(item => { const [name,label] = item.split(':'); return `<label class="form-field">${label}<input name="${name}" type="number" value="${e(assessment[name] ?? '')}" min="0" step="1"></label>`; }).join('');
      return dialog('填写考核结果', `<p><strong>${e(assessment.memberName || assessment.candidateName || assessment.memberId || '')}</strong> · ${e(assessment.type === 'quality' || assessment.kind === '质检' ? '在店质检' : '入店考核')} · ${e(assessment.game || '—')}</p>${field('评分（0–100）', 'score', 'number', assessment.score ?? '', 'min="0" max="100" step="1"')}<div class="form-grid-2">${statFields}</div><label class="form-field">结论<select name="result"><option value="通过">通过</option><option value="待复核">待复核</option><option value="不通过">不通过</option></select></label><label class="form-field">战绩凭证<input name="evidence" value="${e(assessment.evidence || '')}" maxlength="1000"></label>${textarea('考核记录 / 改进要求', 'note', '补充关键表现、问题与后续安排')}<p class="detail-note">提交后会记录操作人和时间；未通过的入店考核不会自动开通接单权限，质检不改变历史订单。</p>`, '保存结果', form => api(`/assessments/${id}`, { score: Number(form.get('score')), result: form.get('result'), wins: form.get('wins') ? Number(form.get('wins')) : undefined, losses: form.get('losses') ? Number(form.get('losses')) : undefined, kills: form.get('kills') ? Number(form.get('kills')) : undefined, deaths: form.get('deaths') ? Number(form.get('deaths')) : undefined, mvp: form.get('mvp') ? Number(form.get('mvp')) : undefined, evidence: form.get('evidence') || undefined, note: form.get('note') }));
    }
    if (action === 'newOrder') {
      const products = w.products.filter(p => p.state === '启用' && w.games.some(g => g.name === p.game && g.state === '上架'));
      if (w.user.role === 'user') {
        const form = dialog('创建陪玩订单', `${field('游戏与商品','productId','text','','list="productList"')}<datalist id="productList">${products.map(p => `<option value="${e(p.id)}">${e(p.game)} · ${e(p.name)} · ${money(p.priceCents)}/小时</option>`).join('')}</datalist><label class="form-field">服务方式<select name="orderMode"><option value="quick">快速下单，由客服安排</option><option value="filter">按游戏筛选打手</option><option value="designated">指定打手</option></select></label><label class="form-field">指定打手（可选）<select name="preferredEscortId"><option value="">由客服安排</option>${(w.members || []).map(m => `<option value="${e(m.id)}">${e(m.name)} · ${(m.games || []).join(' / ')}</option>`).join('')}</select></label>${field('服务时长（小时）','hours','number',1,'min="0.5" max="24" step="0.5"')} ${field('游戏区服','region','text','','maxlength="80"')}<label class="form-field">预约时间<input name="appointmentAt" type="datetime-local"></label><label class="form-field">语音方式<select name="voice"><option>游戏内语音</option><option>微信语音</option><option>不开语音</option></select></label>${textarea('备注及特殊要求','requirement','例如：开麦沟通、位置偏好、段位要求')}<div class="form-total">订单金额 <strong id="orderQuote"></strong></div><p class="detail-note">在线支付将从账户余额扣款，支付成功后进入待接单。当前余额：${money(w.wallet?.balanceCents)}</p>`, '在线支付并提交', data => api('/orders', { ...Object.fromEntries(data), boss: w.user.name, pay: '在线支付', levelId: 'gold' }));
        const productInput = form.querySelector('[name=productId]');
        const productSelect = document.createElement('select'); productSelect.name = 'productId'; productSelect.required = true; productSelect.innerHTML = products.map(p => `<option value="${e(p.id)}">${e(p.game)} · ${e(p.name)} · ${money(p.priceCents)}/小时</option>`).join(''); productInput.replaceWith(productSelect);
        const updateQuote = () => { const p = products.find(p => p.id === form.querySelector('[name=productId]').value); form.querySelector('#orderQuote').textContent = money((p?.priceCents || 0) * Number(form.querySelector('[name=hours]').value || 0)); };
        form.addEventListener('input', updateQuote); updateQuote(); return;
      }
      const form = dialog('新建陪玩订单', `${field('老板称呼', 'boss', 'text', '', 'maxlength="30" list="customerList"')}<datalist id="customerList">${w.customers.map(c => `<option value="${e(c.name)}">余额 ${money(c.balanceCents)}</option>`).join('')}</datalist><label class="form-field">游戏商品<select name="productId">${products.map(p => `<option value="${p.id}">${e(p.game)} · ${e(p.name)} · ${money(p.priceCents)}/小时</option>`).join('')}</select></label><label class="form-field">订单等级<select name="levelId">${w.levels.map(l=>`<option value="${l.id}" ${l.id==='gold'?'selected':''}>${l.name}及以上</option>`).join('')}</select></label>${field('服务时长（小时）','hours','number',1,'min="0.5" max="24" step="0.5"')}<div class="form-total">订单金额 <strong id="orderQuote"></strong></div><label class="form-field">支付方式<select name="pay"><option>线下已收款</option><option>余额支付</option></select></label><label class="form-field">Tag 标签（可选，用逗号分隔）<input name="tags" maxlength="240" placeholder="例如：娱乐、上分、新人"></label>${textarea('服务要求', 'requirement', '例如：开麦沟通、游戏区服、服务时间和段位要求')}<p class="detail-note">选择“线下已收款”表示客服已经核实收款；余额支付会即时扣减老板余额。</p>`, '创建订单', data => api('/orders', Object.fromEntries(data)));
      const quote = () => { const p = products.find(p => p.id === form.querySelector('[name=productId]').value); form.querySelector('#orderQuote').textContent = money((p?.priceCents || 0) * Number(form.querySelector('[name=hours]').value)); }; form.addEventListener('input', quote); quote(); return;
    }
    if (action === 'conversation') {
      const chat = w.conversations.find(c => c.id === id);
      const relatedOrder = chat?.order || w.orders?.find(order => order.id === chat?.orderId);
      await api(`/conversations/${id}`, {}); await refresh();
      const orderContext = relatedOrder ? `<h3>关联订单</h3><div class="current-order"><div class="current-order-icon purple">${icon('receipt')}</div><div><strong>${e(relatedOrder.id)} · ${e(relatedOrder.game)} · ${e(relatedOrder.product)}</strong><p>${e(relatedOrder.status)} · ${relatedOrder.hours} 小时 · 接单：${e(relatedOrder.participants?.map(p => p.name).join(' / ') || '待分配')}</p><button type="button" class="text-btn" id="viewChatOrder">查看订单详情 →</button></div></div>` : '<p class="detail-note">该会话未关联订单，按普通意见直接跟进即可。</p>';
      const modal = dialog(`${chat.boss} · 会话记录`, `<div class="chat-dialog-meta"><span class="channel-tag">${e(chat.channel)}</span><span class="muted-text">支持向上翻阅历史记录</span></div>${orderContext}<div class="chat-window"><div class="chat-messages">${chat.messages.map(m => `<div><strong>${e(m.author)}</strong><p>${e(m.text)}</p><small>${date(m.at)}</small></div>`).join('') || '<p class="muted-text">暂无聊天记录</p>'}</div></div><h3>客服跟进记录</h3>${chat.notes.map(n => `<div class="detail-note">${e(n.text)}<small>${e(n.author)} · ${date(n.at)}</small></div>`).join('') || '<p class="muted-text">暂无跟进记录</p>'}${textarea('新增跟进记录', 'note', '记录已沟通的结果、改派安排或退款进展')}<label class="form-field">跟进状态<select name="state"><option value="处理中">处理中</option><option value="已结束">已结束</option></select></label><p class="detail-note">这里保存俱乐部内部跟进记录；客户消息渠道尚未连接。</p>`, '保存跟进', form => api(`/conversations/${id}`, Object.fromEntries(form)));
      modal.classList.add('chat-dialog');
      modal.querySelector('#viewChatOrder')?.addEventListener('click', () => { if (relatedOrder) dialog('订单详情', orderDetail(relatedOrder)); });
      const messages = modal.querySelector('.chat-messages'); if (messages) messages.scrollTop = messages.scrollHeight;
      return modal;
    }
    if (action === 'refundReview') {
      const refund = (w.refunds || []).find(item => item.orderId === id && item.status === '待审核');
      if (!refund) throw new Error('没有待审核的退款申请');
      return dialog('退款审核', `<p>${e(refund.id)} · ${e(refund.customer)} · <strong>${money(refund.amountCents)}</strong></p><p class="detail-note">${e(refund.reason)} · ${e(refund.channel)}</p>${textarea('审核说明 / 驳回原因', 'reason', '请填写处理依据')}`, '确认退款', (form, secondary) => api(`/refunds/${refund.id}`, { action: secondary === 'reject' ? 'reject' : 'approve', reason: form.get('reason') }), '<button type="button" class="ghost-btn" data-dialog-action="reject">驳回</button>');
    }
    if (action === 'refundRequest') return dialog('发起退款申请', `<p>${e(o.id)} · ${e(o.boss)} · ${money(o.amountCents)}</p>${field('退款金额（元）', 'amount', 'number', (o.amountCents - (o.refundedCents || 0)) / 100, `min="0.01" max="${(o.amountCents - (o.refundedCents || 0)) / 100}" step="0.01"`)}${textarea('退款原因', 'reason', '记录客户诉求、服务问题或协商结果')}`, '提交退款申请', form => api('/refunds', { orderId: o.id, amountCents: Math.round(Number(form.get('amount')) * 100), reason: form.get('reason') }));
    if (action === 'withdrawPaid') {
      const item = (w.withdrawals || []).find(item => item.id === id);
      return dialog('登记线下打款', `<p>${e(item?.id)} · ${e(item?.name)} · <strong>${money(item?.amountCents)}</strong></p>${field('打款流水号', 'payoutRef', 'text', '', 'maxlength="80"')}<p class="detail-note">登记后该提现进入已打款，流水号用于财务对账。</p>`, '确认已打款', form => api(`/withdrawals/${id}`, { action: 'markPaid', payoutRef: form.get('payoutRef') }));
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
window.addEventListener('hashchange', async () => {
  if (['#games', '#members', '#rules', '#help'].includes(location.hash)) return;
  const { mode, page } = parseRoute(location.hash);
  try {
    if (!state.workspace || state.mode !== mode) await switchWorkspace(mode, page);
    else navigate(page);
  } catch (error) {
    if (error.status !== 401) toast(error.message);
  }
});
window.addEventListener('pageshow', event => { if (event.persisted) boot(); });
async function boot() {
  const { mode: requestedMode, page: desired } = parseRoute(location.hash);
  state.mode = requestedMode;
  document.querySelector('#app').innerHTML = '<div class="loading-screen"><span class="brand-mark">C</span><p>正在载入俱乐部工作台…</p></div>';
  try {
    await refresh(false);
    navigate(state.workspace.role.pages.includes(desired) ? desired : 'overview');
  }
  catch (error) {
    if (error.status === 401) renderLogin();
    else { document.querySelector('#app').innerHTML = `<div class="loading-screen"><h1>暂时无法连接俱乐部</h1><p>${e(error.message)}</p><button class="primary-action" id="retryBoot">重新连接</button></div>`; document.querySelector('#retryBoot').onclick = boot; }
  }
}
boot();
