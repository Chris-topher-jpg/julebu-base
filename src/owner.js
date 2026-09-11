import { escapeHtml as e, icon } from './ui.js';
import { membersMarkup, bindMembers, openMemberRole } from './members.js';

const names = { overview: '首页', clubConfig: '俱乐部配置', memberManagement: '成员管理', serviceManagement: '客服管理', examinerManagement: '考官管理', afterSales: '售后管理' };
const navIcons = { overview: 'grid', clubConfig: 'game', memberManagement: 'users', serviceManagement: 'headset', examinerManagement: 'headset', afterSales: 'receipt' };
const parent = { catalog: 'clubConfig', topups: 'clubConfig', flows: 'clubConfig', settlements: 'clubConfig', accounts: 'memberManagement', escorts: 'memberManagement', clubMembers: 'memberManagement', clubEscorts: 'memberManagement', conversations: 'afterSales' };
const pageNames = { ...names, clubMembers:'俱乐部成员管理', clubEscorts:'俱乐部陪玩管理', serviceManagement:'客服管理', catalog:'游戏与商品', topups:'充值审核', flows:'资金流水', settlements:'提现与结算', accounts:'账号与权限', escorts:'陪玩档案', conversations:'客户会话', orders:'订单记录', dispatch:'派单台' };
const dtf = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
const timestamp = value => dtf.format(new Date(value));
const day = () => timestamp(Date.now()).slice(0,10);
const number = value => Number(value || 0).toLocaleString('en-US');
const yuan = value => (Number(value || 0)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const info = text => `<span class="owner-info" tabindex="0" role="note" aria-label="${e(text)}" data-tip="${e(text)}">?</span>`;
let context;
let view = { day: day(), start: `${day().slice(0,7)}-01`, end: day(), summary: null, curve: null, ranks: {}, filters: {}, hiddenSeries: new Set(), collapsed:false, generation:0 };
let refreshTimer;
let membersExpanded=false;
const requestVersions = {};
const nextRequest = key => requestVersions[key] = (requestVersions[key] || 0) + 1;
const rankNames = {escorts:'陪玩接单排名', buyers:'下单用户排名', orders:'已完成订单排名'};
const defaultFilter = () => ({start:view.start,end:view.end,game:'',tag:'',sort:'amount',page:1});
const empty = text => `<div class="owner-empty">${icon('receipt',26)}<p>${e(text)}</p></div>`;
function metricCards(data) {
  return `<div class="owner-metrics"><div class="owner-metric"><p>已完成订单总金额 ${info('按订单完成时间统计已完成订单的实付金额；待验收、取消和退款中订单不计入。')}</p><strong>${data ? yuan(data.amountCents) : '—'}</strong><span>元</span></div><div class="owner-metric"><p>完成订单总笔数 ${info('每个已完成订单只计一次，不因陪玩人数增加而重复计数。')}</p><strong>${data ? number(data.orderCount) : '—'}</strong><span>笔</span></div><div class="owner-metric"><p>下单总用户人数 ${info('按下单时间去重统计所有下单用户，包含尚未完成的订单；现有旧订单按老板称呼去重。')}</p><strong>${data ? number(data.buyerCount) : '—'}</strong><span>人</span></div></div>`;
}
const dateInput = (name,value,label) => `<input type="date" name="${name}" value="${e(value)}" aria-label="${label}" required>`;
function rangeFields(start,end,prefix) { return `<div class="owner-date-range">${icon('calendar',14)}${dateInput('start',start,`${prefix}开始日期`)}<span>—</span>${dateInput('end',end,`${prefix}结束日期`)}</div>`; }
function home() {
  return `<section class="owner-panel totals-panel" aria-labelledby="totalHeading"><div class="owner-section-head"><h2 id="totalHeading">经营总数据 ${info('累计数据每四小时生成一次快照。页面显示本次统计截止时间，刷新页面不会提前重算。')}</h2><span class="owner-update" id="totalUpdate">正在获取经营数据…</span></div><div id="totalMetrics">${metricCards(null)}</div></section>
  <section class="owner-panel daily-panel" aria-labelledby="dayHeading"><div class="owner-section-head"><div class="owner-title-line"><h2 id="dayHeading">日经营数据 ${info('按北京时间 00:00–次日 00:00 查询，每五分钟刷新；今天只包含截至查询时刻的数据。')}</h2><span class="owner-update" id="dailyUpdate"></span></div><form class="owner-query" id="dailyForm"><div class="owner-date-range">${icon('calendar',14)}${dateInput('day',view.day,'日经营数据日期')}</div><button class="owner-primary">查询</button></form></div><div id="dailyMetrics">${metricCards(null)}</div><p id="dailyError" class="owner-error" role="alert"></p></section>
  <section class="owner-panel curve-panel" aria-labelledby="curveHeading"><div class="owner-section-head"><h2 id="curveHeading">订单流水趋势 ${info('蓝线为已完成订单笔数（左轴），绿线为已完成订单金额 GMV（右轴）；无订单日期补零。')}</h2><form class="owner-query" id="curveForm">${rangeFields(view.start,view.end,'经营曲线')}<button class="owner-primary">查询</button></form></div><p id="curveError" class="owner-error" role="alert"></p><div id="curveChart" aria-live="polite">${empty('正在加载经营曲线…')}</div></section>
  <section class="owner-panel ranking-panel" aria-labelledby="rankingHeading"><div class="owner-section-head"><div><h2 id="rankingHeading">经营排名数据 ${info('各榜单可独立设置日期、游戏和 Tag。点击名称或订单号可查看该项在当前筛选条件下的已完成订单。')}</h2><p class="owner-update" id="rankUpdate">当前时间 ${timestamp(Date.now())}</p></div><span class="owner-rank-hint">点击排名查看订单明细</span></div><div class="owner-rank-grid">${Object.keys(rankNames).map(kind=>rankCard(kind)).join('')}</div></section>`;
}
function rankCard(kind) {
  const f = view.filters[kind] ||= defaultFilter();
  return `<article class="owner-rank-card" id="rank-${kind}"><h3>${rankNames[kind]}</h3><form class="owner-rank-form" data-rank-form="${kind}"><div class="owner-rank-date">${rangeFields(f.start,f.end,rankNames[kind])}<button class="owner-primary">查询</button></div><div class="owner-rank-selects"><select name="game" aria-label="${rankNames[kind]}游戏"><option value="">全部游戏</option></select><select name="tag" aria-label="${rankNames[kind]}Tag"><option value="">全部 Tag</option></select><select name="sort" aria-label="${rankNames[kind]}排序"><option value="amount" ${f.sort==='amount'?'selected':''}>按金额</option><option value="count" ${f.sort==='count'?'selected':''}>按笔数</option></select></div></form><p class="owner-error" role="alert"></p><div class="owner-rank-results">${empty('正在加载排名…')}</div></article>`;
}
function groupContent(page, w) {
  if(['clubMembers','clubEscorts','memberManagement','accounts','escorts'].includes(page)) return membersMarkup(context, ['clubEscorts','escorts'].includes(page)?'clubEscorts':'clubMembers');
  const subnav = (links) => `<div class="owner-subnav">${links.map(([p,n])=>`<button data-page="${p}">${n} ${icon('arrow',14)}</button>`).join('')}</div>`;
  if (page==='clubConfig') return `<section class="owner-panel"><div class="owner-section-head"><h2>俱乐部配置</h2><span class="owner-update">单俱乐部专属工作空间</span></div><div class="owner-config-grid"><div><span>俱乐部名称</span><strong>${e(w.clubName)}</strong></div><div><span>经营统计时区</span><strong>北京时间（UTC+08:00）</strong></div><div><span>总数据更新频率</span><strong>每 4 小时更新</strong></div><div><span>订单分成</span><strong>按订单确认时比例留存</strong></div></div>${subnav([['catalog','游戏与商品'],['topups','充值审核'],['flows','资金流水'],['settlements','提现与结算']])}</section>`;
  if (page==='serviceManagement') return staffPanel(w,'service','客服管理','订单、会话、派单与完单验收');
  if (page==='examinerManagement') return staffPanel(w,'examiner','考官管理','查看陪玩技能资料与考核范围');
  if (page==='afterSales') {
    const issues=w.orders.filter(o=>o.status==='退款审核');
    return staffPanel(w,'afterSales','售后管理','退款跟进、订单验收与客户会话') + `<section class="owner-panel"><div class="owner-section-head"><h2>退款待跟进</h2><span class="owner-update">${issues.length} 笔</span></div>${subnav([['conversations','客户会话与跟进']])}<div class="owner-standard-table"><table><thead><tr><th>订单编号</th><th>老板</th><th>游戏</th><th>订单金额</th><th>状态</th><th>操作</th></tr></thead><tbody>${issues.map(o=>`<tr><td>${e(o.id)}</td><td>${e(o.boss)}</td><td>${e(o.game)}</td><td>${yuan(o.amountCents)}</td><td>${e(o.status)}</td><td><button class="owner-link" data-action="detail" data-id="${e(o.id)}">查看订单</button></td></tr>`).join('')||'<tr><td colspan="6">暂无售后待处理订单</td></tr>'}</tbody></table></div></section>`;
  }
  return context.legacyContent();
}
function staffPanel(w, role, title, scope) {
  const rows=w.staffGroups[role];
  return `<section class="owner-panel"><div class="owner-section-head"><h2>${title}</h2><button class="owner-primary" data-page="clubMembers">设置成员身份</button></div><p class="owner-update">共 ${rows.length} 人 · 在成员管理设置身份后自动同步</p><div class="owner-standard-table"><table><thead><tr><th>用户ID</th><th>成员</th><th>账号</th><th>身份</th><th>状态</th><th>业务范围</th><th>操作</th></tr></thead><tbody>${rows.map(u=>`<tr><td>${e(u.memberNo)}</td><td>${e(u.name)}</td><td>${e(u.username)}</td><td>${e(u.roleLabel)}</td><td><span class="owner-status ${u.active?'':'off'}">${u.active?'正常':'停用'}</span></td><td>${scope}</td><td><button class="owner-link" data-staff-role="${e(u.id)}">设置角色</button></td></tr>`).join('')||`<tr><td colspan="7">暂无${title}成员，请在成员管理设置身份。</td></tr>`}</tbody></table></div></section>`;
}
export function renderOwner(ctx) {
  context = ctx; clearTimeout(refreshTimer);
  const w=ctx.state.workspace; const page=ctx.state.page; const active=parent[page]||page; const title=pageNames[page]||'首页';
  view.generation++;
  if(active==='memberManagement') membersExpanded=true;
  document.querySelector('#app').innerHTML=`<div class="owner-shell ${view.collapsed?'is-collapsed':''}"><aside class="owner-sidebar"><div class="owner-brand"><span class="owner-brand-symbol">${icon('game',24)}</span><strong>${e(w.clubName)}</strong></div><nav aria-label="最高负责人主导航">${ownerNavigation(active,page)}</nav></aside><main class="owner-main"><header class="owner-topbar"><div><button class="owner-icon-button" id="collapseOwnerNav" aria-label="${view.collapsed?'展开':'收起'}侧边栏" aria-expanded="${!view.collapsed}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 5h18M3 12h7M3 19h18m5-10-3 3 3 3"/></svg></button><span class="owner-breadcrumb">${title}</span></div><div class="owner-top-actions"><button class="owner-link" id="metricRules">统计口径</button><span class="owner-user-avatar">${icon('users',20)}</span><span class="owner-username">${e(w.user.name)}</span><span class="owner-role">最高负责人</span><button class="owner-icon-button" data-action="logout" aria-label="退出登录">退出</button></div></header><div class="owner-page-tabs"><span class="owner-page-tab"><i></i>${title}</span></div><div class="owner-content" id="ownerContent">${page==='overview'?home():groupContent(page,w)}</div></main></div>`;
  document.querySelector('#collapseOwnerNav').onclick=()=>{ view.collapsed=!view.collapsed; document.querySelector('.owner-shell').classList.toggle('is-collapsed',view.collapsed); document.querySelector('#collapseOwnerNav').setAttribute('aria-expanded',String(!view.collapsed)); };
  document.querySelector('#metricRules').onclick=()=>ctx.dialog('经营数据统计口径', `<p>金额以人民币元展示，内部以整数分汇总。</p><p>完成金额、完成笔数：按完成时间统计当前已完成订单。下单人数：按下单时间对客户去重；历史账号缺少客户 ID 时使用老板称呼。</p><p>日期按北京时间 00:00 至次日 00:00 计算，结束日期包含当天。总数据每四小时更新，日经营数据每五分钟刷新。</p><p>排名只包含已完成订单。陪玩榜每位成员统计参与订单的全额，同一多人订单可出现在多位成员下，成员金额不能相加作为俱乐部 GMV，也不等于个人到手收益。</p><p>旧示例订单未记录完成时间时使用示例下单时间。真实订单缺少完成时间时不纳入日期统计。</p>`);
  document.querySelectorAll('[data-staff-role]').forEach(btn=>btn.onclick=()=>openMemberRole(ctx,btn.dataset.staffRole));
  document.querySelectorAll('[data-page]').forEach(btn=>btn.onclick=()=>ctx.navigate(btn.dataset.page));
  document.querySelector('#memberNavGroup').onclick=()=>{membersExpanded=!membersExpanded;document.querySelector('#memberSubmenu').hidden=!membersExpanded;document.querySelector('#memberNavGroup').setAttribute('aria-expanded',String(membersExpanded));};
  if(['clubMembers','clubEscorts','memberManagement','accounts','escorts'].includes(page)) bindMembers(['clubEscorts','escorts'].includes(page)?'clubEscorts':'clubMembers');
  if(page==='overview') bindDashboard();
}
export function leaveOwner() { clearTimeout(refreshTimer); view.generation++; }
async function request(section, values={}) { return context.api(`/analytics/${section}?${new URLSearchParams(values)}`); }
function current(generation) { return generation===view.generation && context.state.workspace?.user.role==='admin' && context.state.page==='overview' && !!document.querySelector('#totalMetrics'); }
function setSummary(result) {
  view.summary=result;
  document.querySelector('#totalMetrics').innerHTML=metricCards(result.totals);
  document.querySelector('#totalUpdate').textContent=`统计截止 ${timestamp(result.totals.asOf)}，此数据每 4 小时更新一次`;
  document.querySelector('#totalUpdate').title=`下次更新：${timestamp(result.totals.nextUpdateAt)}`;
  document.querySelector('#dailyMetrics').innerHTML=metricCards(result.daily);
  document.querySelector('#dailyUpdate').textContent=`${result.daily.day} · 更新于 ${timestamp(result.daily.asOf).slice(11)}`;
  for (const kind of Object.keys(rankNames)) populateSelects(kind);
}
function populateSelects(kind) {
  const form=document.querySelector(`[data-rank-form="${kind}"]`); if(!form || !view.summary) return;
  const initialized=form.elements.game.dataset.loaded==='true';
  const chosenGame=initialized ? form.elements.game.value : view.filters[kind].game;
  const chosenTag=initialized ? form.elements.tag.value : view.filters[kind].tag;
  const options=view.summary.options;
  form.elements.game.innerHTML='<option value="">全部游戏</option>'+options.games.map(g=>`<option value="${e(g)}">${e(g)}</option>`).join(''); form.elements.game.value=chosenGame;
  form.elements.game.dataset.loaded='true'; fillTags(form,chosenTag);
}
function fillTags(form,selected='') {
  const tags=form.elements.game.value ? (view.summary?.options.tagsByGame[form.elements.game.value]||[]) : (view.summary?.options.tags||[]);
  form.elements.tag.innerHTML='<option value="">全部 Tag</option>'+tags.map(t=>`<option value="${e(t)}">${e(t)}</option>`).join('');
  if(tags.includes(selected)) form.elements.tag.value=selected;
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
  return Object.entries(names).map(([p,n])=>p==='memberManagement' ? `<button class="owner-nav-item ${p===active?'active':''}" id="memberNavGroup" aria-label="成员管理" aria-expanded="${membersExpanded}">${icon('users',17)}<span>成员管理</span>${icon('chevron',12)}</button><div class="owner-member-submenu" id="memberSubmenu" ${membersExpanded?'':'hidden'}>${[['clubMembers','俱乐部成员管理'],['clubEscorts','俱乐部陪玩管理']].map(([sub,label])=>`<button data-page="${sub}" class="owner-submenu-item ${page===sub?'active':''}" ${page===sub?'aria-current="page"':''} title="${label}"><i></i><span>${label}</span></button>`).join('')}</div>` : `<button class="owner-nav-item ${p===active?'active':''}" data-page="${p}" aria-label="${n}" ${p===active?'aria-current="page"':''}>${icon(navIcons[p],17)}<span>${n}</span>${p==='overview'?'':icon('chevron',12)}</button>`).join('');
}
