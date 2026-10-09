import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createClubServer } from '../server.mjs';
import { DispatchHall, LOBBY_CAPACITY, ROOM_LEASE_MS, parseIceServers } from '../server/dispatch.mjs';
import { verifyFixtureUsers } from './real-name-fixture.mjs';
import { addFixtureGames } from './catalog-fixture.mjs';
import { parseRoute } from '../src/routes.js';

function fixture(t) {
  const app = createClubServer({ edition: 'full', database: ':memory:', production: false, publicOrigin: '' });
  t.after(() => app.server.listening ? app.close() : app.store.close());
  const { store } = app;
  addFixtureGames(store, ['王者荣耀']);
  verifyFixtureUsers(store, ['demo-user', 'demo-escort']);
  const users = Object.fromEntries(store.read().users.map(user => [user.id, user]));
  users.user = users['user-demo'];
  const sessions = Object.fromEntries(['demo-user', 'user', 'demo-service', 'demo-escort', 'demo-finance', 'admin'].map(id => [id, store.login(users[id].username, id.startsWith('demo-') ? 'Test1234!' : '123456').token]));
  let now = Date.now();
  const hall = new DispatchHall(store, { now: () => now, iceServers: [{ urls: 'turn:relay.example.test', username: 'test', credential: 'private' }] });
  const act = (id, room, action, body = {}) => hall.action(users[id], room, action, body, sessions[id]);
  const join = (id, room = 'room-1', clientId = randomUUID()) => act(id, room, 'join', { clientId });
  const poll = (id, seat, extra = {}) => act(id, seat.roomId, 'poll', { peerId: seat.peerId, after: 0, muted: true, ...extra });
  const quote = (seat, extra = {}) => act('demo-service', seat.roomId, 'proposal', { peerId: seat.peerId, productId: 'product-1', levelId: 'gold', hours: 1, requirement: '语音沟通后按约服务', ...extra });
  return { ...app, users, sessions, hall, act, join, poll, quote, advance: value => { now += value; } };
}

test('dispatch hall route and public room list expose only aggregate availability', t => {
  const f = fixture(t);
  assert.deepEqual(parseRoute('#/public/dispatchHall'), { mode: 'public', page: 'overview' });
  f.join('demo-user');
  const listing = f.hall.lobby();
  assert.equal(listing.rooms.length, 5);
  assert.equal(listing.rooms[0].count, 1);
  assert.equal(listing.rooms[0].occupied, true);
  for (const key of ['members', 'messages', 'iceServers', 'userId', 'peerId', 'proposals']) assert.equal(listing[key], undefined);
  assert.ok(!JSON.stringify(listing).includes('demo-user'));
  assert.ok(!JSON.stringify(listing).includes('private'));
});

test('reception lobby supports voice and staff assigns a customer and receptionist to a downstream room', t => {
  const f = fixture(t);
  const customer = f.join('demo-user', 'lobby');
  const service = f.join('demo-service', 'lobby');
  const lobbySnapshot = f.poll('demo-service', service);
  assert.equal(lobbySnapshot.roomId, 'lobby');
  assert.equal(lobbySnapshot.capacity, LOBBY_CAPACITY);
  assert.deepEqual(lobbySnapshot.lobbyCustomers, [{ id: 'demo-user', name: f.users['demo-user'].name }]);
  assert.deepEqual(lobbySnapshot.lobbyStaff, [{ id: 'demo-service', name: f.users['demo-service'].name }]);
  assert.equal(lobbySnapshot.receptionRooms.length, 4);
  const assignment = f.act('demo-service', 'lobby', 'assign', { peerId: service.peerId, customerId: 'demo-user', serviceId: 'demo-service', roomId: 'room-2' });
  assert.deepEqual(assignment, { ok: true, roomId: 'room-2', roomName: '星河接待二厅', customerId: 'demo-user', serviceId: 'demo-service' });
  assert.equal(f.poll('demo-user', customer).assignment.roomId, 'room-2');
  assert.equal(f.poll('demo-service', service).assignment.roomId, 'room-2');
  f.act('demo-user', 'lobby', 'leave', { peerId: customer.peerId });
  f.act('demo-service', 'lobby', 'leave', { peerId: service.peerId });
  assert.equal(f.join('demo-user', 'room-2').customerId, 'demo-user');
  assert.equal(f.join('demo-service', 'room-2').canHost, true);
});

