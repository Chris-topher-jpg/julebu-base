import { escapeHtml as e, icon } from './ui.js';
import { requestJson } from './request.js';

const MAX_IMAGES = 4;
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const videoTypes = new Set(['video/mp4', 'video/webm']);
const formatDate = value => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const avatar = author => author.avatar ? `<img src="${e(author.avatar)}" alt="">` : e((author.name || '用')[0]);

export function momentsMarkup() {
  return `<section class="moments-page" aria-label="动态广场">
    <div class="moments-heading"><div><p class="moments-eyebrow">星河游戏俱乐部 / 社区动态</p><h1>动态广场</h1><p>看看大家的组队日常、精彩时刻和新鲜分享。</p></div><button class="moments-refresh" type="button" data-moment="refresh" aria-label="刷新动态">${icon('trend', 17)} 刷新</button></div>
    <div class="moments-layout"><main class="moments-feed"><div data-moments-composer-slot></div><div data-moments-feed><div class="moments-loading">正在加载动态…</div></div></main><aside class="moments-side"><div class="moments-side-block"><strong>社区动态</strong><p>分享你的游戏时刻，让更多队友认识你。</p><span>${icon('users', 16)} 所有人都可以浏览</span><span>${icon('message', 16)} 文字、图片和视频</span></div></aside></div>
  </section>`;
}

