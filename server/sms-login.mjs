import { createHash, randomInt, randomUUID } from 'node:crypto';

function normalizePhone(value) {
  if (typeof value !== 'string') return '';
  const phone = value.trim();
  return /^1[3-9]\d{9}$/.test(phone) ? phone : '';
}

function digest(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function loginPhoneForUser(user) {
  // Profile contact details and usernames are not proof of phone ownership.
  return user?.loginPhoneVerified === true ? normalizePhone(user.loginPhone) : '';
}

export class SmsLoginChallenges {
  constructor({ production = false, ttlMs = 5 * 60 * 1000, retryMs = 60 * 1000, maxAttempts = 5, clock = Date.now } = {}) {
    this.production = production;
    this.ttlMs = ttlMs;
    this.retryMs = retryMs;
    this.maxAttempts = maxAttempts;
    this.clock = clock;
    this.challenges = new Map();
    this.sends = new Map();
  }

  cleanup(now = this.clock()) {
    for (const [id, item] of this.challenges) if (item.expiresAt <= now) this.challenges.delete(id);
    for (const [phone, sentAt] of this.sends) if (sentAt + this.retryMs <= now) this.sends.delete(phone);
  }

  issue(phone, findUser) {
    const normalized = normalizePhone(phone);
    if (!normalized) throw Object.assign(new Error('请输入有效的手机号'), { status: 400 });
    if (this.production) throw Object.assign(new Error('短信服务暂未配置'), { status: 503 });
    const user = findUser(normalized);
    if (!user?.active) throw Object.assign(new Error('该手机号未绑定有效账号，请使用账号密码登录'), { status: 404 });
    const now = this.clock();
    this.cleanup(now);
    const sentAt = this.sends.get(normalized);
    if (sentAt !== undefined) {
      throw Object.assign(new Error('验证码发送过于频繁，请稍后再试'), { status: 429, retryAfter: Math.ceil((sentAt + this.retryMs - now) / 1000) });
    }
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    const requestId = randomUUID();
    for (const [id, item] of this.challenges) if (item.phone === normalized) this.challenges.delete(id);
    this.sends.set(normalized, now);
    this.challenges.set(requestId, { phone: normalized, userId: user.id, codeHash: digest(code), createdAt: now, expiresAt: now + this.ttlMs, attempts: 0 });
    return { challengeId: requestId, expiresIn: Math.ceil(this.ttlMs / 1000), retryAfter: Math.ceil(this.retryMs / 1000), demoCode: code };
  }

  verify({ phone, code, challengeId: requestId }, findUser) {
    if (this.production) throw Object.assign(new Error('短信服务暂未配置'), { status: 503 });
    const normalized = normalizePhone(phone);
    const challenge = this.challenges.get(String(requestId || ''));
    const now = this.clock();
    this.cleanup(now);
    if (!normalized || !challenge || challenge.phone !== normalized || challenge.expiresAt <= now) throw Object.assign(new Error('验证码无效或已过期'), { status: 401 });
    if (challenge.attempts >= this.maxAttempts) { this.challenges.delete(String(requestId)); throw Object.assign(new Error('验证码尝试次数过多，请重新获取'), { status: 401 }); }
    challenge.attempts++;
    if (digest(String(code || '')) !== challenge.codeHash) {
      if (challenge.attempts >= this.maxAttempts) this.challenges.delete(String(requestId));
      throw Object.assign(new Error('验证码错误'), { status: 401 });
    }
    this.challenges.delete(String(requestId));
    const user = findUser(normalized);
    if (!user || user.id !== challenge.userId || !user.active) throw Object.assign(new Error('该手机号未绑定有效账号'), { status: 401 });
    return user;
  }
}

export { normalizePhone };
