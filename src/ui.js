export function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
export function icon(name, size = 18) {
  const paths = {
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>',
    message: '<path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.4 8.4 0 0 1-3-.6L4 20l1.5-4A7.2 7.2 0 0 1 4 11.5 7.5 7.5 0 0 1 12 4a7.5 7.5 0 0 1 8 7.5Z"/><path d="M8 12h.01M12 12h.01M16 12h.01"/>',
    heart: '<path d="M20.8 8.9c0 5.5-8.8 10.1-8.8 10.1S3.2 14.4 3.2 8.9A4.5 4.5 0 0 1 12 6.7a4.5 4.5 0 0 1 8.8 2.2Z"/>',
    ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
    copy: '<rect x="9" y="9" width="10" height="10" rx="1"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    x: '<path d="m6 6 12 12M18 6 6 18"/>',
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
  paths.lock = '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>';
  paths.check = '<path d="m5 12 4 4L19 6"/>';
  paths.clock = '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.grid}</svg>`;
}


export function authFormMarkup() {
  return `<button class="auth-close" type="button" data-action="closeLogin" aria-label="关闭登录弹窗">×</button>
  <div class="auth-dialog-head"><div class="login-logo">${icon('game', 21)}</div><strong>星河游戏俱乐部</strong></div>
  <h2 id="authTitle">欢迎回来</h2><p class="login-subtitle" id="authDescription">登录后下单，查看订单和售后</p>
  <label id="authUsernameField">手机号 / 账号<input id="loginUsername" autocomplete="username" placeholder="请输入手机号或账号" required minlength="3" maxlength="30"></label>
  <label id="authNameField" hidden>昵称<input id="registerName" autocomplete="nickname" placeholder="怎么称呼你" maxlength="30" disabled></label>
  <label id="passwordField">密码<input id="loginPassword" type="password" autocomplete="current-password" placeholder="请输入密码" required maxlength="128"></label>
  <label id="authPhoneField" hidden>手机号<input id="loginPhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="请输入已绑定的手机号" pattern="1[3-9][0-9]{9}" maxlength="11" disabled></label>
  <div id="codeField" hidden><label for="loginCode">手机验证码</label><div class="auth-code-row"><input id="loginCode" inputmode="numeric" autocomplete="one-time-code" placeholder="请输入 6 位验证码" pattern="[0-9]{6}" maxlength="6" disabled><button id="authSendCode" class="auth-send-code" type="button" disabled>获取验证码</button></div></div>
  <p class="auth-demo-code" id="authDemoCode" role="status" hidden></p>
  <button class="login-submit" type="submit" id="authSubmit">登录</button>
  <button class="auth-switch auth-login-method" type="button" id="authPhoneToggle">手机验证码登录</button>
  <p class="login-error" id="loginError" role="alert"></p>
  <button class="auth-switch" type="button" id="authModeToggle">还没有账号？立即注册</button>
  <p class="auth-tip" id="authPhoneTip" hidden>仅支持已绑定手机号的账号；新用户请先注册账号。</p>`;
}

export function loginMarkup(workspace = {}) {
  const games = workspace?.catalogGames || workspace?.games || [];
  return `<div class="public-home"><header class="public-nav"><div class="public-brand"><span class="brand-mark">C</span><strong>星河游戏俱乐部</strong><small>陪玩服务平台</small></div><nav><a href="#/public/overview">首页</a><a href="#/public/companions">大神陪玩</a><a href="#/public/guarantees">服务保障</a></nav><div class="public-nav-actions"><button class="public-header-message" type="button" data-action="headerMessages" aria-label="消息与售后">${icon('message', 20)}<span class="public-header-dot" hidden></span></button><button class="public-account-trigger" type="button" data-action="headerAccount" aria-expanded="false"><span class="public-account-avatar">登</span><span class="public-account-label">个人</span>${icon('chevron', 14)}</button><a class="register-link" href="#login" data-action="openLogin">注册</a><a class="nav-login-link" href="#login" data-action="openLogin">登录</a><div class="public-account-menu" hidden></div></div></header>
  <main><section class="public-hero" id="games"><div class="hero-banner"><div class="banner-track"><article><span class="banner-kicker">星河游戏俱乐部</span><strong>找个靠谱的陪玩<br><em>一起赢下每一局</em></strong><p>专业陪玩 · 实时接单 · 安心交易</p></article><article><span class="banner-kicker">轻松组队</span><strong>选好游戏<br><em>开启专属陪玩</em></strong><p>查看服务价格，按需选择陪玩时长</p></article><article><span class="banner-kicker">热门推荐</span><strong>${escapeHtml(games[0]?.name || '游戏陪玩')}<br><em>专属陪玩</em></strong><p>在线打手随时响应，快速匹配</p></article></div><div class="banner-dots"><i class="active"></i><i></i><i></i></div></div><aside class="hero-login" id="login"><div class="login-card-head"><div class="login-logo">${icon('game', 21)}</div><div><strong>星河游戏俱乐部</strong><small>登录后查看个人买卖数据</small></div></div><h2>登录后解锁完整服务</h2><p class="login-subtitle">登录后下单，查看订单和售后</p><button class="login-submit hero-login-trigger" type="button" data-action="openLogin">登录 / 注册 ${icon('arrow', 16)}</button></aside></section><section class="public-content" id="members"></section></main>
  <footer class="public-footer" id="rules"><span>© 星河游戏俱乐部</span><span>服务保障 · 交易须知 · 联系客服</span></footer><dialog class="auth-dialog" id="authDialog"><form id="loginForm" method="dialog">${authFormMarkup()}</form></dialog></div>`;
}
