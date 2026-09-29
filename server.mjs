import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const staff = new Set(['admin', 'service']);
const mime = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.js': 'text/javascript; charset=utf-8' };
const publicFiles = new Set(['/', '/index.html', '/src/main.js', '/src/style.css', '/src/assets/gaming.jpg']);
const now = () => new Date().toISOString();
const id = prefix => `${prefix}_${randomBytes(prefix === 's' ? 32 : 12).toString('hex')}`;
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const value = (input, label, min = 0, max = 300) => {
  const result = typeof input === 'string' ? input.trim() : '';
  if (result.length < min || result.length > max) fail(`${label}长度不正确`);
  return result;
};
const integer = (input, label, min, max) => {
  const result = Number(input);
  if (!Number.isInteger(result) || result < min || result > max) fail(`${label}不正确`);
  return result;
};
const usernameValue = input => {
  const username = value(input, '账号', 3, 30).toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(username)) fail('账号仅支持字母、数字、下划线和连字符');
  return username;
};
function hash(password) {
  const salt = randomBytes(16);
  return `${salt.toString('base64')}:${scryptSync(password, salt, 32).toString('base64')}`;
}
function matches(password, stored) {
  const [salt, expected] = stored.split(':');
  return timingSafeEqual(scryptSync(password, Buffer.from(salt, 'base64'), 32), Buffer.from(expected, 'base64'));
}
function sessionToken(req) {
  return (req.headers.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith('club_session='))?.slice(13) || '';
}
async function jsonBody(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') fail('需要 JSON 请求', 415);
  const parts = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > 16_000) fail('请求内容过大', 413);
    parts.push(part);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(parts).toString()); } catch { fail('请求格式错误'); }
  if (!body || Array.isArray(body) || typeof body !== 'object') fail('请求格式错误');
  return body;
}

