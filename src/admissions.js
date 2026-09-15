import { escapeHtml as e, icon } from './ui.js';

const states = { consulting: '咨询中', unpaid: '待支付', pending: '待考核', inProgress: '考核中', recheck: '待复核', passed: '已通过', failed: '未通过', cancelled: '已取消', refunded: '已退款' };
const finished = new Set(['passed', 'failed', 'cancelled', 'refunded']);
const money = cents => Number.isSafeInteger(cents) ? `¥ ${(cents / 100).toFixed(2)}` : '未配置';
const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '未安排';
const status = value => `<span class="ad-status ad-status-${e(value)}">${e(states[value] || value || '咨询中')}</span>`;
const button = (action, label, symbol = '', extra = '', primary = false) => `<button type="button" class="ad-button${primary ? ' ad-primary' : ''}" data-ad-action="${action}" ${extra}>${symbol ? icon(symbol, 16) : ''}${label}</button>`;
const field = (label, name, content) => `<label class="ad-field"><span>${label}</span>${content || `<input name="${name}" required>`}</label>`;
const empty = text => `<div class="ad-empty">${icon('receipt', 28)}<p>${text}</p></div>`;
const actionForm = (key, title, body, label, attrs = '', primary = false) => `<form class="ad-action-form" data-ad-form="${key}" ${attrs}><h4>${title}</h4>${body}<button class="ad-button${primary ? ' ad-primary' : ''}" type="submit">${label}</button></form>`;
const reasonField = label => field(label, 'reason', `<textarea name="reason" rows="2" maxlength="2000" required></textarea>`);
const localDateTime = value => {
  const d = new Date(value); if (!Number.isFinite(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function admissionsMarkup() {
  return `<section class="admissions" aria-label="打手入驻考核"><header class="ad-heading"><div><h2>入驻考核</h2><p data-ad-caption>考核申请与咨询记录</p></div><div class="ad-heading-actions"><button type="button" class="ad-draft-discard" data-ad-action="discardDraft" hidden>放弃修改</button><span data-ad-sync role="status"></span><button type="button" class="ad-icon-button" data-ad-action="refresh" aria-label="刷新考核记录" title="刷新考核记录">${icon('arrow', 18)}</button></div></header><div class="ad-error" role="alert" hidden></div><nav class="ad-top-tabs" aria-label="考核管理" hidden></nav><div class="ad-layout"><aside class="ad-sidebar"><div class="ad-sidebar-tools"></div><div class="ad-application-list" aria-label="考核申请"></div></aside><main class="ad-main"><div class="ad-detail">${empty('正在加载考核信息…')}</div></main></div></section>`;
}

export function mountAdmissions(container, { api, workspace, mode, onNavigate, onChanged, initialId } = {}) {
  if (!container) return () => {};
  let root = container.matches?.('.admissions') ? container : container.querySelector('.admissions');
  if (!root) { container.innerHTML = admissionsMarkup(workspace); root = container.querySelector('.admissions'); }
  const $ = selector => root.querySelector(selector);
  let snapshot = null, selected = initialId || '', section = 'applications', view = 'order', filter = 'all';
  let dead = false, busy = false, requestId = 0, loading = false, dirty = false, pendingDetail = false, initialized = false;
  let detailSignature = '', messageSignature = '', listSignature = '', configGame = '', newGame = '', renderedKey = '', orderRequestId = crypto.randomUUID();
  const drafts = new Map();
  const active = () => !dead && root.isConnected;
  const apps = () => snapshot?.applications || [];
  const games = () => snapshot?.games || [];
  const application = () => apps().find(item => item.id === selected);
  const orderFor = app => snapshot?.orders?.find(order => order.id === app?.orderId || order.applicationId === app?.id);
  const ongoing = app => !finished.has(app.status) || orderFor(app)?.dispute?.status === 'pending';
  const configFor = game => games().find(item => item.game === game);
  const isAdmin = () => snapshot?.role === 'admin';
  const staffFor = app => app && app.userId !== snapshot?.userId && (isAdmin() || snapshot?.role === 'examiner' && app.examinerId === snapshot.userId);
  const own = app => app?.userId === snapshot?.userId;
  const setError = message => { if (!active()) return; $('.ad-error').textContent = message; $('.ad-error').hidden = !message; };
  const setSync = text => { if (active()) $('[data-ad-sync]').textContent = text; };
  const selectedKey = () => `${section}:${section === 'config' ? configGame : selected || 'new'}:${view}`;
  const formState = () => [...$('.ad-detail').querySelectorAll('input,textarea,select')].filter(el => el.name).map(el => ({ name: el.name, value: el.value, checked: el.checked, type: el.type }));
  function remember() {
    if (dirty) drafts.set(selectedKey(), { controls: formState(), versions: [...$('.ad-detail').querySelectorAll('form[data-version]')].map(form => ({ type: form.dataset.adForm, version: form.dataset.version, configVersion: form.dataset.configVersion })) });
  }
  function restore() {
    const savedDraft = drafts.get(selectedKey());
    if (!savedDraft) return;
    for (const saved of savedDraft.controls) {
      const controls = [...$('.ad-detail').querySelectorAll('input,textarea,select')].filter(el => el.name === saved.name);
      const el = ['checkbox', 'radio'].includes(saved.type) ? controls.find(item => item.value === saved.value) : controls[0];
      if (!el || el.type === 'checkbox' && ['acceptTerms', 'acceptStandards'].includes(el.name)) continue;
      if (['checkbox', 'radio'].includes(saved.type)) el.checked = saved.checked;
      else el.value = saved.value;
    }
    for (const saved of savedDraft.versions) {
      const form = [...$('.ad-detail').querySelectorAll('form')].find(item => item.dataset.adForm === saved.type);
      if (form) { form.dataset.version = saved.version; if (saved.configVersion) form.dataset.configVersion = saved.configVersion; }
    }
    dirty = true;
  }

  function renderList() {
    const admin = isAdmin();
    const topTabs = $('.ad-top-tabs');
    topTabs.hidden = !admin;
    topTabs.innerHTML = admin ? `<button type="button" data-ad-section="applications" aria-current="${section === 'applications' ? 'page' : 'false'}">考核申请</button><button type="button" data-ad-section="config" aria-current="${section === 'config' ? 'page' : 'false'}">费用与考官配置</button>` : '';
    $('.ad-heading h2').textContent = admin || snapshot.role === 'examiner' ? '入驻考核' : '成为打手';
    $('[data-ad-caption]').textContent = admin ? '安排考官、跟进考核订单与处理争议' : snapshot.role === 'examiner' ? '处理考核派单，联系申请人并安排考核' : application() ? '跟进订单、考官联系和考核结果' : '选择游戏并确认标准，后台为你安排考官';
    root.classList.toggle('ad-config-mode', section === 'config');
    root.classList.toggle('ad-personal-mode', !admin && snapshot.role !== 'examiner');
    const tools = `${snapshot.canApply ? button('new', '申请入驻', 'plus', '', true) : ''}<label class="ad-filter"><span>申请状态</span><select data-ad-filter aria-label="筛选考核申请"><option value="all" ${filter === 'all' ? 'selected' : ''}>全部申请</option><option value="ongoing" ${filter === 'ongoing' ? 'selected' : ''}>进行中</option><option value="unassigned" ${filter === 'unassigned' ? 'selected' : ''}>待分配考官</option><option value="uncontacted" ${filter === 'uncontacted' ? 'selected' : ''}>待联系申请人</option><option value="disputes" ${filter === 'disputes' ? 'selected' : ''}>争议待处理</option><option value="ended" ${filter === 'ended' ? 'selected' : ''}>已结束</option></select></label>`;
    if ($('.ad-sidebar-tools').innerHTML !== tools && !$('.ad-sidebar-tools').contains(document.activeElement)) $('.ad-sidebar-tools').innerHTML = tools;
    const visible = [...apps()].filter(app => filter === 'unassigned' ? ongoing(app) && app.orderId && !app.examinerId : filter === 'uncontacted' ? ongoing(app) && app.orderId && app.examinerId && !orderFor(app)?.contactedAt && !orderFor(app)?.appointmentAt : filter === 'ongoing' ? ongoing(app) : filter === 'ended' ? !ongoing(app) : filter === 'disputes' ? orderFor(app)?.dispute?.status === 'pending' : true).sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
    const html = visible.map(app => `<button type="button" class="ad-application${selected === app.id ? ' is-selected' : ''}" data-ad-select="${e(app.id)}" aria-pressed="${selected === app.id}"><span class="ad-application-top"><strong>${e(app.game)}</strong>${status(app.status)}${!app.examinerId && app.orderId && !finished.has(app.status) ? '<span class="ad-status ad-status-pending">待分配</span>' : ''}</span><span>${e(own(app) ? `考官：${app.examinerName || "待分配"}` : `申请人：${app.userName}`)}</span><small>${e(date(app.updatedAt))}${orderFor(app)?.dispute?.status === 'pending' ? '<b>争议待处理</b>' : ''}</small></button>`).join('') || empty('暂无考核申请');
    if (html !== listSignature) { $('.ad-application-list').innerHTML = html; listSignature = html; }
  }

  function configSummary(config) {
    if (!config) return '<p class="ad-note">暂无可选游戏。</p>';
    return `<div class="ad-fee-summary ad-standard-fee"><div><span>考核费</span><strong>${money(config.feeCents)}</strong></div></div>${config.description ? `<p class="ad-description" data-ad-standard>${e(config.description)}</p>` : '<p class="ad-note" data-ad-standard>考核标准尚未公布。</p>'}<p class="ad-note">考核费不计入押金。当前收益提现要求押金达到 ${money(snapshot.withdrawalMinDepositCents)}，通过考核后仍适用。</p>${!config.payable ? '<p class="ad-warning">暂未开放付费考核，可以先与考官咨询。</p>' : ''}`;
  }

  function newApplicationMarkup() {
    if (!snapshot.canApply) return empty(snapshot.role === 'escort' ? '你已取得打手资格。' : '暂无考核申请');
    const existing = apps().find(ongoing);
    if (existing) return `<div class="ad-new"><h3>你有一份进行中的申请</h3><p>${e(existing.game)} · ${e(existing.examinerName)} · ${orderFor(existing)?.dispute?.status === 'pending' ? '争议处理中' : e(states[existing.status])}</p>${button('resume', '继续申请', 'arrow', `data-id="${e(existing.id)}"`, true)}</div>`;
    if (!games().length) return empty('暂无开放入驻的游戏');
    if (!games().some(game => game.game === newGame)) newGame = '';
    return personalApplicationMarkup();
  }

  function configMarkup() {
    if (!isAdmin()) return empty('无权管理考核配置');
    if (!games().length) return empty('请先在游戏管理中添加上架游戏');
    if (!games().some(game => game.game === configGame)) configGame = games()[0].game;
    const config = configFor(configGame);
    const examiners = (snapshot.examiners || []).filter(examiner => examiner.active && (!examiner.games?.length || examiner.games.includes(config.game)));
    return `<div class="ad-config"><h3>费用与考官配置</h3>${field('游戏', '', `<select data-ad-config-game aria-label="选择配置游戏">${games().map(game => `<option value="${e(game.game)}" ${game.game === configGame ? 'selected' : ''}>${e(game.game)}</option>`).join('')}</select>`)}<form data-ad-form="config" data-version="${config.version}" class="ad-config-form"><label class="ad-check"><input type="checkbox" name="enabled" ${config.enabled ? 'checked' : ''}><span>开放付费考核</span></label><div class="ad-field-grid">${field('考核费（元）', 'fee', `<input name="fee" type="number" min="0.01" max="100000" step="0.01" value="${Number.isSafeInteger(config.feeCents) ? (config.feeCents / 100).toFixed(2) : ''}">`)}${field('通过后授予等级', 'levelId', `<select name="levelId"><option value="">请选择等级</option>${(snapshot.levels || []).map(level => `<option value="${e(level.id)}" ${level.id === config.levelId ? 'selected' : ''}>${e(level.name)}</option>`).join('')}</select>`)}</div>${field('考核标准与费用说明', 'description', `<textarea name="description" rows="6" maxlength="4000">${e(config.description || '')}</textarea>`)}<fieldset class="ad-examiners"><legend>指定考官</legend>${examiners.map(examiner => `<label class="ad-check"><input type="checkbox" name="examinerIds" value="${e(examiner.id)}" ${config.examinerIds?.includes(examiner.id) ? 'checked' : ''}><span>${e(examiner.name)}</span></label>`).join('') || '<p class="ad-note">暂无符合该游戏范围的启用考官。</p>'}</fieldset><p class="ad-note">调整费用或标准后，未支付的旧订单需要取消并重新预约；已支付订单按下单时的标准考核。</p><button type="submit" class="ad-button ad-primary">${icon('check', 16)}保存配置</button></form></div>`;
  }

  function chatMarkup(app) {
    return `<section class="ad-chat" aria-label="考核咨询"><div class="ad-messages" role="log" aria-label="考核会话消息" aria-relevant="additions"></div><form class="ad-composer" data-ad-form="message" data-conversation="${e(app.conversationId)}"><label class="ad-sr-only" for="adMessage">给考官或申请人发送消息</label><textarea id="adMessage" name="text" maxlength="2000" rows="3" placeholder="输入消息" required></textarea><div><span class="ad-note">${e(own(app) ? `接待考官：${app.examinerName}` : `申请人：${app.userName}`)}</span><button class="ad-button ad-primary" type="submit">${icon('arrow', 16)}发送</button></div></form></section>`;
  }

  function progressMarkup(app) {
    if (app && ['cancelled', 'refunded'].includes(app.status)) return '';
    const step = !app ? 0 : ({ consulting: 0, unpaid: 1, pending: 2, inProgress: 2, recheck: 3, passed: 3, failed: 3 })[app.status] ?? 0;
    return `<ol class="ad-progress" aria-label="考核流程">${['确认标准', '订单与支付', '联系与考核', '查看结果'].map((label, index) => `<li class="${index < step || app?.status === 'passed' ? 'is-complete' : index === step ? 'is-current' : ''}" ${index === step ? 'aria-current="step"' : ''}><span>${index < step || app?.status === 'passed' ? icon('check', 13) : index + 1}</span><strong>${label}</strong></li>`).join('')}</ol>`;
  }

  function personalNavigationMarkup() {
    const mine = apps().filter(own).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    if (!mine.length) return '';
    const canRestart = snapshot.canApply && !mine.some(ongoing) && selected;
    return `<div class="ad-personal-navigation"><details class="ad-disclosure ad-attempts" data-ad-disclosure="attempts"><summary>${icon('receipt', 16)}我的考核申请（${mine.length}）${icon('chevron', 16)}</summary><div class="ad-attempt-list">${mine.map(app => `<button type="button" data-ad-select="${e(app.id)}" aria-pressed="${app.id === selected}"><span><strong>${e(app.game)}</strong><small>${e(date(app.createdAt))} · 考官 ${e(app.examinerName)}</small></span>${status(app.status)}</button>`).join('')}</div></details>${canRestart ? button('new', '重新申请', 'plus') : ''}</div>`;
  }

  function personalBookingMarkup(app, config, cancellation = '') {
    if (app && app.status !== 'consulting') return '<section class="ad-order"><h3>本次申请已结束</h3><p class="ad-note">可在下方查看申请记录或重新申请。</p></section>';
    const game = app?.game || newGame;
    const canOrder = snapshot.canApply && config?.orderable;
    return `<section class="ad-order ad-booking-card">
      <div class="ad-order-heading"><div><h3>选择考核游戏</h3><p class="ad-note">查看对应标准，确认后即可提交考核订单。</p></div>${game ? `<div class="ad-order-price"><span>考核费用</span><strong>${money(config?.feeCents)}</strong></div>` : ''}</div>
      <form class="ad-action-form ad-booking-form" data-ad-form="placeOrder" data-config-version="${config?.version || 0}">
        ${field('考核游戏', 'game', `<select name="game" data-ad-game required ${app ? 'disabled' : ''}><option value="">请选择要考核的游戏</option>${(app ? [{game}] : games()).map(item => `<option value="${e(item.game)}" ${item.game === game ? 'selected' : ''}>${e(item.game)}</option>`).join('')}</select>`)}
        <section class="ad-order-standard" aria-label="考核标准" aria-live="polite"><h4>${game ? `考核标准 · ${e(game)}` : '考核标准'}</h4><p class="ad-description" data-ad-standard>${e(config?.description || (game ? '该游戏尚未公布考核标准。' : '选择游戏后，将在这里展示对应的考核标准与要求。'))}</p></section>
        ${game && !canOrder ? '<p class="ad-warning">该游戏暂未开放考核，请选择其他游戏或稍后再试。</p>' : canOrder && !config.examiners?.length ? '<p class="ad-warning">暂无可用考官，提交后将由管理员安排；开始考核前可取消订单。</p>' : ''}
        <label class="ad-check"><input type="checkbox" name="acceptStandards" required ${canOrder ? '' : 'disabled'}><span>我已阅读并确认${game ? `「${e(game)}」的` : ''}考核标准与费用。</span></label>
        <div class="ad-booking-actions"><button class="ad-button ad-primary" type="submit" ${canOrder ? '' : 'disabled'}>${icon('receipt', 16)}确认并创建考核订单</button></div>
        <p class="ad-note">创建后由后台安排考官联系你、协商考核时间。创建订单不会立即扣款。</p>
      </form>
      <p class="ad-deposit-note">考核费不计入押金；收益提现须满足 ${money(snapshot.withdrawalMinDepositCents)} 的押金门槛。</p>
      ${cancellation}
    </section>`;
  }

  function personalChatMarkup(app, config) {
    if (!app) return `<div class="ad-process-guide"><span class="ad-standard-tag">后台安排 · 全程可查</span><h3>提交后会发生什么？</h3><ol><li><strong>订单创建</strong><p>保存本次游戏、考核标准和费用，在订单内完成支付。</p></li><li><strong>后台安排考官</strong><p>按游戏匹配考官，你无需自行选择或寻找考官。</p></li><li><strong>考官联系你</strong><p>通过订单会话确认考核时间和注意事项，请留意站内消息。</p></li><li><strong>参加考核，查看结果</strong><p>按约参加考核；通过后开通打手资格。</p></li></ol><p class="ad-note">考核开始前可取消，已支付费用全额退回余额。未通过不自动退款，可申请争议复核。</p></div>`;
    const examinerName = app.examinerName || '等待安排考官';
    return `<div class="ad-examiner-heading"><span class="ad-examiner-avatar">${app.examinerId ? e(examinerName.slice(0, 1)) : icon('users', 18)}</span><div><h3>${e(examinerName)}</h3><p class="ad-note">${finished.has(app.status) ? '本次考核的历史会话' : app.examinerId ? '后台已分配，考官将通过这里联系你' : '管理员正在安排该游戏的考官'}</p></div><span class="ad-standard-tag">${app.examinerId ? '订单会话' : '待分配'}</span></div>
      ${app.examinerId ? chatMarkup(app) : `<section class="ad-chat ad-chat-pending" aria-label="考核咨询">${empty('订单已提交。分配考官后将开启会话并通知你。')}</section>`}
      <div class="ad-chat-footer"><p class="ad-chat-tip">${icon('message', 14)}在这里确认时间、范围和注意事项。</p>${button('backToOrder', app && orderFor(app) ? '返回订单' : '返回预约', 'arrow')}</div>`;
  }

  function personalApplicationMarkup(app) {
    const order = app ? orderFor(app) : null, game = app?.game || newGame, config = configFor(game);
    const hints = {
      consulting: '确认游戏标准即可创建订单，由后台安排考核。',
      unpaid: '订单已创建，后台将安排考官联系你；请完成订单支付。',
      pending: order?.appointmentAt ? '支付已完成，请按约定时间参加考核。' : '支付已完成，等待考官联系并确认考核时间。',
      inProgress: '考核进行中，可随时与考官沟通。',
      recheck: '本次考核正在复核，请留意考官消息。',
      passed: '恭喜通过考核，现在可以进入打手工作台。',
      failed: '可查看考核结果；如有异议，可申请争议复核。',
      cancelled: '本次申请已取消，可重新发起考核申请。',
      refunded: '考核费用已退回余额，可在钱包中查看。',
    };
    return `<div class="ad-personal-workspace">
      <header class="ad-personal-heading">
        <div class="ad-personal-title"><span class="ad-game-icon">${icon('game', 23)}</span><div><div class="ad-personal-title-line"><h3>${game ? `${e(game)} · 入驻考核` : '申请成为打手'}</h3>${app ? status(app.status) : '<span class="ad-status ad-status-consulting">待确认</span>'}</div><p class="ad-note">${e(order?.dispute?.status === 'pending' ? '争议已提交，等待管理员处理。' : hints[app?.status] || '选好游戏、确认标准，剩下的交给后台安排。')}</p></div></div>
      </header>
      ${progressMarkup(app)}
      <div class="ad-personal-flow">
        <div class="ad-personal-primary">
          <section class="ad-personal-order">${app ? orderMarkup(app, { showStandard: false, personal: true }) : personalBookingMarkup(null, config)}</section>
          ${personalNavigationMarkup()}
          ${app ? `<details class="ad-personal-history ad-disclosure" data-ad-disclosure="history"><summary>${icon('clock', 16)}申请记录<span>查看进度与操作记录</span>${icon('chevron', 16)}</summary>${historyMarkup(app)}</details>` : ''}
        </div>
        <aside class="ad-personal-chat" aria-label="${app ? '联系考官' : '申请流程说明'}">
          ${personalChatMarkup(app, config)}
        </aside>
      </div>
    </div>`;
  }

  function assignmentMarkup(app, order) {
    if (!order || finished.has(order.status)) return '';
    const assigned = Boolean(app.examinerId), scheduled = Boolean(order.appointmentAt);
    const title = !assigned ? '等待后台安排考官' : scheduled ? '考核时间已确认' : order.contactedAt ? '考官已联系，正在协商时间' : '已安排考官，等待联系';
    const detail = !assigned ? '管理员已收到订单，将安排该游戏的考官。' : scheduled ? `${app.examinerName} · ${date(order.appointmentAt)}（北京时间）` : own(app) ? `${app.examinerName} 负责本次考核，请留意订单会话和站内通知。` : `${app.examinerName} 负责本次考核，请及时联系申请人并确认时间。`;
    return `<div class="ad-assignment-status" role="status">${icon(scheduled ? 'calendar' : 'users', 18)}<div><strong>${title}</strong><p>${e(detail)}</p></div></div>`;
  }

  function scheduleMarkup(app, order) {
    if (!staffFor(app) || !['unpaid', 'pending'].includes(order.status) || !app.examinerId) return '';
    const beijing = order.appointmentAt ? new Date(Date.parse(order.appointmentAt) + 8 * 3600000).toISOString() : '';
    const day = time => new Date(time + 8 * 3600000).toISOString().slice(0, 10);
    return `<div class="ad-staff-contact">${button('contact', '联系申请人', 'message')}<p class="ad-note">先通过订单会话联系申请人，再填写双方确认的时间。</p></div>${actionForm('schedule', order.appointmentAt ? '调整考核时间' : '安排考核时间', `<div class="ad-booking-time">${field('考核日期', 'appointmentDate', `<input name="appointmentDate" type="date" min="${day(Date.now())}" max="${day(Date.now() + 89 * 86400000)}" value="${beijing.slice(0, 10)}" required>`)}${field('开始时间（北京时间）', 'appointmentTime', `<input name="appointmentTime" type="time" value="${beijing.slice(11, 16)}" required>`)}</div><label class="ad-check"><input type="checkbox" name="confirmed" required><span>已与申请人确认此考核时间。</span></label>`, '保存考核时间', `data-order="${e(order.id)}" data-version="${order.version}"`)}`;
  }

  function orderMarkup(app, { showStandard = true, personal = false } = {}) {
    const order = orderFor(app), config = configFor(app.game), reviewer = staffFor(app);
    if (!order) {
      const canCreate = app.status === 'consulting' && (own(app) && snapshot.canApply || reviewer) && config?.payable && config.examiners?.some(examiner => examiner.id === app.examinerId);
      const cancelForm = (own(app) || isAdmin()) && app.status === 'consulting' ? actionForm('cancelApplication', '取消申请', reasonField('取消原因'), '取消申请', `data-version="${app.version}"`) : '';
      const cancelApplication = personal && cancelForm ? `<details class="ad-disclosure ad-cancel-disclosure" data-ad-disclosure="cancel"><summary>取消申请${icon('chevron', 16)}</summary>${cancelForm}</details>` : cancelForm;
      if (personal) return personalBookingMarkup(app, config, cancelApplication);
      return `<section class="ad-order"><div class="ad-order-heading"><h3>创建考核订单</h3><span class="ad-status ad-status-consulting">${canCreate ? '可预约' : '暂不可预约'}</span></div>${showStandard ? configSummary(config) : ``}${app.status === 'consulting' ? actionForm('order', '确认预约时间', field('考核时间', 'appointmentAt', `<input name="appointmentAt" type="datetime-local" min="${localDateTime(Date.now() + 60000)}" max="${localDateTime(Date.now() + 89 * 86400000)}" required ${canCreate ? '' : 'disabled'}>`), '创建考核订单', `data-version="${app.version}" data-config-version="${config?.version || 0}" ${canCreate ? '' : 'data-unavailable="true"'}`, true) : ''}<p class="ad-note">预约时间以与考官确认的时间为准。创建订单后由申请人本人支付。</p>${cancelApplication}</section>`;
    }
    let actions = scheduleMarkup(app, order) + (isAdmin() ? reassignMarkup(app) : '');
    if (own(app) && order.status === 'unpaid') {
      const enough = snapshot.balanceCents >= order.feeCents;
      const canPay = snapshot.canApply && snapshot.verified && enough && (order.flow === 'orderFirst' ? config?.orderable : config?.payable) && config.version === order.configVersion && (order.flow === 'orderFirst' || Date.parse(order.appointmentAt) > Date.now());
      actions += `<form class="ad-payment ad-action-form" data-ad-form="pay" data-order="${e(order.id)}" data-version="${order.version}" data-config-version="${order.configVersion}">${personal ? `<div class="ad-payment-heading"><h4>余额支付</h4><span>可用余额 <strong>${money(snapshot.balanceCents)}</strong></span></div>` : `<h4>余额支付</h4><div class="ad-fee-summary"><div><span>本次支付</span><strong>${money(order.feeCents)}</strong></div><div><span>账户余额</span><strong>${money(snapshot.balanceCents)}</strong></div></div>`}<label class="ad-check ad-terms"><input name="acceptTerms" type="checkbox" required><span>我已确认考核费 ${money(order.feeCents)}及考核标准；考核未通过不自动退款。开始前取消可全额退回余额，开始后可申请争议处理。考核费不计入押金；收益提现须达到押金门槛 ${money(snapshot.withdrawalMinDepositCents)}。</span></label>${!snapshot.verified ? `<p class="ad-warning">通过实名认证后才可支付。</p>${button('realName', '实名认证', 'lock')}` : ''}${!enough ? `<p class="ad-warning">余额不足，还差 ${money(order.feeCents - snapshot.balanceCents)}。</p>${button('topup', '账户充值', 'wallet')}` : ''}${config?.version !== order.configVersion ? '<p class="ad-warning">费用或标准已调整，请取消旧订单后重新预约。</p>' : ''}${order.flow !== 'orderFirst' && Date.parse(order.appointmentAt) <= Date.now() ? '<p class="ad-warning">预约时间已过，请取消订单后重新预约。</p>' : ''}${personal ? '<div class="ad-pay-actions">' : ''}<button class="ad-button ad-primary" type="submit" ${canPay ? '' : 'disabled'}>${icon('wallet', 16)}确认支付 ${money(order.feeCents)}</button>${personal ? button('contact', '联系考官', 'message', app.examinerId ? '' : 'disabled') + '</div>' : ''}</form>`;
    }
    if ((own(app) || isAdmin()) && ['unpaid', 'pending'].includes(order.status)) {
      const cancelForm = actionForm('cancelOrder', order.paidAt ? '取消并全额退款' : '取消订单', reasonField('取消原因'), order.paidAt ? `取消并退回 ${money(order.feeCents)}` : '取消订单', `data-order="${e(order.id)}" data-version="${order.version}"`);
      actions += personal ? `<details class="ad-disclosure ad-cancel-disclosure" data-ad-disclosure="cancel"><summary>${order.paidAt ? '取消考核并退款' : '取消订单'}${icon('chevron', 16)}</summary>${cancelForm}</details>` : cancelForm;
    }
    if (reviewer && order.status === 'pending' && app.examinerId && order.appointmentAt) actions += actionForm('start', '开始考核', `<p class="ad-note">预约时间：${e(date(order.appointmentAt))}</p><label class="ad-check"><input type="checkbox" name="ready" required><span>已与申请人确认，开始本次考核</span></label>`, '开始考核', `data-order="${e(order.id)}" data-version="${order.version}"`, true);
    if (reviewer && ['inProgress', 'recheck'].includes(order.status) && order.dispute?.status !== 'pending') actions += actionForm('review', '提交考核结果', `<div class="ad-field-grid">${field('考核结果', 'result', '<select name="result" required><option value="">请选择结果</option><option value="pass">通过并授予打手资格</option><option value="fail">未通过</option><option value="recheck">待复核</option></select>')}${field('评分（0–100）', 'score', '<input type="number" name="score" min="0" max="100" step="1" required>')}</div>${field('考核结论', 'notes', '<textarea name="notes" rows="3" maxlength="2000" required></textarea>')}${field('考核证据', 'evidence', '<textarea name="evidence" rows="3" maxlength="4000" required placeholder="填写对局记录、成绩或证据链接"></textarea>')}<label class="ad-check"><input type="checkbox" name="reviewConfirmed" required><span>已核对结论与证据，通过后将授予该游戏的打手资格</span></label>`, '提交结果', `data-order="${e(order.id)}" data-version="${order.version}"`, true);
    if (own(app) && ['inProgress', 'recheck', 'failed'].includes(order.status) && order.dispute?.status !== 'pending') actions += actionForm('dispute', '申请争议复核', reasonField('争议原因与诉求'), '提交争议', `data-order="${e(order.id)}" data-version="${order.version}"`);
    if (order.dispute) actions += `<div class="ad-dispute"><h4>争议处理 · ${order.dispute.status === 'pending' ? '待处理' : '已处理'}</h4><p>${e(order.dispute.reason)}</p>${order.dispute.reviewNote ? `<p>处理说明：${e(order.dispute.reviewNote)}</p>` : ''}</div>`;
    if (isAdmin() && order.dispute?.status === 'pending') actions += actionForm('resolveDispute', '处理争议', field('处理结果', 'decision', '<select name="decision" required><option value="">请选择处理结果</option><option value="refund">全额退款</option><option value="recheck">安排复核</option><option value="reject">驳回争议</option></select>') + reasonField('处理依据'), '确认处理', `data-order="${e(order.id)}" data-version="${order.version}"`, true);
    if (isAdmin() && ['inProgress', 'recheck', 'failed'].includes(order.status) && order.dispute?.status !== 'pending') actions += actionForm('refund', '全额退款', reasonField('退款原因'), `退回 ${money(order.feeCents)}`, `data-order="${e(order.id)}" data-version="${order.version}"`);
    if (personal) return `<section class="ad-order ad-order-card">
      <div class="ad-order-heading"><h3>考核订单</h3><div class="ad-order-price"><span>考核费用</span><strong>${money(order.feeCents)}</strong></div></div>
      ${assignmentMarkup(app, order)}
      <dl class="ad-booking-facts">
        <div><dt>${icon('calendar', 15)}预约时间（北京时间）</dt><dd>${e(date(order.appointmentAt))}</dd></div>
        <div><dt>${icon('users', 15)}接待考官</dt><dd>${e(order.examinerName || '等待后台分配')}</dd></div>
        ${order.paidAt ? `<div><dt>支付时间</dt><dd>${e(date(order.paidAt))}</dd></div>` : ''}
        ${order.refundedAt ? `<div><dt>已退回余额</dt><dd>${money(order.refundedCents)}</dd></div>` : ''}
      </dl>
      <section class="ad-order-standard" aria-label="本单考核标准"><h4>本单考核标准</h4><p class="ad-description" data-ad-standard>${e(order.description || '考核标准尚未公布。')}</p></section>
      ${order.status === 'passed' ? '<p class="ad-success">考核已通过，打手资格已授予。</p>' : ''}
      ${order.status === 'failed' ? '<p class="ad-warning">本次考核未通过，费用不自动退回。对结果有异议可提交争议复核。</p>' : ''}
      ${order.cancelReason ? `<p class="ad-note">取消或退款原因：${e(order.cancelReason)}</p>` : ''}
      ${actions}${reviewsMarkup(order)}
      <details class="ad-disclosure ad-order-reference" data-ad-disclosure="reference"><summary>订单编号${icon('chevron', 16)}</summary><p>${e(order.id)}</p></details>
    </section>`;
    return `<section class="ad-order"><div class="ad-order-heading"><h3>考核订单</h3>${status(order.status)}</div>${assignmentMarkup(app, order)}<dl class="ad-facts"><div><dt>订单号</dt><dd>${e(order.id)}</dd></div><div><dt>考核费用</dt><dd>${money(order.feeCents)}</dd></div><div><dt>预约时间</dt><dd>${e(date(order.appointmentAt))}</dd></div>${reviewer ? `<div><dt>授予等级</dt><dd>${e(order.levelName || '未配置')}</dd></div>` : ''}<div><dt>考官</dt><dd>${e(order.examinerName || '等待后台分配')}</dd></div>${order.paidAt ? `<div><dt>余额支付时间</dt><dd>${e(date(order.paidAt))}</dd></div>` : ''}${order.refundedAt ? `<div><dt>已退回余额</dt><dd>${money(order.refundedCents)}</dd></div>` : ''}</dl><h4>本单考核标准</h4><p class="ad-description">${e(order.description)}</p>${order.status === 'passed' ? '<p class="ad-success">考核已通过，打手资格已授予。</p>' : ''}${order.status === 'failed' ? '<p class="ad-warning">本次考核未通过，费用不自动退回。对结果有异议可提交争议复核。</p>' : ''}${order.cancelReason ? `<p class="ad-note">取消或退款原因：${e(order.cancelReason)}</p>` : ''}${actions}${reviewsMarkup(order)}</section>`;
  }

  function reviewsMarkup(order) {
    return order?.reviews?.length ? `<section class="ad-review-history"><h4>考核结果记录</h4>${order.reviews.map(review => `<article><div><strong>${e({ pass: '通过', fail: '未通过', recheck: '待复核' }[review.result] || review.result)} · ${e(review.score)} 分</strong><time>${e(date(review.at))}</time></div><p>${e(review.notes)}</p><p class="ad-evidence">${e(review.evidence)}</p><small>${e(review.examinerName)}</small></article>`).join('')}</section>` : '';
  }

  function reassignMarkup(app) {
    return isAdmin() && !finished.has(app.status) ? actionForm('reassign', app.examinerId ? '重新分派考官' : '分配考官', field('接任考官', 'examinerId', `<select name="examinerId" required><option value="">请选择考官</option>${(configFor(app.game)?.examiners || []).filter(examiner => examiner.id !== app.examinerId).map(examiner => `<option value="${e(examiner.id)}">${e(examiner.name)}</option>`).join('')}</select>`) + reasonField('安排说明'), app.examinerId ? '确认转派' : '确认分配', `data-version="${app.version}"`) : '';
  }

  function historyMarkup(app) {
    const reassign = reassignMarkup(app);
    return `<section class="ad-history"><h3>申请记录</h3><p class="ad-note">申请号：${e(app.id)}</p><ol><li><strong>发起入驻申请</strong><span>${e(app.userName)} · ${e(date(app.createdAt))}</span></li>${(app.history || []).map(item => `<li><strong>${e(item.action)}</strong>${item.detail ? `<p>${e(item.detail)}</p>` : ''}<span>${e(item.by)} · ${e(date(item.at))}</span></li>`).join('')}</ol>${reassign}</section>`;
  }

  function renderDetail(force = false) {
    const app = application(), order = orderFor(app);
    const signature = JSON.stringify([section, selected, view, configGame, newGame, app, order, games(), snapshot.levels, snapshot.examiners, snapshot.balanceCents, snapshot.verified, snapshot.canApply]);
    if (!force && signature === detailSignature) { renderMessages(); return; }
    if (!force && dirty) { pendingDetail = true; setSync('记录有更新'); renderMessages(); return; }
    const opened = renderedKey === selectedKey() ? [...$('.ad-detail').querySelectorAll('details[data-ad-disclosure][open]')].map(el => el.dataset.adDisclosure) : [];
    renderedKey = selectedKey();
    detailSignature = signature; pendingDetail = false; messageSignature = ''; dirty = false;
    const personalFlow = app && own(app) && !isAdmin() && snapshot.role !== 'examiner';
    $('.ad-detail').innerHTML = section === 'config' ? configMarkup() : !app ? newApplicationMarkup() : personalFlow ? personalApplicationMarkup(app) : `<header class="ad-detail-header"><div><h3>${e(app.game)} · 入驻考核</h3><p>${e(app.userName)} / 考官 ${e(app.examinerName)}</p></div>${status(app.status)}</header><nav class="ad-detail-tabs" aria-label="申请详情"><button type="button" data-ad-view="chat" aria-current="${view === 'chat' ? 'page' : 'false'}">${icon('message', 16)}咨询</button><button type="button" data-ad-view="order" aria-current="${view === 'order' ? 'page' : 'false'}">${icon('receipt', 16)}考核订单</button><button type="button" data-ad-view="history" aria-current="${view === 'history' ? 'page' : 'false'}">${icon('clock', 16)}记录</button></nav>${view === 'chat' ? chatMarkup(app) : view === 'order' ? orderMarkup(app) : historyMarkup(app)}`;
    restore();
    $('.ad-detail').querySelectorAll('details[data-ad-disclosure]').forEach(el => { el.open = opened.includes(el.dataset.adDisclosure); });
    $('[data-ad-action="discardDraft"]').hidden = !dirty;
    if (app?.status === 'passed' && own(app)) $('.ad-detail').insertAdjacentHTML('beforeend', `<div class="ad-passed-entry">${button('management', '进入打手工作台', 'arrow', '', true)}</div>`);
    $('.ad-detail').querySelectorAll('[data-unavailable="true"] button[type="submit"]').forEach(el => { el.disabled = true; });
    renderMessages();
    setBusy(busy);
  }

  function renderMessages() {
    const list = $('.ad-messages'), app = application(); if (!list || !app) return;
    const messages = snapshot.conversations?.find(chat => chat.id === app.conversationId || chat.applicationId === app.id)?.messages || [];
    const signature = JSON.stringify(messages);
    if (signature === messageSignature) return;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 70;
    const first = !messageSignature;
    messageSignature = signature;
    list.innerHTML = messages.map(message => `<article class="ad-message${message.authorId === snapshot.userId ? ' is-own' : ''}"><div><strong>${e(message.author || '考核参与人')}</strong><time>${e(date(message.at))}</time></div><p>${e(message.text)}</p></article>`).join('') || empty('暂无消息');
    if (atBottom || first) list.scrollTop = list.scrollHeight;
  }

  function setBusy(value) {
    root.setAttribute('aria-busy', String(value));
    root.querySelectorAll('button, input, textarea, select').forEach(el => {
      if (value) { if (!el.disabled) { el.dataset.adBusyDisabled = 'true'; el.disabled = true; } }
      else if (el.dataset.adBusyDisabled) { delete el.dataset.adBusyDisabled; el.disabled = false; }
    });
  }

  function acceptSnapshot(next, force = false) {
    snapshot = next.snapshot || next;
    if (!Array.isArray(snapshot.applications) || !Array.isArray(snapshot.games)) throw new Error('考核信息格式异常，请刷新后重试。');
    if (selected && !apps().some(app => app.id === selected)) selected = '';
    if (initialId) {
      const target = apps().find(item => item.id === initialId) || snapshot.orders?.find(item => item.id === initialId);
      if (target) selected = target.applicationId || target.id;
      initialId = '';
    }
    if (!initialized && !selected && !isAdmin() && snapshot.role !== 'examiner') {
      const mine = apps().filter(own).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
      selected = (mine.find(ongoing) || (!snapshot.canApply ? mine[0] : null))?.id || '';
    }
    initialized = true;
    if (!selected && !snapshot.canApply && apps().length) selected = apps()[0].id;
    renderList(); renderDetail(force); setSync(pendingDetail ? '记录有更新' : '已同步');
  }

  async function load({ silent = false, force = false } = {}) {
    if (!active() || busy || loading && !force) return;
    const current = ++requestId; loading = true;
    if (!silent) { setError(''); setSync('正在加载'); }
    try { const next = await api('/admissions'); if (active() && current === requestId) acceptSnapshot(next, force); }
    catch (error) { if (active() && current === requestId) { setSync('同步暂时中断'); if (!silent || !snapshot) setError(error.message || '无法加载考核信息'); } }
    finally { if (current === requestId) loading = false; }
  }

  async function mutate(path, payload, { clearDraft = true, after } = {}) {
    if (busy || !active()) return;
    const current = ++requestId; loading = false; busy = true; setBusy(true); setError(''); setSync('正在保存');
    let saved = false;
    try {
      const result = await api(path, payload);
      if (!active() || current !== requestId) return;
      saved = true;
      if (clearDraft) { drafts.delete(selectedKey()); dirty = false; }
      if (path.endsWith('/messages')) {
        const composer = $('.ad-composer textarea'); if (composer) composer.value = '';
        const draft = drafts.get(selectedKey());
        if (draft) draft.controls = draft.controls.filter(control => control.name !== 'text');
        if (draft && !draft.controls.some(control => control.type === 'checkbox' ? control.checked : control.value)) { drafts.delete(selectedKey()); dirty = false; }
      }
      after?.(result);
      const next = result?.snapshot || await api('/admissions');
      if (!active() || current !== requestId) return;
      acceptSnapshot(next, true);
      if (!path.endsWith('/messages')) $('.ad-main').scrollTop = 0;
      if (typeof onChanged === 'function') Promise.resolve(onChanged(snapshot, result)).catch(() => {});
    } catch (error) {
      if (active() && current === requestId) {
        setError(saved ? '操作已保存，最新记录暂时无法加载，请刷新查看。' : error.message || '操作未成功，请稍后重试。');
        setSync(saved ? '等待同步' : '操作未完成');
      }
    } finally { if (active() && current === requestId) { busy = false; setBusy(false); } }
  }

  function focusConsultation() {
    const chat = $('.ad-personal-chat'), main = $('.ad-main');
    if (chat && root.closest('dialog')) {
      const composer = $('.ad-composer');
      const top = chat.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop;
      const bottom = composer.getBoundingClientRect().bottom - main.getBoundingClientRect().top + main.scrollTop;
      main.scrollTop = Math.max(0, bottom - top < main.clientHeight - 24 ? top - 12 : bottom - main.clientHeight + 12);
    } else chat?.scrollIntoView({ block: 'nearest' });
    $('.ad-composer textarea')?.focus({ preventScroll: true });
  }

  function contactExaminer() {
    const app = application();
    if (!app || !app.examinerId) return;
    if (!$('.ad-composer')) move(() => { view = 'chat'; });
    focusConsultation();
  }

  function move(next) { remember(); next(); dirty = false; setError(''); renderList(); renderDetail(true); $('.ad-main').scrollTop = 0; }
  const click = event => {
    const el = event.target.closest('button'); if (!el || !root.contains(el) || busy || el.disabled) return;
    if (el.dataset.adSelect) return move(() => { selected = el.dataset.adSelect; section = 'applications'; view = 'order'; });
    if (el.dataset.adSection) return move(() => { section = el.dataset.adSection; });
    if (el.dataset.adView) return move(() => { view = el.dataset.adView; });
    if (el.dataset.adAction === 'refresh') { remember(); void load({ force: true }); }
    else if (el.dataset.adAction === 'discardDraft') { drafts.delete(selectedKey()); dirty = false; setError(''); renderDetail(true); }
    else if (el.dataset.adAction === 'new') move(() => { selected = ''; newGame = ''; orderRequestId = crypto.randomUUID(); section = 'applications'; view = 'order'; });
    else if (el.dataset.adAction === 'resume') move(() => { selected = el.dataset.id; view = 'order'; });
    else if (el.dataset.adAction === 'realName') onNavigate?.('verifyRealName');
    else if (el.dataset.adAction === 'topup') onNavigate?.('topup');
    else if (el.dataset.adAction === 'management') onNavigate?.('management');
    else if (el.dataset.adAction === 'backToOrder') {
      if (root.closest('dialog')) $('.ad-main').scrollTop = 0;
      else $('.ad-personal-order')?.scrollIntoView({ block: 'start' });
    }
    else if (el.dataset.adAction === 'contact') void contactExaminer();
  };
  const change = event => {
    const el = event.target;
    if (el.matches('[data-ad-filter]')) { filter = el.value; renderList(); }
    else if (el.matches('[data-ad-config-game]')) move(() => { configGame = el.value; });
    else if (el.matches('[data-ad-game]') && !application()) {
      const keepFocus = document.activeElement === el;
      newGame = el.value;
      orderRequestId = crypto.randomUUID();
      dirty = false;
      drafts.delete(selectedKey());
      setError('');
      renderDetail(true);
      if (keepFocus) $('[data-ad-game]')?.focus({ preventScroll: true });
    }
  };
  const input = event => { if (event.target.closest('.ad-detail form')) { dirty = true; $('[data-ad-action="discardDraft"]').hidden = false; } };
  const submit = event => {
    const form = event.target.closest('[data-ad-form]'); if (!form || !root.contains(form)) return;
    event.preventDefault(); if (busy || !form.reportValidity() || form.dataset.unavailable === 'true') return;
    const data = new FormData(form), type = form.dataset.adForm, app = application();
    const string = name => String(data.get(name) || '').trim();
    const version = Number(form.dataset.version);
    const action = (name, extra = {}) => mutate(`/admissions/orders/${encodeURIComponent(form.dataset.order)}/actions`, { action: name, version, ...extra });
    if (type === 'message') {
      if (!string('text')) { setError('请输入消息内容'); return; }
      remember();
      void mutate(`/admissions/conversations/${encodeURIComponent(form.dataset.conversation)}/messages`, { text: string('text') }, { clearDraft: false });
    } else if (type === 'placeOrder') {
      void mutate('/admissions/orders', { game: app?.game || string('game'), configVersion: Number(form.dataset.configVersion), acceptStandards: data.has('acceptStandards'), requestId: orderRequestId }, { after: result => { const order = result?.result || result; selected = order.applicationId || selected; view = 'order'; orderRequestId = crypto.randomUUID(); } });
    } else if (type === 'config') {
      const fee = string('fee'), enabled = data.has('enabled');
      if (fee && !/^\d+(?:\.\d{1,2})?$/.test(fee)) { setError('考核费最多保留两位小数'); return; }
      if (enabled && (!fee || !string('levelId') || !string('description') || !data.getAll('examinerIds').length)) { setError('开放收费前请填写费用、授予等级、考核说明，并指定至少一位考官。'); return; }
      void mutate('/admissions/config', { game: configGame, feeCents: fee ? Math.round(Number(fee) * 100) : null, enabled, levelId: string('levelId'), description: string('description'), examinerIds: data.getAll('examinerIds'), version });
    } else if (!app) return;
    else if (type === 'schedule') {
      const appointmentAt = new Date(`${string('appointmentDate')}T${string('appointmentTime')}:00+08:00`);
      if (!Number.isFinite(appointmentAt.getTime()) || appointmentAt.getTime() <= Date.now()) { setError('请选择未来的考核时间。'); return; }
      void action('schedule', { appointmentAt: appointmentAt.toISOString(), confirmed: data.has('confirmed') });
    } else if (type === 'order') {
      const appointmentAt = new Date(data.has('appointmentDate') ? `${string('appointmentDate')}T${string('appointmentTime')}:00+08:00` : string('appointmentAt'));
      if (!Number.isFinite(appointmentAt.getTime())) { setError('请选择有效的预约时间'); return; }
      if (appointmentAt.getTime() <= Date.now()) { setError('预约时间必须晚于当前时间，请重新选择。'); return; }
      void mutate(`/admissions/applications/${encodeURIComponent(app.id)}/orders`, { version, configVersion: Number(form.dataset.configVersion), appointmentAt: appointmentAt.toISOString() });
    } else if (type === 'pay') void action('pay', { acceptTerms: data.has('acceptTerms'), configVersion: Number(form.dataset.configVersion) });
    else if (type === 'review') void action('review', { result: string('result'), score: Number(string('score')), notes: string('notes'), evidence: string('evidence') });
    else if (type === 'start') void action('start');
    else if (['cancelOrder', 'refund', 'dispute'].includes(type)) void action(type === 'cancelOrder' ? 'cancel' : type, { reason: string('reason') });
    else if (type === 'resolveDispute') void action('resolveDispute', { reason: string('reason'), decision: string('decision') });
    else if (type === 'reassign' || type === 'cancelApplication') void mutate(`/admissions/applications/${encodeURIComponent(app.id)}/actions`, { action: type === 'reassign' ? 'reassign' : 'cancel', version, reason: string('reason'), ...(type === 'reassign' ? { examinerId: string('examinerId') } : {}) });
  };
  root.addEventListener('click', click); root.addEventListener('change', change); root.addEventListener('input', input); root.addEventListener('submit', submit);
  const interval = setInterval(() => { if (!active()) cleanup(); else if (!document.hidden) void load({ silent: true }); }, 5000);
  function cleanup() { if (dead) return; dead = true; requestId++; clearInterval(interval); root.removeEventListener('click', click); root.removeEventListener('change', change); root.removeEventListener('input', input); root.removeEventListener('submit', submit); drafts.clear(); }
  void load();
  return cleanup;
}

export function openAdmissions({ api, user, workspace, mode = 'personal', onChanged, onNavigate, onRealName, onTopup, initialId } = {}) {
  const existing = document.querySelector('#admissionsDialog[open]'); if (existing) return existing;
  const previousFocus = document.activeElement;
  const modal = document.createElement('dialog');
  modal.id = 'admissionsDialog'; modal.className = 'ad-dialog'; modal.setAttribute('aria-label', '入驻考核');
  modal.innerHTML = `<button class="ad-icon-button ad-dialog-close" type="button" aria-label="关闭入驻考核" title="关闭">${icon('x', 22)}</button>${admissionsMarkup(workspace)}`;
  document.body.append(modal);
  const cleanup = mountAdmissions(modal, { api, workspace: workspace || { user }, mode, onChanged, initialId, onNavigate: target => { modal.close(); if (target === 'verifyRealName' && onRealName) onRealName(); else if (target === 'topup' && onTopup) onTopup(); else onNavigate?.(target); } });
  modal.querySelector('.ad-dialog-close').onclick = () => modal.close();
  modal.addEventListener('close', () => { cleanup(); modal.remove(); if (!document.querySelector('dialog[open]') && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); }, { once: true });
  modal.showModal();
  return modal;
}
