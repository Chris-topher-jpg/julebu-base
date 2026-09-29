import { escapeHtml as e, icon } from './ui.js';

const verificationOf = w => w?.user?.realNameVerification || w?.realNameVerification || { status: 'unverified' };
const statusText = { unverified: '未实名认证', pending: '审核中', verified: '已认证', rejected: '认证未通过' };
const statusTone = s => ({ verified: 'success', pending: 'pending', rejected: 'danger' }[s] || 'muted');
const mask = value => value || '—';

export function hasRealName(user) { return user?.realNameVerification?.status === 'verified'; }

export function realNameNotice(workspace) {
  const v = verificationOf(workspace); if (v.status === 'verified') return '';
  const action = `data-action="verifyRealName"`;
  const text = v.status === 'pending' ? '实名认证审核中，审核通过后即可使用全部服务。' : v.status === 'rejected' ? `实名认证未通过${v.rejectionReason ? `：${e(v.rejectionReason)}` : ''}，请重新提交。` : '点单、接单等服务需要先完成实名认证。';
  return `<aside class="real-name-notice ${statusTone(v.status)}" role="status"><span>${icon('lock',18)}</span><div><strong>${text}</strong><small>仅用于身份核验，信息将按隐私政策保护。</small></div><button type="button" class="real-name-action" ${action}>${v.status === 'pending' ? '查看状态' : '去认证'} ${icon('arrow',14)}</button></aside>`;
}

export function realNameMarkup(workspace) {
  const v = verificationOf(workspace); const status = v.status || 'unverified';
  if (status === 'verified') return `<section class="real-name-card"><header><div><p class="account-eyebrow">账户安全</p><h2>实名认证</h2></div><span class="real-name-badge success">已认证</span></header><div class="real-name-summary"><div><span>姓名</span><strong>${e(mask(v.maskedName))}</strong></div><div><span>身份证号</span><strong>${e(mask(v.maskedIdNumber))}</strong></div><div><span>认证时间</span><strong>${e(v.reviewedAt || '已完成')}</strong></div></div><p class="detail-note">认证信息已加密保护，仅用于平台服务和风控。</p></section>`;
  if (status === 'pending') return `<section class="real-name-card"><header><div><p class="account-eyebrow">账户安全</p><h2>实名认证</h2></div><span class="real-name-badge pending">审核中</span></header><div class="real-name-state"><span class="state-icon">${icon('clock',26)}</span><div><h3>资料已提交，等待人工审核</h3><p>审核通过后即可使用点单、成为打手和接单等服务。</p><small>提交时间：${e(v.submittedAt || '—')}</small></div></div></section>`;
  return `<section class="real-name-card"><header><div><p class="account-eyebrow">账户安全</p><h2>实名认证</h2><p>完成实名认证后，才可点单、成为打手并接单。</p></div><span class="real-name-badge ${statusTone(status)}">${statusText[status]}</span></header>${status === 'rejected' ? `<div class="real-name-state rejected"><span class="state-icon">${icon('ban',26)}</span><div><h3>需要重新提交</h3><p>${e(v.rejectionReason || '审核未通过，请检查资料后重新提交。')}</p></div></div>` : ''}<form class="real-name-form" data-real-name-form><label>真实姓名<input name="realName" maxlength="60" autocomplete="name" required placeholder="请输入姓名"></label><label>身份证号<input name="idNumber" maxlength="18" inputmode="text" autocomplete="off" required placeholder="请输入18位身份证号码"></label><label class="real-name-consent"><input type="checkbox" name="consent" value="true" required><span>我已阅读并同意身份信息仅用于实名认证及平台安全管理</span></label><p class="real-name-privacy">请提交本人大陆居民身份证信息。平台不会在工作区展示完整证件号码。</p><p class="real-name-error" role="alert"></p><button class="primary-action" type="submit" data-real-name-submit>${status === 'rejected' ? '重新提交认证' : '提交认证'} ${icon('arrow',15)}</button></form></section>`;
}

export function realNameReviewsMarkup(workspace) {
  return `<section class="real-name-reviews"><header class="owner-section-head"><div><p class="owner-eyebrow">风控审核</p><h2>实名认证审核</h2><p>请线下核验身份证原件后再处理申请。</p></div><button type="button" class="owner-icon-button" data-real-name-refresh aria-label="刷新实名认证申请">${icon('arrow',17)}</button></header><div class="real-name-review-list" data-real-name-list><div class="owner-empty">正在加载审核申请…</div></div></section>`;
}