function initialize(db, { production, adminPassword, adminUsername, adminName }) {
  db.exec(`PRAGMA foreign_keys=ON;
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS services (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, category TEXT NOT NULL, description TEXT NOT NULL, price_cents INTEGER NOT NULL, duration_hours INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1) STRICT;
    CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES users(id), escort_id TEXT REFERENCES users(id), service_id INTEGER NOT NULL, service_name TEXT NOT NULL, category TEXT NOT NULL, price_cents INTEGER NOT NULL, duration_hours INTEGER NOT NULL, contact TEXT NOT NULL, note TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, paid_at TEXT, started_at TEXT, finished_at TEXT, accepted_at TEXT) STRICT;
    CREATE TABLE IF NOT EXISTS order_events (id INTEGER PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE, actor TEXT NOT NULL, action TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;`);
  const mode = db.prepare("SELECT value FROM settings WHERE key='mode'").get()?.value;
  const existing = db.prepare('SELECT COUNT(*) count FROM users').get().count;
  if (production && existing && mode !== 'production') throw new Error('正式环境必须使用独立数据库，不能使用演示数据库');
  if (!production && mode === 'production') throw new Error('正式数据库必须使用 NODE_ENV=production 启动');
  if (existing) return;
  if (production && (!adminPassword || adminPassword.length < 12)) throw new Error('首次启动正式环境需要至少 12 位 CLUB_ADMIN_PASSWORD');
  const users = production
    ? [['u_admin', usernameValue(adminUsername || 'admin'), adminName || '管理员', 'admin', adminPassword]]
    : [['u_admin', 'admin', '管理员', 'admin'], ['u_service', 'service', '客服小星', 'service'], ['u_escort', 'escort', '陪玩小北', 'escort'], ['u_user', 'user', '演示用户', 'customer']];
  db.exec('BEGIN');
  try {
    db.prepare("INSERT INTO settings VALUES ('mode',?)").run(production ? 'production' : 'demo');
    const addUser = db.prepare('INSERT INTO users (id,username,password_hash,name,role,created_at) VALUES (?,?,?,?,?,?)');
    for (const user of users) addUser.run(user[0], user[1], hash(user[4] || '123456'), user[2], user[3], now());
    if (!production) {
      const addService = db.prepare('INSERT INTO services (name,category,description,price_cents,duration_hours) VALUES (?,?,?,?,?)');
      addService.run('竞技上分陪玩', '热门游戏', '语音组队，按约定时长提供陪玩服务。', 6800, 1);
      addService.run('新手教学陪练', '新手入门', '基础设置、实战指导与对局复盘。', 8800, 1);
      addService.run('开黑组队服务', '多人组队', '组队协调与游戏陪伴服务。', 12800, 2);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

const publicUser = user => ({ id: user.id, username: user.username, name: user.name, role: user.role, active: user.active, roleLabel: { admin: '管理员', service: '客服', escort: '陪玩', customer: '用户' }[user.role] });
const columns = 'SELECT o.*, customer.name customer_name, escort.name escort_name FROM orders o JOIN users customer ON customer.id=o.customer_id LEFT JOIN users escort ON escort.id=o.escort_id';

export function createBasicClubServer(options = {}) {
  const { database = ':memory:', production = false, publicOrigin, paymentContact = '请联系俱乐部客服获取收款信息' } = options;
  if (production && (!publicOrigin || new URL(publicOrigin).protocol !== 'https:')) throw new Error('正式环境需要 HTTPS CLUB_PUBLIC_ORIGIN');
  if (database !== ':memory:') mkdirSync(dirname(resolve(database)), { recursive: true });
  const db = new DatabaseSync(database);
  try { initialize(db, options); } catch (error) { db.close(); throw error; }
  const atomic = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const userById = userId => db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  const orderById = orderId => db.prepare(`${columns} WHERE o.id=?`).get(orderId);
  const addEvent = (orderId, actor, action, note = '') => db.prepare('INSERT INTO order_events (order_id,actor,action,note,created_at) VALUES (?,?,?,?,?)').run(orderId, actor, action, note, now());
  const orderView = order => ({ ...order, customer: order.customer_name, escort: order.escort_name || '', events: db.prepare('SELECT actor,action,note,created_at createdAt FROM order_events WHERE order_id=? ORDER BY id').all(order.id) });
  const servicesFor = all => db.prepare(`SELECT id,name,category,description,price_cents priceCents,duration_hours durationHours,active FROM services ${all ? '' : 'WHERE active=1'} ORDER BY id`).all();
  const workspace = user => {
    const clause = staff.has(user.role) ? '' : user.role === 'escort' ? ' WHERE o.escort_id=?' : ' WHERE o.customer_id=?';
    return {
      user: publicUser(user),
      orders: db.prepare(`${columns}${clause} ORDER BY o.created_at DESC`).all(...(staff.has(user.role) ? [] : [user.id])).map(orderView),
      services: servicesFor(user.role === 'admin'),
      escorts: staff.has(user.role) ? db.prepare("SELECT id,name FROM users WHERE role='escort' AND active=1 ORDER BY name").all() : [],
      users: user.role === 'admin' ? db.prepare("SELECT * FROM users WHERE role IN ('service','escort') ORDER BY created_at").all().map(publicUser) : [],
    };
  };
  const requireUser = req => {
    const session = db.prepare('SELECT user_id FROM sessions WHERE token=? AND expires_at>?').get(sessionToken(req), Date.now());
    const user = session && userById(session.user_id);
    if (!user || !user.active) fail('登录已失效，请重新登录', 401);
    return user;
  };
  const cookie = token => `club_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token ? 28800 : 0}${production ? '; Secure' : ''}`;
  const createSession = (res, user) => {
    const token = id('s');
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(token, user.id, Date.now() + 28_800_000);
    res.setHeader('Set-Cookie', cookie(token));
  };
  const authAttempts = new Map();
  const server = createServer(async (req, res) => {
    const respond = (body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    try {
      const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
      if (url.pathname.startsWith('/api/')) {
        if (!['GET', 'POST'].includes(req.method)) fail('请求方法不支持', 405);
        if (req.method === 'POST' && req.headers.origin && req.headers.origin !== (publicOrigin ? new URL(publicOrigin).origin : url.origin)) fail('请求来源不被允许', 403);
        if (['/api/login', '/api/register'].includes(url.pathname) && req.method === 'POST') {
          const timestamp = Date.now();
          for (const [key, item] of authAttempts) if (item.until <= timestamp) authAttempts.delete(key);
          const key = req.socket.remoteAddress;
          const attempt = authAttempts.get(key) || { count: 0, until: timestamp + 60_000 };
          authAttempts.set(key, attempt);
          if (++attempt.count > 30) fail('操作频繁，请稍后重试', 429);
        }
        const body = req.method === 'POST' ? await jsonBody(req) : {};
        if (url.pathname === '/api/public/services' && req.method === 'GET') return respond({ services: servicesFor(false), demo: !production, paymentContact });
        if (url.pathname === '/api/register' && req.method === 'POST') {
          const username = usernameValue(body.username);
          if (db.prepare('SELECT id FROM users WHERE username=?').get(username)) fail('该账号已被使用', 409);
          const userId = id('u');
          db.prepare('INSERT INTO users (id,username,password_hash,name,role,created_at) VALUES (?,?,?,?,?,?)').run(userId, username, hash(value(body.password, '密码', 8, 128)), value(body.name, '称呼', 1, 30), 'customer', now());
          const user = userById(userId);
          createSession(res, user);
          return respond({ user: publicUser(user) }, 201);
        }
        if (url.pathname === '/api/login' && req.method === 'POST') {
          const user = db.prepare('SELECT * FROM users WHERE username=?').get(value(body.username, '账号', 1, 30).toLowerCase());
          if (!user || !user.active || !matches(value(body.password, '密码', 1, 128), user.password_hash)) fail('账号或密码不正确', 401);
          createSession(res, user);
          return respond({ user: publicUser(user) });
        }
        if (url.pathname === '/api/logout' && req.method === 'POST') {
          db.prepare('DELETE FROM sessions WHERE token=?').run(sessionToken(req));
          res.setHeader('Set-Cookie', cookie(''));
          return respond({ ok: true });
        }
        const user = requireUser(req);
        if (url.pathname === '/api/me' && req.method === 'GET') return respond(workspace(user));
        if (url.pathname === '/api/password' && req.method === 'POST') {
          if (!matches(value(body.currentPassword, '当前密码', 1, 128), user.password_hash)) fail('当前密码不正确', 403);
          db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash(value(body.password, '新密码', 8, 128)), user.id);
          db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
          createSession(res, user);
          return respond({ ok: true });
        }
        if (url.pathname === '/api/staff' && req.method === 'POST') {
          if (user.role !== 'admin') fail('只有管理员可以创建业务账号', 403);
          if (!['service', 'escort'].includes(body.role)) fail('只能创建客服或陪玩账号');
          const username = usernameValue(body.username);
          if (db.prepare('SELECT id FROM users WHERE username=?').get(username)) fail('该账号已被使用', 409);
          db.prepare('INSERT INTO users (id,username,password_hash,name,role,created_at) VALUES (?,?,?,?,?,?)').run(id('u'), username, hash(value(body.password, '密码', 8, 128)), value(body.name, '称呼', 1, 30), body.role, now());
          return respond({ ok: true }, 201);
        }
        if (url.pathname === '/api/orders' && req.method === 'POST') {
          if (user.role !== 'customer') fail('只有用户可以提交订单', 403);
          const service = db.prepare('SELECT * FROM services WHERE id=? AND active=1').get(integer(body.serviceId, '服务项目', 1, 999999));
          if (!service) fail('服务项目不可用', 404);
          const created = now(), orderId = id('o');
          atomic(() => {
            db.prepare("INSERT INTO orders (id,customer_id,service_id,service_name,category,price_cents,duration_hours,contact,note,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'待支付',?,?)").run(orderId, user.id, service.id, service.name, service.category, service.price_cents, service.duration_hours, value(body.contact, '联系方式', 2, 80), value(body.note || '', '备注', 0, 300), created, created);
            addEvent(orderId, user.name, '提交订单');
          });
          return respond(orderView(orderById(orderId)), 201);
        }
        const actionMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/actions$/);
        if (actionMatch && req.method === 'POST') {
          const order = orderById(decodeURIComponent(actionMatch[1]));
          if (!order || !(staff.has(user.role) || user.id === order.customer_id || user.id === order.escort_id)) fail('订单不存在', 404);
          const action = value(body.action, '操作', 1, 30);
          const requireState = (allowed, states) => {
            if (!allowed) fail('你没有此操作权限', 403);
            if (!states.includes(order.status)) fail('订单状态已变化，请刷新后重试', 409);
          };
          const update = (status, fields = {}) => db.prepare('UPDATE orders SET status=?,updated_at=?,paid_at=COALESCE(?,paid_at),escort_id=COALESCE(?,escort_id),started_at=COALESCE(?,started_at),finished_at=COALESCE(?,finished_at),accepted_at=COALESCE(?,accepted_at) WHERE id=?').run(status, now(), fields.paidAt || null, fields.escortId || null, fields.startedAt || null, fields.finishedAt || null, fields.acceptedAt || null, order.id);
          atomic(() => {
            if (action === 'pay') {
              requireState(user.id === order.customer_id, ['待支付']);
              const reference = value(body.reference, '付款备注', 2, 100);
              update('待核款');
              addEvent(order.id, user.name, '提交付款报备', reference);
            } else if (action === 'confirm-payment') {
              requireState(staff.has(user.role), ['待支付', '待核款']);
              update('待派单', { paidAt: now() });
              addEvent(order.id, user.name, '客服确认收款');
            } else if (action === 'dispatch') {
              requireState(staff.has(user.role), ['待派单']);
              const escort = userById(value(body.escortId, '陪玩人员', 1, 60));
              if (!escort || escort.role !== 'escort' || !escort.active) fail('请选择可用的陪玩人员');
              update('待服务', { escortId: escort.id });
              addEvent(order.id, user.name, '客服派单', `已分配给 ${escort.name}`);
            } else if (action === 'start') {
              requireState(user.id === order.escort_id, ['待服务']);
              update('服务中', { startedAt: now() });
              addEvent(order.id, user.name, '开始服务');
            } else if (action === 'finish') {
              requireState(user.id === order.escort_id, ['服务中']);
              update('待验收', { finishedAt: now() });
              addEvent(order.id, user.name, '提交完成');
            } else if (action === 'accept') {
              requireState(user.id === order.customer_id, ['待验收']);
              update('已完成', { acceptedAt: now() });
              addEvent(order.id, user.name, '客户验收完成');
            } else if (action === 'cancel') {
              requireState(user.id === order.customer_id || staff.has(user.role), ['待支付']);
              update('已取消');
              addEvent(order.id, user.name, '取消未付款订单');
            } else fail('不支持的订单操作', 404);
          });
          return respond(orderView(orderById(order.id)));
        }
        const serviceMatch = url.pathname.match(/^\/api\/services\/(\d+)$/);
        if ((url.pathname === '/api/services' || serviceMatch) && req.method === 'POST') {
          if (user.role !== 'admin') fail('只有管理员可以维护服务项目', 403);
          const serviceId = serviceMatch ? Number(serviceMatch[1]) : null;
          if (serviceId && !db.prepare('SELECT id FROM services WHERE id=?').get(serviceId)) fail('服务项目不存在', 404);
          if (serviceId && Object.keys(body).length === 1 && typeof body.active === 'boolean') {
            db.prepare('UPDATE services SET active=? WHERE id=?').run(Number(body.active), serviceId);
          } else {
            const fields = [value(body.name, '服务名称', 2, 50), value(body.category, '服务分类', 2, 30), value(body.description, '服务说明', 5, 200), integer(body.priceCents, '服务价格', 100, 10000000), integer(body.durationHours, '服务时长', 1, 24)];
            if (db.prepare('SELECT id FROM services WHERE name=? AND id<>?').get(fields[0], serviceId || 0)) fail('服务名称已存在', 409);
            if (serviceId) db.prepare('UPDATE services SET name=?,category=?,description=?,price_cents=?,duration_hours=? WHERE id=?').run(...fields, serviceId);
            else db.prepare('INSERT INTO services (name,category,description,price_cents,duration_hours) VALUES (?,?,?,?,?)').run(...fields);
          }
          return respond({ ok: true }, serviceId ? 200 : 201);
        }
        fail('接口不存在', 404);
      }
      if (!['GET', 'HEAD'].includes(req.method)) fail('请求方法不支持', 405);
      // Only explicit public assets are served; databases and source configuration stay private.
      if (!publicFiles.has(url.pathname)) fail('资源不存在', 404);
      const file = resolve(root, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
      const content = await readFile(file).catch(() => null);
      if (!content) fail('资源不存在', 404);
      res.writeHead(200, { 'Content-Type': mime[extname(file)] });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (!error.status) console.error(error);
      respond({ error: error.status ? error.message : '服务器暂时不可用' }, error.status || 500);
    }
  });
  return { server, db, close: () => db.close() };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server } = createBasicClubServer({
    database: process.env.CLUB_DATABASE || resolve(root, 'data/club-basic.sqlite'),
    production: process.env.NODE_ENV === 'production',
    publicOrigin: process.env.CLUB_PUBLIC_ORIGIN,
    adminUsername: process.env.CLUB_ADMIN_USERNAME,
    adminPassword: process.env.CLUB_ADMIN_PASSWORD,
    adminName: process.env.CLUB_ADMIN_NAME,
    paymentContact: process.env.CLUB_PAYMENT_CONTACT,
  });
  const port = Number(process.env.PORT || 4173);
  server.listen(port, '127.0.0.1', () => console.log(`基础版俱乐部系统运行于 http://127.0.0.1:${port}/`));
}