test('lobby remains open to multiple users and escorts while occupied reception rooms stay private', t => {
  const f = fixture(t);
  f.join('demo-user', 'room-1');
  assert.equal(f.hall.lobby().rooms.find(room => room.id === 'room-1').joinable, false);
  assert.equal(f.hall.lobby(f.users.user).rooms.find(room => room.id === 'room-1').joinable, false);
  assert.equal(f.hall.lobby(f.users['demo-escort']).rooms.find(room => room.id === 'lobby').joinable, true);
  const customer = f.join('user', 'lobby');
  const escort = f.join('demo-escort', 'lobby');
  assert.equal(f.poll('demo-escort', escort).members.length, 2);
  assert.equal(f.poll('user', customer).customerId, null);
  f.act('user', 'lobby', 'leave', { peerId: customer.peerId });
  assert.throws(() => f.join('user', 'room-1'), /接待其他用户/);
  f.act('demo-escort', 'lobby', 'leave', { peerId: escort.peerId });
  assert.throws(() => f.join('demo-escort', 'room-1'), /等待客服邀请/);
  const service = f.join('demo-service', 'room-1');
  f.act('demo-service', 'room-1', 'invite', { peerId: service.peerId, userId: 'demo-escort' });
  assert.equal(f.hall.lobby(f.users['demo-escort']).rooms.find(room => room.id === 'room-1').joinable, true);
  assert.equal(f.join('demo-escort', 'room-1').members.length, 3);
});

test('reception lobby admits thirty members and rejects the next join', t => {
  const f = fixture(t);
  for (let i = 0; i < LOBBY_CAPACITY; i++) {
    const account = f.store.accountAction(f.users.admin, null, { username: `lobby_service_${i}`, name: `大厅客服 ${i}`, password: 'Test1234!', role: 'service', active: true, games: [] });
    const token = f.store.login(account.username, 'Test1234!').token;
    f.hall.action(account, 'lobby', 'join', { clientId: randomUUID() }, token);
  }
  const listing = f.hall.lobby();
  const lobby = listing.rooms.find(room => room.id === 'lobby');
  assert.equal(lobby.count, 30);
  assert.equal(lobby.capacity, 30);
  assert.equal(lobby.joinable, false);
  assert.throws(() => f.join('demo-service', 'lobby'), /房间已满/);
});

test('join is idempotent for one tab, reserves one customer and guards other sessions', t => {
  const f = fixture(t), clientId = randomUUID();
  const buyer = f.join('demo-user', 'room-1', clientId);
  assert.equal(f.join('demo-user', 'room-1', clientId).peerId, buyer.peerId);
  assert.throws(() => f.join('demo-user'), /其他窗口/);
  assert.throws(() => f.join('demo-user', 'room-2'), /退出当前/);
  assert.throws(() => f.join('user'), /接待其他用户/);
  assert.throws(() => f.act('user', 'room-1', 'poll', { peerId: buyer.peerId, after: 0, muted: false }), /离开语音房/);
  const otherToken = f.store.login('demo_user', 'Test1234!').token;
  assert.throws(() => f.hall.action(f.users['demo-user'], 'room-1', 'message', { peerId: buyer.peerId, text: '伪造' }, otherToken), /离开语音房/);
  assert.ok(f.join('demo-service').canHost);
});

test('only staff can invite qualified escorts and cross-room signaling is rejected', t => {
  const f = fixture(t), buyer = f.join('demo-user'), service = f.join('demo-service');
  assert.throws(() => f.join('demo-escort'), /等待客服邀请/);
  assert.throws(() => f.act('demo-user', 'room-1', 'invite', { peerId: buyer.peerId, userId: 'demo-escort' }), /只有客服/);
  f.act('demo-service', 'room-1', 'invite', { peerId: service.peerId, userId: 'demo-escort' });
  assert.equal(f.hall.lobby(f.users['demo-escort']).rooms[0].invited, true);
  const notice = f.store.notifications(f.users['demo-escort']).items.find(item => item.kind === 'dispatchHall');
  assert.equal(notice.page, 'dispatchHall');
  const escort = f.join('demo-escort');
  const outsider = f.join('user', 'room-2');
  assert.throws(() => f.act('demo-user', 'room-1', 'signal', { peerId: buyer.peerId, to: outsider.peerId, signal: { type: 'offer', sdp: 'private-sdp' } }), /离开/);
  f.act('demo-user', 'room-1', 'signal', { peerId: buyer.peerId, to: escort.peerId, signal: { type: 'offer', sdp: 'audio-offer' } });
  const snapshot = f.poll('demo-escort', escort);
  assert.equal(snapshot.signals.length, 1);
  assert.equal(snapshot.signals[0].signal.sdp, 'audio-offer');
  assert.equal(f.poll('demo-service', service).signals.length, 0);
  assert.equal(f.poll('demo-escort', escort, { after: snapshot.cursor }).signals.length, 0);
  assert.ok(snapshot.members.every(member => !('token' in member) && !('signals' in member)));
  assert.deepEqual(snapshot.proposals, []);
});

