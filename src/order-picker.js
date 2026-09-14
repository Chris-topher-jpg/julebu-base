import { escapeHtml as e, icon } from './ui.js';

const money = value => `¥ ${(Number(value || 0) / 100).toFixed(2)}`;
const gamesOf = workspace => workspace.catalogGames || workspace.games || [];
const availableProducts = workspace => (workspace.products || []).filter(product => product.state === '启用' && gamesOf(workspace).some(game => game.name === product.game && game.state === '上架'));
const escortCountOf = product => Number(product?.escortCount) === 2 || product?.name === '2陪1' ? 2 : 1;

export function openOrderPicker({ workspace, productId, preferredEscort, api, onSuccess, onClose }) {
  document.querySelector('#actionDialog')?.remove();
  let catalog = workspace;
  const matchingProducts = () => availableProducts(catalog).filter(item => !preferredEscort || item.game === preferredEscort.game && escortCountOf(item) === 1 && Number(gamesOf(catalog).find(game => game.name === item.game)?.min || 1) === 1);
  let products = matchingProducts();
  const levels = () => [...(catalog.levels || [])].filter(item => !preferredEscort || item.id === preferredEscort.levelId).sort((a, b) => b.rank - a.rank);
  const unitPrice = (chosenProduct, chosenLevel) => {
    const gamePrice = catalog.gameLevelConfigs?.[chosenProduct?.game]?.levels?.find(item => item.id === chosenLevel?.id)?.priceCents;
    const base = Number.isSafeInteger(gamePrice) ? gamePrice : chosenProduct?.game === '三角洲行动' ? chosenLevel?.priceCents : chosenProduct?.priceCents;
    return Number.isSafeInteger(base) ? base * (chosenProduct?.game === '三角洲行动' ? escortCountOf(chosenProduct) : 1) : base;
  };
  const initial = products.find(product => product.id === productId) || products[0];
  const selection = { game: initial?.game || '', productId: initial?.id || '', levelId: levels().at(-1)?.id || '', confirmed: false };
  let step = 1, pending = false, purchaseAttempt = null;
  const product = () => products.find(item => item.id === selection.productId);
  const level = () => levels().find(item => item.id === selection.levelId);
  const modal = document.createElement('dialog');
  modal.id = 'actionDialog'; modal.className = 'self-order-dialog';
  modal.setAttribute('aria-labelledby', 'selfOrderTitle');
  modal.innerHTML = `<form class="so-form">
    <header class="so-header"><div><h2 id="selfOrderTitle">自助下单</h2><button type="button" class="so-notice-button" aria-expanded="false" aria-controls="soNotice">下单须知 ${icon('arrow', 13)}</button></div><button type="button" class="so-close" aria-label="关闭下单窗口">×</button></header>
    <div class="so-body">
      <div id="soNotice" class="so-notice" hidden><strong>陪玩单下单须知</strong><p>按小时计价，最少 1 小时，每次增减 1 小时。确认游戏、等级、时长和区服后使用余额支付；支付成功后客服会邀请打手，符合条件的打手也可报名，由你在“我的点单”最终选择。服务完成后可在“我的点单”确认验收，有问题可申请售后。</p></div>
      <ol class="so-steps" aria-label="下单步骤"><li data-so-step="1" aria-current="step"><b>01</b><span>选择您的需求</span></li><li data-so-step="2"><b>02</b><span>确认陪玩订单</span></li></ol>
      <section class="so-selection">
        <h3 class="so-section-heading"><b>1</b>选择您的需求 <span>陪玩单</span></h3>
        <div class="so-games" role="group" aria-label="选择游戏"></div>
        <div class="so-field"><span id="soServiceLabel">选择陪玩 <em>*</em></span><button type="button" class="so-service-trigger" aria-labelledby="soServiceLabel soSelectionText" aria-expanded="false" aria-controls="soCascader"><span id="soSelectionText">请选择陪玩服务</span>${icon('chevron', 17)}</button></div>
        <div id="soCascader" class="so-cascader" hidden>
          <section><h4>订单类型</h4><label class="so-search">${icon('search', 14)}<input type="search" aria-label="搜索订单类型" placeholder="搜索订单类型" data-so-search="type"></label><div class="so-options" data-so-options="type"><button type="button" class="so-option is-selected" data-so-type="companion" aria-pressed="true"><span><strong>陪玩单</strong><small>按小时预约陪玩服务</small></span>${icon('arrow', 13)}</button></div><p class="so-search-empty" data-so-empty="type" hidden>没有匹配的订单类型</p></section>
          <section><h4>陪玩等级</h4><label class="so-search">${icon('search', 14)}<input type="search" aria-label="搜索陪玩等级" placeholder="搜索等级" data-so-search="level"></label><div class="so-options" data-so-options="level"></div><p class="so-search-empty" data-so-empty="level" hidden>没有匹配的等级</p></section>
          <section><h4>服务类型</h4><label class="so-search">${icon('search', 14)}<input type="search" aria-label="搜索服务类型" placeholder="搜索服务类型" data-so-search="product"></label><div class="so-options" data-so-options="product"></div><p class="so-search-empty" data-so-empty="product" hidden>没有匹配的服务</p></section>
        </div>
        <div class="so-field"><label for="soHours">下单时长 <em>*</em></label><div class="so-duration"><div class="so-stepper"><button type="button" data-so-hours="-1" aria-label="减少一小时">−</button><input id="soHours" name="hours" type="number" value="1" min="1" max="24" step="1" required aria-label="服务时长（小时）"><button type="button" data-so-hours="1" aria-label="增加一小时">+</button></div><span>小时</span><small>1 小时起，每次增减 1 小时</small></div></div>
        <div class="so-field"><label for="soRegion">游戏区服 <em>*</em></label><input id="soRegion" name="region" required maxlength="80" placeholder="请输入区服、游戏 ID 等信息"></div>
        <div class="so-field so-remark"><label for="soRequirement">备注</label><textarea id="soRequirement" name="requirement" rows="2" maxlength="300" placeholder="填写位置偏好、开麦要求、段位等（选填）"></textarea></div>
      </section>
      <section class="so-confirmation" hidden><h3 class="so-section-heading"><b>2</b>确认陪玩订单</h3><div class="so-confirm-card"></div><p class="so-payment-note">确认支付后将从账户余额扣款，订单进度可在“我的点单”查看。</p></section>
      <p class="so-error" role="alert"></p>
    </div>
    <footer class="so-footer"><div class="so-price"><span>订单金额 <strong id="soQuote">—</strong></span><small id="soBalance"></small></div><div class="so-footer-actions"><button type="button" class="so-back" hidden>返回修改</button><button type="submit" class="so-submit">下一步，确认订单 ${icon('arrow', 15)}</button></div></footer>
  </form>`;
  document.body.append(modal);
  const form = modal.querySelector('form');
  const $ = selector => modal.querySelector(selector);
  const error = message => { $('.so-error').textContent = message; };
  if (preferredEscort) {
    $('#selfOrderTitle').textContent = `指定陪玩 · ${preferredEscort.name}`;
    $('.so-section-heading').insertAdjacentHTML('afterend', `<p class="so-notice">指定 ${e(preferredEscort.name)}（${e(preferredEscort.number)}） · ${e(preferredEscort.game)} · ${e(preferredEscort.level)}。此单仅邀请该成员；请先沟通服务时间，对方确认后开始服务。</p>`);
  }
  const total = () => Math.round(unitPrice(product(), level()) * Number(form.elements.hours.value));
  const close = () => { if (!pending) modal.close(); };
  modal.addEventListener('close', () => { modal.remove(); onClose?.(); });
  modal.addEventListener('cancel', event => { if (pending) event.preventDefault(); else if (!$('#soCascader').hidden) { event.preventDefault(); setCascader(false); } });
  $('.so-close').onclick = close;
  modal.addEventListener('click', event => { if (event.target === modal) { const rect = modal.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close(); } });
  $('.so-notice-button').onclick = () => { const hidden = !$('#soNotice').hidden; $('#soNotice').hidden = hidden; $('.so-notice-button').setAttribute('aria-expanded', String(!hidden)); };

  function setCascader(open) {
    $('#soCascader').hidden = !open;
    $('.so-service-trigger').setAttribute('aria-expanded', String(open));
  }
  function applySearch(kind) {
    const query = $(`[data-so-search="${kind}"]`).value.trim().toLowerCase();
    let count = 0;
    $(`[data-so-options="${kind}"]`).querySelectorAll('button').forEach(button => { button.hidden = !button.textContent.toLowerCase().includes(query); if (!button.hidden) count++; });
    $(`[data-so-empty="${kind}"]`).hidden = count > 0;
  }
  function renderGames() {
    $('.so-games').innerHTML = [...new Set(products.map(item => item.game))].map((game, i) => `<button type="button" class="so-game" data-so-game="${e(game)}" aria-pressed="${game === selection.game}"><span class="so-game-icon so-game-tone-${i % 4}">${icon('game', 23)}</span><strong>${e(game)}</strong></button>`).join('') || '<p class="so-empty">暂无可售陪玩服务，请稍后再试。</p>';
    modal.querySelectorAll('[data-so-game]').forEach(button => button.onclick = () => {
      if (pending) return;
      selection.game = button.dataset.soGame; selection.productId = products.find(item => item.game === selection.game)?.id || ''; selection.confirmed = false;
      modal.querySelectorAll('[data-so-game]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      modal.querySelectorAll('[data-so-search]').forEach(input => { input.value = ''; });
      renderChoices(); update(); setCascader(true); error('');
    });
  }
  function refreshCatalog(fresh) {
    catalog = fresh; products = matchingProducts();
    if (preferredEscort && !(catalog.members || []).some(member => member.id === preferredEscort.escortId && member.active !== false && !member.escortFrozen && (member.game === preferredEscort.game || member.games?.includes(preferredEscort.game)) && member.levelId === preferredEscort.levelId)) throw new Error('该陪玩当前无法接受此服务或等级已变更，请关闭后重新选择。');
    let invalid = false;
    if (!product() || product().game !== selection.game) {
      const next = products.find(item => item.game === selection.game) || products[0];
      selection.game = next?.game || ''; selection.productId = next?.id || ''; invalid = true;
    }
    if (!level()) { selection.levelId = levels().at(-1)?.id || ''; invalid = true; }
    if (invalid) selection.confirmed = false;
    renderGames(); renderChoices(); update();
    return invalid;
  }
  function renderChoices() {
    $('[data-so-options="level"]').innerHTML = levels().map(item => `<button type="button" class="so-option ${item.id === selection.levelId ? 'is-selected' : ''}" data-so-level="${e(item.id)}" aria-pressed="${item.id === selection.levelId}"><span><strong>${e(item.name)}陪玩</strong><small>${Number.isSafeInteger(unitPrice(product(), item)) ? money(unitPrice(product(), item)) + ' / 小时' : '暂未定价'}</small></span>${icon('arrow', 13)}</button>`).join('');
    $('[data-so-options="product"]').innerHTML = products.filter(item => item.game === selection.game).map(item => `<button type="button" class="so-option ${selection.confirmed && item.id === selection.productId ? 'is-selected' : ''}" data-so-product="${e(item.id)}" aria-pressed="${selection.confirmed && item.id === selection.productId}"><span><strong>${e(item.name)}</strong><small>${Number.isSafeInteger(unitPrice(item, level())) ? money(unitPrice(item, level())) + ' / 小时' : '暂未定价'}</small></span>${icon('check', 14)}</button>`).join('');
    modal.querySelectorAll('[data-so-level]').forEach(button => button.onclick = () => { selection.levelId = button.dataset.soLevel; selection.confirmed = false; renderChoices(); update(); });
    modal.querySelectorAll('[data-so-product]').forEach(button => button.onclick = () => { selection.productId = button.dataset.soProduct; selection.confirmed = true; renderChoices(); update(); setCascader(false); $('.so-service-trigger').focus(); error(''); });
    ['type', 'level', 'product'].forEach(applySearch);
  }
  function update() {
    const chosen = product(), chosenLevel = level();
    $('#soSelectionText').textContent = selection.confirmed ? `${chosenLevel?.name}陪玩 / ${chosen?.name}` : '请选择陪玩服务';
    $('.so-service-trigger').classList.toggle('has-selection', selection.confirmed);
    const amount = total(), hours = Number(form.elements.hours.value);
    $('#soQuote').textContent = selection.confirmed && Number.isSafeInteger(amount) && amount > 0 ? money(amount) : '—';
    $('#soBalance').textContent = `可用余额 ${money(catalog.wallet?.balanceCents)}`;
    $('.so-submit').disabled = pending || !products.length || !levels().length;
    modal.querySelectorAll('[data-so-hours]').forEach(button => button.disabled = button.dataset.soHours.startsWith('-') ? hours <= 1 : hours >= 24);
    if (selection.confirmed && Number.isFinite(amount) && amount > Number(catalog.wallet?.balanceCents || 0)) $('#soBalance').textContent += ` · 还差 ${money(amount - Number(catalog.wallet?.balanceCents || 0))}`;
    if (pending) form.querySelectorAll('button, input, select, textarea').forEach(control => { control.disabled = true; });
  }
  function confirmation() {
    const fields = [['游戏', selection.game], ['订单类型', preferredEscort ? '指定陪玩' : '陪玩单'], ...(preferredEscort ? [['指定成员', `${preferredEscort.name}（${preferredEscort.number}）`]] : []), ['陪玩等级', level()?.name], ['服务类型', product()?.name], ['下单时长', `${form.elements.hours.value} 小时`], ['服务单价', `${money(unitPrice(product(), level()))} / 小时`], ['游戏区服', form.elements.region.value], ['陪玩安排', preferredEscort ? '仅邀请指定成员，由我最终确认；服务时间需与对方沟通' : '客服邀请 / 打手报名，由我最终选择'], ['备注', form.elements.requirement.value.trim() || '无特殊要求']];
    $('.so-confirm-card').innerHTML = `<dl>${fields.map(([label, value]) => `<div><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`).join('')}</dl>`;
  }
  function showStep(value) {
    step = value; error('');
    $('.so-selection').hidden = step !== 1; $('.so-confirmation').hidden = step !== 2;
    $('.so-back').hidden = step !== 2;
    $('.so-submit').innerHTML = step === 1 ? `下一步，确认订单 ${icon('arrow', 15)}` : '余额支付并下单';
    modal.querySelectorAll('[data-so-step]').forEach(item => { item.classList.toggle('is-done', Number(item.dataset.soStep) < step); if (Number(item.dataset.soStep) === step) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current'); });
    if (step === 2) confirmation();
    $('.so-body').scrollTop = 0;
  }
  $('.so-back').onclick = () => showStep(1);
  $('.so-service-trigger').onclick = () => setCascader($('#soCascader').hidden);
  modal.querySelectorAll('[data-so-search]').forEach(input => input.oninput = () => applySearch(input.dataset.soSearch));
  $('[data-so-type]').onclick = () => $('[data-so-search="level"]').focus();
  modal.querySelectorAll('[data-so-hours]').forEach(button => button.onclick = () => { form.elements.hours.stepUp(Number(button.dataset.soHours)); update(); });
  form.addEventListener('input', event => { if (!event.target.matches('[data-so-search]')) { form.elements.region.setCustomValidity(''); update(); error(''); } });
  form.noValidate = true;
  form.onsubmit = async event => {
    event.preventDefault();
    if (pending) return;
    if (!selection.confirmed) { showStep(1); setCascader(true); error('请先选择陪玩等级和服务类型。'); $('.so-service-trigger').focus(); return; }
    form.elements.region.setCustomValidity(form.elements.region.value.trim() ? '' : '请填写游戏区服或游戏 ID。');
    if (!form.checkValidity()) { showStep(1); form.reportValidity(); return; }
    if (!Number.isSafeInteger(total()) || total() <= 0) { error('当前服务暂未定价，请重新选择。'); return; }
    if (step === 1) { showStep(2); return; }
    // Keep the legacy quick-order payload defaults while the optional controls are hidden.
    const submitted = { ...Object.fromEntries(new FormData(form)), productId: selection.productId, levelId: selection.levelId, region: form.elements.region.value.trim(), requirement: form.elements.requirement.value.trim() || '按约定完成陪玩服务', orderMode: preferredEscort ? 'designated' : 'quick', preferredEscortId: preferredEscort?.escortId || '', appointmentAt: '', voice: '游戏内语音' };
    const reviewedPrice = unitPrice(product(), level());
    const purchaseSignature = JSON.stringify({ ...submitted, expectedUnitPriceCents: reviewedPrice, boss: catalog.user.name });
    const disabledBefore = new Map([...form.querySelectorAll('button, input, select, textarea')].map(control => [control, control.disabled]));
    pending = true;
    disabledBefore.forEach((disabled, control) => { control.disabled = true; });
    $('.so-submit').textContent = '正在提交…'; error('');
    let created;
    try {
      // If the previous response was lost, retrieve the same purchase before
      // checking a balance or catalog that may already reflect its payment.
      if (purchaseAttempt?.signature === purchaseSignature) {
        created = await api('/orders', purchaseAttempt.payload);
      } else {
        const invalid = refreshCatalog(await api('/me'));
        if (invalid) { showStep(1); setCascader(true); throw new Error('所选服务或等级已调整，请重新选择。'); }
        const latestPrice = unitPrice(product(), level());
        if (!Number.isSafeInteger(latestPrice) || latestPrice <= 0) { selection.confirmed = false; showStep(1); setCascader(true); throw new Error('当前服务暂未定价，请重新选择。'); }
        if (reviewedPrice !== latestPrice) { confirmation(); throw new Error('服务价格已更新，请核对最新金额后再次确认。'); }
        if (Math.round(latestPrice * Number(submitted.hours)) > Number(catalog.wallet?.balanceCents || 0)) throw new Error('余额不足，请联系客服充值后再下单。');
        purchaseAttempt = { signature: purchaseSignature, payload: { ...submitted, expectedUnitPriceCents: latestPrice, boss: catalog.user.name, pay: '在线支付', context: 'personal', requestId: crypto.randomUUID() } };
        created = await api('/orders', purchaseAttempt.payload);
      }
    } catch (failure) {
      if (failure.status && failure.status < 500) purchaseAttempt = null;
      error(failure.message || '下单失败，请重试。');
    }
    finally {
      pending = false; disabledBefore.forEach((disabled, control) => { control.disabled = disabled; });
      $('.so-submit').innerHTML = step === 1 ? `下一步，确认订单 ${icon('arrow', 15)}` : '余额支付并下单'; renderGames(); renderChoices(); update();
    }
    if (created) {
      modal.close();
      try { await onSuccess?.(created); }
      catch { window.alert(`订单 ${created.id} 已创建。页面暂时未能刷新，请前往“我的点单”查看订单进度。`); }
    }
  };
  renderGames(); renderChoices(); update(); modal.showModal();
  return modal;
}
