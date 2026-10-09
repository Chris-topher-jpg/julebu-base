const validPhone = value => /^1[3-9]\d{9}$/.test(value);

// The dialog owns OTP requests so a closed or changed form cannot receive them.
export function bindAuth({ modal, form, api, authenticate }) {
  const el = id => form.querySelector(`#${id}`);
  const phoneInput = el('loginPhone'), codeInput = el('loginCode');
  const send = el('authSendCode'), submit = el('authSubmit'), error = el('loginError');
  const demo = el('authDemoCode'), phoneToggle = el('authPhoneToggle'), registerToggle = el('authModeToggle');
  const retries = new Map();
  let mode = 'password', generation = 0, challenge = null, timer = null, sending = false, busy = false;
  const phone = () => phoneInput.value.trim();
  const active = token => token === generation && modal.isConnected && modal.open;
  const stopTimer = () => { clearTimeout(timer); timer = null; };
  const clearChallenge = () => { challenge = null; codeInput.value = ''; demo.textContent = ''; demo.hidden = true; };

  function updateSend() {
    stopTimer();
    const seconds = Math.max(0, Math.ceil(((retries.get(phone())?.until || 0) - Date.now()) / 1000));
    send.disabled = mode !== 'phone' || busy || sending || seconds > 0;
    send.textContent = sending ? '正在发送…' : seconds ? `${seconds} 秒后重发` : '获取验证码';
    if (mode === 'phone' && modal.open && modal.isConnected && seconds > 0) timer = setTimeout(updateSend, 1000);
  }
  function syncFields() {
    const registering = mode === 'register', phoneMode = mode === 'phone';
    for (const [field, input, visible] of [
      ['authUsernameField', 'loginUsername', !phoneMode], ['authNameField', 'registerName', registering],
      ['passwordField', 'loginPassword', !phoneMode], ['authPhoneField', 'loginPhone', phoneMode], ['codeField', 'loginCode', phoneMode],
    ]) {
      el(field).hidden = !visible;
      el(input).disabled = !visible || busy;
      el(input).required = visible;
    }
    el('authTitle').textContent = registering ? '创建账号' : phoneMode ? '手机验证码登录' : '欢迎回来';
    el('authDescription').textContent = registering ? '注册后即可选择服务、跟踪订单和联系客服' : phoneMode ? '使用账号已绑定的手机号登录' : '登录后下单，查看订单和售后';
    el('loginPassword').minLength = registering ? 8 : 1;
    el('loginPassword').autocomplete = registering ? 'new-password' : 'current-password';
    el('loginPassword').placeholder = registering ? '设置至少 8 位密码' : '请输入密码';
    submit.disabled = busy || sending;
    submit.textContent = busy ? (registering ? '正在创建账号…' : '正在登录…') : registering ? '注册并登录' : '登录';
    phoneToggle.hidden = registering;
    phoneToggle.disabled = registering || busy;
    phoneToggle.textContent = phoneMode ? '账号密码登录' : '手机验证码登录';
    registerToggle.disabled = busy;
    registerToggle.textContent = registering ? '已有账号？返回登录' : '还没有账号？立即注册';
    el('authPhoneTip').hidden = !phoneMode;
    updateSend();
  }
  function setMode(next) {
    generation++; mode = next; busy = false; sending = false;
    clearChallenge(); error.textContent = ''; syncFields();
    if (modal.open) (mode === 'phone' ? phoneInput : el('loginUsername')).focus();
  }
  function invalidate() {
    generation++; busy = false; sending = false; stopTimer(); clearChallenge();
  }
  const close = () => { invalidate(); modal.close(); };
  const open = event => {
    event?.preventDefault();
    if (!modal.isConnected) return;
    setMode(event?.currentTarget?.classList.contains('register-link') ? 'register' : 'password');
    if (!modal.open) modal.showModal();
    el('loginUsername').focus();
  };
  form.querySelector('[data-action="closeLogin"]').onclick = close;
  modal.addEventListener('close', invalidate);
  modal.addEventListener('cancel', invalidate);
  modal.addEventListener('click', event => { if (event.target === modal) close(); });
  phoneToggle.onclick = () => setMode(mode === 'phone' ? 'password' : 'phone');
  registerToggle.onclick = () => setMode(mode === 'register' ? 'password' : 'register');
  phoneInput.addEventListener('input', () => {
    generation++; sending = false; clearChallenge(); error.textContent = ''; syncFields();
  });
  send.onclick = async () => {
    if (send.disabled || busy || mode !== 'phone') return;
    const requestedPhone = phone();
    if (!validPhone(requestedPhone)) { error.textContent = '请输入有效的 11 位手机号'; phoneInput.focus(); return; }
    const token = ++generation;
    const attempt = { until: Date.now() + 60000 };
    retries.set(requestedPhone, attempt);
    clearChallenge(); error.textContent = ''; sending = true; syncFields();
    try {
      const result = await api('/login/code', { phone: requestedPhone });
      if (retries.get(requestedPhone) === attempt) attempt.until = Date.now() + Math.max(60, Number(result.retryAfter) || 60) * 1000;
      if (!active(token) || mode !== 'phone' || phone() !== requestedPhone) return;
      if (!result.challengeId) throw new Error('验证码发送失败，请稍后重试');
      challenge = { id: result.challengeId, phone: requestedPhone, expiresAt: Date.now() + (Number(result.expiresIn) || 300) * 1000 };
      if (result.demoCode) {
        demo.textContent = `本地测试验证码：${result.demoCode}（不会发送短信）`;
        demo.hidden = false;
      }
      codeInput.focus();
    } catch (cause) {
      if (cause.status !== 429 && retries.get(requestedPhone) === attempt) retries.delete(requestedPhone);
      if (active(token) && mode === 'phone' && phone() === requestedPhone) error.textContent = cause.message || '验证码发送失败，请稍后重试';
    } finally {
      if (active(token)) { sending = false; syncFields(); }
    }
  };
  form.onsubmit = async event => {
    event.preventDefault();
    if (busy || sending || !modal.open || !form.reportValidity()) return;
    let path, body;
    if (mode === 'phone') {
      if (!validPhone(phone())) { error.textContent = '请输入有效的 11 位手机号'; return; }
      if (!/^\d{6}$/.test(codeInput.value.trim())) { error.textContent = '请输入 6 位手机验证码'; return; }
      if (!challenge || challenge.phone !== phone()) { error.textContent = '请先获取当前手机号的验证码'; return; }
      if (challenge.expiresAt <= Date.now()) { clearChallenge(); error.textContent = '验证码已过期，请重新获取'; return; }
      path = '/login/phone'; body = { phone: phone(), code: codeInput.value.trim(), challengeId: challenge.id };
    } else {
      path = mode === 'register' ? '/register' : '/login';
      body = { username: el('loginUsername').value.trim(), password: el('loginPassword').value, name: el('registerName').value.trim() };
    }
    const token = ++generation;
    busy = true; error.textContent = ''; syncFields();
    try { await authenticate(path, body, () => active(token)); }
    catch (cause) { if (active(token)) error.textContent = cause.message || '登录失败，请稍后重试'; }
    finally { if (active(token)) { busy = false; syncFields(); } }
  };
  syncFields();
  return { open, close };
}