test('room messages are bounded and a departed customer cannot leave data for the next customer', t => {
  const f = fixture(t), buyer = f.join('demo-user'), service = f.join('demo-service');
  f.act('demo-user', 'room-1', 'message', { peerId: buyer.peerId, text: '<script>private need</script>' });
  assert.equal(f.poll('demo-service', service).messages[0].text, '<script>private need</script>');
  assert.throws(() => f.act('demo-user', 'room-1', 'message', { peerId: buyer.peerId, text: 'x'.repeat(501) }), /500/);
  f.act('demo-user', 'room-1', 'leave', { peerId: buyer.peerId });
  assert.throws(() => f.poll('demo-service', service), /离开语音房/);
  assert.deepEqual(f.join('user').messages, []);
});

test('expired seats, revoked sessions and unqualified escorts lose room access', t => {
  const f = fixture(t), buyer = f.join('demo-user');
  f.advance(ROOM_LEASE_MS + 1);
  assert.equal(f.hall.lobby().rooms[0].count, 0);
  assert.throws(() => f.poll('demo-user', buyer), /离开语音房/);
  f.join('demo-user');
  const service = f.join('demo-service');
  f.act('demo-service', 'room-1', 'invite', { peerId: service.peerId, userId: 'demo-escort' });
  const escort = f.join('demo-escort');
  f.store.transaction(f.users.admin, 'account:manage', 'freeze fixture', data => { data.users.find(user => user.id === 'demo-escort').escortFrozen = true; });
  assert.throws(() => f.poll('demo-escort', escort), /离开语音房/);
  f.store.logout(f.sessions['demo-user']);
  assert.equal(f.hall.lobby().rooms[0].count, 0);
});

test('room limits and message rate limits cannot be bypassed with repeated requests', t => {
  const f = fixture(t), buyer = f.join('demo-user');
  for (let i = 0; i < 20; i++) f.act('demo-user', 'room-1', 'message', { peerId: buyer.peerId, text: `消息 ${i}` });
  assert.throws(() => f.act('demo-user', 'room-1', 'message', { peerId: buyer.peerId, text: 'too many' }), error => error.status === 429);
  for (let i = 0; i < 5; i++) {
    const account = f.store.accountAction(f.users.admin, null, { username: `room_service_${i}`, name: `客服 ${i}`, password: 'Test1234!', role: 'service', active: true, games: [] });
    const token = f.store.login(account.username, 'Test1234!').token;
    f.hall.action(account, 'room-1', 'join', { clientId: randomUUID() }, token);
  }
  assert.equal(f.hall.lobby().rooms[0].count, 6);
  assert.throws(() => f.join('demo-service'), /房间已满/);
});

test('staff proposals never debit funds, confirmation is scoped and atomically idempotent', t => {
  const f = fixture(t), buyer = f.join('demo-user'), service = f.join('demo-service');
  const balance = () => f.store.read().customers.find(customer => customer.id === f.users['demo-user'].customerId).balanceCents;
  const before = balance(), proposal = f.quote(service);
  assert.equal(balance(), before);
  assert.throws(() => f.act('demo-user', 'room-1', 'proposal', { peerId: buyer.peerId }), /只有客服/);
  assert.throws(() => f.store.createOrder(f.users.user, { context: 'personal', dispatchProposalId: proposal.id }), error => error.status === 403);
  assert.throws(() => f.store.createOrder(f.users['demo-service'], { context: 'personal', dispatchProposalId: proposal.id }), error => error.status === 403);
  const order = f.store.createOrder(f.users['demo-user'], { context: 'personal', dispatchProposalId: proposal.id, hours: 24, amountCents: 1 });
  assert.equal(order.amountCents, proposal.amountCents);
  assert.equal(order.hours, 1);
  assert.equal(order.customerId, f.users['demo-user'].customerId);
  assert.equal(balance(), before - proposal.amountCents);
  assert.equal(f.store.createOrder(f.users['demo-user'], { context: 'personal', dispatchProposalId: proposal.id }).id, order.id);
  assert.equal(balance(), before - proposal.amountCents);
  assert.equal(f.store.read().ledger.filter(item => item.source === order.id && item.label === '订单消费').length, 1);
  assert.equal(f.hall.lobby(f.users['demo-user']).proposals[0].status, 'confirmed');
});

