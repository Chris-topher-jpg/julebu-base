import { escapeHtml as e, icon } from './ui.js';
import { orderTypeOf, productNeedsLevel, productGuarantee, productEscortCount } from './product-config.js';

const DELTA_GAME = '三角洲行动';
const money = value => `¥ ${(Number(value || 0) / 100).toFixed(2)}`;
const action = (kind, label, id = '') => `<button class="ghost-btn" data-action="${kind}" data-id="${e(id)}">${label}</button>`;
const deltaGame = games => (games || []).find(game => game.name === DELTA_GAME) || (games || [])[0];
let selectedGameName = '';

export function catalogMarkup(w) {
  const games = w.catalogGames || w.games || [];
  const game = games.find(item => item.name === selectedGameName) || deltaGame(games);
  selectedGameName = game?.name || '';
  const products = (w.products || []).filter(product => product.game === game?.name);
  const gameConfig = game ? w.gameLevelConfigs?.[game.name] : null;
  const levels = (gameConfig?.levels || []).slice().sort((a, b) => (b.rank || 0) - (a.rank || 0));
  const configured = levels.filter(level => Number.isFinite(Number(level.priceCents)) && Number(level.priceCents) > 0).length;
  return `
  <article id="catalog-pricing" class="panel data-panel pricing-panel"><div class="panel-head"><div><h2>等级和陪玩价格</h2></div><button class="primary-action" data-action="catalogPrices">修改等级和价格</button></div><div class="price-level-grid">${levels.map(level => `<div class="price-level-card"><span class="member-level level-${e(level.id)}">${e(level.name)}</span><span class="price-level-rank">${level.rank ? `等级 ${level.rank}` : ''}</span><div class="price-input-wrap"><span>¥</span><output>${Number.isFinite(Number(level.priceCents)) ? (Number(level.priceCents) / 100).toFixed(2) : '未设置'}</output><small>/ 小时</small></div></div>`).join('')}</div></article>
  <article id="catalog-games" class="panel data-panel"><div class="panel-head"><div><h2>俱乐部游戏</h2><p>游戏分类会与这里的配置保持同步。</p></div><button class="primary-action" data-action="catalogGame">添加游戏</button></div><div class="catalog-game-grid">${games.map(item => `<article class="catalog-game ${item.name === game?.name ? 'is-selected' : ''}"><button class="catalog-game-select" data-action="catalogSelectGame" data-id="${e(item.name)}"><span class="catalog-game-icon">${icon('game',22)}</span><span><strong>${e(item.name)}</strong><small>${e(item.category || 'FPS')} · 每单 ${item.min || 1}–${item.max || 1} 人</small></span><span class="status ${item.state === '上架' ? 'active' : 'muted'}">${e(item.state)}</span></button><div class="catalog-actions">${action('catalogGame','编辑',item.name)}${action('catalogGameState',item.state === '上架' ? '下架' : '上架',item.name)}${action('catalogGameDelete','删除',item.name)}</div></article>`).join('') || '<div class="empty-state">暂无已配置游戏</div>'}</div></article>
  <article id="catalog-special-orders" class="panel data-panel"><div class="panel-head"><div><h2>特殊订单</h2><p>${e(game?.name || '当前游戏')} · 陪玩单 / 趣味单 / 护航单</p></div><button class="primary-action" data-action="catalogProduct">新增服务</button></div><label class="list-search">${icon('search',16)}<input id="listSearch" type="search" aria-label="搜索特殊订单" placeholder="搜索名称、类型或护航保障"></label><div class="table-scroll"><table class="business-table catalog-product-table"><thead><tr><th>订单名称 / 护航保障</th><th>订单类型</th><th>计价</th><th>打手</th><th>状态</th><th>服务说明</th><th>操作</th></tr></thead><tbody>${products.map(p => `<tr data-searchable><td><strong>${e(p.name)}</strong>${productGuarantee(p) ? `<small class="catalog-id">护航 ${e(productGuarantee(p))}</small>` : ''}</td><td><span class="catalog-type-chip">${e(orderTypeOf(p))}</span></td><td><strong>${!productNeedsLevel(p) || p.pricingMode === 'fixed' ? `${money(p.priceCents)} / 小时` : '按等级定价'}</strong></td><td>${e(productEscortCount(p))} 位</td><td><span class="status ${p.state === '启用' ? 'active' : 'muted'}">${e(p.state === '启用' ? '在售' : '暂停')}</span></td><td class="catalog-product-note">${e(p.note || '—')}</td><td><div class="row-actions">${action('catalogProduct','编辑',p.id)}${action('catalogProductState',p.state === '启用' ? '暂停' : '启用',p.id)}${action('catalogProductDelete','删除',p.id)}</div></td></tr>`).join('') || '<tr><td colspan="7"><div class="empty-state">当前游戏还没有服务</div></td></tr>'}</tbody></table></div><div id="noSearchResults" class="empty-state" hidden>没有找到匹配的特殊订单</div></article>`;
}

