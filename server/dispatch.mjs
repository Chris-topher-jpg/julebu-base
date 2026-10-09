import { randomUUID } from 'node:crypto';
import { requireThat } from './club.mjs';
import { catalogList } from './game-catalog.mjs';
import { isRealNameVerified } from './real-name.mjs';
import { priceOf, meetsLevel } from './membership.mjs';
import { productUnitPrice, productNeedsLevel, productEscortCount } from '../src/product-config.js';

const staff = user => ['admin', 'service'].includes(user.role);
const eligible = user => user?.active && user.role === 'escort' && !user.escortFrozen && isRealNameVerified(user);
const role = user => staff(user) ? '客服' : user.role === 'escort' ? '打手' : '用户';
const proposalView = ({ input, ...proposal }) => ({ ...proposal, input: { hours: input.hours, requirement: input.requirement } });
const definitions = [
  { id: 'room-1', name: '星河接待一厅', kind: '接待', description: '说出你的需求，客服帮你安排' },
  { id: 'room-2', name: '星河接待二厅', kind: '接待', description: '选游戏、聊偏好，轻松找到队友' },
  { id: 'room-3', name: '星河接待三厅', kind: '接待', description: '多人组队与定制需求咨询' },
  { id: 'room-4', name: '星河试音专厅', kind: '试音', description: '先听声音，再选合拍的打手' },
  { id: 'lobby', name: '接待大厅', kind: '接待', description: '先与客服语音沟通，再分配到接待厅', lobby: true },
];
export const ROOM_LEASE_MS = 45000;
export const LOBBY_CAPACITY = 30;

export function parseIceServers(raw = '[]') {
  let servers;
  try { servers = JSON.parse(raw); } catch { throw new Error('CLUB_ICE_SERVERS 必须为有效的 JSON 数组'); }
  requireThat(Array.isArray(servers) && servers.length <= 8 && servers.every(item => {
    const urls = typeof item?.urls === 'string' ? [item.urls] : item?.urls;
    return Array.isArray(urls) && urls.length > 0 && urls.length <= 8 && urls.every(url => typeof url === 'string' && /^(stun|stuns|turn|turns):[^\s]+$/.test(url)) &&
      (item.username === undefined || typeof item.username === 'string') && (item.credential === undefined || typeof item.credential === 'string');
  }), 'CLUB_ICE_SERVERS 的语音服务器配置无效');
  return servers.map(({ urls, username, credential }) => ({ urls, ...(username !== undefined ? { username } : {}), ...(credential !== undefined ? { credential } : {}) }));
}

