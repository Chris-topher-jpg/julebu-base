import { escapeHtml as e, icon } from './ui.js';

// Shared account controls; the message link follows the active workspace.
export function accountHeaderActionsMarkup(workspace, { management = false } = {}) {
  const user = workspace.user;
  const name = user.name || user.username || '用户';
  const unread = (workspace.conversations || []).reduce((sum, chat) => sum + (Number(chat.unread) || 0), 0);
  const avatar = user.avatar
    ? `<img src="${e(user.avatar)}" alt="${e(name)}的头像">`
    : e(Array.from(name)[0]);
  const role = management && user.roleLabel ? `<span class="account-role">${e(user.roleLabel)}</span>` : '';
  const message = management ? '' : `<a class="account-header-message" href="/#/personal/memberAfterSales" aria-label="消息与售后${unread ? `，${unread}条未读` : ''}">${icon('bell', 21)}${unread ? `<span class="account-unread">${unread > 99 ? '99+' : unread}</span>` : ''}</a>`;
  return `<div class="account-header-actions">${message}<a class="account-user-button" href="/#/personal/memberProfile" aria-label="进入个人中心" title="${e(name)}${user.roleLabel ? ` · ${e(user.roleLabel)}` : ''}"><span class="account-mini-avatar">${avatar}</span><span>${e(name)}</span></a>${role}<button type="button" class="account-logout" data-action="logout">退出</button></div>`;
}
