import { escapeHtml as e, icon } from './ui.js';

let ctx;
const filters = { clubMembers: { id:'', name:'', role:'' }, clubEscorts: { id:'', name:'', status:'', game:'' } };
const selected = new Set();
const pages = { clubMembers:1, clubEscorts:1 };
const money = n => (Number(n || 0)/100).toLocaleString('en-US',{maximumFractionDigits:2});
const roleName = u => u.role==='admin'?'俱乐部会长':u.role==='service'?'俱乐部客服':u.role==='afterSales'?'俱乐部售后':u.role==='examiner'?'俱乐部考官':u.role==='escort'?'俱乐部陪玩':u.roleLabel;
const pill = (text, tone='blue') => `<span class="member-pill ${tone}">${e(text)}</span>`;
const avatar = u => `<span class="member-avatar avatar-${u.tone}" aria-label="${e(u.name)}的头像">${e(u.name.slice(0,1))}</span>`;
const action = (verb,label,u,cls='') => `<button class="member-link ${cls}" data-member-action="${verb}" data-member-id="${e(u.id)}">${label}</button>`;
const input = (label,name,value,placeholder) => `<label>${label}<input name="${name}" value="${e(value)}" placeholder="${placeholder}" autocomplete="off"></label>`;
const select = (label,name,value,options,placeholder) => `<label>${label}<select name="${name}"><option value="">${placeholder}</option>${options.map(([id,text])=>`<option value="${e(id)}" ${id===value?'selected':''}>${e(text)}</option>`).join('')}</select></label>`;

