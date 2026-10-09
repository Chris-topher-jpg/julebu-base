import { escapeHtml as e, icon } from './ui.js';

const pending = item => ['待审核', '待线下退款'].includes(item.status);
const money = value => `¥ ${(Number(value || 0) / 100).toFixed(2)}`;
const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '—';
const action = (name, label, id) => `<button type="button" class="ghost-btn" data-action="${name}" data-id="${e(id)}">${label}</button>`;

export function refundProgress(item) {
  return ({
    '待审核': '等待售后或财务审核，订单暂时停止履约。',
    '待线下退款': '审核已通过，等待财务完成退款并登记流水；尚未退款到账。',
    '已通过': '退款已退回原消费余额，可在我的钱包查看。',
    '已退款': '财务已登记退款流水，请核对原付款渠道到账情况。',
    '已驳回': '退款申请已驳回，订单恢复原服务阶段；可联系售后继续沟通。',
    '已撤回': '申请已撤回，订单恢复原服务阶段，本次未产生退款。',
  })[item.status] || '请查看处理记录或联系售后。';
}

export function refundDetailsMarkup(item, { personal = false } = {}) {
  // Legacy applications retain their real timestamps; never invent audit events.
  const history = item.history?.length ? item.history : [
    { action: '提交退款申请', at: item.requestedAt, note: item.reason },
    ...(item.approvedAt ? [{ action: '审核通过', at: item.approvedAt }] : []),
    ...(item.paidAt ? [{ action: item.channel === '余额原路' ? '退款退回余额' : '登记线下退款', at: item.paidAt, note: item.reviewNote }] : item.reviewedAt ? [{ action: item.status, at: item.reviewedAt, note: item.reviewNote }] : []),
  ].filter(event => event.at);
  return `<div class="detail-grid"><div><span>退款申请</span><strong>${e(item.id)}</strong></div><div><span>关联订单</span><strong>${e(item.orderId)}</strong></div><div><span>申请金额</span><strong>${money(item.amountCents)}</strong></div><div><span>当前状态</span><strong>${e(item.status)}</strong></div><div><span>退款渠道</span><strong>${e(item.channel || '待核对')}</strong></div><div><span>申请时间</span><strong>${e(date(item.requestedAt))}</strong></div></div>
    <p class="detail-note">${e(refundProgress(item))}</p>
    <p class="detail-note">申请原因：${e(item.reason || '—')}</p>
    ${item.reviewNote ? `<p class="detail-note">处理说明：${e(item.reviewNote)}</p>` : ''}
    ${item.payoutRef ? `<p class="detail-note">退款流水：${e(item.payoutRef)}</p>` : ''}
    <h3>处理记录</h3><div class="timeline">${history.map(event => `<div><i></i><strong>${e(event.action)}</strong><small>${personal || !event.by ? '' : `${e(event.by)} · `}${e(date(event.at))}</small>${event.note ? `<p>${e(event.note)}</p>` : ''}</div>`).join('') || '<p class="muted-text">暂无处理记录</p>'}</div>`;
}

export function refundQueueMarkup(workspace, { filter = '全部', query = '' } = {}) {
  const items = workspace.refunds || [], permissions = workspace.role?.permissions || [];
  const canReview = permissions.includes('refund:manage'), canPay = permissions.includes('finance:manage');
  const statuses = ['全部', '待处理', '待审核', '待线下退款', '已通过', '已退款', '已驳回', '已撤回'];
  const matches = (item, status) => status === '全部' || (status === '待处理' ? pending(item) : item.status === status);
  const filtered = items.filter(item => matches(item, filter)).sort((a, b) => Number(pending(b)) - Number(pending(a)) || (pending(a) ? 1 : -1) * ((Date.parse(a.requestedAt) || 0) - (Date.parse(b.requestedAt) || 0)));
  const rows = filtered.map(item => {
    const order = workspace.orders?.find(order => order.id === item.orderId);
    const controls = action('refundDetail', '查看进度', item.id) + (canReview && pending(item) ? action('refundReviewById', item.status === '待审核' ? '审核申请' : canPay ? '登记退款 / 撤销审核' : '查看 / 撤销审核', item.id) : '');
    return `<tr data-searchable><td><strong>${e(item.id)}</strong><small>${e(date(item.requestedAt))}</small></td><td>${e(item.orderId)}${order ? `<small>${e(order.game)} · ${e(order.product)}</small>` : ''}</td><td>${e(item.customer || '—')}</td><td>${money(item.amountCents)}<small>${e(item.channel || '待核对')}</small></td><td><span class="owner-order-status ${pending(item) ? 'pending' : ''}">${e(item.status)}</span><small>${e(refundProgress(item))}</small></td><td>${e(item.reason || '—')}</td><td><div class="row-actions">${controls}</div></td></tr>`;
  }).join('');
  return `<div class="filter-strip"><div class="filter-tabs">${statuses.map(status => `<button data-filter="${status}" class="${filter === status ? 'active' : ''}">${status} <b>${items.filter(item => matches(item, status)).length}</b></button>`).join('')}</div></div>
    <section class="panel"><label class="list-search">${icon('search', 16)}<input id="listSearch" type="search" placeholder="搜索申请号、订单号、顾客或原因" aria-label="搜索退款申请" value="${e(query)}"></label>
    <div class="owner-standard-table"><table><thead><tr>${['退款申请 / 时间', '关联订单', '顾客', '金额 / 渠道', '进度 / 下一步', '申请原因', '操作'].map(label => `<th>${label}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
    <div id="noSearchResults" class="empty-state" ${rows ? 'hidden' : ''}>${items.length ? '没有符合条件的退款申请' : '暂无退款申请'}</div></section>`;
}
