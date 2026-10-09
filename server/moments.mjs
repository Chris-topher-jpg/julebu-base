import { randomUUID } from 'node:crypto';
import { requireThat } from './club.mjs';

const IMAGE_LIMIT = 5 * 1024 * 1024;
const VIDEO_LIMIT = 25 * 1024 * 1024;
export const MOMENT_UPLOAD_LIMIT = VIDEO_LIMIT;
const MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm']);

function validMedia(bytes, mime) {
  if (mime === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (mime === 'image/webp') return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (mime === 'image/gif') return ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6));
  if (mime === 'video/mp4') return bytes.toString('ascii', 4, 8) === 'ftyp';
  if (mime === 'video/webm') return bytes.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex'));
  return false;
}

export class Moments {
  constructor(store) {
    this.store = store;
    this.db = store.db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS moments_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS moments_media (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, post_id INTEGER, mime TEXT NOT NULL, bytes BLOB NOT NULL, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS moments_media_post ON moments_media(post_id);
      CREATE TABLE IF NOT EXISTS moments_likes (post_id INTEGER NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (post_id, user_id));
      CREATE TABLE IF NOT EXISTS moments_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL, user_id TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS moments_comments_post ON moments_comments(post_id, id);
    `);
    this.cleanup();
  }
  cleanup() {
    this.db.prepare('DELETE FROM moments_media WHERE post_id IS NULL AND created_at < ?').run(Date.now() - 24 * 3600000);
  }
  actor(user) {
    const actor = user && this.store.read().users.find(item => item.id === user.id && item.active);
    requireThat(actor, '登录已失效，请重新登录', 401);
    return actor;
  }
  author(id) {
    const user = this.store.read().users.find(item => item.id === id);
    return { id, name: user?.name || '已停用用户', avatar: user?.avatar || '' };
  }
  post(id) {
    const post = this.db.prepare('SELECT id, user_id, body, created_at FROM moments_posts WHERE id=?').get(id);
    requireThat(post, '动态不存在', 404);
    return post;
  }
  view(post, viewer) {
    const media = this.db.prepare('SELECT id, mime FROM moments_media WHERE post_id=? ORDER BY rowid').all(post.id)
      .map(item => ({ id: item.id, type: item.mime.startsWith('video/') ? 'video' : 'image', url: `/api/public/moments/media/${item.id}` }));
    const comments = this.db.prepare('SELECT id, user_id, body, created_at FROM moments_comments WHERE post_id=? ORDER BY id DESC LIMIT 3').all(post.id).reverse()
      .map(item => ({ id: item.id, author: this.author(item.user_id), text: item.body, createdAt: item.created_at }));
    return { id: post.id, author: this.author(post.user_id), text: post.body, createdAt: post.created_at, media,
      likes: this.db.prepare('SELECT COUNT(*) AS count FROM moments_likes WHERE post_id=?').get(post.id).count,
      liked: Boolean(viewer && this.db.prepare('SELECT 1 FROM moments_likes WHERE post_id=? AND user_id=?').get(post.id, viewer.id)),
      commentCount: this.db.prepare('SELECT COUNT(*) AS count FROM moments_comments WHERE post_id=?').get(post.id).count,
      comments, canDelete: Boolean(viewer && (viewer.id === post.user_id || viewer.role === 'admin')) };
  }
  list(viewer, { before = '', mine = false } = {}) {
    const cursor = before === '' ? Number.MAX_SAFE_INTEGER : Number(before);
    requireThat(Number.isSafeInteger(cursor) && cursor > 0, '分页参数无效');
    const authorId = mine ? viewer?.id || '' : null;
    const rows = this.db.prepare('SELECT id, user_id, body, created_at FROM moments_posts WHERE id < ? AND (? IS NULL OR user_id=?) ORDER BY id DESC LIMIT 21').all(cursor, authorId, authorId);
    const hasMore = rows.length > 20;
    const posts = rows.slice(0, 20);
    return { posts: posts.map(post => this.view(post, viewer)), nextCursor: hasMore ? posts.at(-1).id : null };
  }
  media(id) {
    const row = this.db.prepare('SELECT mime, bytes FROM moments_media WHERE id=? AND post_id IS NOT NULL').get(id);
    requireThat(row, '媒体不存在', 404);
    return { mime: row.mime, bytes: Buffer.from(row.bytes) };
  }
  upload(user, mime, bytes) {
    const actor = this.actor(user);
    requireThat(MEDIA_TYPES.has(mime), '仅支持 JPG、PNG、WebP、GIF、MP4 或 WebM', 415);
    requireThat(bytes.length > 0 && bytes.length <= (mime.startsWith('video/') ? VIDEO_LIMIT : IMAGE_LIMIT), '文件大小超出限制', 413);
    requireThat(validMedia(bytes, mime), '文件内容与格式不符');
    const pending = this.db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(length(bytes)), 0) AS total FROM moments_media WHERE user_id=? AND post_id IS NULL').get(actor.id);
    requireThat(pending.count < 8 && pending.total + bytes.length <= 50 * 1024 * 1024, '待发布文件过多，请稍后重试', 429);
    const id = randomUUID();
    this.db.prepare('INSERT INTO moments_media (id,user_id,post_id,mime,bytes,created_at) VALUES (?,?,NULL,?,?,?)').run(id, actor.id, mime, bytes, Date.now());
    return { id, type: mime.startsWith('video/') ? 'video' : 'image' };
  }
  create(user, input) {
    const actor = this.actor(user);
    const body = typeof input.text === 'string' ? input.text.trim() : '';
    const ids = input.mediaIds;
    requireThat(body.length <= 1000, '动态文字最多 1000 字');
    requireThat(Array.isArray(ids) && ids.length <= 4 && ids.every(id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id)) && new Set(ids).size === ids.length, '附件无效');
    requireThat(body || ids.length, '请输入文字或添加图片、视频');
    const media = ids.map(id => this.db.prepare('SELECT id,mime FROM moments_media WHERE id=? AND user_id=? AND post_id IS NULL').get(id, actor.id));
    requireThat(media.every(Boolean), '附件不存在或已被使用', 409);
    requireThat(!media.some(item => item.mime.startsWith('video/')) || media.length === 1, '视频动态只能添加一个视频');
    requireThat(this.db.prepare('SELECT COUNT(*) AS count FROM moments_posts WHERE user_id=? AND created_at>?').get(actor.id, Date.now() - 60000).count < 3, '发布太频繁，请稍后再试', 429);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = this.db.prepare('INSERT INTO moments_posts (user_id,body,created_at) VALUES (?,?,?)').run(actor.id, body, Date.now());
      for (const id of ids) this.db.prepare('UPDATE moments_media SET post_id=? WHERE id=?').run(result.lastInsertRowid, id);
      this.db.exec('COMMIT');
      return this.view(this.post(Number(result.lastInsertRowid)), actor);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  like(user, id) {
    const actor = this.actor(user), post = this.post(id);
    const exists = this.db.prepare('SELECT 1 FROM moments_likes WHERE post_id=? AND user_id=?').get(id, actor.id);
    if (exists) this.db.prepare('DELETE FROM moments_likes WHERE post_id=? AND user_id=?').run(id, actor.id);
    else this.db.prepare('INSERT INTO moments_likes VALUES (?,?)').run(id, actor.id);
    return this.view(post, actor);
  }
  comments(id) {
    this.post(id);
    return { comments: this.db.prepare('SELECT id,user_id,body,created_at FROM moments_comments WHERE post_id=? ORDER BY id DESC LIMIT 100').all(id).reverse()
      .map(item => ({ id: item.id, author: this.author(item.user_id), text: item.body, createdAt: item.created_at })) };
  }
  comment(user, id, input) {
    const actor = this.actor(user), post = this.post(id);
    const body = typeof input.text === 'string' ? input.text.trim() : '';
    requireThat(body.length > 0 && body.length <= 300, '评论最多 300 字');
    requireThat(this.db.prepare('SELECT COUNT(*) AS count FROM moments_comments WHERE user_id=? AND created_at>?').get(actor.id, Date.now() - 60000).count < 10, '评论太频繁，请稍后再试', 429);
    this.db.prepare('INSERT INTO moments_comments (post_id,user_id,body,created_at) VALUES (?,?,?,?)').run(id, actor.id, body, Date.now());
    return this.view(post, actor);
  }
  delete(user, id) {
    const actor = this.actor(user), post = this.post(id);
    requireThat(post.user_id === actor.id || actor.role === 'admin', '只能删除自己的动态', 403);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM moments_comments WHERE post_id=?').run(id);
      this.db.prepare('DELETE FROM moments_likes WHERE post_id=?').run(id);
      this.db.prepare('DELETE FROM moments_media WHERE post_id=?').run(id);
      this.db.prepare('DELETE FROM moments_posts WHERE id=?').run(id);
      this.db.exec('COMMIT');
      return { ok: true };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}