export function catalogAction(kind, id, ctx) {
  const { workspace: w, dialog, api } = ctx;
  if (kind === 'catalogSelectGame') { selectedGameName = id; ctx.refresh?.(); return; }
  if (kind === 'catalogPrices') {
    const games = w.catalogGames || w.games || [];
    const gameName = (games.find(item => item.name === selectedGameName) || deltaGame(games))?.name;
    if (!gameName) return dialog('暂无俱乐部游戏', '<p>请先添加一个俱乐部游戏。</p>');
    const gameConfig = gameName ? w.gameLevelConfigs?.[gameName] : null;
    // Game-specific prices use the club's shared eligibility tiers. New games
    // begin with those stable IDs so the configuration is usable at checkout.
    const levels = (gameConfig?.levels || (gameName !== DELTA_GAME ? w.levels : []) || []).slice().sort((a, b) => (b.rank || 0) - (a.rank || 0));
    const body = `<div id="levelEditor">${levels.map((level, index) => `<div class="form-grid-2 level-editor-row"><label class="form-field">等级名称<input name="name-${index}" value="${e(level.name)}" required></label><label class="form-field">每小时价格<input name="price-${index}" type="number" value="${Number(level.priceCents || 0) / 100 || ''}" min="0.01" step="0.01" required></label><input type="hidden" name="id-${index}" value="${e(level.id)}"><input type="hidden" name="rank-${index}" value="${level.rank || levels.length - index}"><button type="button" class="ghost-btn" data-remove-level="${index}">删除等级</button></div>`).join('')}</div><button type="button" class="ghost-btn" data-add-level>添加新等级</button>`;
    const dlg = dialog(`修改${gameName || ''}等级和价格`, body, '保存配置', async form => {
      const indices = [...new Set([...form.keys()].map(key => key.match(/^(?:name|price|id|rank)-(\d+)$/)?.[1]).filter(Boolean))].sort((a, b) => Number(form.get(`rank-${b}`)) - Number(form.get(`rank-${a}`)));
      const levelsPayload = indices.map((index, i) => ({
        id: form.get(`id-${index}`) || `level-${Date.now()}-${i}`,
        name: String(form.get(`name-${index}`) || '').trim(),
        // Preserve existing rank values so merely editing a price or removing
        // an unused tier does not change eligibility for orders already placed.
        rank: Number(form.get(`rank-${index}`)) || indices.length - i,
        shareBps: Number(form.get(`share-${index}`) || levels.find(level => level.id === form.get(`id-${index}`))?.shareBps || Math.max(1, 7000 - i * 100)),
        priceCents: Math.round(Number(form.get(`price-${index}`)) * 100),
      }));
      if (!levelsPayload.length) throw new Error('请至少保留一个等级');
      if (levelsPayload.some(level => !level.name || !Number.isSafeInteger(level.priceCents) || level.priceCents < 1 || level.priceCents > 100000000)) throw new Error('等级名称不能为空，价格须为 0.01–1,000,000 元');
      const version = Number(gameConfig?.version || 1);
      return api('/levels', { game: gameName, version, levels: levelsPayload });
    });
    let nextIndex = levels.length;
    if (gameName !== DELTA_GAME) {
      dlg.querySelector('[data-add-level]')?.remove();
      dlg.querySelectorAll('[data-remove-level]').forEach(button => button.remove());
    }
    dlg.querySelector('[data-add-level]')?.addEventListener('click', () => {
      if (dlg.querySelectorAll('.level-editor-row').length >= 12) return;
      const index = nextIndex++;
      const rankInputs = [...dlg.querySelectorAll('input[name^="rank-"]')];
      // Add above the highest tier, retaining the existing tiers' ranks.
      const rank = Math.max(0, ...rankInputs.map(input => Number(input.value) || 0)) + 1;
      const share = Math.min(10000, Math.max(6000, ...levels.map(level => Number(level.shareBps) || 0)) + (index - levels.length + 1) * 100);
      dlg.querySelector('#levelEditor').insertAdjacentHTML('afterbegin', `<div class="form-grid-2 level-editor-row"><label class="form-field">等级名称<input name="name-${index}" required></label><label class="form-field">每小时价格<input name="price-${index}" type="number" min="0.01" step="0.01" required></label><input type="hidden" name="id-${index}" value="level-${Date.now()}-${index}"><input type="hidden" name="rank-${index}" value="${rank}"><input type="hidden" name="share-${index}" value="${share}"><button type="button" class="ghost-btn" data-remove-level>删除等级</button></div>`);
    });
    dlg.addEventListener('click', event => { if (event.target.matches('[data-remove-level]')) event.target.closest('.level-editor-row')?.remove(); }); return dlg;
  }
  const game = kind.startsWith('catalogGame');
  const activeGame = (w.catalogGames || w.games || []).find(item => item.name === selectedGameName) || deltaGame(w.catalogGames || w.games);
  const products = (w.products || []).filter(product => product.game === activeGame?.name);
  const item = (game ? (w.catalogGames || w.games || []) : products).find(row => (game ? row.name : row.id) === id);
  const path = `/catalog/${game ? 'games' : 'products'}`;
  const identity = item ? (game ? { originalName: item.name, version: item.version ?? 0 } : { id: item.id, version: item.version ?? 0 }) : {};
  if (kind.endsWith('State')) {
    const state = game ? (item.state === '上架' ? '下架' : '上架') : (item.state === '启用' ? '暂停' : '启用');
    return dialog(`${state}${game ? '游戏' : '商品'}`, `<p>确认将「${e(item.name)}」设为${state}？</p><p class="detail-note">${['下架', '暂停'].includes(state) ? '新的订单将无法选择此服务。已创建订单的价格与履约不受影响。' : '保存后符合条件的服务可供新订单选择。'}</p>`, `确认${state}`, () => api(path, { ...identity, action: 'state', state }));
  }
  if (kind.endsWith('Delete')) return dialog(`删除${game ? '游戏' : '服务说明'}`, `<p>确认删除「${e(item.name)}」？</p><p class="detail-note">存在业务引用时会阻止删除，历史服务需要保留时可暂停。</p>`, '确认删除', () => api(path, { ...identity, action: 'delete' }));
  const input = (label, name, value, attrs = '') => `<label class="form-field">${label}<input name="${name}" value="${e(value)}" ${attrs} required></label>`;
  let body;
  if (game) body = input('游戏名称', 'name', item?.name || '', `maxlength="40" ${item ? 'readonly' : ''}`) + input('分类', 'category', item?.category || 'FPS', 'maxlength="30"') + `<div class="form-grid-2">${input('每单最少人数', 'min', item?.min || 1, 'type="number" min="1" max="10" step="1"')}${input('每单最多人数', 'max', item?.max || 1, 'type="number" min="1" max="10" step="1"')}</div><label class="form-field">状态<select name="state">${['上架', '下架', '维护'].map(s => `<option ${s === (item?.state || '上架') ? 'selected' : ''}>${s}</option>`).join('')}</select></label>`;
  else {
    if (!(w.catalogGames || w.games || []).length) return dialog('暂无俱乐部游戏', '<p>请先添加一个俱乐部游戏。</p>');
    const catalogGames = w.catalogGames || w.games || [];
    const price = item?.priceCents ? Number(item.priceCents) / 100 : '';
    const orderTypes = [...new Set(['陪玩单', '护航单', '趣味单', orderTypeOf(item)])];
    body = `<div class="form-grid-2"><label class="form-field">所属游戏<select name="game">${catalogGames.map(itemGame => `<option value="${e(itemGame.name)}" ${itemGame.name === (item?.game || activeGame?.name) ? 'selected' : ''}>${e(itemGame.name)}</option>`).join('')}</select></label><label class="form-field">订单类型<select name="orderType" required>${orderTypes.map(type => `<option value="${e(type)}" ${type === orderTypeOf(item) ? 'selected' : ''}>${e(type)}</option>`).join('')}</select></label></div>
      ${input('订单名称', 'name', item?.name || '', 'maxlength="60"')}
      <label class="form-field catalog-guarantee" hidden>护航保障（多少保多少）<input name="guarantee" maxlength="80" value="${e(item?.guarantee || '')}" placeholder="例如：100 保 300 万"></label>
      <div class="form-grid-2 catalog-pricing-fields"><label class="form-field catalog-pricing-mode">计价方式<select name="pricingMode"><option value="level" ${item?.pricingMode === 'fixed' && productNeedsLevel(item) ? '' : 'selected'}>按陪玩等级 / 小时</option><option value="fixed" ${item?.pricingMode === 'fixed' && productNeedsLevel(item) ? 'selected' : ''}>固定价格 / 小时</option></select></label><label class="form-field catalog-fixed-price">输入金额（元 / 小时）<input name="price" type="number" min="0.01" max="1000000" step="0.01" value="${price}" placeholder="请输入服务金额" aria-describedby="catalogPriceHint" required></label><label class="form-field">参与打手人数<input name="escortCount" type="number" min="1" max="10" step="1" value="${e(productEscortCount(item))}" required></label></div>
      <p id="catalogPriceHint" class="detail-note" hidden>此金额为每小时服务总价，已包含全部参与打手。</p>
      <label class="form-field">服务说明<textarea name="note" rows="3" maxlength="300" placeholder="说明玩法、服务范围、区服或特别要求">${e(item?.note || '')}</textarea></label><label class="form-field">状态<select name="state"><option value="启用" ${item?.state === '暂停' ? '' : 'selected'}>在售</option><option value="暂停" ${item?.state === '暂停' ? 'selected' : ''}>暂停</option></select></label>`;
  }
  const editor = dialog(`${item ? '编辑' : '新增'}${game ? '游戏' : '服务'}`, body, '保存配置', form => {
    const values = Object.fromEntries(form);
    if (game) return api(path, { ...identity, ...values, action: 'save', min: Number(values.min), max: Number(values.max) });
    const pricingMode = productNeedsLevel({ orderType: values.orderType }) ? values.pricingMode : 'fixed';
    const priceCents = pricingMode === 'fixed' ? Math.round(Number(values.price) * 100) : Number(item?.priceCents || w.gameLevelConfigs?.[values.game]?.levels?.at(-1)?.priceCents || w.levels?.at(-1)?.priceCents || 1);
    return api(path, { ...identity, ...values, action: 'save', unit: '小时', pricingMode, priceCents, escortCount: Number(values.escortCount) });
  });
  if (!game) {
    const syncFields = () => {
      const type = editor.querySelector('[name="orderType"]').value.trim();
      const needsLevel = productNeedsLevel({ orderType: type });
      const pricing = editor.querySelector('[name="pricingMode"]');
      editor.querySelector('.catalog-pricing-mode').hidden = !needsLevel;
      pricing.disabled = !needsLevel;
      const fixed = !needsLevel || pricing.value === 'fixed';
      editor.querySelector('.catalog-pricing-fields').classList.toggle('has-fixed-price', fixed);
      editor.querySelector('.catalog-fixed-price').hidden = !fixed;
      editor.querySelector('[name="price"]').disabled = !fixed;
      editor.querySelector('#catalogPriceHint').hidden = !fixed;
      editor.querySelector('.catalog-guarantee').hidden = type !== '护航单';
      const guarantee = editor.querySelector('[name="guarantee"]');
      guarantee.disabled = type !== '护航单';
      guarantee.required = type === '护航单';
    };
    editor.querySelector('[name="orderType"]').addEventListener('change', syncFields);
    editor.querySelector('[name="pricingMode"]').addEventListener('change', syncFields);
    syncFields();
  }
  return editor;
}