function validId(value) { return /^[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])([0-2]\d|3[01])\d{3}[0-9Xx]$/.test(String(value || '').trim()); }

export function bindRealName({ state, api, refresh, toast, dialog }) {
  const form = document.querySelector('[data-real-name-form]');
  if (form) form.onsubmit = async ev => { ev.preventDefault(); const submit = form.querySelector('[data-real-name-submit]'); const error = form.querySelector('.real-name-error'); const data = new FormData(form); if (!validId(data.get('idNumber'))) { error.textContent = '请输入有效的18位身份证号码'; return; } if (submit.disabled) return; submit.disabled = true; error.textContent = ''; try { await api('/real-name', { realName: String(data.get('realName')).trim(), idNumber: String(data.get('idNumber')).trim().toUpperCase(), consent: true }); await refresh(); toast('实名认证资料已提交，等待审核'); } catch (err) { error.textContent = err.message || '提交失败，请稍后重试'; } finally { submit.disabled = false; } };
  const list = document.querySelector('[data-real-name-list]');
  const load = async () => { if (!list) return; list.innerHTML = '<div class="owner-empty">正在加载审核申请…</div>'; try { const result = await api('/real-name/requests'); const items = result.requests || result.items || []; list.innerHTML = items.map(item => reviewRow(item)).join('') || '<div class="owner-empty">暂无审核申请</div>'; bindReviewActions(list, { dialog, api, refresh, toast }); } catch (err) { list.innerHTML = `<div class="real-name-load-error">${e(err.message || '加载失败')} <button type="button" data-real-name-retry>重试</button></div>`; list.querySelector('[data-real-name-retry]').onclick = load; } };
  document.querySelector('[data-real-name-refresh]')?.addEventListener('click', load); load();
}

// App-level compatibility hook; the shell binds with its request context when available.
export function bindRealNameForm() { return true; }

function reviewRow(item) { const v = item.statusFields || item; const id = e(item.requestId || v.requestId || ''); const pending = v.status === 'pending'; return `<article class="real-name-review-row" data-request-id="${id}" data-version="${Number(v.version) || 1}"><div class="review-user"><strong>${e(item.name || item.username || item.userId)}</strong><small>${e(item.username || item.memberNo || item.userId || '')}</small></div><div><span class="real-name-badge ${statusTone(v.status)}">${statusText[v.status] || v.status}</span><small>${e(v.submittedAt || '—')}</small></div><div class="review-masked"><span>${e(mask(v.maskedName))}</span><span>${e(mask(v.maskedIdNumber))}</span></div>${pending ? '<div class="review-actions"><button type="button" class="owner-link" data-review-approve>通过</button><button type="button" class="owner-link danger" data-review-reject>驳回</button></div>' : '<div class="review-actions"><span class="review-complete">已处理</span></div>'}</article>`; }

export function bindReviewActions(root, ctx) { root.querySelectorAll('[data-review-approve]').forEach(btn => btn.onclick = () => reviewDialog(btn.closest('.real-name-review-row'), 'approve', ctx)); root.querySelectorAll('[data-review-reject]').forEach(btn => btn.onclick = () => reviewDialog(btn.closest('.real-name-review-row'), 'reject', ctx)); }
async function reviewDialog(row, action, { dialog, api, refresh, toast }) { const requestId = row.dataset.requestId; let detail; try { detail = await api(`/real-name/requests/${encodeURIComponent(requestId)}`); } catch (err) { toast(err.message || '无法读取申请详情'); return; } const version = Number(detail.version); const name = detail.realName || detail.maskedName || '申请人'; const body = `<p class="review-detail-name">申请人：${e(name)}<br>身份证号：${e(detail.maskedIdNumber || '—')}</p>` + (action === 'approve' ? '<label class="real-name-consent"><input type="checkbox" name="documentsChecked" required><span>我已线下核验身份证原件与提交信息一致</span></label><label>审核备注<textarea name="reviewNote" required maxlength="200" placeholder="请输入审核备注"></textarea></label>' : '<label>驳回原因<textarea name="reviewNote" required maxlength="200" placeholder="请输入驳回原因"></textarea></label>'); const modal = dialog(action === 'approve' ? '通过实名认证' : '驳回实名认证', body, '确认', async form => { const note = String(form.get('reviewNote') || '').trim(); if (!note) throw new Error('请填写审核备注'); await api(`/real-name/requests/${encodeURIComponent(requestId)}`, { action, version, reviewNote: note, ...(action === 'approve' ? { documentsChecked: true } : {}) }); await refresh(); toast('审核结果已保存'); }); modal?.classList.add('real-name-dialog'); }
