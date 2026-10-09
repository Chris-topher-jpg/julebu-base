import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createClubServer } from '../server.mjs';
import { Moments } from '../server/moments.mjs';
import { parseRoute } from '../src/routes.js';

const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000000020001e221bc330000000049454e44ae426082', 'hex');

test('moments store publishes media, exposes public interactions, and enforces ownership', () => {
  const app = createClubServer({ database: ':memory:', production: false, publicOrigin: '' });
  try {
    const moments = new Moments(app.store);
    const first = app.store.read().users.find(user => user.id === 'demo-user');
    const second = app.store.read().users.find(user => user.id === 'user-demo');
    const media = moments.upload(first, 'image/png', png);
    const post = moments.create(first, { text: '今天和队友开黑', mediaIds: [media.id] });
    assert.equal(moments.list(second).posts[0].text, '今天和队友开黑');
    assert.equal(moments.like(second, post.id).likes, 1);
    assert.equal(moments.comment(second, post.id, { text: '下次一起' }).commentCount, 1);
    assert.throws(() => moments.delete(second, post.id), { status: 403 });
    assert.deepEqual(moments.media(media.id).bytes, png);
    assert.deepEqual(moments.delete(first, post.id), { ok: true });
    assert.equal(moments.list(second).posts.length, 0);
  } finally { app.store.close(); }
});

test('moments HTTP routes allow anonymous browsing and byte ranges', async t => {
  const app = createClubServer({ database: ':memory:', production: false, publicOrigin: '' });
  t.after(() => app.server.listening ? app.close() : app.store.close());
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const port = app.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const actor = app.store.read().users.find(user => user.id === 'demo-user');
  const token = app.store.login(actor.username, 'Test1234!').token;
  const get = path => fetch(base + path, { headers: { Cookie: `club_session=${token}` } });
  assert.deepEqual(parseRoute('#/public/moments'), { mode: 'public', page: 'moments' });
  assert.equal((await fetch(base + '/api/public/moments')).status, 200);
  assert.equal((await fetch(base + '/api/moments/media', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png })).status, 401);
  const upload = await fetch(base + '/api/moments/media', { method: 'POST', headers: { 'Content-Type': 'image/png', Cookie: `club_session=${token}` }, body: png });
  assert.equal(upload.status, 201);
  const media = await upload.json();
  const create = await fetch(base + '/api/moments', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `club_session=${token}` }, body: JSON.stringify({ text: 'HTTP 动态', mediaIds: [media.id] }) });
  assert.equal(create.status, 201);
  const post = await create.json();
  const listing = await (await get('/api/public/moments')).json();
  assert.equal(listing.posts[0].id, post.id);
  const mediaResponse = await get(post.media[0].url);
  assert.equal(mediaResponse.headers.get('content-type'), 'image/png');
  assert.equal(mediaResponse.headers.get('accept-ranges'), 'bytes');
  const range = await fetch(base + post.media[0].url, { headers: { Range: 'bytes=0-7' } });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 8);
});