// Seats and signaling are ephemeral. Quotes are persisted in the same SQLite
// transaction as orders; no audio is ever recorded or stored by this server.
export class DispatchHall {
  constructor(store, { iceServers = [], now = Date.now } = {}) {
    this.store = store; this.iceServers = iceServers; this.now = now;
    this.rooms = definitions.map(definition => ({ ...definition, members: new Map(), invites: new Map(), messages: [], sequence: 0, customerId: null }));
  }
  prune() {
    for (const room of this.rooms) {
      for (const [id, member] of room.members) {
        const actor = member.expires > this.now() && this.store.session(member.token);
        if (!actor || actor.id !== member.userId || role(actor) !== member.role || !room.lobby && actor.role === 'escort' && !eligible(actor)) room.members.delete(id);
      }
      if (room.customerId && ![...room.members.values()].some(member => member.userId === room.customerId)) {
        // A different customer must never inherit a former customer's room.
        room.members.clear(); room.customerId = null;
      }
      for (const [id, invitation] of room.invites) if (invitation.expires <= this.now()) room.invites.delete(id);
      if (!room.members.size) { room.messages = []; room.invites.clear(); room.customerId = null; }
    }
  }
  room(id) {
    const room = this.rooms.find(item => item.id === id);
    requireThat(room, '语音房不存在', 404); return room;
  }
  actor(user) {
    const actor = this.store.read().users.find(item => item.id === user.id && item.active);
    requireThat(actor, '登录已失效，请重新登录', 401); return actor;
  }
  lobby(user) {
    this.prune();
    const actor = user && this.actor(user);
    const rooms = this.rooms.map(room => {
      const members = [...room.members.values()];
      const current = members.some(member => member.userId === actor?.id);
      const invited = Boolean(actor && room.invites.has(actor.id));
      const capacity = room.lobby ? LOBBY_CAPACITY : 6;
      return { id: room.id, name: room.name, kind: room.kind, description: room.description, capacity,
        count: members.length, staffCount: members.filter(member => member.role === '客服').length,
        occupied: Boolean(room.customerId), current, invited,
        joinable: members.length < capacity && (room.lobby || current || actor && staff(actor) || (actor?.role === 'escort' ? eligible(actor) && invited : !room.customerId)),
      };
    });
    const data = actor && this.store.read();
    return { rooms, ...(actor ? { userId: actor.id, role: role(actor), canHost: staff(actor),
      proposals: (data.dispatchProposals || []).filter(item => item.buyerId === actor.id || staff(actor) && item.staffId === actor.id).slice(0, 30).map(proposalView),
    } : {}) };
  }
  member(room, user, input, token) {
    const member = room.members.get(input.peerId);
    requireThat(member && member.userId === user.id && member.token === token, '你已离开语音房，请重新加入', 409);
    return member;
  }
  snapshot(room, member, after = 0) {
    const data = this.store.read();
    const actor = data.users.find(user => user.id === member.userId);
    const lobbyMembers = room.lobby ? [...room.members.values()] : [];
    return { roomId: room.id, name: room.name, peerId: member.id, canHost: staff(actor), customerId: room.customerId, capacity: room.lobby ? LOBBY_CAPACITY : 6,
      assignment: member.assignment || null,
      members: [...room.members.values()].map(({ id, userId, name, role, muted }) => ({ id, userId, name, role, muted })),
      messages: room.messages, signals: member.signals.filter(signal => signal.id > after),
      cursor: member.signals.at(-1)?.id || after,
      proposals: (data.dispatchProposals || []).filter(item => item.roomId === room.id && item.buyerId === room.customerId && (staff(actor) || item.buyerId === actor.id)).slice(0, 8).map(proposalView),
      ...(staff(actor) ? { escorts: data.users.filter(user => eligible(user) && user.online).map(({ id, name, games }) => ({ id, name, games })) } : {}),
      ...(room.lobby && staff(actor) ? {
        lobbyCustomers: lobbyMembers.filter(item => item.role === '用户').map(({ userId, name }) => ({ id: userId, name })),
        lobbyStaff: lobbyMembers.filter(item => item.role === '客服').map(({ userId, name }) => ({ id: userId, name })),
        receptionRooms: this.rooms.filter(item => !item.lobby).map(item => ({ id: item.id, name: item.name, count: item.members.size, occupied: Boolean(item.customerId) })),
      } : {}),
    };
  }
  action(user, id, action, input, token) {
    this.prune();
    const actor = this.actor(user), room = this.room(id);
    if (action === 'join') {
      requireThat(typeof input.clientId === 'string' && /^[a-zA-Z0-9-]{16,80}$/.test(input.clientId), '入房请求无效');
      const existing = [...room.members.values()].find(member => member.userId === actor.id);
      if (existing) {
        requireThat(existing.token === token && existing.clientId === input.clientId, '你已在其他窗口加入该房间，请先退出', 409);
        existing.expires = this.now() + ROOM_LEASE_MS;
        return { ...this.snapshot(room, existing), iceServers: this.iceServers };
      }
      requireThat(!this.rooms.some(item => [...item.members.values()].some(member => member.userId === actor.id)), '请先退出当前语音房', 409);
      requireThat(room.members.size < (room.lobby ? LOBBY_CAPACITY : 6), '房间已满，请选择其他房间', 409);
      if (actor.role === 'escort' && !room.lobby) requireThat(eligible(actor) && room.invites.has(actor.id), '请等待客服邀请后进入试音', 403);
      else if (!staff(actor) && !room.lobby) requireThat(!room.customerId, '该房间正在接待其他用户，请选择空闲房间', 409);
      const member = { id: randomUUID(), clientId: input.clientId, userId: actor.id, token, name: actor.name, role: role(actor), muted: true, expires: this.now() + ROOM_LEASE_MS, signals: [], buckets: {} };
      room.members.set(member.id, member);
      if (!staff(actor) && actor.role !== 'escort' && !room.lobby) room.customerId = actor.id;
      room.invites.delete(actor.id);
      if (room.customerId === actor.id) this.store.transaction(actor, 'profile:update', '派单大厅 · 请求客服接待', data => {
        for (const service of data.users.filter(item => item.active && staff(item))) this.notice(data, service.id, room.id, '有用户等待语音接待', `${room.name} 有新的接待需求`, 'reception');
      });
      return { ...this.snapshot(room, member), iceServers: this.iceServers };
    }
    // Leaving after an expired lease is deliberately idempotent.
    if (action === 'leave' && !room.members.has(input.peerId)) return { ok: true };
    const member = this.member(room, actor, input, token);
    if (action === 'leave') {
      room.members.delete(member.id); this.prune(); return { ok: true };
    }
    if (action === 'poll') {
      requireThat(Number.isSafeInteger(input.after) && input.after >= 0, '同步游标无效');
      requireThat(typeof input.muted === 'boolean', '麦克风状态无效');
      member.expires = this.now() + ROOM_LEASE_MS; member.muted = input.muted;
      member.signals = member.signals.filter(signal => signal.id > input.after);
      return this.snapshot(room, member, input.after);
    }
    const limit = action === 'signal' ? 180 : action === 'message' ? 20 : 10;
    const bucket = member.buckets[action] ||= { start: this.now(), count: 0 };
    if (this.now() - bucket.start >= 10000) { bucket.start = this.now(); bucket.count = 0; }
    requireThat(++bucket.count <= limit, '操作过于频繁，请稍后再试', 429);
    if (action === 'signal') {
      const recipient = room.members.get(input.to);
      requireThat(recipient && recipient !== member, '对方已离开语音房', 409);
      const signal = input.signal;
      requireThat(signal && (signal.type === 'restart' || ['offer', 'answer'].includes(signal.type) && typeof signal.sdp === 'string' && signal.sdp.length <= 18000), '语音协商数据无效');
      requireThat(recipient.signals.length < 100, '对方暂时无法接收语音连接，请稍后重试', 429);
      recipient.signals.push({ id: ++room.sequence, from: member.id, signal: { type: signal.type, ...(signal.sdp ? { sdp: signal.sdp } : {}) } });
      return { ok: true };
    }
    if (action === 'message') {
      requireThat(typeof input.text === 'string' && input.text.trim().length > 0 && input.text.trim().length <= 500, '消息应为 1–500 个字符');
      room.messages.push({ id: randomUUID(), userId: actor.id, name: actor.name, role: role(actor), text: input.text.trim(), at: new Date(this.now()).toISOString() });
      room.messages = room.messages.slice(-80); return { ok: true };
    }
    requireThat(staff(actor), '只有客服和管理员可以执行此操作', 403);
    if (action === 'invite') {
      const escort = this.store.read().users.find(user => user.id === input.userId);
      requireThat(eligible(escort) && escort.online, '该打手暂不可试音，请选择在线打手');
      requireThat(room.customerId, '请等待用户进入房间后再邀请试音');
      room.invites.set(escort.id, { expires: this.now() + 5 * 60000 });
      this.store.transaction(actor, 'order:dispatch', '派单大厅 · 邀请打手试音', data => this.notice(data, escort.id, room.id, '客服邀请你进入语音房试音', `${room.name} · 请在 5 分钟内进入派单大厅`, 'invitation', 5));
      return { ok: true };
    }
    if (action === 'assign') {
      requireThat(room.lobby, '只有接待大厅可以进行分配');
      const target = this.room(input.roomId);
      requireThat(!target.lobby, '请选择下方接待厅');
      requireThat(target.members.size < 6 && !target.customerId, '目标接待厅正在接待其他用户，请选择其他房间', 409);
      const customer = [...room.members.values()].find(item => item.userId === input.customerId && item.role === '用户');
      requireThat(customer, '请选择当前接待大厅中的老板', 409);
      const receptionist = [...room.members.values()].find(item => item.userId === (input.serviceId || actor.id) && item.role === '客服');
      requireThat(receptionist, '请选择当前接待大厅中的客服', 409);
      const assignment = { roomId: target.id, roomName: target.name, assignedAt: new Date(this.now()).toISOString(), assignedBy: actor.id };
      customer.assignment = assignment;
      receptionist.assignment = assignment;
      this.store.transaction(actor, 'order:dispatch', '派单大厅 · 分配接待厅', data => {
        this.notice(data, customer.userId, target.id, '客服已为你分配接待厅', `请进入${target.name}继续语音沟通`, 'reception', 10);
        if (receptionist.userId !== actor.id) this.notice(data, receptionist.userId, target.id, '你已被分配接待厅', `请进入${target.name}继续接待`, 'reception', 10);
      });
      return { ok: true, roomId: target.id, roomName: target.name, customerId: customer.userId, serviceId: receptionist.userId };
    }
    if (action === 'proposal') {
      requireThat(room.customerId, '请等待用户进入房间后再拟单');
      return proposalView(this.propose(actor, room, input));
    }
    requireThat(false, '房间操作不存在', 404);
  }
  propose(user, room, input) {
    return this.store.transaction(user, 'order:dispatch', '派单大厅 · 客服拟单', (data, actor) => {
      const product = data.products.find(item => item.id === input.productId && item.state === '启用');
      requireThat(product && catalogList(data).some(game => game.name === product.game && game.state === '上架'), '请选择可售服务');
      const buyer = data.users.find(item => item.id === room.customerId && item.active);
      const customer = buyer && data.customers.find(item => item.id === buyer.customerId);
      requireThat(customer, '用户账户不可用', 409);
      const levelId = productNeedsLevel(product) ? input.levelId : null;
      requireThat(!productNeedsLevel(product) || data.levels.some(level => level.id === levelId), '请选择服务等级');
      const hours = Number(input.hours);
      requireThat(Number.isInteger(hours) && hours >= 1 && hours <= 24, '服务时长应为 1–24 小时');
      requireThat(typeof input.requirement === 'string' && input.requirement.trim().length > 0 && input.requirement.trim().length <= 300, '请填写服务需求，最多 300 字');
      const unitPriceCents = productUnitPrice(product, levelId, data.gameLevelConfigs, data.levels.map(level => ({ ...level, priceCents: priceOf(data, level.id) })));
      requireThat(Number.isSafeInteger(unitPriceCents) && unitPriceCents > 0, '服务价格配置无效', 409);
      const preferred = input.escortId && data.users.find(item => item.id === input.escortId);
      if (input.escortId) requireThat(eligible(preferred) && preferred.online && preferred.games.includes(product.game) && meetsLevel(data, preferred, { levelRequired: productNeedsLevel(product), levelId }) && productEscortCount(product) === 1 && (product.participantMin ?? data.games.find(game => game.name === product.game)?.min ?? 1) === 1, '指定打手不满足该服务要求，多人服务请选择客服安排');
      const proposal = { id: randomUUID(), roomId: room.id, buyerId: buyer.id, buyerName: customer.name, staffId: actor.id, staffName: actor.name,
        productName: product.name, game: product.game, levelName: data.levels.find(level => level.id === levelId)?.name || '', escortName: preferred?.name || '',
        amountCents: unitPriceCents * hours, status: 'pending', createdAt: new Date(this.now()).toISOString(),
        input: { boss: customer.name, productId: product.id, levelId, hours, pay: '在线支付', requirement: input.requirement.trim(),
          voice: '派单大厅语音房', orderMode: preferred ? 'designated' : 'quick', preferredEscortId: preferred?.id || '',
          expectedUnitPriceCents: unitPriceCents, expectedProductVersion: product.version ?? 0, requestId: randomUUID() },
      };
      for (const previous of data.dispatchProposals || []) if (previous.buyerId === buyer.id && previous.status === 'pending') previous.status = 'replaced';
      (data.dispatchProposals ||= []).unshift(proposal);
      this.notice(data, buyer.id, proposal.id, '客服已拟好订单，请确认', '进入派单大厅查看服务内容与金额，确认后才会扣款', 'proposal', 30);
      return proposal;
    });
  }
  notice(data, recipientId, entityId, title, body, relation, minutes = 5) {
    data.notifications ||= [];
    data.notifications.unshift({ id: randomUUID(), recipientId, entityId, title, body, relation, mode: 'public', page: 'dispatchHall', kind: 'dispatchHall', createdAt: new Date(this.now()).toISOString(), expiresAt: this.now() + minutes * 60000, readAt: null });
    data.notifications = data.notifications.slice(0, 20000);
  }
}
