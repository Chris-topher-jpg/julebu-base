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


export function loginMarkup() { return `<div class="public-home"><header class="public-nav"><div class="public-brand"><span class="brand-mark">C</span><strong>星河游戏俱乐部</strong><small>陪玩服务平台</small></div><nav><a href="#games">首页</a><a href="#members">大神陪玩</a><a href="#rules">服务保障</a></nav><div class="public-nav-actions"><span class="public-online"><i></i>在线陪玩 ${icon('chevron', 13)}</span><a class="register-link" href="#login" data-action="openLogin">注册</a><a class="nav-login-link" href="#login" data-action="openLogin">登录</a></div></header><main><section class="public-hero" id="games"><div class="hero-banner"><div class="banner-track"><article><span class="banner-kicker">星河游戏俱乐部</span><strong>找个靠谱的陪玩<br><em>一起赢下每一局</em></strong><p>专业陪玩 · 实时接单 · 安心交易</p></article><article><span class="banner-kicker">新人专享</span><strong>首单立减 <em>10 元</em></strong><p>选择喜欢的游戏，马上开始组队</p></article><article><span class="banner-kicker">热门推荐</span><strong>王者荣耀<br><em>上分陪玩</em></strong><p>在线打手随时响应，快速匹配</p></article></div><div class="banner-dots"><i class="active"></i><i></i><i></i></div></div><aside class="hero-login" id="login"><div class="login-card-head"><div class="login-logo">${icon('game', 21)}</div><div><strong>星河游戏俱乐部</strong><small>登录后查看个人买卖数据</small></div></div><h2>登录后解锁完整服务</h2><p class="login-subtitle">登录后查看订单进度、收藏账号和报价提醒</p><button class="login-submit hero-login-trigger" type="button" data-action="openLogin">登录 / 注册 ${icon('arrow', 16)}</button><div class="login-card-foot"><span>首次使用？登录即自动注册</span><a href="#help">联系客服</a></div></aside></section><section class="public-content" id="members"><div class="section-heading"><div><span>热门陪玩</span><h1>选择你的专属队友</h1></div><button class="filter-button">全部游戏 ${icon('chevron', 14)}</button></div><div class="game-filters"><button class="active">全部</button><button>王者荣耀</button><button>和平精英</button><button>英雄联盟</button><button>无畏契约</button><button>更多游戏</button></div><div class="companion-grid">${[['王者荣耀','巅峰赛·上分','88 元/小时','玥玥','purple'],['和平精英','四排吃鸡·陪练','68 元/小时','阿布','orange'],['英雄联盟','峡谷排位·开黑','78 元/小时','小鹿','green'],['无畏契约','竞技模式·上分','98 元/小时','Koi','blue'],['王者荣耀','娱乐局·聊天','58 元/小时','奶糖','pink'],['和平精英','王牌冲刺·陪玩','72 元/小时','星野','navy']].map((item, i) => `<article class="companion-card"><div class="companion-cover ${item[4]}"><span class="cover-character">${item[3].slice(0,1)}</span><span class="online-tag"><i></i>${i % 3 === 1 ? '游戏中' : '空闲中'}</span><span class="rating">★ 好评率 ${98 + (i % 3)}%</span></div><div class="companion-body"><div class="companion-title"><strong>${item[3]}</strong><span>Lv.${12 + i}</span></div><p>${item[0]} · ${item[1]}</p><div class="companion-meta"><b>${item[2]}</b><span>${42 + i * 7} 人已下单</span></div><button class="companion-action" type="button" data-action="openLogin">聊一聊 ${icon('arrow', 14)}</button></div></article>`).join('')}</div></section></main><footer class="public-footer" id="rules"><span>© 星河游戏俱乐部</span><span>服务保障 · 交易须知 · 联系客服</span></footer><dialog class="auth-dialog" id="authDialog"><form id="loginForm" method="dialog"><button class="auth-close" type="button" data-action="closeLogin" aria-label="关闭登录弹窗">×</button><div class="auth-dialog-head"><div class="login-logo">${icon('game', 21)}</div><div><strong>登录 / 注册</strong><small>手机号登录，快速开始陪玩</small></div></div><h2 id="authTitle">手机号登录</h2><p class="login-subtitle">登录后查看订单进度、收藏账号和报价提醒</p><label>手机号<input id="loginUsername" autocomplete="tel" inputmode="tel" placeholder="请输入手机号" required></label><label id="passwordField">密码<input id="loginPassword" type="password" autocomplete="current-password" placeholder="请输入密码" required></label><label id="codeField" hidden>手机验证码<input id="loginCode" inputmode="numeric" placeholder="请输入 6 位验证码" maxlength="6"></label><button class="login-submit" type="submit" id="authSubmit">登录 / 注册 ${icon('arrow', 16)}</button><p class="login-error" id="loginError"></p><button class="auth-switch" type="button" id="authModeToggle">验证码登录</button><p class="auth-tip">未注册手机号登录后将自动创建账号</p></form></dialog></div>`; }
