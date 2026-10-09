// One status control for all roles and workspaces. A status change does not
// replace the page, so profile drafts and other in-progress forms survive.
export function presenceButtonMarkup(user = {}) {
  const online = Boolean(user.online);
  return `<button type="button" class="presence-toggle" data-action="online" data-presence-control role="switch" aria-label="在线状态" aria-checked="${online}" title="${online ? '当前在线，点击切换为离线' : '当前离线，点击切换为在线'}"><span class="presence-dot" aria-hidden="true"></span><span data-presence-label>${online ? '在线' : '离线'}</span><span class="presence-track" aria-hidden="true"></span></button>`;
}

export function updatePresenceControls(root, { online, busy = false }) {
  for (const button of root.querySelectorAll('[data-presence-control]')) {
    button.disabled = busy;
    button.setAttribute('aria-checked', String(Boolean(online)));
    button.setAttribute('aria-busy', String(busy));
    button.title = busy ? '正在保存状态' : online ? '当前在线，点击切换为离线' : '当前离线，点击切换为在线';
    button.querySelector('[data-presence-label]').textContent = busy ? '保存中' : online ? '在线' : '离线';
  }
  for (const label of root.querySelectorAll('[data-self-presence-label]')) {
    label.textContent = online ? '在线' : '离线';
    label.dataset.online = String(Boolean(online));
  }
}

export function createPresenceController({ context, request, receive, onBusy, onError }) {
  let busy = false;
  const current = before => {
    const after = context();
    return after?.userId === before.userId && after.epoch === before.epoch;
  };
  return {
    get busy() { return busy; },
    async toggle() {
      const before = context();
      if (busy || !before?.userId) return false;
      busy = true;
      onBusy(true);
      try {
        const result = await request({ online: !before.online, expectedUserId: before.userId });
        if (!current(before)) return false;
        if (result?.id !== before.userId || typeof result.online !== 'boolean') throw new Error('状态返回异常，请刷新后核对');
        receive(result.online);
        return true;
      } catch (error) {
        if (current(before)) onError(error);
        return false;
      } finally {
        busy = false;
        onBusy(false);
      }
    },
  };
}
