import { escapeHtml as e, icon } from './ui.js';
import { realNameNotice, realNameMarkup } from './real-name.js';

const money = value => `¥ ${((Number(value) || 0) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '时间未记录';
const initials = name => e(Array.from(name || '我')[0]);
const userName = workspace => workspace.user.name || workspace.user.username || '用户';
const field = (label, value) => `<div><dt>${e(label)}</dt><dd>${e(value || '未填写')}</dd></div>`;
const unreadCount = workspace => (workspace.conversations || []).reduce((sum, chat) => sum + (Number(chat.unread) || 0), 0);
export const personalActiveOrderStatuses = ['待接单', '待确认', '待服务', '陪玩中'];
const pageNames = { memberProfile: '个人中心', memberHome: '个人主页', placeOrder: '个人中心', memberOrders: '我的点单', memberAfterSales: '消息与售后', memberWallet: '我的钱包', realName: '实名认证' };

export function personalShellMarkup(workspace, page, content) {
  if (page === 'placeOrder') page = 'memberProfile';
  const name = userName(workspace);
  const avatar = workspace.user.avatar || '';
  const avatarContent = avatar ? `<img src="${e(avatar)}" alt="${e(name)}的头像">` : initials(name);
  const unread = unreadCount(workspace);
  const descriptions = { memberProfile: `${name}，你的陪玩服务、订单和账户，都在这里。`, memberHome: '编辑头像、昵称和个人介绍，完善你的公开资料。', memberOrders: '查看每一笔点单，跟进服务进度与验收结果。', memberAfterSales: '查看客服回复、沟通记录与退款进度。', memberWallet: '查看可用余额，每一笔收支都有记录。' };
  const navItem = (target, title, symbol, count) => `<button type="button" class="account-nav-item ${page === target ? 'is-active' : ''}" data-page="${target}" ${page === target ? 'aria-current="page"' : ''}>${icon(symbol, 19)}<span>${title}</span>${count ? `<em>${e(count)}</em>` : ''}${page === target ? icon('arrow', 15) : ''}</button>`;
  return `<div class="account-page">
    <header class="account-header"><div class="account-header-inner"><a class="account-brand" href="/#/"><span class="brand-mark">C</span><strong>星河游戏俱乐部</strong><small>陪玩服务平台</small></a><nav class="account-public-nav" aria-label="网站导航"><a href="/#/">首页</a><a href="/#/public/companions">大神陪玩</a><a href="/#/public/guarantees">服务保障</a></nav><div class="account-header-actions"><a class="account-header-message" href="/#/personal/memberAfterSales" aria-label="消息与售后${unread ? `，${unread}条未读` : ''}">${icon('bell', 21)}${unread ? `<span class="account-unread">${unread > 99 ? '99+' : unread}</span>` : ''}</a><button type="button" class="account-user-button" data-page="memberProfile" aria-label="进入个人中心"><span class="account-mini-avatar">${avatarContent}</span><span>${e(name)}</span></button><button type="button" class="account-logout" data-action="logout">退出</button></div></div></header>
    <main class="account-main"><header class="account-page-heading"><div><p class="account-eyebrow">我的星河 / MY ACCOUNT</p><h1>${e(pageNames[page] || '个人中心')}</h1><p>${e(descriptions[page] || descriptions.memberProfile)}</p></div></header><div class="account-layout"><aside class="account-sidebar" aria-label="个人中心任务栏"><div class="account-sidebar-profile"><span class="account-avatar">${avatarContent}</span><div><strong>${e(name)}</strong><small>我的陪玩账户</small></div></div><nav aria-label="个人中心导航">${navItem('memberProfile', '中心首页', 'grid')}${navItem('memberHome', '个人主页', 'users')}<div class="account-nav-group"><p>我的服务</p>${navItem('memberOrders', '我的点单', 'receipt', (workspace.orders || []).length)}${navItem('memberAfterSales', '消息与售后', 'message', unread)}</div><div class="account-nav-group"><p>账户服务</p>${navItem('memberWallet', '我的钱包', 'wallet')} ${navItem('realName', '实名认证', 'lock')}<a class="account-nav-item" href="/#/public/guarantees">${icon('lock', 19)}<span>服务保障</span></a></div>${workspace.membership?.active && workspace.membership.role !== 'member' ? `<div class="account-nav-group"><p>俱乐部成员</p><button type="button" class="account-nav-item" data-action="enterManagement">${icon('building', 18)}<span>进入后台管理</span></button></div>` : ''}</nav><a class="account-back-home" href="/#/">返回网站首页 ${icon('arrow', 15)}</a></aside><section class="account-content" aria-label="${e(pageNames[page] || '个人中心')}内容">${content}</section></div></main>
    <footer class="account-footer"><span>© 星河游戏俱乐部</span><span>认真对待每一次组队。</span><a href="/#/public/guarantees">服务保障</a></footer>
  </div>`;
}

export function personalProfileMarkup(workspace) {
  const user = workspace.user;
  return `<div class="personal-center"><dl class="pc-profile-fields">${field('昵称', userName(workspace))}${field('用户 ID', user.id)}${field('登录账号', user.username)}${field('联系手机', user.phone)}${field('用户编号', user.memberNo)}</dl></div>`;
}

export function personalHomeMarkup(workspace) {
  const user = workspace.user || {};
  const avatars = Array.from({ length: 14 }, (_, index) => `/src/escort-${String(index + 1).padStart(2, '0')}.jpg`);
  const current = user.avatar || avatars[0];
  const tags = Array.isArray(user.profileTags) ? user.profileTags.join('、') : '';
  return `<section class="profile-editor"><form id="profileEditorForm"><div class="profile-editor-head"><div><p class="account-eyebrow">我的公开资料</p><h2>个人主页</h2><p>这些资料会显示在你的账户和陪玩展示卡片中。</p></div><span class="profile-editor-status">${user.online ? '在线' : '离线'}</span></div><div class="profile-editor-grid"><div class="profile-avatar-editor"><img id="profileAvatarPreview" src="${e(current)}" alt="头像预览"><input type="hidden" name="avatar" value="${e(user.avatar || '')}"><label class="profile-upload-button">上传头像<input id="profileAvatarFile" type="file" accept="image/jpeg,image/png,image/webp"></label><p>或选择头像</p><div class="profile-avatar-options">${avatars.map(avatar => `<button type="button" class="profile-avatar-option ${current === avatar ? 'is-selected' : ''}" data-profile-avatar="${e(avatar)}"><img src="${e(avatar)}" alt="选择头像"></button>`).join('')}</div></div><div class="profile-fields"><label class="form-field">昵称<input name="name" value="${e(user.name || '')}" maxlength="30" required></label><label class="form-field">个人介绍<textarea name="bio" rows="5" maxlength="240" placeholder="介绍一下自己">${e(user.bio || '')}</textarea></label><label class="form-field">个人标签<input name="tags" value="${e(tags)}" maxlength="200" placeholder="用顿号分隔，例如：开麦、耐心、团队配合"><small>最多填写 8 个标签</small></label><p class="detail-note">登录账号和用户编号由系统管理，不能在此修改。</p><button type="submit" class="primary-action">保存个人主页</button><p class="profile-editor-feedback" role="status" aria-live="polite"></p></div></div></form></section>`;
}

function recentActivities(workspace) {
  const orders = (workspace.orders || []).map(order => ({
    title: [order.game, order.product].filter(Boolean).join(' · ') || '陪玩订单',
    description: `${order.status} · ${order.hours} 小时 · ${money(order.amountCents)}`,
    at: order.history?.at(-1)?.at || order.createdAt, symbol: 'receipt',
    action: `data-action="detail" data-id="${e(order.id)}"`, label: '查看订单',
  }));
  const chats = (workspace.conversations || []).filter(chat => chat.last || chat.messages?.length).map(chat => ({
    title: chat.escortName || '俱乐部客服', description: chat.last || chat.messages.at(-1).text,
    at: chat.updatedAt || chat.messages?.at(-1)?.at || chat.createdAt, symbol: 'message',
    action: `data-action="conversation" data-id="${e(chat.id)}"`, label: chat.unread ? `查看回复 · ${chat.unread}` : '继续沟通',
  }));
  const refunds = (workspace.refunds || []).map(refund => ({
    title: `退款申请 · ${refund.status}`, description: `${money(refund.amountCents)} · ${refund.reason || refund.orderId}`,
    at: refund.approvedAt || refund.requestedAt, symbol: 'headset', action: 'data-page="memberAfterSales"', label: '查看进度',
  }));
  return [...orders, ...chats, ...refunds].sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0)).slice(0, 4);
}

export function personalCenterMarkup(workspace) {
  const name = userName(workspace);
  const avatar = workspace.user.avatar || '';
  const orders = workspace.orders || [];
  const refunds = workspace.refunds || [];
  const activeOrders = orders.filter(order => personalActiveOrderStatuses.includes(order.status)).length;
  const awaitingConfirmation = orders.filter(order => order.status === '待验收').length;
  const spent = orders.filter(order => !['已取消', '未支付', '待支付'].includes(order.status) && !['未支付', '待支付'].includes(order.paymentStatus)).reduce((sum, order) => sum + Math.max(0, (Number(order.amountCents) || 0) - (Number(order.refundedCents) || 0)), 0);
  const unread = unreadCount(workspace);
  const pendingRefunds = refunds.filter(refund => ['待审核', '待线下退款'].includes(refund.status)).length;
  const metric = (label, value, note, symbol, tone, action) => `<button type="button" class="pc-metric" ${action}><span class="pc-metric-icon ${tone}">${icon(symbol, 23)}</span><div><span>${label}</span><strong>${e(value)}</strong><small>${note}</small></div></button>`;
  const activities = recentActivities(workspace);
  const activityMarkup = activities.map(activity => `<article class="pc-activity"><span class="pc-activity-icon">${icon(activity.symbol, 21)}</span><div><strong>${e(activity.title)}</strong><p>${e(activity.description)}</p><small>${e(date(activity.at))}</small></div><button type="button" class="pc-text-button" ${activity.action}>${e(activity.label)} ${icon('arrow', 14)}</button></article>`).join('');
  const available = (workspace.products || []).filter(product => product.state === '启用' && (workspace.catalogGames || workspace.games || []).some(game => game.name === product.game && game.state === '上架'));
  const seenGames = new Set();
  const services = available.filter(product => {
    if (seenGames.has(product.game)) return false;
    seenGames.add(product.game); return true;
  }).slice(0, 3);
  const serviceMarkup = services.map(product => `<article class="pc-service-card"><span class="pc-service-icon">${icon('game', 30)}</span><small>${e(product.game)}</small><h3>${e(product.name)}</h3><p>按需选择时长，由客服匹配陪玩</p><div><strong>${money(product.priceCents)}<small> / ${e(product.unit || '小时')}</small></strong><button type="button" class="pc-text-button" data-action="newOrder" data-product-id="${e(product.id)}">去点单 ${icon('arrow', 14)}</button></div></article>`).join('');

  return `<div class="personal-center">${realNameNotice(workspace)}
    <section class="pc-banner" aria-label="个人资料"><div class="pc-banner-person"><span class="pc-avatar" aria-hidden="true">${avatar ? `<img src="${e(avatar)}" alt="${e(name)}的头像">` : initials(name)}</span><div><p class="pc-banner-kicker">欢迎回来</p><h2>${e(name)}</h2><p class="pc-banner-id">用户 ID · ${e(workspace.user.id)}</p></div></div><div class="pc-banner-art" aria-hidden="true">${icon('game', 140)}</div><div class="pc-banner-actions"><button type="button" class="pc-profile-button" data-page="memberHome">${icon('users', 16)} 个人主页</button></div></section>
    <section class="pc-summary" aria-label="账户概况">${metric('账户余额', money(workspace.wallet?.balanceCents), '查看余额明细', 'wallet', 'blue', 'data-page="memberWallet"')}${metric('进行中订单', activeOrders, '跟踪陪玩进度', 'game', 'purple', 'data-action="personalOrderStatus" data-id="进行中"')}${metric('待验收订单', awaitingConfirmation, '确认服务结果', 'check', 'orange', 'data-action="personalOrderStatus" data-id="待验收"')}${metric('未读消息', unread, '查看最新回复', 'message', 'green', 'data-page="memberAfterSales"')}</section>
    <div class="pc-main-columns"><section class="pc-card pc-orders"><div class="pc-card-head"><div><h2>最近动态</h2><p>订单进度、客服回复和售后消息</p></div></div>${activities.length ? `<div class="pc-activity-list">${activityMarkup}</div>` : `<div class="pc-empty"><span class="pc-empty-icon">${icon('game', 34)}</span><h3>今天，和新队友一起开局</h3><p>开始第一笔点单，服务进度和沟通记录会显示在这里。</p><button type="button" class="primary-action" data-action="newOrder">去找陪玩 ${icon('arrow', 15)}</button></div>`}</section><aside class="pc-side"><section class="pc-card"><div class="pc-card-head"><h2>我的服务记录</h2></div><div class="pc-notices"><div><span>累计点单</span><strong>${orders.length} 笔</strong></div><div><span>累计消费</span><strong>${money(spent)}</strong></div><div><span>退款审核中</span><strong>${pendingRefunds} 笔</strong></div></div><button type="button" class="pc-support-button" data-page="memberOrders">查看全部订单 ${icon('arrow', 15)}</button></section><section class="pc-card"><div class="pc-card-head"><h2>需要帮忙？</h2></div><p class="pc-muted">下单咨询、服务问题或退款进度，都可以在消息与售后里联系我们。</p><button type="button" class="pc-support-button" data-page="memberAfterSales">消息与售后 ${icon('headset', 16)}</button></section></aside></div>
    ${services.length ? `<section class="pc-services"><div class="pc-card-head"><div><h2>开启下一场组队</h2><p>选择喜欢的游戏，把配合交给我们</p></div><button type="button" class="pc-text-button" data-action="newOrder">全部服务 ${icon('arrow', 15)}</button></div><div class="pc-service-grid">${serviceMarkup}</div></section>` : ''}
  </div>`;
}

export function personalRealNameMarkup(workspace) { return `<div class="personal-center">${realNameMarkup(workspace)}</div>`; }