export function membersMarkup(context,page) {
  ctx=context;
  const w=ctx.state.workspace,f=filters[page],escorts=page==='clubEscorts';
  return `<section class="owner-panel members-panel" aria-label="${escorts?'俱乐部陪玩管理':'俱乐部成员管理'}">
    <form id="memberSearch" class="member-search">
      ${input('用户ID','id',f.id,escorts?'请输入用户ID / 账号':'请输入用户ID')}
      ${input('用户昵称','name',f.name,'请输入用户昵称')}
      ${escorts?select('接单状态','status',f.status,['空闲','接单中','离线'].map(s=>[s,s]),'全部'):select('权限','role',f.role,w.roleOptions.map(r=>[r.id,roleName({role:r.id,roleLabel:r.label})]),'请选择权限')}
      ${escorts?select('游戏','game',f.game,w.games.map(g=>[g.name,g.name]),'请选择游戏'):''}
      <div class="member-search-actions"><button class="owner-primary">${icon('search',14)} 搜索</button><button type="button" class="member-reset" id="resetMembers">↻ 重置</button></div>
    </form>
    <div class="member-toolbar"><div>${escorts?'<button class="member-button green" id="batchSkills">批量绑定游戏</button>':'<button class="member-button" id="createMember">新增俱乐部成员</button>'}</div><button class="member-round" id="refreshMembers" aria-label="刷新成员列表">↻</button></div>
    ${escorts?`<div class="member-level-strip">${w.levels.map(l=>`<span><b>${l.name}</b></span>`).join('<i>›</i>')}<small>等级仅用于接单门槛；抽成按游戏配置</small></div>`:''}
    <div class="member-table-wrap" id="memberResults"></div>
  </section>`;
}
function filtered(page) {
  const w=ctx.state.workspace,f=filters[page];
  const rows=(page==='clubEscorts'?w.members:w.accounts).filter(u=>(!f.id||[u.memberNo,u.id,u.username].some(v=>String(v).toLowerCase().includes(f.id.toLowerCase())))&&(!f.name||u.name.includes(f.name))&&(!f.role||u.role===f.role)&&(!f.game||u.games.includes(f.game))&&(!f.status||u.takingStatus===f.status));
  if(page==='clubEscorts') rows.sort((a,b)=>(w.levels.find(l=>l.id===b.levelId)?.rank||0)-(w.levels.find(l=>l.id===a.levelId)?.rank||0)||a.memberNo.localeCompare(b.memberNo));
  return rows;
}
function draw(page) {
  const escorts=page==='clubEscorts', rows=filtered(page),max=Math.max(1,Math.ceil(rows.length/10));
  pages[page]=Math.min(pages[page],max);const visible=rows.slice((pages[page]-1)*10,pages[page]*10);
  const heads=escorts?['<input type="checkbox" id="selectPage" aria-label="选择本页陪玩">','用户ID','昵称','头像','陪玩状态','接单状态','押金（元）','等级 / 游戏抽成','操作']:['用户ID','昵称','头像','成员状态','接单状态','可提现余额（元）','待结算余额（元）','冻结提现余额（元）','操作'];
  document.querySelector('#memberResults').innerHTML=`<table class="member-table ${escorts?'escort-table':''}"><thead><tr>${heads.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${visible.map(u=>`<tr data-member-row="${e(u.id)}">${escorts?`<td><input type="checkbox" data-select-member="${e(u.id)}" aria-label="选择${e(u.name)}" ${selected.has(u.id)?'checked':''}></td>`:''}<td><span title="${e(u.id)}">${e(u.memberNo)}</span></td><td>${e(u.name)}${!escorts?`<small>${e(roleName(u))}</small>`:''}</td><td>${avatar(u)}</td><td>${pill(!u.active?'停用':escorts&&u.escortFrozen?'冻结':'正常',!u.active||escorts&&u.escortFrozen?'red':'blue')}</td><td>${pill(u.takingStatus,u.takingStatus==='接单中'?'red':u.takingStatus==='未开通'||u.takingStatus==='离线'?'gray':'blue')}</td>${escorts?`<td>${money(u.depositCents)}</td><td><b class="member-level level-${u.levelId}">${e(u.levelName)}</b>${(u.commissionByGame&&Object.keys(u.commissionByGame).length)?Object.entries(u.commissionByGame).map(([game,bps])=>`<small>${e(game)} ${bps/100}%</small>`).join(''):'<small>未配置游戏抽成</small>'}</td>`:`<td>${money(u.balanceCents)}</td><td>${money(u.pendingCents)}</td><td>${money(u.frozenCents)}</td>`}<td class="member-operations"><div>${escorts?`${action('profile','编辑等级/游戏',u)} ${action('skills','查看游戏',u,'green')}<br>${action('remove','取消陪玩身份',u,'red')} ${action('freeze',u.escortFrozen?'解冻':'冻结',u,u.escortFrozen?'green':'orange')}`:`${u.role!=='escort'&&u.id!==ctx.state.workspace.user.id?action('escort','设为陪玩',u):''} ${u.role!=='escort'?action('role','设置角色',u):action('skills','查看游戏',u)} ${action('more','更多',u)}`}</div></td></tr>`).join('')||`<tr><td colspan="${heads.length}" class="members-empty">没有符合条件的成员</td></tr>`}</tbody></table><div class="member-pagination"><span>共 ${rows.length} 位${escorts?`陪玩 · 已选 ${selected.size} 位`: '成员（包含陪玩）'}</span><button data-member-page="${pages[page]-1}" ${pages[page]===1?'disabled':''}>上一页</button><b>${pages[page]} / ${max}</b><button data-member-page="${pages[page]+1}" ${pages[page]===max?'disabled':''}>下一页</button></div>`;
  document.querySelectorAll('[data-member-action]').forEach(btn=>btn.onclick=()=>openAction(btn.dataset.memberAction,ctx.state.workspace.accounts.find(u=>u.id===btn.dataset.memberId)));
  document.querySelectorAll('[data-member-page]').forEach(btn=>btn.onclick=()=>{pages[page]=Number(btn.dataset.memberPage);draw(page);});
  document.querySelectorAll('[data-select-member]').forEach(box=>box.onchange=()=>{box.checked?selected.add(box.dataset.selectMember):selected.delete(box.dataset.selectMember);draw(page);});
  const all=document.querySelector('#selectPage');if(all){all.checked=visible.length>0&&visible.every(u=>selected.has(u.id));all.onchange=()=>{visible.forEach(u=>all.checked?selected.add(u.id):selected.delete(u.id));draw(page);};}
}
export function bindMembers(page) {
  selected.forEach(id=>{if(!ctx.state.workspace.members.some(u=>u.id===id))selected.delete(id);});
  draw(page);
  document.querySelector('#memberSearch').onsubmit=ev=>{ev.preventDefault();filters[page]=Object.fromEntries(new FormData(ev.currentTarget));pages[page]=1;draw(page);};
  document.querySelector('#resetMembers').onclick=()=>{Object.keys(filters[page]).forEach(k=>filters[page][k]='');pages[page]=1;selected.clear();ctx.navigate(page);};
  document.querySelector('#refreshMembers').onclick=async()=>{try{await ctx.refresh();ctx.toast('成员资料已刷新');}catch(err){ctx.toast(err.message);}};
  document.querySelector('#createMember')?.addEventListener('click',createMember);
  document.querySelector('#batchSkills')?.addEventListener('click',()=>{
    const members=ctx.state.workspace.members.filter(u=>selected.has(u.id));if(!members.length)return ctx.toast('请先勾选需要绑定游戏的陪玩');
    const dialog=ctx.dialog('批量绑定游戏',`<p>已选择 ${members.length} 位陪玩，新增所选游戏，保留原有游戏。</p>${gameFields([])}`,'保存游戏',form=>ctx.api('/members/skills',{members:members.map(u=>({id:u.id,memberVersion:u.memberVersion})),games:form.getAll('games')}));dialog.classList.add('member-dialog');
  });
}
const gameFields = games => `<fieldset class="member-skills"><legend>游戏</legend>${ctx.state.workspace.games.map(g=>`<label><input type="checkbox" name="games" value="${e(g.name)}" ${games.includes(g.name)?'checked':''}>${e(g.name)}${g.state!=='上架'?'<small>维护中</small>':''}</label>`).join('')}</fieldset>`;
const levelField = id => `<label class="form-field">陪玩等级<select name="levelId">${ctx.state.workspace.levels.map(l=>`<option value="${l.id}" ${l.id===id?'selected':''}>${l.name}</option>`).join('')}</select></label>`;
const depositField = value => `<label class="form-field">押金（元）<input type="number" name="deposit" value="${(Number(value || 0)/100).toFixed(2)}" min="0" step="0.01" required></label>`;
function save(u,action,data){return ctx.api(`/members/${u.id}/${action}`,{...data,memberVersion:u.memberVersion});}
export function openMemberRole(context,id) {
  ctx=context;
  const member=ctx.state.workspace.accounts.find(u=>u.id===id);
  if(member) openAction('role',member);
}
function openAction(action,u) {
  let modal;
  if(action==='role') {
    const options=ctx.state.workspace.roleOptions.filter(r=>r.id!=='escort');
    const descriptions={admin:'俱乐部会长：经营统计、俱乐部配置、成员与各业务管理及财务审核。',finance:'俱乐部财务：充值审核、资金流水、提现与结算。',service:'俱乐部客服：创建订单、客户会话、派单与完单验收。',examiner:'俱乐部考官：查看陪玩游戏资料与考核范围。',afterSales:'俱乐部售后：退款跟进、订单验收与客户会话。',member:'普通成员：仅查看自己的身份信息，尚未开通业务操作权限。'};
    modal=ctx.dialog('设置角色',`<p class="member-dialog-user">${e(u.name)} · ${e(u.memberNo)}</p><label class="form-field">角色<select name="role" aria-label="角色">${options.map(r=>`<option value="${r.id}" ${u.role===r.id?'selected':''}>${roleName({role:r.id,roleLabel:r.label})}</option>`).join('')}</select></label><p class="member-permission-note" id="roleDescription"></p><p class="detail-note">保存后该成员需重新登录，按新身份获得页面和操作权限。</p>`,'确认',form=>save(u,'role',{role:form.get('role')}));
    modal.classList.add('member-role-dialog');const update=()=>modal.querySelector('#roleDescription').textContent=descriptions[modal.querySelector('[name=role]').value];modal.querySelector('[name=role]').onchange=update;update();
  } else if(action==='profile'||action==='escort') {
    modal=ctx.dialog(action==='escort'?'设为俱乐部陪玩':'编辑等级 / 游戏',`<p class="member-dialog-user">${e(u.name)} · ${e(u.memberNo)}</p>${action==='escort'?depositField(u.depositCents):''}${levelField(u.levelId||'gold')}${gameFields(u.games)}<p class="detail-note">明星 ＞ 魔王 ＞ 巅峰 ＞ 金牌。可接本级及以下订单，且必须具备对应游戏。未配置游戏时暂不能上线接单。</p><p class="detail-note">${action==='escort'?'保存后自动加入陪玩管理，原管理角色将切换为陪玩身份。':'等级分成只影响之后的新派单，已派订单仍按原比例结算。'}</p>`,'保存',form=>save(u,action,{levelId:form.get('levelId'),games:form.getAll('games'),...(action==='escort'?{depositCents:Math.round(Number(form.get('deposit'))*100)}:{})}));
  } else if(action==='skills') {
    modal=ctx.dialog('陪玩游戏',`<p class="member-dialog-user">${e(u.name)} · ${e(u.levelName)} · 分成 ${u.shareBps/100}%</p><div class="member-skill-tags">${u.games.map(g=>pill(g)).join('')||'<p>尚未配置游戏</p>'}</div><p class="detail-note">可接：${ctx.state.workspace.levels.filter(l=>l.rank<=ctx.state.workspace.levels.find(l=>l.id===u.levelId)?.rank).map(l=>l.name).join('、')}等级订单。</p>`);
  } else if(action==='freeze') {
    modal=ctx.dialog(u.escortFrozen?'解除陪玩冻结':'冻结陪玩',`<p>${e(u.name)}</p><p class="detail-note">${u.escortFrozen?'解冻后可自行上线接单。':'冻结后无法接收新单或开始服务，已开始的订单仍可提交完单。'}</p>`,'确认',()=>save(u,'freeze',{frozen:!u.escortFrozen}));
  } else if(action==='remove') {
    modal=ctx.dialog('取消陪玩身份',`<p>${e(u.name)}将恢复为普通俱乐部成员，仍保留在俱乐部成员名单中。</p><p class="detail-note">需要先完成未结订单并结清余额和提现。</p>`,'确认取消',()=>save(u,'remove',{}));
  } else if(action==='more') {
    modal=ctx.dialog('成员信息',`<div class="detail-grid"><div><span>用户ID</span><strong>${e(u.memberNo)}</strong></div><div><span>登录账号</span><strong>${e(u.username)}</strong></div><div><span>角色</span><strong>${e(roleName(u))}</strong></div><div><span>账号状态</span><strong>${u.active?'正常':'停用'}</strong></div><div><span>冻结余额</span><strong>${money(u.frozenCents)}</strong></div></div><div class="member-more-actions"><button type="button" class="member-button orange" id="freezeBalance">冻结余额</button>${u.frozenCents>0?'<button type="button" class="member-button" id="unfreezeBalance">解冻余额</button>':''}<button type="button" class="member-button" id="freezeAccount">${u.active?'冻结账号':'解冻账号'}</button></div><p class="detail-note">冻结账号会立即撤销登录会话；冻结余额后会从可提现余额中扣除，解冻后恢复。</p>`, '', ()=>{});
    modal.querySelector('#freezeAccount').onclick=async()=>{try{await save(u,'status',{active:!u.active});modal.remove();await ctx.refresh();ctx.toast(u.active?'账号已冻结':'账号已解冻');}catch(err){ctx.toast(err.message);}};
    modal.querySelector('#freezeBalance').onclick=()=>{const box=ctx.dialog('冻结可提现余额',`<p>${e(u.name)} 当前可提现余额：${money(u.balanceCents)}</p><label class="form-field">冻结金额（元）<input type="number" name="amount" min="0.01" max="${u.balanceCents/100}" step="0.01" required></label><p class="detail-note">最多不能超过当前可提现余额。</p>`,'确认冻结',form=>save(u,'freezeBalance',{amountCents:Math.round(Number(form.get('amount'))*100)}));box.classList.add('member-dialog');};
    modal.querySelector('#unfreezeBalance')?.addEventListener('click',async()=>{try{await save(u,'unfreezeBalance',{amountCents:u.frozenCents});modal.remove();await ctx.refresh();ctx.toast('余额已解冻');}catch(err){ctx.toast(err.message);}});
  }
  modal?.classList.add('member-dialog');
}
function createMember() {
  const modal=ctx.dialog('新增俱乐部成员',`<label class="form-field">用户 ID<input name="userId" required maxlength="80" placeholder="请输入对方用户 ID" autocomplete="off"></label><p class="detail-note">输入已注册用户 ID 即可加入俱乐部，无需创建登录账号。系统会自动带入对方昵称和账号资料。</p>`,'加入俱乐部',form=>ctx.api('/accounts',{action:'joinById',userId:form.get('userId')}));modal.classList.add('member-dialog');
}
function levelDialog() {
  const w=ctx.state.workspace;
  const modal=ctx.dialog('等级分成管理',`<p class="detail-note">等级由高到低排列，分成须依次递减。变更仅用于新派单。</p>${w.levels.map(l=>`<label class="form-field">${l.name}分成（%）<input type="number" name="${l.id}" value="${l.shareBps/100}" min="0.01" max="100" step="0.01" required></label>`).join('')}<p class="detail-note">单人订单直接使用该等级比例；多人订单，每人的等级分成比例除以参与人数，向下取整至 0.01%，派单后锁定。</p>`,'保存分成',form=>ctx.api('/levels',{revision:w.revision,levels:w.levels.map(l=>({id:l.id,shareBps:Math.round(Number(form.get(l.id))*100)}))}));modal.classList.add('member-dialog');
}
