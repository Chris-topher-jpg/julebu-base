import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, resolve } from 'node:path';
import { ClubStore, can, requireThat } from './server/club.mjs';
import { catalogAction } from './server/catalog.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
export function createClubServer({ database = resolve(root, 'data/club.sqlite') } = {}) {
  const store = new ClubStore(database);
  const attempts = new Map();
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    const json = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      const base = `http://${req.headers.host}`;
      const url = new URL(req.url, base);
      requireThat(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), '不允许的访问主机', 403);
      if (url.pathname.startsWith('/api/')) {
        let body = {};
        if (req.method !== 'GET') {
          requireThat(req.method === 'POST', '请求方法不支持', 405);
          requireThat(!req.headers.origin || req.headers.origin === base, '请求来源不被允许', 403);
          requireThat(req.headers['content-type']?.startsWith('application/json'), '需要 JSON 请求', 415);
          let raw = '';
          for await (const chunk of req) { raw += chunk; requireThat(Buffer.byteLength(raw) < 24000, '请求过大', 413); }
          try { body = JSON.parse(raw || '{}'); } catch { requireThat(false, '请求格式错误'); }
          requireThat(body && typeof body === 'object' && !Array.isArray(body), '请求格式错误');
        }
        const token = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('club_session='))?.slice(13) || '';
        if (['/api/login', '/api/register'].includes(url.pathname) && req.method === 'POST') {
          const key = req.socket.remoteAddress;
          const limit = attempts.get(key);
          requireThat(!limit || limit.until < Date.now() || limit.count < 10, '登录尝试过多，请 10 分钟后再试', 429);
          try {
            const result = url.pathname === '/api/register' ? store.register(body) : store.login(typeof body.username === 'string' ? body.username.trim() : '', body.password);
            attempts.delete(key); store.logout(token);
            res.setHeader('Set-Cookie', `club_session=${result.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
            const personal = store.personal(result.user);
            return json({ user: personal.user, membership: personal.membership }, url.pathname === '/api/register' ? 201 : 200);
          } catch (e) { attempts.set(key, { count: limit?.until > Date.now() ? limit.count + 1 : 1, until: Date.now() + 600000 }); throw e; }
        }
        if (url.pathname === '/api/logout' && req.method === 'POST') {
          store.logout(token);
          res.setHeader('Set-Cookie', 'club_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
          return json({ ok: true });
        }
        const user = store.session(token);
        requireThat(user, '登录已失效，请重新登录', 401);
        if (req.method === 'GET') {
          if (url.pathname === '/api/me') return json(store.personal(user));
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
            const csv = [keys.join(','), ...rows.map(row => keys.map(key => JSON.stringify(row[key] ?? '')).join(','))].join('\n');
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

