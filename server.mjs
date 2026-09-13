import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, resolve } from 'node:path';
import { ClubStore, can, requireThat } from './server/club.mjs';
import { catalogAction } from './server/catalog.mjs';
import { catalogList } from './server/game-catalog.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const jsonLimit = 24000;
const loginWindow = 10 * 60 * 1000;

function configuredOrigin(value, production) {
  if (!value) {
    if (production) throw new Error('正式环境必须配置 CLUB_PUBLIC_ORIGIN 为 HTTPS 站点地址');
    return null;
  }
  let url;
  try { url = new URL(value); } catch { throw new Error('CLUB_PUBLIC_ORIGIN 不是有效的站点地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || (production && url.protocol !== 'https:') || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('CLUB_PUBLIC_ORIGIN 必须是完整站点来源地址，正式环境须使用 HTTPS，不包含路径、查询参数或账号');
  }
  return url;
}

async function readJson(req) {
  requireThat(req.headers['content-type']?.split(';')[0].trim().toLowerCase() === 'application/json', '需要 JSON 请求', 415);
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > jsonLimit) {
      req.resume();
      requireThat(false, '请求过大', 413);
    }
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)) || '{}'); }
  catch { requireThat(false, '请求格式错误'); }
  requireThat(body && typeof body === 'object' && !Array.isArray(body), '请求格式错误');
  return body;
}

