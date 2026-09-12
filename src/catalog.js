import { escapeHtml as e, icon } from './ui.js';

const money = value => `¥ ${(Number(value || 0) / 100).toFixed(2)}`;
const action = (kind, label, id = '') => `<button class="ghost-btn" data-action="${kind}" data-id="${e(id)}">${label}</button>`;
export function catalogMarkup(w) {
  const games = w.games || [], products = w.products || [];
  return `<section class="page-intro"><div><p class="eyebrow">服务配置</p><h1>游戏与商品</h1><p class="subline">维护可售服务和每小时价格。调整配置后，新订单立即生效，已有订单保留原约定。</p></div><button class="primary-action" data-action="catalogGame">${icon('plus',16)} 新增游戏</button></section>
  <section class="catalog-summary"><div><strong>${games.filter(g=>g.state==='上架').length}</strong><span>上架游戏</span></div><div><strong>${products.filter(p=>p.state==='启用' && games.some(g=>g.name===p.game && g.state==='上架')).length}</strong><span>可售商品</span></div><div><strong>${products.filter(p=>p.state!=='启用').length}</strong><span>已暂停商品</span></div></section>
  <article class="panel data-panel"><div class="panel-head"><div><h2>游戏配置</h2><p>下架游戏会停止新订单，已接订单仍可继续服务。</p></div></div><div class="catalog-game-grid">${games.map(g=>`<article class="catalog-game"><div><span class="catalog-game-icon">${icon('game',22)}</span><span class="status ${g.state==='上架'?'active':'muted'}">${e(g.state)}</span></div><h3>${e(g.name)}</h3><p>${e(g.category)} · 每单 ${g.min}–${g.max} 人</p><div class="catalog-actions">${action('catalogGame','编辑',g.name)}${action('catalogGameState',g.state==='上架'?'下架':'上架',g.name)}${action('catalogGameDelete','删除',g.name)}</div></article>`).join('') || '<div class="empty-state">先添加一个游戏，再配置可售商品。</div>'}</div></article>
  <article class="panel data-panel"><div class="panel-head"><div><h2>服务商品</h2><p>按小时计价，支持半小时下单；已被订单引用的商品可暂停保留。</p></div><button class="primary-action" data-action="catalogProduct">新增商品</button></div><label class="list-search">${icon('search',16)}<input id="listSearch" type="search" aria-label="搜索商品" placeholder="搜索游戏、商品名称或状态"></label><div class="table-scroll"><table class="business-table"><thead><tr><th>商品 / 编号</th><th>游戏</th><th>价格</th><th>状态</th><th>服务说明</th><th>操作</th></tr></thead><tbody>${products.map(p=>`<tr data-searchable><td><strong>${e(p.name)}</strong><small class="catalog-id">${e(p.id)}</small></td><td>${e(p.game)}</td><td><strong>${money(p.priceCents)}</strong> / 小时</td><td><span class="status ${p.state==='启用'?'active':'muted'}">${e(p.state==='启用'?'在售':'暂停')}</span>${p.state==='启用' && !games.some(g=>g.name===p.game && g.state==='上架')?'<small class="catalog-id">游戏未上架</small>':''}</td><td>${e(p.note || '—')}</td><td><div class="row-actions">${action('catalogProduct','编辑',p.id)}${action('catalogProductState',p.state==='启用'?'暂停':'启用',p.id)}${action('catalogProductDelete','删除',p.id)}</div></td></tr>`).join('') || '<tr><td colspan="6"><div class="empty-state">暂无服务商品</div></td></tr>'}</tbody></table></div><div id="noSearchResults" class="empty-state" hidden>没有找到匹配的商品</div></article>`;
}

export function catalogAction(kind, id, ctx) {
  const { workspace:w, dialog, api } = ctx;
  const game = kind.startsWith('catalogGame');
  const item = (game ? w.games : w.products).find(row=> (game ? row.name : row.id) === id);
  const path = `/catalog/${game?'games':'products'}`;
  const identity = item ? (game ? {originalName:item.name,version:item.version??0} : {id:item.id,version:item.version??0}) : {};
  if (kind.endsWith('State')) {
    const state = game ? (item.state==='上架'?'下架':'上架') : (item.state==='启用'?'暂停':'启用');
    return dialog(`${state}${game?'游戏':'商品'}`, `<p>确认将「${e(item.name)}」设为${state}？</p><p class="detail-note">${['下架','暂停'].includes(state)?'新的订单将无法选择此服务。已创建订单的价格与履约不受影响。':'保存后符合上架条件的商品可供新订单选择。'}</p>`, `确认${state}`, ()=>api(path,{...identity,action:'state',state}));
  }
  if (kind.endsWith('Delete')) return dialog(`删除${game?'游戏':'商品'}`, `<p>确认删除「${e(item.name)}」？</p><p class="detail-note">存在商品、成员或订单引用时会阻止删除。历史服务需要保留时，可使用下架或暂停。</p>`, '确认删除', ()=>api(path,{...identity,action:'delete'}));
  const input = (label,name,value,attrs='') => `<label class="form-field">${label}<input name="${name}" value="${e(value)}" ${attrs} required></label>`;
  let body;
  if (game) body = input('游戏名称','name',item?.name||'','maxlength="40"') + input('分类','category',item?.category||'MOBA','maxlength="30"') + `<div class="form-grid-2">${input('每单最少人数','min',item?.min||1,'type="number" min="1" max="10" step="1"')}${input('每单最多人数','max',item?.max||1,'type="number" min="1" max="10" step="1"')}</div><label class="form-field">状态<select name="state">${['上架','下架','维护'].map(s=>`<option ${s===(item?.state||'上架')?'selected':''}>${s}</option>`).join('')}</select></label><p class="detail-note">已有成员或订单引用的游戏名称会保留，避免历史业务失去关联。</p>`;
  else {
    if (!w.games.length) return dialog('请先添加游戏','<p>商品需要关联一个游戏。请先在游戏配置中新增游戏。</p>');
    body = input('商品名称','name',item?.name||'','maxlength="60"') + `<label class="form-field">所属游戏<select name="game">${w.games.map(g=>`<option value="${e(g.name)}" ${g.name===item?.game?'selected':''}>${e(g.name)}${g.state==='上架'?'':'（未上架）'}</option>`).join('')}</select></label>` + input('每小时价格（元）','price',item ? item.priceCents/100 : '', 'type="number" min="0.01" max="100000" step="0.01"') + `<label class="form-field">服务说明<textarea name="note" rows="3" maxlength="300" placeholder="说明服务范围、区服或特别要求">${e(item?.note||'')}</textarea></label><label class="form-field">状态<select name="state"><option value="启用" ${item?.state==='暂停'?'':'selected'}>在售</option><option value="暂停" ${item?.state==='暂停'?'selected':''}>暂停</option></select></label>`;
  }
  return dialog(`${item?'编辑':'新增'}${game?'游戏':'商品'}`, body, '保存配置', form=> {
    const values=Object.fromEntries(form);
    return api(path,{...identity,...values,action:'save',...(game?{min:Number(values.min),max:Number(values.max)}:{priceCents:Math.round(Number(values.price)*100),unit:'小时'})});
  });
}