export function mountMoments(root, { workspace, login, toast }) {
  let disposed = false, before = '', loading = false, posting = false;
  const objectUrls = new Set();
  const currentUser = workspace?.user;
  const feed = root.querySelector('[data-moments-feed]');
  const composerSlot = root.querySelector('[data-moments-composer-slot]');
  const fail = error => { if (!disposed) toast?.(error.message || '动态暂时无法加载'); };
  const api = (path, options = {}) => requestJson(path, { credentials: 'same-origin', ...options }, { timeout: options.body instanceof Blob ? 60000 : 15000 });
  const revoke = () => { for (const url of objectUrls) URL.revokeObjectURL(url); objectUrls.clear(); };
  const mediaMarkup = item => item.type === 'video'
    ? `<video class="moment-video" controls preload="metadata" src="${e(item.url)}"></video>`
    : `<img class="moment-image" loading="lazy" src="${e(item.url)}" alt="动态图片">`;
  const postMarkup = post => `<article class="moment-card" data-post-id="${post.id}"><header class="moment-card-head"><span class="moment-avatar">${avatar(post.author)}</span><div><strong>${e(post.author.name)}</strong><time>${e(formatDate(post.createdAt))}</time></div>${post.canDelete ? `<button class="moment-more" type="button" data-moment="delete" data-id="${post.id}" aria-label="删除动态">${icon('x', 17)}</button>` : ''}</header>${post.text ? `<p class="moment-text">${e(post.text).replaceAll('\n', '<br>')}</p>` : ''}${post.media?.length ? `<div class="moment-media ${post.media.length > 1 ? 'is-grid' : ''}">${post.media.map(mediaMarkup).join('')}</div>` : ''}<footer class="moment-actions"><button type="button" class="moment-action ${post.liked ? 'is-liked' : ''}" data-moment="like" data-id="${post.id}">${icon('heart', 17)} <span>${post.likes || 0}</span></button><button type="button" class="moment-action" data-moment="comments" data-id="${post.id}">${icon('message', 17)} <span>${post.commentCount || 0}</span></button></footer><div class="moment-comments" data-comments>${(post.comments || []).map(comment => `<p><strong>${e(comment.author.name)}</strong>${e(comment.text)}</p>`).join('')}${post.commentCount > (post.comments || []).length ? `<button class="moment-more-comments" type="button" data-moment="comments" data-id="${post.id}">查看全部评论</button>` : ''}</div>${currentUser ? `<form class="moment-comment-form" data-comment-form="${post.id}"><input name="text" maxlength="300" placeholder="说点什么…"><button type="submit" aria-label="发表评论">${icon('arrow', 16)}</button></form>` : ''}</article>`;
  const emptyMarkup = () => `<div class="moments-empty"><span>${icon('message', 30)}</span><strong>还没有动态</strong><p>成为第一个分享游戏时刻的人吧。</p></div>`;
  const render = posts => { feed.innerHTML = posts.length ? posts.map(postMarkup).join('') : emptyMarkup(); if (before) feed.insertAdjacentHTML('beforeend', '<button class="moments-load-more" type="button" data-moment="more">加载更多</button>'); bindFeed(); };
  async function load(reset = false) {
    if (loading || disposed) return;
    loading = true;
    if (reset) { before = ''; feed.innerHTML = '<div class="moments-loading">正在加载动态…</div>'; }
    try {
      const result = await api(`/api/public/moments${before ? `?before=${encodeURIComponent(before)}` : ''}`);
      if (disposed) return;
      before = result.nextCursor;
      if (reset) render(result.posts || []); else { const more = feed.querySelector('.moments-load-more'); more?.remove(); feed.insertAdjacentHTML('beforeend', (result.posts || []).map(postMarkup).join('')); if (before) feed.insertAdjacentHTML('beforeend', '<button class="moments-load-more" type="button" data-moment="more">加载更多</button>'); bindFeed(); }
    } catch (error) { if (reset) feed.innerHTML = `<div class="moments-empty"><strong>动态加载失败</strong><p>${e(error.message)}</p><button type="button" data-moment="refresh">重新加载</button></div>`; else fail(error); }
    finally { loading = false; }
  }
  function bindFeed() {
    feed.querySelectorAll('[data-moment="like"]').forEach(button => button.onclick = async () => { try { const post = await api(`/api/moments/${button.dataset.id}/like`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); const card = button.closest('.moment-card'); button.classList.toggle('is-liked', post.liked); button.querySelector('span').textContent = post.likes; } catch (error) { if (error.status === 401) login?.(); else fail(error); } });
    feed.querySelectorAll('[data-moment="delete"]').forEach(button => button.onclick = async () => { if (!confirm('确定删除这条动态吗？')) return; try { await api(`/api/moments/${button.dataset.id}/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); button.closest('.moment-card')?.remove(); } catch (error) { fail(error); } });
    feed.querySelectorAll('[data-moment="comments"]').forEach(button => button.onclick = async () => { const card = button.closest('.moment-card'); try { const result = await api(`/api/public/moments/${button.dataset.id}/comments`); card.querySelector('[data-comments]').innerHTML = result.comments.map(comment => `<p><strong>${e(comment.author.name)}</strong>${e(comment.text)}</p>`).join(''); } catch (error) { fail(error); } });
    feed.querySelectorAll('.moment-comment-form').forEach(form => form.onsubmit = async event => { event.preventDefault(); const input = form.elements.text; const text = input.value.trim(); if (!text) return; try { const post = await api(`/api/moments/${form.dataset.commentForm}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }); form.closest('.moment-card').outerHTML = postMarkup(post); bindFeed(); } catch (error) { if (error.status === 401) login?.(); else fail(error); } });
    feed.querySelector('[data-moment="more"]')?.addEventListener('click', () => load(false));
  }
  function composerMarkup() { return currentUser ? `<form class="moment-composer" data-moment-composer><div class="moment-composer-head"><span class="moment-avatar">${avatar({ name: currentUser.name || currentUser.username, avatar: currentUser.avatar })}</span><strong>分享新动态</strong></div><textarea name="text" maxlength="1000" placeholder="分享此刻的游戏心情…"></textarea><div class="moment-upload-row"><label class="moment-upload"><input type="file" name="media" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm" multiple>${icon('plus', 17)} 添加图片或视频</label><span>图片最多 4 张，视频只能上传 1 段</span><button type="submit" class="moment-publish">发布</button></div><div class="moment-preview" data-preview></div><p class="moment-form-error" data-form-error></p></form>` : `<div class="moment-login-prompt"><span>${icon('message', 20)}</span><p><strong>登录后分享你的动态</strong><small>发布文字、图片或视频，与俱乐部成员交流。</small></p><button type="button" data-moment="login">登录 / 注册</button></div>`; }
  composerSlot.innerHTML = composerMarkup();
  const composer = composerSlot.querySelector('[data-moment-composer]');
  const preview = composer?.querySelector('[data-preview]');
  const fileInput = composer?.elements.media;
  fileInput?.addEventListener('change', () => { revoke(); preview.innerHTML = ''; const files = [...fileInput.files]; const hasVideo = files.some(file => videoTypes.has(file.type)); const valid = files.length <= MAX_IMAGES && (!hasVideo || files.length === 1) && files.every(file => imageTypes.has(file.type) || videoTypes.has(file.type)); if (!valid) { preview.innerHTML = '<p>请选择最多 4 张图片，或 1 段 MP4/WebM 视频。</p>'; fileInput.value = ''; return; } files.forEach(file => { const url = URL.createObjectURL(file); objectUrls.add(url); preview.insertAdjacentHTML('beforeend', videoTypes.has(file.type) ? `<video controls src="${url}"></video>` : `<img src="${url}" alt="待上传图片">`); }); });
  composer?.addEventListener('submit', async event => { event.preventDefault(); if (posting) return; const errorSlot = composer.querySelector('[data-form-error]'); errorSlot.textContent = ''; const files = [...(fileInput.files || [])]; if (!composer.elements.text.value.trim() && !files.length) { errorSlot.textContent = '请输入文字或添加附件'; return; } posting = true; composer.querySelector('.moment-publish').disabled = true; try { const mediaIds = []; for (const file of files) { const uploaded = await api('/api/moments/media', { method: 'POST', headers: { 'Content-Type': file.type }, body: file }); mediaIds.push(uploaded.id); } await api('/api/moments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: composer.elements.text.value, mediaIds }) }); composer.elements.text.value = ''; fileInput.value = ''; revoke(); preview.innerHTML = ''; await load(true); toast?.('动态已发布'); } catch (error) { errorSlot.textContent = error.message; } finally { posting = false; composer.querySelector('.moment-publish').disabled = false; } });
  composerSlot.querySelector('[data-moment="login"]')?.addEventListener('click', login);
  root.querySelector('[data-moment="refresh"]')?.addEventListener('click', () => load(true));
  load(true);
  return () => { disposed = true; revoke(); };
}
