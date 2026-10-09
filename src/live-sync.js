// One poll at a time. A response belongs to the exact account/view and
// snapshot that requested it, including across logout and local mutations.
export function createLiveSync({ context, request, receive, status, expired, interval = 3000 }) {
  let timer, running = false, active = false, lifetime = 0;
  const matches = (a, b) => a && b && a.userId === b.userId && a.mode === b.mode && a.generation === b.generation && a.revision === b.revision && !b.busy;
  async function poll() {
    const before = context(), turn = lifetime;
    if (!active || running || !before || before.busy) return;
    running = true;
    try {
      const result = await request(`/sync?since=${encodeURIComponent(before.revision ?? 0)}&context=${before.mode === 'management' ? 'management' : 'personal'}`);
      if (!active || turn !== lifetime || !matches(before, context())) return;
      const responseUser = result.userId ?? result.workspace?.user.id;
      if (responseUser && responseUser !== before.userId) { expired(); return; }
      receive(result);
      status('已同步');
    } catch (error) {
      if (!active || turn !== lifetime || !matches(before, context())) return;
      if (error.status === 401) expired();
      else status('连接中断，正在重试');
    } finally { running = false; }
  }
  return {
    poll,
    start() {
      if (active) return;
      active = true; lifetime++;
      status('正在同步');
      timer = setInterval(poll, interval);
      void poll();
    },
    stop() { active = false; lifetime++; clearInterval(timer); },
  };
}
