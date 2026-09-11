export function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
export function icon(name, size = 18) {
  const paths = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    building: '<path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M9 7h2M9 11h2M9 15h2M15 7h2M15 11h2M15 15h2"/>',
    wallet: '<rect x="2" y="5" width="20" height="15" rx="2"/><path d="M2 9h20M16 15h.01"/>',
    game: '<path d="M8 13h8M10 11v4M16.5 11.5h.01M19 14h.01"/><path d="M7.2 7h9.6c2.7 0 4.6 2.3 4.1 4.9l-1.2 6A2.6 2.6 0 0 1 17.2 20l-2.5-3H9.3l-2.5 3a2.6 2.6 0 0 1-2.5-2.1l-1.2-6C2.6 9.3 4.5 7 7.2 7Z"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    trend: '<path d="m4 16 5-5 4 3 7-8"/><path d="M17 6h3v3"/>',
    receipt: '<path d="M5 3h14v18l-3-2-4 2-4-2-3 2z"/><path d="M8 8h8M8 12h8M8 16h4"/>',
    headset: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><path d="M4 14h3v5H5a1 1 0 0 1-1-1zM20 14h-3v5h2a1 1 0 0 0 1-1z"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.grid}</svg>`;
}


export function loginMarkup() { return `<div class="login-shell"><section class="login-hero"><div class="login-brand"><span class="brand-mark">C</span><span>clubhouse</span></div><div class="login-hero-copy"><p class="eyebrow">GAME COMPANION OPERATIONS</p><h1>让每一场开黑，<br><span>都被妥善安排。</span></h1><p>一个俱乐部，一套清晰的接单、派单与结算流程。</p><div class="login-features"><div><span class="feature-icon purple">${icon('game', 18)}</span><div><strong>订单和派单协同</strong><small>客服快速匹配合适的陪玩</small></div></div><div><span class="feature-icon orange">${icon('headset', 18)}</span><div><strong>成员在线管理</strong><small>打手只接收自己有权限的订单</small></div></div><div><span class="feature-icon green">${icon('receipt', 18)}</span><div><strong>收益自动留痕</strong><small>充值、流水和结算清晰可追踪</small></div></div></div></div><div class="login-hero-foot">星河游戏俱乐部 · 陪玩运营中心</div></section><section class="login-panel"><div class="login-card"><div class="login-card-head"><div class="login-logo">${icon('game', 21)}</div><div><strong>星河游戏俱乐部</strong><small>单俱乐部管理系统</small></div></div><h2>欢迎回来</h2><p class="login-subtitle">登录后将根据你的职责展示工作台</p><form id="loginForm"><label>账号<input id="loginUsername" autocomplete="username" placeholder="请输入账号" required></label><label>密码<input id="loginPassword" type="password" autocomplete="current-password" placeholder="请输入密码" required></label><button class="login-submit" type="submit">登录运营台 ${icon('arrow', 16)}</button><p class="login-error" id="loginError"></p></form><div class="demo-divider"><span>演示账号</span></div><div class="demo-accounts"><button type="button" class="demo-account" data-username="admin"><span class="mini-avatar purple">杨</span><span><strong>最高负责人</strong><small>完整业务权限</small></span></button><button type="button" class="demo-account" data-username="service"><span class="mini-avatar orange">林</span><span><strong>客服</strong><small>订单 / 会话 / 派单</small></span></button><button type="button" class="demo-account" data-username="escort"><span class="mini-avatar green">米</span><span><strong>打手</strong><small>接单 / 我的订单 / 收益</small></span></button></div><p class="login-hint">演示账号：<strong>admin / service / escort</strong><br>统一密码：<strong>123456</strong></p></div></section></div>`; }