test('replaced, expired or repriced proposals fail without charging the customer', t => {
  const f = fixture(t); f.join('demo-user'); const service = f.join('demo-service');
  const first = f.quote(service), second = f.quote(service, { hours: 2 });
  const confirm = id => f.store.createOrder(f.users['demo-user'], { context: 'personal', dispatchProposalId: id });
  assert.throws(() => confirm(first.id), /拟单已更新/);
  f.store.transaction(f.users.admin, 'account:manage', 'change price', data => { data.products.find(item => item.id === 'product-1').version = 99; });
  assert.throws(() => confirm(second.id), /配置已更新/);
  const third = f.quote(service);
  f.store.transaction(f.users.admin, 'account:manage', 'expire quote', data => { data.dispatchProposals.find(item => item.id === third.id).createdAt = new Date(Date.now() - 31 * 60000).toISOString(); });
  assert.throws(() => confirm(third.id), /超过 30 分钟/);
  assert.ok(!f.store.read().dispatchProposals.some(item => item.orderId));
});

test('proposal confirmation still requires real-name verification and sufficient balance', t => {
  const f = fixture(t); f.join('user'); const service = f.join('demo-service');
  const proposal = f.quote(service);
  const confirm = () => f.store.createOrder(f.users.user, { context: 'personal', dispatchProposalId: proposal.id });
  assert.throws(confirm, /实名/);
  verifyFixtureUsers(f.store, ['user-demo']);
  f.store.transaction(f.users.admin, 'account:manage', 'balance fixture', data => { data.customers.find(item => item.id === f.users.user.customerId).balanceCents = 0; });
  assert.throws(confirm, /余额不足/);
  assert.equal(f.store.read().dispatchProposals[0].status, 'pending');
});

test('HTTP endpoints enforce login, JSON, origin and same-origin microphone permission', async t => {
  const f = fixture(t); f.server.listen(0, '127.0.0.1'); await once(f.server, 'listening');
  const base = `http://127.0.0.1:${f.server.address().port}`;
  const request = (path, body, headers = {}) => fetch(base + path, { ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }), headers: { 'Content-Type': 'application/json', Cookie: `club_session=${f.sessions['demo-user']}`, ...headers } });
  assert.equal((await fetch(base + '/api/public/dispatch')).status, 200);
  assert.equal((await fetch(base + '/api/dispatch')).status, 401);
  assert.equal((await request('/api/dispatch/rooms/room-1/join', { clientId: randomUUID() }, { Cookie: '' })).status, 401);
  assert.equal((await request('/api/dispatch/rooms/room-1/join', { clientId: randomUUID() }, { Origin: 'https://outside.example' })).status, 403);
  const joined = await request('/api/dispatch/rooms/room-1/join', { clientId: randomUUID() });
  assert.equal(joined.status, 200);
  assert.match(joined.headers.get('permissions-policy'), /microphone=\(self\)/);
  const seat = await joined.json();
  assert.equal(seat.members[0].muted, true);
  assert.equal((await request('/api/dispatch/rooms/room-1/signal', { peerId: seat.peerId, to: 'fake', signal: { type: 'offer', sdp: 'x' } })).status, 409);
});

test('ICE configuration validates schemes and strips unrelated options', () => {
  assert.deepEqual(parseIceServers(), []);
  assert.throws(() => parseIceServers('bad'), /JSON/);
  assert.throws(() => parseIceServers('[{"urls":"https://wrong.example"}]'), /配置无效/);
  assert.deepEqual(parseIceServers('[{"urls":["stun:stun.example.test"],"extra":"drop"}]'), [{ urls: ['stun:stun.example.test'] }]);
});
