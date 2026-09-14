import { escapeHtml as e, icon } from './ui.js';
import { catalogTags } from './catalog-tags.js';
import { membersMarkup, bindMembers } from './members.js';
import { realNameReviewsMarkup, bindRealName, realNameNotice } from './real-name.js';

const names = { overview: '首页', orderManagement:'订单管理', conversations:'会话中心', financeManagement:'财务管理', clubConfig: '俱乐部配置', memberManagement: '成员管理', serviceManagement: '客服管理', examinerManagement: '考官管理', afterSales: '售后管理', userManagement:'用户管理', realNameReviews:'实名认证审核' };
const navIcons = { overview: 'grid', clubConfig: 'game', memberManagement: 'users', serviceManagement: 'headset', examinerManagement: 'headset', afterSales: 'receipt', financeManagement:'wallet', orderManagement:'receipt', userManagement:'users', conversations:'message', realNameReviews:'lock' };
const parent = { catalog: 'clubConfig', auditLog: 'clubConfig', topups: 'financeManagement', flows: 'financeManagement', settlements: 'financeManagement', accounts: 'memberManagement', escorts: 'memberManagement', clubMembers: 'memberManagement', clubEscorts: 'memberManagement', financeList:'financeManagement', commissionConfig:'financeManagement', orderList:'orderManagement', transferOrders:'orderManagement', dispatchOrders:'orderManagement', orders:'orderManagement', dispatch:'orderManagement' };
const pageNames = { ...names, auditLog:'操作审计', clubMembers:'俱乐部成员管理', clubEscorts:'俱乐部陪玩管理', serviceManagement:'客服管理', financeList:'财务总览', commissionConfig:'抽佣配置', orderList:'订单列表', transferOrders:'转单列表', dispatchOrders:'派单列表', catalog:'游戏与商品', topups:'充值与退款审核', flows:'资金流水', settlements:'提现与结算', accounts:'账号与权限', escorts:'陪玩档案', conversations:'客户会话', orders:'订单记录', dispatch:'派单台', memberProfile:'个人中心', placeOrder:'个人中心', memberOrders:'我的点单', memberAfterSales:'售后记录', memberWallet:'我的钱包', realNameReviews:'实名认证审核' };
const dtf = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
const timestamp = value => dtf.format(new Date(value));
const safeTimestamp = value => value && Number.isFinite(new Date(value).getTime()) ? timestamp(value) : '—';
const day = () => timestamp(Date.now()).slice(0,10);
const number = value => Number(value || 0).toLocaleString('en-US');
const yuan = value => (Number(value || 0)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const info = text => `<span class="owner-info" tabindex="0" role="note" aria-label="${e(text)}" data-tip="${e(text)}">?</span>`;
const gamesOf = workspace => workspace.catalogGames || workspace.games || [];
let context;
let view = { day: day(), start: `${day().slice(0,7)}-01`, end: day(), summary: null, curve: null, ranks: {}, filters: {}, hiddenSeries: new Set(), collapsed:false, generation:0 };
let refreshTimer;
let membersExpanded=false;
const requestVersions = {};
const nextRequest = key => requestVersions[key] = (requestVersions[key] || 0) + 1;
const rankNames = {escorts:'陪玩接单排名', buyers:'下单用户排名', orders:'已完成订单排名'};
const defaultFilter = () => ({start:view.start,end:view.end,game:'',tag:'',sort:'amount',page:1});
const empty = text => `<div class="owner-empty">${icon('receipt',26)}<p>${e(text)}</p></div>`;
function metricCards(data, daily = false) {
  if (!daily) return `<div class="owner-metrics"><div class="owner-metric"><p>已完成订单总金额 ${info('按订单完成时间统计已完成订单的实付金额；待验收、取消和退款中订单不计入。')}</p><strong>${data ? yuan(data.amountCents) : '—'}</strong><span>元</span></div><div class="owner-metric"><p>完成订单总笔数 ${info('每个已完成订单只计一次，不因陪玩人数增加而重复计数。')}</p><strong>${data ? number(data.orderCount) : '—'}</strong><span>笔</span></div><div class="owner-metric"><p>下单总用户人数 ${info('按下单时间去重统计所有下单用户，包含尚未完成的订单；现有旧订单按老板称呼去重。')}</p><strong>${data ? number(data.buyerCount) : '—'}</strong><span>人</span></div></div>`;
  const cards = [['下单用户数', data?.uv, '人', '按日去重下单用户统计'], ['未支付订单数', data?.unpaidOrderCount, '笔', '当前标记为未支付的订单'], ['已接单订单数', data?.acceptedOrderCount, '笔', '已有陪玩确认接单'], ['已完成订单数', data?.completedOrderCount, '笔', '通过验收并入账'], ['已取消订单数', data?.cancelledOrderCount, '笔', '订单状态为已取消'], ['退款相关订单数', data?.refundedOrderCount, '笔', '退款审核或已退款订单'], ['已完成订单金额', data?.completedAmountCents == null ? null : yuan(data.completedAmountCents), '元', '已完成订单的实付金额'], ['已完成订单用户数', data?.completedBuyerCount, '人', '完成订单用户去重'], ['平均订单金额', data?.averageOrderCents == null ? null : yuan(data.averageOrderCents), '元', '完成金额除以完成订单数']];
  return `<div class="owner-metrics daily-business-metrics">${cards.map(([title,value,unit,note])=>`<div class="owner-metric"><p>${title} ${info(note)}</p><strong>${data && value != null ? (typeof value === 'string' ? value : number(value)) : '—'}</strong><span>${unit}</span></div>`).join('')}</div>`;
}
const dateInput = (name,value,label) => `<input type="date" name="${name}" value="${e(value)}" aria-label="${label}" required>`;
function rangeFields(start,end,prefix) { return `<div class="owner-date-range">${icon('calendar',14)}${dateInput('start',start,`${prefix}开始日期`)}<span>—</span>${dateInput('end',end,`${prefix}结束日期`)}</div>`; }
function operationsPanel(w) {
  const orders = w.orders || [], refunds = w.refunds || [], withdrawals = w.withdrawals || [];
  const chats = (w.conversations || []).filter(chat => chat.state !== '已结束');
  const overdue = chats.filter(chat => chat.slaDueAt && Date.parse(chat.slaDueAt) < Date.now()).length;
  const tasks = [
    ['待派订单', orders.filter(order => order.status === '待接单').length, '匹配游戏、等级与在线陪玩', 'dispatch', 'game', 'orange'],
    ['完单待验收', orders.filter(order => order.status === '待验收').length, '核验完单说明后结算收益', 'orders', 'check', 'green'],
    ['退款待处理', refunds.filter(refund => ['待审核', '待线下退款'].includes(refund.status)).length, '审核申请或登记实际退款流水', 'topups', 'receipt', 'pink'],
    ['提现待审核', withdrawals.filter(item => item.status === '待审核').length, '核验成员状态与提现金额', 'settlements', 'wallet', 'purple'],
    ['等待打款', withdrawals.filter(item => item.status === '待线下打款').length, '实际打款后登记流水号', 'settlements', 'trend', 'blue'],
    ['待跟进会话', chats.length, overdue ? `${overdue} 个会话已超时，请优先跟进` : '回复咨询，推进订单与售后', 'conversations', 'message', overdue ? 'orange' : 'blue'],
  ];
  return `<section class="owner-panel owner-operations" aria-labelledby="operationsHeading"><div class="owner-section-head"><div><p class="owner-eyebrow">星河游戏俱乐部 · 运营工作台</p><h2 id="operationsHeading">先处理待办，让每一单顺利完成</h2><p class="owner-update">按当前业务状态统计 · 更新于 ${timestamp(Date.now()).slice(11)}</p></div><div class="owner-toolbar-actions"><button class="owner-secondary" data-page="orders">查看全部订单</button><button class="owner-primary" data-action="newOrder">${icon('plus',15)} 新建订单</button></div></div><div class="owner-task-grid">${tasks.map(([label,count,note,page,symbol,tone])=>`<button class="owner-task-card ${tone}" data-page="${page}"><span class="owner-task-label"><i>${icon(symbol,18)}</i>${label}${icon('arrow',15)}</span><strong>${number(count)}<small>${page==='conversations'?'条':'笔'}</small></strong><span class="owner-task-note">${e(note)}</span></button>`).join('')}</div><div class="owner-flow-guide"><span>订单履约</span><b>创建订单</b>${icon('arrow',13)}<b>派单接单</b>${icon('arrow',13)}<b>服务完单</b>${icon('arrow',13)}<b>验收入账</b>${icon('arrow',13)}<b>提现打款</b></div></section>`;
}
function home(w) {
  return `${operationsPanel(w)}<section class="owner-panel totals-panel" aria-labelledby="totalHeading"><div class="owner-section-head"><h2 id="totalHeading">经营总数据 ${info('累计数据每四小时生成一次快照。页面显示本次统计截止时间，刷新页面不会提前重算。')}</h2><div><button class="owner-link" id="exportSummary">导出 CSV</button><span class="owner-update" id="totalUpdate">正在获取经营数据…</span></div></div><div id="totalMetrics">${metricCards(null)}</div></section>
  <section class="owner-panel daily-panel" aria-labelledby="dayHeading"><div class="owner-section-head"><div class="owner-title-line"><h2 id="dayHeading">日经营数据 ${info('按北京时间 00:00–次日 00:00 查询，每五分钟刷新；今天只包含截至查询时刻的数据。')}</h2><span class="owner-update" id="dailyUpdate"></span></div><form class="owner-query" id="dailyForm"><div class="owner-date-range">${icon('calendar',14)}${dateInput('day',view.day,'日经营数据日期')}</div><button class="owner-primary">查询</button></form></div><div id="dailyMetrics">${metricCards(null, true)}</div><p id="dailyError" class="owner-error" role="alert"></p></section>
  <section class="owner-panel curve-panel" aria-labelledby="curveHeading"><div class="owner-section-head"><h2 id="curveHeading">订单流水趋势 ${info('蓝线为已完成订单笔数（左轴），绿线为已完成订单金额 GMV（右轴）；无订单日期补零。')}</h2><form class="owner-query" id="curveForm">${rangeFields(view.start,view.end,'经营曲线')}<button class="owner-primary">查询</button></form></div><p id="curveError" class="owner-error" role="alert"></p><div id="curveChart" aria-live="polite">${empty('正在加载经营曲线…')}</div></section>
  <section class="owner-panel ranking-panel" aria-labelledby="rankingHeading"><div class="owner-section-head"><div><h2 id="rankingHeading">经营排名数据 ${info('各榜单可独立设置日期、游戏和 Tag。点击名称或订单号可查看该项在当前筛选条件下的已完成订单。')}</h2><p class="owner-update" id="rankUpdate">当前时间 ${timestamp(Date.now())}</p></div><span class="owner-rank-hint">点击排名查看订单明细</span></div><div class="owner-rank-grid">${Object.keys(rankNames).map(kind=>rankCard(kind)).join('')}</div></section>`;
}
function rankCard(kind) {
  const f = view.filters[kind] ||= defaultFilter();
  return `<article class="owner-rank-card" id="rank-${kind}"><h3>${rankNames[kind]}</h3><form class="owner-rank-form" data-rank-form="${kind}"><div class="owner-rank-date">${rangeFields(f.start,f.end,rankNames[kind])}<button class="owner-primary">查询</button></div><div class="owner-rank-selects"><select name="game" aria-label="${rankNames[kind]}游戏"><option value="">全部游戏</option></select><select name="tag" aria-label="${rankNames[kind]}Tag"><option value="">全部 Tag</option></select><select name="sort" aria-label="${rankNames[kind]}排序"><option value="amount" ${f.sort==='amount'?'selected':''}>按金额</option><option value="count" ${f.sort==='count'?'selected':''}>按笔数</option></select></div></form><p class="owner-error" role="alert"></p><div class="owner-rank-results">${empty('正在加载排名…')}</div></article>`;
}
function groupContent(page, w) {
  if (page === 'realNameReviews') return realNameReviewsMarkup(w);
  if(['clubMembers','clubEscorts','memberManagement','accounts','escorts'].includes(page)) return membersMarkup(context, ['clubEscorts','escorts'].includes(page)?'clubEscorts':'clubMembers');
  const subnav = (links) => `<div class="owner-subnav">${links.map(([p,n])=>`<button data-page="${p}">${n} ${icon('arrow',14)}</button>`).join('')}</div>`;
  if (page==='clubConfig') return `<section class="owner-panel"><div class="owner-section-head"><h2>俱乐部配置</h2><span class="owner-update">单俱乐部专属工作空间</span></div><div class="owner-config-grid"><div><span>俱乐部名称</span><strong>${e(w.clubName)}</strong></div><div><span>经营统计时区</span><strong>北京时间（UTC+08:00）</strong></div><div><span>总数据更新频率</span><strong>每 4 小时更新</strong></div><div><span>抽佣规则</span><strong>按游戏配置</strong></div></div>${subnav([['catalog','游戏与商品'],['auditLog','操作审计']])}</section>`;
  if (page==='serviceManagement') return staffPanel(w,'service','客服管理','订单、会话、派单与完单验收');
  if (page==='examinerManagement') return staffPanel(w,'examiner','考官管理','查看陪玩游戏资料与考核范围');
  if (page==='afterSales') {
    return staffPanel(w,'afterSales','售后管理','退款、订单验收与客户会话');
  }
  if (page==='userManagement') return userManagementPage(w);
  if (page==='auditLog') return auditPage();
  if (['financeManagement','financeList'].includes(page)) return financeListPage(w);
  if (page==='commissionConfig') return commissionConfigPage(w);
  if (['orderManagement','orderList','transferOrders','dispatchOrders'].includes(page)) return orderManagementPage(page==='orderManagement'?'orderList':page,w);
  return context.legacyContent();
}
function orderManagementPage(page,w) {
  const orders = w.orders || [];
  const title = page==='orderList'?'订单列表':page==='transferOrders'?'转单列表':'派单列表';
  const rows = (page==='transferOrders' ? orders.filter(o=>o.history?.some(h=>/转单|退回派单池/.test(String(h.action)))) : page==='dispatchOrders' ? orders.filter(o=>o.participants?.length || o.history?.some(h=>h.action==='客服派单')) : orders).slice().sort((a,b)=>Date.parse(b.createdAt || 0)-Date.parse(a.createdAt || 0));
  const options = values => [...new Set(values)].filter(Boolean).map(value=>`<option value="${e(value)}">${e(value)}</option>`).join('');
  return `<section class="owner-panel"><div class="owner-section-head"><div><h2>${title}</h2><span class="owner-update">查看服务进度，按当前状态处理下一步</span></div><div class="owner-toolbar-actions"><button class="owner-secondary" data-page="dispatch">进入派单台</button><button class="owner-primary" data-action="newOrder">新建订单</button></div></div><form class="owner-list-filters" id="orderManagementFilters"><label class="owner-user-search">${icon('search',15)}<input id="orderManagementSearch" name="query" type="search" placeholder="搜索单号、老板、陪玩或商品" aria-label="搜索${title}"></label><select name="status" aria-label="订单状态"><option value="">全部状态</option>${options(rows.map(o=>o.status))}</select><select name="game" aria-label="订单游戏"><option value="">全部游戏</option>${options(rows.map(o=>o.game))}</select><button type="reset" class="owner-secondary">重置</button></form><div class="owner-list-count" id="orderManagementCount" aria-live="polite">共 ${rows.length} 笔</div><div class="owner-standard-table"><table><thead><tr><th>订单编号 / 下单时间</th><th>老板</th><th>游戏 / 商品</th><th>陪玩</th><th>状态</th><th>金额（元）</th><th>操作</th></tr></thead><tbody id="orderManagementResults">${rows.map(o=>`<tr data-order-management-row="${e([o.id,o.boss,o.game,o.product,(o.participants||[]).map(p=>p.name).join(' ')].join(' '))}" data-status="${e(o.status)}" data-game="${e(o.game)}"><td><strong>${e(o.id)}</strong><small>${e(safeTimestamp(o.createdAt))}</small></td><td>${e(o.boss)}</td><td>${e(o.game)}<small>${e(o.product)} · ${e(o.hours)} 小时</small></td><td>${e((o.participants||[]).map(p=>p.name).join(' / ')||'待分配')}</td><td><span class="owner-order-status ${['待接单','待验收','退款审核'].includes(o.status)?'pending':''}">${e(o.status)}</span></td><td class="owner-money">${yuan(o.amountCents)}${o.refundedCents?`<small>已退 ${yuan(o.refundedCents)}</small>`:''}</td><td><div class="owner-row-actions"><button class="owner-link" data-action="detail" data-id="${e(o.id)}">详情</button>${o.status==='待接单'?`<button class="owner-link" data-action="dispatch" data-id="${e(o.id)}">${o.selectionRequired ? '拉打手' : '派单'}</button>`:''}${['待确认','待服务','陪玩中'].includes(o.status)?`<button class="owner-link" data-action="transfer" data-id="${e(o.id)}">转单</button>`:''}${o.status==='待验收'?`<button class="owner-link" data-action="review" data-id="${e(o.id)}">验收</button>`:''}${o.status==='退款审核'?`<button class="owner-link" data-action="refundReview" data-id="${e(o.id)}">审核退款</button>`:''}</div></td></tr>`).join('')}</tbody></table></div><div id="orderManagementEmpty" class="owner-empty" ${rows.length?'hidden':''}>${icon('receipt',26)}<p>${rows.length?'没有符合筛选条件的订单':'暂无相关订单记录'}</p><button class="owner-link" data-page="orders">进入订单工作台 →</button></div></section>`;
}
function bindOrderManagementSearch() {
  const form=document.querySelector('#orderManagementFilters');if(!form)return;
  const draw=()=>{const query=form.elements.query.value.trim().toLowerCase();let count=0;document.querySelectorAll('[data-order-management-row]').forEach(row=>{row.hidden=!row.dataset.orderManagementRow.toLowerCase().includes(query)||(form.elements.status.value&&row.dataset.status!==form.elements.status.value)||(form.elements.game.value&&row.dataset.game!==form.elements.game.value);if(!row.hidden)count++;});document.querySelector('#orderManagementCount').textContent=`共 ${count} 笔符合条件的订单`;document.querySelector('#orderManagementEmpty').hidden=count>0;};
  form.oninput=draw;form.onchange=draw;form.onsubmit=event=>event.preventDefault();form.onreset=()=>setTimeout(draw,0);
}
function financeListPage(w) {
  const withdrawals=w.withdrawals||[], ledger=w.ledger||[], batches=w.settlements||[];
  const sum=status=>withdrawals.filter(row=>row.status===status).reduce((total,row)=>total+Number(row.amountCents||0),0);
  const metrics=[['已登记打款',sum('已打款'),'以打款流水号登记完成为准'],['待线下打款',sum('待线下打款'),'已审核通过，等待实际付款'],['待审核提现',sum('待审核'),'申请金额已从可提现余额冻结'],['陪玩订单入账',ledger.filter(row=>row.label==='订单分成').reduce((total,row)=>total+Number(row.deltaCents||0),0),'按订单验收产生的分成流水累计']];
  return `<section class="owner-panel"><div class="owner-section-head"><div><h2>财务总览</h2><span class="owner-update">提现状态与账户流水统一核对，金额以实际记录为准</span></div><div class="owner-toolbar-actions"><button class="owner-secondary" data-page="flows">资金流水</button><button class="owner-primary" data-page="settlements">处理提现</button></div></div><div class="owner-finance-metrics">${metrics.map(([title,value,note])=>`<div class="owner-metric"><p>${title}</p><strong>${yuan(value)}</strong><span>元</span><small>${note}</small></div>`).join('')}</div><div class="owner-section-head owner-finance-title"><div><h2>提现明细</h2><span class="owner-update">审核通过后进入待打款，登记流水号后才计为已打款</span></div><label class="owner-user-search">${icon('search',15)}<input id="financeSearch" type="search" placeholder="搜索提现单、成员、状态或流水号" aria-label="搜索提现明细"></label></div><div class="owner-standard-table"><table><thead><tr><th>提现单 / 申请时间</th><th>成员</th><th>申请金额（元）</th><th>状态</th><th>打款流水号</th><th>打款时间</th><th>驳回原因</th></tr></thead><tbody>${withdrawals.map(r=>`<tr data-finance-row="${e([r.id,r.name,r.userId,r.status,r.payoutRef].filter(Boolean).join(' '))}"><td>${e(r.id)}<small>${e(safeTimestamp(r.at))}</small></td><td>${e(r.name)}<small>${e(r.userId)}</small></td><td class="owner-money">${yuan(r.amountCents)}</td><td><span class="owner-order-status ${r.status==='已打款'?'':'pending'}">${e(r.status)}</span></td><td>${e(r.payoutRef||'—')}</td><td>${e(safeTimestamp(r.paidAt))}</td><td>${e(r.reason||'—')}</td></tr>`).join('')}</tbody></table></div><div class="owner-empty" id="financeEmpty" ${withdrawals.length?'hidden':''}>${icon('wallet',26)}<p>${withdrawals.length?'没有符合条件的提现记录':'暂无提现申请，后续申请将自动显示在这里'}</p></div></section><section class="owner-panel"><div class="owner-section-head"><div><h2>最近资金变动</h2><span class="owner-update">充值、订单消费、分成、退款与提现均保留关联单号</span></div><button class="owner-link" data-page="flows">查看全部 ${ledger.length} 条 →</button></div><div class="owner-standard-table"><table><thead><tr><th>时间</th><th>账户</th><th>业务类型</th><th>变动金额（元）</th><th>变动后余额（元）</th><th>关联单号</th><th>操作人</th></tr></thead><tbody>${ledger.slice().sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,10).map(r=>`<tr><td>${e(safeTimestamp(r.at))}</td><td>${e(r.account||r.userId||'—')}</td><td>${e(r.label)}</td><td class="owner-money ${r.deltaCents<0?'outflow':'inflow'}">${r.deltaCents>0?'+':''}${yuan(r.deltaCents)}</td><td>${yuan(r.afterCents)}</td><td>${e(r.source||'—')}</td><td>${e(r.by||'—')}</td></tr>`).join('')||'<tr><td colspan="7"><div class="owner-empty">暂无资金变动记录</div></td></tr>'}</tbody></table></div>${batches.length?`<p class="owner-finance-note">另有 ${batches.length} 组历史结算批次，可在<a href="#/management/settlements" data-page="settlements">提现与结算</a>查看；历史批次不计入当前提现与入账汇总。</p>`:''}</section>`;
}
function bindFinanceSearch() {
  const input=document.querySelector('#financeSearch'); if(!input)return;
  input.oninput=()=>{const q=input.value.trim().toLowerCase();let count=0;document.querySelectorAll('[data-finance-row]').forEach(row=>{row.hidden=!row.dataset.financeRow.toLowerCase().includes(q);if(!row.hidden)count++;});document.querySelector('#financeEmpty').hidden=count>0;};
}
function commissionConfigPage(w) {
  return `<section class="owner-panel"><div class="owner-section-head"><h2>抽佣配置</h2><span class="owner-update">按陪玩游戏设置分成，已派订单保持原比例</span></div><form id="commissionForm"><div class="owner-standard-table"><table><thead><tr><th>游戏</th><th>分类</th><th>状态</th><th>陪玩抽成比例（%）</th></tr></thead><tbody>${gamesOf(w).map(g=>`<tr><td>${e(g.name)}</td><td>${e(g.category||'—')}</td><td>${e(g.state||'')}</td><td><input type="number" name="${e(g.name)}" value="${(g.commissionBps??7000)/100}" min="0.01" max="100" step="0.01" required></td></tr>`).join('')}</tbody></table></div><button class="owner-primary" type="submit">保存抽佣配置</button><p class="owner-error" id="commissionError"></p></form></section>`;
}
function staffPanel(w, role, title, scope) {
  const rows=w.staffGroups[role];
  const status = u => `<span class="owner-status ${u.active?'':'off'}">${u.active?'正常':'停用'}</span>`;
  const online = u => `<span class="owner-status ${u.online?'online':''}">${u.online?'在线':'离线'}</span>`;
  return `<section class="owner-panel"><div class="owner-section-head"><div><h2>${title}</h2><span class="owner-update">共 ${rows.length} 人 · 在成员管理设置身份后自动同步</span></div><label class="owner-user-search">${icon('search',15)}<input id="staffSearch-${role}" type="search" placeholder="搜索用户 ID 或昵称" aria-label="搜索${title}成员"></label></div><div class="owner-standard-table"><table><thead><tr><th>用户ID</th><th>昵称</th><th>头像</th><th>成员状态</th><th>在线状态</th><th>身份</th></tr></thead><tbody id="staffResults-${role}"></tbody></table></div></section>`;
}
function bindStaffManagement(role) {
  const input=document.querySelector(`#staffSearch-${role}`), body=document.querySelector(`#staffResults-${role}`), rows=context.state.workspace.staffGroups[role]||[];
  if(!input||!body)return;
  const status=u=>`<span class="owner-status ${u.active?'':'off'}">${u.active?'正常':'停用'}</span>`;
  const online=u=>`<span class="owner-status ${u.online?'online':''}">${u.online?'在线':'离线'}</span>`;
  const draw=()=>{const q=input.value.trim().toLowerCase();const visible=rows.filter(u=>[u.id,u.memberNo,u.name,u.username].some(v=>String(v||'').toLowerCase().includes(q)));body.innerHTML=visible.map(u=>`<tr><td title="编号 ${e(u.memberNo || '')}">${e(u.id)}</td><td>${e(u.name)}</td><td><span class="owner-staff-avatar" aria-label="${e(u.name)}的头像">${e(u.name.slice(0,1))}</span></td><td>${status(u)}</td><td>${online(u)}</td><td>${e(u.roleLabel)}</td></tr>`).join('')||'<tr><td colspan="6"><div class="owner-empty">没有找到符合条件的成员</div></td></tr>';};
  input.oninput=draw;draw();
}
function userManagementPage(w) {
  const users = w.users || [];
  const money = value => `¥ ${(Number(value || 0) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`;
  return `<section class="owner-panel user-management-panel"><div class="owner-section-head"><div><h2>用户管理</h2><p class="owner-update">俱乐部下单用户 · 共 ${users.length} 人</p></div><label class="owner-user-search">${icon('search',15)}<input id="userSearch" type="search" placeholder="搜索用户 ID、昵称、账号或联系方式" aria-label="搜索用户" autocomplete="off"></label></div><div class="owner-standard-table"><table><thead><tr><th>用户 ID</th><th>昵称</th><th>账号标识</th><th>联系方式</th><th>俱乐部身份</th><th>余额（元）</th><th>订单数</th><th>已完成订单</th><th>累计消费（元）</th><th>状态</th></tr></thead><tbody id="userResults"></tbody></table></div></section>`;
}
function bindUserManagement() {
  const input = document.querySelector('#userSearch');
  const body = document.querySelector('#userResults');
  const users = context.state.workspace.users || [];
  if (!input || !body) return;
  const money = value => `¥ ${(Number(value || 0) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`;
  const draw = () => {
    const query = input.value.trim().toLowerCase();
    const rows = users.filter(user => [user.id, user.customerNo, user.name, user.username, user.phone, user.memberRoleLabel].some(value => String(value || '').toLowerCase().includes(query)));
    body.innerHTML = rows.map(user => `<tr><td><strong>${e(user.customerNo || user.id)}</strong><small>${e(user.id)}</small></td><td><span class="owner-staff-avatar" aria-label="${e(user.name)}的头像">${e(String(user.name || '?').slice(0, 1))}</span><b class="user-name-cell">${e(user.name)}</b></td><td>${e(user.username || '—')}</td><td>${e(user.phone || '未填写')}</td><td><span class="owner-status ${user.joinedClub ? '' : 'off'}">${user.joinedClub ? e(user.memberRoleLabel || '已加入') : '未加入'}</span></td><td>${money(user.balanceCents)}</td><td>${number(user.orderCount)}</td><td>${number(user.completedOrderCount)}</td><td>${money(user.totalSpentCents)}</td><td><span class="owner-status ${user.active ? '' : 'off'}">${user.active ? '正常' : '停用'}</span></td></tr>`).join('') || '<tr><td colspan="10"><div class="owner-empty">没有找到符合条件的用户</div></td></tr>';
  };
  input.oninput = draw;
  draw();
}
function auditPage() { return `<section class="owner-panel"><div class="owner-section-head"><div><h2>操作审计</h2><span class="owner-update">记录关键权限、订单和资金操作，最多显示最近 200 条</span></div><label class="owner-user-search">${icon('search',15)}<input id="auditSearch" type="search" placeholder="搜索操作、操作人或时间" aria-label="搜索操作审计"></label></div><div class="owner-standard-table"><table><thead><tr><th>时间</th><th>操作人</th><th>操作</th></tr></thead><tbody id="auditResults"><tr><td colspan="3">正在加载审计记录…</td></tr></tbody></table></div></section>`; }
async function bindAudit() {
  const input=document.querySelector('#auditSearch'), body=document.querySelector('#auditResults'); if(!input||!body)return;
  const draw=async()=>{ try { const rows=await context.api(`/audit?query=${encodeURIComponent(input.value.trim())}`); body.innerHTML=rows.map(item=>`<tr><td>${e(timestamp(item.at))}</td><td>${e(item.by)}</td><td>${e(item.action)}</td></tr>`).join('')||'<tr><td colspan="3"><div class="owner-empty">暂无审计记录</div></td></tr>'; } catch(err){ body.innerHTML=`<tr><td colspan="3">${e(err.message)}</td></tr>`; } };
  input.oninput=draw; await draw();
}
function bindExports() {
  const button=document.querySelector('#exportSummary'); if(!button)return;
  button.onclick=async()=>{ button.disabled=true; try { const result=await context.api(`/analytics/export?kind=summary&day=${encodeURIComponent(view.day)}`); const link=document.createElement('a'); link.href=URL.createObjectURL(new Blob([result.content],{type:result.mime})); link.download=result.filename; link.click(); setTimeout(()=>URL.revokeObjectURL(link.href),1000); } catch(err){ context.toast(err.message); } finally { button.disabled=false; } };
}
export function renderOwner(ctx) {
  context = ctx; clearTimeout(refreshTimer);
  const w=ctx.state.workspace; const page=ctx.state.page; const active=parent[page]||page; const title=pageNames[page]||'首页';
  view.generation++;
  if(active==='memberManagement') membersExpanded=true;
  const personal = ctx.state.mode === 'personal';
  const admin = w.user.role === 'admin';
  const content = personal ? context.legacyContent() : (admin ? (page === 'overview' ? home(w) : groupContent(page,w)) : context.legacyContent());
  const navigation = admin ? ownerNavigation(active,page) : restrictedNavigation(w, page);
  const staffAction = !admin && w.user.role === 'escort' ? `<button class="owner-link" data-action="online">${w.user.online ? '在线接单中' : '离线接单'}</button>` : '';
  const realNameGate = !admin && w.user.role === 'escort' ? realNameNotice(w) : '';
  document.querySelector('#app').innerHTML=`<div class="owner-shell ${view.collapsed?'is-collapsed':''}"><aside class="owner-sidebar"><div class="owner-brand"><span class="owner-brand-symbol">${icon('game',24)}</span><strong>${e(w.clubName)}</strong></div><nav aria-label="${admin?'最高负责人':'职责'}主导航">${navigation}</nav></aside><main class="owner-main"><header class="owner-topbar"><div><button class="owner-icon-button" id="collapseOwnerNav" aria-label="${view.collapsed?'展开':'收起'}侧边栏" aria-expanded="${!view.collapsed}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 5h18M3 12h7M3 19h18m5-10-3 3 3 3"/></svg></button><span class="owner-breadcrumb">${title}</span></div><div class="owner-top-actions"><button class="owner-icon-button owner-home-button" data-action="enterHome" aria-label="返回网站首页">返回网站首页</button>${admin?'<button class="owner-link" id="metricRules">统计口径</button>':''}${staffAction}<span class="owner-user-avatar">${icon('users',20)}</span><span class="owner-username">${e(w.user.name)}</span><span class="owner-role">${e(w.user.roleLabel)}</span><button class="owner-icon-button" data-action="logout" aria-label="退出登录">退出</button></div></header><div class="owner-page-tabs"><span class="owner-page-tab"><i></i>${title}</span></div><div class="owner-content" id="ownerContent">${realNameGate}${content}</div></main></div>`;
  document.querySelector('#collapseOwnerNav').onclick=()=>{ view.collapsed=!view.collapsed; document.querySelector('.owner-shell').classList.toggle('is-collapsed',view.collapsed); document.querySelector('#collapseOwnerNav').setAttribute('aria-expanded',String(!view.collapsed)); };
  if(admin) document.querySelector('#metricRules').onclick=()=>ctx.dialog('经营数据统计口径', `<p>金额以人民币元展示，内部以整数分汇总。</p><p>完成金额、完成笔数：按完成时间统计当前已完成订单。下单人数：按下单时间对客户去重；历史账号缺少客户 ID 时使用老板称呼。</p><p>日期按北京时间 00:00 至次日 00:00 计算，结束日期包含当天。总数据每四小时更新，日经营数据每五分钟刷新。</p><p>排名只包含已完成订单。陪玩榜每位成员统计参与订单的全额，同一多人订单可出现在多位成员下，成员金额不能相加作为俱乐部 GMV，也不等于个人到手收益。</p><p>旧示例订单未记录完成时间时使用示例下单时间。真实订单缺少完成时间时不纳入日期统计。</p>`);
  document.querySelectorAll('[data-page]').forEach(btn=>btn.onclick=()=>ctx.navigate(btn.dataset.page));
  const toggleNav = (id,submenu) => { const button=document.querySelector(`#${id}`), menu=document.querySelector(`#${submenu}`); if(!button||!menu)return; button.onclick=()=>{const open=menu.hidden; menu.hidden=!open; button.setAttribute('aria-expanded',String(open));}; };
  toggleNav('memberNavGroup','memberManagementSubmenu');
  toggleNav('clubConfigNavGroup','clubConfigSubmenu');
  toggleNav('financeManagementNavGroup','financeManagementSubmenu');
  toggleNav('orderManagementNavGroup','orderManagementSubmenu');
  if(['clubMembers','clubEscorts','memberManagement','accounts','escorts'].includes(page)) bindMembers(['clubEscorts','escorts'].includes(page)?'clubEscorts':'clubMembers');
  if(page==='userManagement') bindUserManagement();
  if(['financeManagement','financeList'].includes(page)) bindFinanceSearch();
  if(['orderManagement','orderList','transferOrders','dispatchOrders'].includes(page)) bindOrderManagementSearch();
  if(['serviceManagement','examinerManagement','afterSales'].includes(page)) bindStaffManagement(page==='serviceManagement'?'service':page==='examinerManagement'?'examiner':'afterSales');
  if(admin && page==='overview') bindDashboard();
  if(admin && page==='overview') bindExports();
  if(page==='auditLog') bindAudit();
  if(page==='commissionConfig') document.querySelector('#commissionForm').onsubmit=async ev=>{ev.preventDefault();const form=ev.currentTarget;try{await ctx.api('/commissions',{games:gamesOf(w).map(g=>({name:g.name,commissionBps:Math.round(Number(form.elements[g.name].value)*100)}))});await ctx.refresh();ctx.toast('抽佣配置已保存');}catch(err){document.querySelector('#commissionError').textContent=err.message;}};
  if(page === 'realNameReviews') bindRealName({ state: ctx.state, api: ctx.api, refresh: ctx.refresh, toast: ctx.toast, dialog: ctx.dialog });
}
const restrictedGroups = {
  service: [['overview','工作台'],['orders','订单管理'],['conversations','会话中心'],['dispatch','派单台']],
  examiner: [['overview','工作台'],['examinerCandidates','陪玩游戏资料']],
  afterSales: [['overview','工作台'],['orders','订单管理'],['conversations','会话中心']],
  finance: [['overview','工作台'],['topups','充值审核'],['flows','资金流水'],['settlements','提现与结算']],
  escort: [['overview','工作台'],['availableOrders','接单大厅'],['myOrders','我的订单'],['myEarnings','我的收益'],['conversations','我的咨询']],
  member: [['overview','返回首页'],['memberProfile','个人中心'],['memberOrders','我的点单'],['memberAfterSales','售后记录'],['memberWallet','我的钱包']],
  user: [['overview','返回首页'],['memberProfile','个人中心'],['memberOrders','我的点单'],['memberAfterSales','售后记录'],['memberWallet','我的钱包']],
};
function restrictedNavigation(w, page) {
  const items = (restrictedGroups[w.user.role] || [['overview','工作台']]).filter(([target]) => w.role.pages.includes(target));
  return items.map(([target, label]) => {
    const isPublicHome = target === 'overview' && ['member', 'user'].includes(w.user.role);
    const action = isPublicHome ? 'data-action="enterHome"' : `data-page="${target}"`;
    return `<button class="owner-nav-item ${page===target?'active':''}" ${action} aria-label="${label}" ${page===target?'aria-current="page"':''}>${icon(target==='overview'?'grid':target==='memberProfile'?'users':target==='availableOrders'?'game':target==='myEarnings'?'wallet':target==='memberWallet'?'wallet':target==='conversations'?'users':target==='dispatch'?'trend':target==='topups'?'wallet':target==='flows'?'trend':target==='settlements'?'wallet':target==='examinerCandidates'?'users':target==='memberAfterSales'?'headset':'receipt',17)}<span>${label}</span></button>`;
  }).join('');
}
export function leaveOwner() { clearTimeout(refreshTimer); view.generation++; }
async function request(section, values={}) { return context.api(`/analytics/${section}?${new URLSearchParams(values)}`); }
function current(generation) { return generation===view.generation && context.state.workspace?.user.role==='admin' && context.state.page==='overview' && !!document.querySelector('#totalMetrics'); }
function setSummary(result) {
  view.summary=result;
  document.querySelector('#totalMetrics').innerHTML=metricCards(result.totals);
  document.querySelector('#totalUpdate').textContent=`统计截止 ${timestamp(result.totals.asOf)}，此数据每 4 小时更新一次`;
  document.querySelector('#totalUpdate').title=`下次更新：${timestamp(result.totals.nextUpdateAt)}`;
  document.querySelector('#dailyMetrics').innerHTML=metricCards(result.daily, true);
  document.querySelector('#dailyUpdate').textContent=`${result.daily.day} · 更新于 ${timestamp(result.daily.asOf).slice(11)}`;
  for (const kind of Object.keys(rankNames)) populateSelects(kind);
}
function populateSelects(kind) {
  const form=document.querySelector(`[data-rank-form="${kind}"]`); if(!form) return;
  const initialized=form.elements.game.dataset.loaded==='true';
  const chosenGame=initialized ? form.elements.game.value : view.filters[kind].game;
  const chosenTag=initialized ? form.elements.tag.value : view.filters[kind].tag;
  const games=gamesOf(context.state.workspace).map(game=>game.name);
  form.elements.game.innerHTML='<option value="">全部游戏</option>'+games.map(g=>`<option value="${e(g)}">${e(g)}</option>`).join(''); form.elements.game.value=games.includes(chosenGame)?chosenGame:'';
  const filter=view.filters[kind];
  const validGame=!filter.game || games.includes(filter.game);
  const validTag=!filter.tag || catalogTags(context.state.workspace.products, filter.game).includes(filter.tag);
  if (!validGame || !validTag) {
    if (!validGame) filter.game='';
    filter.tag=''; filter.page=1;
    delete view.ranks[kind]; nextRequest(kind);
  }
  form.elements.game.dataset.loaded='true'; fillTags(form,chosenTag);
}
function fillTags(form,selected='') {
  // Workspace products update with catalog edits. A cached analytics summary
  // must never restore a deleted or renamed option on any of the three lists.
  const tags=catalogTags(context.state.workspace.products, form.elements.game.value);
  form.elements.tag.innerHTML='<option value="">全部 Tag</option>'+tags.map(t=>`<option value="${e(t)}">${e(t)}</option>`).join('');
  form.elements.tag.value=tags.includes(selected)?selected:'';
}
async function task(form, errorElement, work) {
  const submit=form.querySelector('button[type=submit], button.owner-primary'); if(submit?.disabled) return;
  if(submit) submit.disabled=true; errorElement.textContent='';
  try { await work(); } catch(err) { if(errorElement.isConnected) errorElement.textContent=err.message; } finally { if(submit) submit.disabled=false; }
}
function bindDashboard() {
  const generation=view.generation;
  const daily=document.querySelector('#dailyForm'), curve=document.querySelector('#curveForm');
  daily.onsubmit=event=>{event.preventDefault(); task(daily,document.querySelector('#dailyError'),async()=>{ const version=nextRequest('summary'); const selected=daily.elements.day.value; const result=await request('summary',{day:selected}); if(current(generation)&&version===requestVersions.summary){view.day=selected;setSummary(result);} });};
  curve.onsubmit=event=>{event.preventDefault(); task(curve,document.querySelector('#curveError'),async()=>{const version=nextRequest('trend'); const query=Object.fromEntries(new FormData(curve)); const result=await request('trend',query); if(current(generation)&&version===requestVersions.trend){view.start=query.start;view.end=query.end;view.curve=result;drawChart();}});};
  document.querySelectorAll('[data-rank-form]').forEach(form=>{
    const kind=form.dataset.rankForm;
    populateSelects(kind);
    form.elements.game.onchange=()=>fillTags(form);
    form.onsubmit=event=>{event.preventDefault(); const card=form.closest('.owner-rank-card'); task(form,card.querySelector('.owner-error'),async()=>{
      const version=nextRequest(kind); const query={...Object.fromEntries(new FormData(form)),page:1}; const result=await request('rankings',{kind,...query}); if(current(generation)&&version===requestVersions[kind]){view.filters[kind]=query;view.ranks[kind]=result;drawRank(kind);} });};
  });
  if(view.summary) setSummary(view.summary);
  if(view.curve) drawChart();
  for(const kind of Object.keys(rankNames)) if(view.ranks[kind]) drawRank(kind);
  loadDashboard(generation);
}
async function loadDashboard(generation) {
  if(!current(generation)) return;
  if(document.querySelector('.owner-content .owner-primary:disabled')) {
    refreshTimer=setTimeout(()=>loadDashboard(generation),1000); return;
  }
  const keys=['summary','trend',...Object.keys(rankNames)];
  const versions=keys.map(nextRequest);
  const requests=[request('summary',{day:view.day}),request('trend',{start:view.start,end:view.end}),...Object.keys(rankNames).map(kind=>request('rankings',{kind,...view.filters[kind]}))];
  const results=await Promise.allSettled(requests);
  if(!current(generation)) return;
  results.forEach((r,i)=>{
    if(versions[i]!==requestVersions[keys[i]]) return;
    if(r.status==='rejected') { const target=i===0?'#dailyError':i===1?'#curveError':`#rank-${Object.keys(rankNames)[i-2]} .owner-error`; document.querySelector(target).textContent=r.reason.message; if(i===0)document.querySelector('#totalUpdate').textContent='数据加载失败，请重试'; return; }
    if(i===0)setSummary(r.value); else if(i===1){view.curve=r.value;drawChart();} else {const kind=Object.keys(rankNames)[i-2];view.ranks[kind]=r.value;drawRank(kind);}
  });
  refreshTimer=setTimeout(()=>{if(current(generation))loadDashboard(generation);},5*60*1000);
}
function scale(max) {
  if(max<=5) return {max:5,step:1};
  const raw=max/5; const magnitude=10**Math.floor(Math.log10(raw));
  const step=[1,2,2.5,5,10].find(n=>n*magnitude>=raw)*magnitude;
  return {max:step*5,step};
}
function linePath(points) {
  if(!points.length)return '';
  // Monotone cubic interpolation keeps daily values within adjacent observations.
  if(points.length===1)return `M${points[0].join(',')}`;
  const slopes=points.slice(1).map((p,i)=>(p[1]-points[i][1])/(p[0]-points[i][0]));
  const tangent=points.map((p,i)=>i===0?slopes[0]:i===points.length-1?slopes.at(-1):slopes[i-1]*slopes[i]<=0?0:2/(1/slopes[i-1]+1/slopes[i]));
  return `M${points[0].join(',')} `+points.slice(1).map((p,i)=>{const a=points[i],dx=(p[0]-a[0])/3;return `C${a[0]+dx},${a[1]+tangent[i]*dx} ${p[0]-dx},${p[1]-tangent[i+1]*dx} ${p[0]},${p[1]}`;}).join(' ');
}
function drawChart() {
  const chart=document.querySelector('#curveChart'); if(!chart||!view.curve)return;
  const points=view.curve.points;
  const left=66,right=1010,top=43,bottom=263; const height=bottom-top;
  const orders=scale(Math.max(...points.map(p=>p.orderCount))),gmv=scale(Math.max(...points.map(p=>p.amountCents/100)));
  const x=i=>points.length===1?(left+right)/2:left+(right-left)*i/(points.length-1);
  const tickEvery=Math.max(1,Math.ceil(points.length/12));
  const series=[{key:'orders',name:'订单数',color:'#5470c6',values:points.map(p=>p.orderCount),axis:orders},{key:'gmv',name:'GMV',color:'#91cc75',values:points.map(p=>p.amountCents/100),axis:gmv}];
  chart.innerHTML=`<div class="owner-chart-legend">${series.map(s=>`<button data-series="${s.key}" aria-pressed="${!view.hiddenSeries.has(s.key)}" class="${view.hiddenSeries.has(s.key)?'is-muted':''}"><span style="--series-color:${s.color}"></span>${s.name}</button>`).join('')}</div><div class="owner-chart-wrap"><svg viewBox="0 0 1100 300" role="img" aria-label="${e(view.curve.start)} 至 ${e(view.curve.end)} 订单数与 GMV 双轴经营曲线"><text x="47" y="23">订单数</text><text x="1010" y="23">元</text>${Array.from({length:6},(_,i)=>{const y=bottom-height*i/5; return `<line x1="${left}" x2="${right}" y1="${y}" y2="${y}" stroke="#e9edf3"/><text x="56" y="${y+4}" text-anchor="end">${number(orders.step*i)}</text><text x="1020" y="${y+4}">${number(gmv.step*i)}</text>`;}).join('')}<line x1="${left}" x2="${right}" y1="${bottom}" y2="${bottom}" stroke="#bfc5d0"/>${points.map((p,i)=>i%tickEvery===0||i===points.length-1?`<text x="${x(i)}" y="281" text-anchor="middle">${p.day.slice(5).replace('-','/')}</text>`:'').join('')}${series.filter(s=>!view.hiddenSeries.has(s.key)).map(s=>{const coords=s.values.map((v,i)=>[x(i),bottom-v/s.axis.max*height]);return `<path d="${linePath(coords)}" fill="none" stroke="${s.color}" stroke-width="2"/>${coords.map((p,i)=>`<circle cx="${p[0]}" cy="${p[1]}" r="2.3" fill="white" stroke="${s.color}" stroke-width="1.8"><title>${points[i].day} ${s.name}：${s.key==='orders'?s.values[i]+' 笔':yuan(points[i].amountCents)+' 元'}</title></circle>`).join('')}`;}).join('')}${points.map((p,i)=>`<rect class="owner-chart-hit" data-point="${i}" tabindex="0" role="button" aria-label="${p.day}，${p.orderCount} 笔，${yuan(p.amountCents)} 元" x="${Math.max(left,x(i)-(right-left)/Math.max(1,points.length-1)/2)}" y="${top}" width="${(right-left)/Math.max(1,points.length-1)}" height="${height}" fill="transparent"/>`).join('')}</svg><div class="owner-chart-tooltip" hidden></div></div><div class="owner-chart-foot"><span>${view.curve.total.orderCount?`区间内已完成 ${number(view.curve.total.orderCount)} 笔订单`:'该时间段暂无已完成订单，曲线按零展示'}</span><button class="owner-link" id="viewChartData">查看逐日数据</button></div>`;
  chart.querySelectorAll('[data-series]').forEach(btn=>btn.onclick=()=>{const k=btn.dataset.series;view.hiddenSeries.has(k)?view.hiddenSeries.delete(k):view.hiddenSeries.add(k);drawChart();});
  const tooltip=chart.querySelector('.owner-chart-tooltip');
  chart.querySelectorAll('[data-point]').forEach(hit=>{
    const show=()=>{const i=Number(hit.dataset.point),p=points[i]; tooltip.innerHTML=`<strong>${p.day}</strong><span><i class="blue"></i>订单数 <b>${number(p.orderCount)} 笔</b></span><span><i class="green"></i>GMV <b>${yuan(p.amountCents)} 元</b></span>`;tooltip.style.left=`${Math.min(75,Math.max(8,x(i)/1100*100))}%`;tooltip.hidden=false;};
    hit.onmouseenter=show;hit.onfocus=show;hit.onmouseleave=()=>tooltip.hidden=true;hit.onblur=()=>tooltip.hidden=true;
  });
  document.querySelector('#viewChartData').onclick=()=>context.dialog('经营曲线 · 逐日数据',`<div class="owner-standard-table"><table><thead><tr><th>日期</th><th>完成订单数</th><th>GMV（元）</th></tr></thead><tbody>${points.map(p=>`<tr><td>${p.day}</td><td>${number(p.orderCount)}</td><td>${yuan(p.amountCents)}</td></tr>`).join('')}</tbody></table></div>`);
}
function drawRank(kind) {
  const card=document.querySelector(`#rank-${kind}`); if(!card)return;
  const result=view.ranks[kind];
  card.querySelector('.owner-rank-results').innerHTML=`<div class="owner-rank-table"><table><thead><tr><th>排名</th><th>${kind==='orders'?'订单编号':'用户昵称'}</th><th>${kind==='escorts'?'接单总笔数':'完成总笔数'}</th><th>${kind==='escorts'?'接单总金额':'订单总金额'}<br>（元）</th></tr></thead><tbody>${result.rows.map(r=>`<tr><td>${r.rank}</td><td><button class="owner-rank-name" data-rank-key="${e(r.key)}" title="${e(r.name)}">${e(r.name)}</button>${kind==='orders'?`<small title="${e(r.game)}">${e(r.game)}</small>`:''}</td><td>${number(r.orderCount)}</td><td>${yuan(r.amountCents)}</td></tr>`).join('') || '<tr><td colspan="4"><div class="owner-empty">当前筛选下暂无已完成订单</div></td></tr>'}</tbody></table></div><div class="owner-pagination"><span>共 ${result.total} 项</span><button data-rank-page="${result.page-1}" aria-label="${rankNames[kind]}上一页" ${result.page===1?'disabled':''}>‹</button><b>${result.page} / ${Math.max(1,Math.ceil(result.total/result.pageSize))}</b><button data-rank-page="${result.page+1}" aria-label="${rankNames[kind]}下一页" ${result.page*result.pageSize>=result.total?'disabled':''}>›</button></div>`;
  card.querySelectorAll('[data-rank-page]').forEach(btn=>btn.onclick=async()=>{const form=card.querySelector('form');task(form,card.querySelector('.owner-error'),async()=>{const version=nextRequest(kind);const filter={...view.filters[kind],page:Number(btn.dataset.rankPage)};const result=await request('rankings',{kind,...filter});if(card.isConnected&&version===requestVersions[kind]){view.filters[kind]=filter;view.ranks[kind]=result;drawRank(kind);}});});
  card.querySelectorAll('[data-rank-key]').forEach(btn=>btn.onclick=()=>showRankDetails(kind,btn.dataset.rankKey));
  document.querySelector('#rankUpdate').textContent=`更新于 ${timestamp(result.asOf)} · 仅统计已完成订单`;
}
async function showRankDetails(kind,key,page=1) {
  const generation=view.generation;
  const filter={...view.filters[kind],kind,key,page,pageSize:10};
  try {
    const data=await request('details',filter);
    if(!current(generation)) return;
    const body=`<div class="owner-detail-summary"><strong>${e(data.name)}</strong><span>${e(filter.start)} 至 ${e(filter.end)}</span><span>${e(filter.game||'全部游戏')} · ${e(filter.tag||'全部 Tag')}</span><b>${data.total} 笔 · ${yuan(data.amountCents)} 元</b></div><div class="owner-standard-table"><table><thead><tr><th>订单编号</th><th>老板 / 陪玩</th><th>游戏 / Tag</th><th>完成时间</th><th>金额（元）</th><th></th></tr></thead><tbody>${data.orders.map(o=>`<tr><td>${e(o.id)}</td><td>${e(o.boss)}<small>${e(o.participants.map(p=>p.name).join(' / '))}</small></td><td>${e(o.game)}<small>${e(o.tags.join(' / '))}</small></td><td>${timestamp(o.completedAt)}</td><td>${yuan(o.amountCents)}</td><td><button class="owner-link" data-report-order="${e(o.id)}">详情</button></td></tr>`).join('')||'<tr><td colspan="6">暂无符合条件的订单</td></tr>'}</tbody></table></div><div class="owner-pagination"><span>第 ${page} / ${Math.max(1,Math.ceil(data.total/data.pageSize))} 页</span><button type="button" id="previousDetailPage" ${page===1?'disabled':''}>上一页</button><button type="button" id="nextDetailPage" ${page*data.pageSize>=data.total?'disabled':''}>下一页</button></div>`;
    const modal=context.dialog('经营排名 · 订单明细',body);modal.classList.add('owner-detail-dialog');
    modal.querySelector('#previousDetailPage').onclick=()=>showRankDetails(kind,key,page-1);
    modal.querySelector('#nextDetailPage').onclick=()=>showRankDetails(kind,key,page+1);
    modal.querySelectorAll('[data-report-order]').forEach(btn=>btn.onclick=()=>{
      const o=data.orders.find(o=>o.id===btn.dataset.reportOrder);
      const detail=context.dialog('订单详情',`<button class="owner-link" type="button" id="backToRanking">← 返回排名明细</button>`+context.orderDetail(o));
      detail.querySelector('#backToRanking').onclick=()=>showRankDetails(kind,key,page);
    });
  } catch(err){context.toast(err.message);}
}

function ownerNavigation(active,page) {
  const groups={clubConfig:[['catalog','游戏与商品'],['auditLog','操作审计']],memberManagement:[['clubMembers','俱乐部成员管理'],['clubEscorts','俱乐部陪玩管理']],financeManagement:[['financeList','财务总览'],['topups','充值与退款审核'],['flows','资金流水'],['settlements','提现与结算'],['commissionConfig','抽佣配置']],orderManagement:[['orderList','全部订单'],['orders','订单处理'],['dispatch','待派单工作台'],['transferOrders','转单记录'],['dispatchOrders','派单记录']]};
  return Object.entries(names).map(([p,n])=>groups[p] ? `<button class="owner-nav-item ${p===active?'active':''}" id="${p==='memberManagement'?'memberNavGroup':p+'NavGroup'}" aria-label="${n}" aria-expanded="${p===active}">${icon(navIcons[p],17)}<span>${n}</span>${icon('chevron',12)}</button><div class="owner-member-submenu" id="${p}Submenu" ${p===active?'':'hidden'}>${groups[p].map(([sub,label])=>`<button data-page="${sub}" class="owner-submenu-item ${page===sub?'active':''}" title="${label}"><i></i><span>${label}</span></button>`).join('')}</div>` : `<button class="owner-nav-item ${p===active?'active':''}" data-page="${p}" aria-label="${n}" ${p===active?'aria-current="page"':''}>${icon(navIcons[p],17)}<span>${n}</span>${p==='overview'?'':icon('chevron',12)}</button>`).join('');
}
