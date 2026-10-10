import { escapeHtml as e } from './ui.js';

const money = cents => `¥ ${(Number(cents || 0) / 100).toFixed(2)}`;
const date = value => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '—';
const button = (action, text, id) => `<button type="button" class="ghost-btn" data-action="${action}" data-id="${e(id)}">${text}</button>`;

export function compensationDetails(item) {
  return `<div class="detail-grid"><div><span>赔偿申请</span><strong>${e(item.id)}</strong></div><div><span>关联订单</span><strong>${e(item.orderId)}</strong></div><div><span>赔偿金额</span><strong>${money(item.amountCents)}</strong></div><div><span>当前状态</span><strong>${e(item.status)}</strong></div></div><p class="detail-note">申请原因：${e(item.reason)}</p><p class="detail-note">赔偿由俱乐部承担，财务核准后发放到账户余额，单独记录资金流水。</p><h3>处理记录</h3><div class="timeline">${item.history.map(event => `<div><i></i><strong>${e(event.action)}</strong><small>${e(date(event.at))}</small><p>${e(event.note)}</p></div>`).join('')}</div>`;
}

export function compensationPanel(workspace, { personal = false } = {}) {
  const items = [...(workspace.compensations || [])].sort((a, b) => Number(b.status === '待审核') - Number(a.status === '待审核') || b.requestedAt.localeCompare(a.requestedAt));
  const paid = items.filter(item => item.status === '已到账').reduce((sum, item) => sum + item.amountCents, 0);
  const pending = items.filter(item => item.status === '待审核').reduce((sum, item) => sum + item.amountCents, 0);
  const canReview = !personal && workspace.role?.permissions.includes('finance:manage');
  return `<section class="panel"><div class="panel-head"><div><h2>赔偿记录</h2><p>已到账 ${money(paid)} · 待审核 ${money(pending)}；赔偿与订单退款分别核算</p></div></div><div class="owner-standard-table"><table><thead><tr>${['申请 / 订单', '赔偿金额', '状态', '原因 / 处理说明', '操作'].map(text => `<th>${text}</th>`).join('')}</tr></thead><tbody>${items.map(item => `<tr><td>${e(item.id)}<small>${e(item.orderId)} · ${e(date(item.requestedAt))}</small></td><td>${money(item.amountCents)}</td><td>${e(item.status)}<small>${item.status === '已到账' ? '已计入账户余额' : item.status === '待审核' ? '等待财务审核' : '未产生赔偿入账'}</small></td><td>${e(item.reason)}<small>${e(item.reviewNote || '')}</small></td><td><div class="row-actions">${button('compensationDetail', '赔偿详情', item.id)}${canReview && item.status === '待审核' ? button('compensationReview', '审核赔偿', item.id) : ''}${personal && item.canRetract ? button('compensationRetract', '撤回赔偿', item.id) : ''}</div></td></tr>`).join('')}</tbody></table></div>${items.length ? '' : '<div class="empty-state">暂无赔偿记录</div>'}</section>`;
}