// Spreadsheet programs execute formula-looking cells even when CSV-quoted.
function csvCell(value) {
  if (typeof value === 'number') return String(value);
  let text = String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+\-@]/u.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function createClubServer({ database, production = process.env.NODE_ENV === 'production', publicOrigin = process.env.CLUB_PUBLIC_ORIGIN, bootstrapAdmin = { username: process.env.CLUB_ADMIN_USERNAME, password: process.env.CLUB_ADMIN_PASSWORD, name: process.env.CLUB_ADMIN_NAME } } = {}) {
  const origin = configuredOrigin(publicOrigin, production);
  if (production && (!database || database === ':memory:')) throw new Error('正式环境必须通过 CLUB_DATABASE 指定独立且持久化的数据库路径');
  const store = new ClubStore(database || resolve(root, 'data/club.sqlite'), { production, bootstrapAdmin });
  const attempts = new Map();
  const cookieFlags = `HttpOnly; SameSite=Strict; Path=/${origin?.protocol === 'https:' ? '; Secure' : ''}`;
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (origin?.protocol === 'https:') res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    const json = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      requireThat(typeof req.headers.host === 'string' && /^(?:[a-z0-9.-]+|\[[a-f0-9:]+\])(?::\d{1,5})?$/i.test(req.headers.host), '无效的访问主机', 400);
      requireThat(req.url?.startsWith('/') && !req.url.startsWith('//'), '无效的请求地址', 400);
      const base = `${origin?.protocol || 'http:'}//${req.headers.host}`;
      let url;
      try { url = new URL(req.url, base); } catch { requireThat(false, '无效的请求地址', 400); }
      // In production TLS is normally terminated by a reverse proxy. Validate
      // the configured host here while keeping the externally visible origin
      // (and Origin header) pinned to CLUB_PUBLIC_ORIGIN below.
      requireThat(origin ? url.hostname === origin.hostname && (!origin.port || url.port === origin.port) : ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), '不允许的访问主机', 403);
      if (url.pathname.startsWith('/api/')) {
        let body = {};
        if (req.method !== 'GET') {
          requireThat(req.method === 'POST', '请求方法不支持', 405);
          requireThat(!req.headers.origin || req.headers.origin === (origin ? origin.origin : url.origin), '请求来源不被允许', 403);
          requireThat(req.headers['sec-fetch-site'] !== 'cross-site', '请求来源不被允许', 403);
          body = await readJson(req);
        }
        const token = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('club_session='))?.slice(13) || '';
        if (['/api/login', '/api/register'].includes(url.pathname) && req.method === 'POST') {
          const accountName = typeof body.username === 'string' ? body.username.trim() : '';
          requireThat(accountName.length > 0 && accountName.length <= 128, '请输入有效的登录账号');
          // A local HTTPS reverse proxy shares one socket IP for every visitor.
          // Account limits stay independent; the proxy also needs IP rate limits.
          const key = production ? `account:${accountName.toLowerCase()}` : req.socket.remoteAddress;
          const currentTime = Date.now();
          for (const [address, attempt] of attempts) if (attempt.until <= currentTime) attempts.delete(address);
          const limit = attempts.get(key);
          if (limit?.count >= 10) {
            res.setHeader('Retry-After', String(Math.ceil((limit.until - currentTime) / 1000)));
            requireThat(false, '登录尝试过多，请稍后再试', 429);
          }
          try {
            const result = url.pathname === '/api/register' ? store.register(body) : store.login(accountName, body.password);
            store.logout(token);
            res.setHeader('Set-Cookie', `club_session=${result.token}; ${cookieFlags}; Max-Age=28800`);
            const personal = store.personal(result.user);
            return json({ user: personal.user, membership: personal.membership }, url.pathname === '/api/register' ? 201 : 200);
          } catch (e) { attempts.set(key, { count: (limit?.count || 0) + 1, until: limit?.until || currentTime + loginWindow }); throw e; }
        }
        if (url.pathname === '/api/logout' && req.method === 'POST') {
          store.logout(token);
          res.setHeader('Set-Cookie', `club_session=; ${cookieFlags}; Max-Age=0`);
          return json({ ok: true });
        }
        if (url.pathname === '/api/public/catalog' && req.method === 'GET') {
          const data = store.read();
          const games = catalogList(data).map(({ name, category, state, min, max }) => ({ name, category, state, min, max }));
          return json({ games, catalogGames: games, revision: data.revision });
        }
        const user = store.session(token);
        requireThat(user, '登录已失效，请重新登录', 401);
        if (req.method === 'GET') {
          if (url.pathname === '/api/me') return json(store.personal(user));
          if (url.pathname === '/api/sync') {
            return json(store.sync(user, url.searchParams.get('since') ?? 0, url.searchParams.get('context') ?? 'management'));
          }
          if (url.pathname === '/api/notifications') return json(store.notifications(user));
          if (url.pathname === '/api/workspace') return json(store.workspace(user));
          if (url.pathname === '/api/audit') return json(store.auditList(user, Object.fromEntries(url.searchParams)));
          const analyticsExport = url.pathname === '/api/analytics/export';
          const analytics = url.pathname.match(/^\/api\/analytics\/([a-z]+)$/);
          if (analyticsExport) {
            const query = Object.fromEntries(url.searchParams);
            const kind = query.kind || 'orders';
            const result = store.analytics(user, kind === 'summary' ? 'summary' : kind === 'trend' ? 'trend' : 'rankings', kind === 'rankings' ? { ...query, kind: query.rankKind || 'orders' } : query);
            const rows = kind === 'summary' ? [{ metric: '完成订单总金额', value: result.daily.amountCents / 100 }, { metric: '完成订单总笔数', value: result.daily.orderCount }, { metric: '下单总用户人数', value: result.daily.buyerCount }] : kind === 'trend' ? result.points.map(point => ({ date: point.day, orderCount: point.orderCount, amountCents: point.amountCents / 100 })) : result.rows.map(row => ({ rank: row.rank, name: row.name, orderCount: row.orderCount, amountCents: row.amountCents / 100 }));
            const keys = Object.keys(rows[0] || { value: '' });
            const csv = [keys.join(','), ...rows.map(row => keys.map(key => csvCell(row[key])).join(','))].join('\r\n');
            return json({ filename: `club-${kind}-${Date.now()}.csv`, content: `\uFEFF${csv}`, mime: 'text/csv;charset=utf-8' });
          }
          if (analytics) return json(store.analytics(user, analytics[1], Object.fromEntries(url.searchParams)));
          const resources = { orders: 'order:view', accounts: 'account:manage', topups: 'finance:manage', ledger: 'finance:manage', withdrawals: 'finance:manage', conversations: 'conversation:manage', assessments: 'assessment:view', 'assessment-records': 'assessment:view', examinations: 'assessment:view' };
          const resource = url.pathname.slice(5);
          requireThat(resources[resource], '接口不存在', 404);
          requireThat(can(user, resources[resource]), '你的职责没有此操作权限', 403);
          const workspace = store.workspace(user);
          return json(['assessments', 'assessment-records', 'examinations'].includes(resource) ? (workspace.assessments || []) : workspace[resource]);
        }
        if (url.pathname === '/api/notifications/read') return json(store.readNotifications(user, body));
        const catalog = url.pathname.match(/^\/api\/catalog\/(games|products)$/);
        if (catalog) return json(catalogAction(store, user, catalog[1], body));
        if (url.pathname === '/api/orders') return json(store.createOrder(user, body), 201);
        if (url.pathname === '/api/refunds') return json(store.createRefund(user, body), 201);
        if (url.pathname === '/api/conversations') return json(store.conversationCreate(user, body), 201);
        const refund = url.pathname.match(/^\/api\/refunds\/([^/]+)$/);
        if (refund) return json(store.reviewRefund(user, refund[1], body));
        const orderAction = url.pathname.match(/^\/api\/orders\/([^/]+)\/([^/]+)$/);
        if (orderAction) return json(store.orderAction(user, orderAction[1], orderAction[2], body));
        const chat = url.pathname.match(/^\/api\/conversations\/([^/]+)$/);
        if (chat) return json(store.conversationAction(user, chat[1], body));
        const chatMessage = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
        if (chatMessage) return json(store.conversationMessage(user, chatMessage[1], body));
        if (url.pathname === '/api/withdrawals') return json(store.withdrawal(user, body), 201);
        const withdrawal = url.pathname.match(/^\/api\/withdrawals\/([^/]+)$/);
        if (withdrawal) return json(store.reviewWithdrawal(user, withdrawal[1], body));
        const topup = url.pathname.match(/^\/api\/topups\/([^/]+)$/);
        if (topup) return json(store.topupAction(user, topup[1], body));
        if (url.pathname === '/api/online') return json(store.setOnline(user, body));
        const examiner = url.pathname.match(/^\/api\/examiners\/([^/]+)$/);
        if (examiner) return json(store.examinerAction(user, examiner[1], body));
        if (url.pathname === '/api/assessments' || url.pathname === '/api/examinations') return json(store.createAssessment(user, body), 201);
        const assessment = url.pathname.match(/^\/api\/(?:assessments|examinations|assessment-records)\/([^/]+)$/);
        if (assessment) return json(store.updateAssessment(user, assessment[1], body));
        if (url.pathname === '/api/levels') return json(store.configureLevels(user, body));
        if (url.pathname === '/api/level-prices' || url.pathname === '/api/catalog/prices') return json(store.configureLevelPrices(user, body));
        if (url.pathname === '/api/commissions') return json(store.configureCommissions(user, body));
        if (url.pathname === '/api/members/skills') return json(store.bindSkills(user, body));
        const member = url.pathname.match(/^\/api\/members\/([^/]+)\/([^/]+)$/);
        if (member) return json(store.membershipAction(user, member[1], member[2], body));
        const account = url.pathname.match(/^\/api\/accounts(?:\/([^/]+))?$/);
        if (account) return json(store.accountAction(user, account[1], body));
        requireThat(false, '接口不存在', 404);
      }
      requireThat(req.method === 'GET' || req.method === 'HEAD', '请求方法不支持', 405);
      if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
      const path = ['/', '/user', '/user/'].includes(url.pathname) ? '/index.html' : url.pathname;
      requireThat(path === '/index.html' || /^\/src\/[a-zA-Z0-9_-]+\.(js|css|svg|jpg)$/.test(path), '文件不存在', 404);
      const contents = await readFile(resolve(root, path.slice(1)));
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };
      res.writeHead(200, { 'Content-Type': `${types[extname(path)]}; charset=utf-8` });
      res.end(req.method === 'HEAD' ? undefined : contents);
    } catch (error) {
      if (!error.status && error.code !== 'ENOENT') console.error(error);
      json({ error: error.status ? error.message : error.code === 'ENOENT' ? '文件不存在' : '服务暂时出错，请稍后重试' }, error.status || (error.code === 'ENOENT' ? 404 : 500));
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  store.totalSnapshot();
  const statisticsTimer = setInterval(() => { try { store.totalSnapshot(); } catch (error) { console.error('统计快照更新失败', error); } }, 60000);
  statisticsTimer.unref();
  server.on('close', () => { clearInterval(statisticsTimer); store.close(); });
  return { server, store };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server } = createClubServer({ database: process.env.CLUB_DATABASE || undefined });
  const port = Number(process.env.PORT || 4173);
  server.listen(port, '127.0.0.1', () => console.log(`星河俱乐部 http://127.0.0.1:${port}/`));
}

