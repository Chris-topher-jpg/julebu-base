// One audio-only connection per occupied seat. A stable UUID ordering selects
// the offerer so simultaneous joins do not produce competing offers.
export function createRoomVoice({ peerId, iceServers, send, onChange = () => {}, onError = () => {}, audioRoot }) {
  const peers = new Map();
  let stream = null, muted = true, deafened = false, closed = false, acquiring = false;
  const supported = typeof RTCPeerConnection !== 'undefined';
  const changed = () => onChange({ muted, deafened, acquiring, supported, peers: Object.fromEntries([...peers].map(([id, peer]) => [id, peer.pc.connectionState])) });
  function enqueue(peer, task) {
    peer.queue = peer.queue.then(async () => { if (!closed && peer.pc.signalingState !== 'closed') await task(); }).catch(error => {
      if (!closed && peers.get(peer.id) === peer) onError(error.message || '语音连接失败，请重连或使用文字沟通');
    });
    return peer.queue;
  }
  async function gathered(pc) {
    if (pc.iceGatheringState === 'complete') return;
    await new Promise(resolve => {
      const finish = () => { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', check); resolve(); };
      const check = () => { if (pc.iceGatheringState === 'complete') finish(); };
      const timer = setTimeout(finish, 8000);
      pc.addEventListener('icegatheringstatechange', check);
    });
  }
  async function offer(peer, restart = false) {
    await peer.pc.setLocalDescription(await peer.pc.createOffer({ iceRestart: restart }));
    await gathered(peer.pc);
    if (!closed && peers.get(peer.id) === peer) await send(peer.id, { type: 'offer', sdp: peer.pc.localDescription.sdp });
  }
  function ensure(id) {
    if (!supported || closed) return null;
    if (peers.has(id)) return peers.get(id);
    const pc = new RTCPeerConnection({ iceServers });
    const transceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
    const audio = document.createElement('audio');
    audio.autoplay = true; audio.muted = deafened; audio.dataset.peerAudio = id; audioRoot.append(audio);
    const peer = { id, pc, transceiver, audio, queue: Promise.resolve() };
    peers.set(id, peer);
    if (stream) enqueue(peer, () => transceiver.sender.replaceTrack(stream.getAudioTracks()[0]));
    pc.ontrack = event => {
      audio.srcObject = event.streams[0] || new MediaStream([event.track]);
      void audio.play().catch(() => { if (!closed) onError('点击“播放声音”以收听房间语音'); });
    };
    pc.onconnectionstatechange = () => {
      changed();
      if (pc.connectionState === 'failed') onError('语音连接未成功，请点击重连；仍可继续文字交流');
    };
    if (peerId < id) enqueue(peer, () => offer(peer));
    changed(); return peer;
  }
  function drop(id) {
    const peer = peers.get(id); if (!peer) return;
    peers.delete(id); peer.pc.onconnectionstatechange = null; peer.pc.ontrack = null;
    peer.pc.close(); peer.audio.srcObject = null; peer.audio.remove();
  }
  return {
    get muted() { return muted; },
    sync(members) {
      const ids = new Set(members.filter(member => member.id !== peerId).map(member => member.id));
      for (const id of peers.keys()) if (!ids.has(id)) drop(id);
      for (const id of ids) ensure(id);
    },
    receive({ from, signal }) {
      const peer = peers.get(from); if (!peer) return;
      enqueue(peer, async () => {
        if (signal.type === 'restart') { if (peerId < from) await offer(peer, true); return; }
        if (signal.type === 'offer') {
          await peer.pc.setRemoteDescription(signal);
          await peer.pc.setLocalDescription(await peer.pc.createAnswer());
          await gathered(peer.pc);
          if (!closed && peers.get(from) === peer) await send(from, { type: 'answer', sdp: peer.pc.localDescription.sdp });
        } else if (signal.type === 'answer' && peer.pc.signalingState === 'have-local-offer') await peer.pc.setRemoteDescription(signal);
      });
    },
    async toggleMic() {
      if (closed || acquiring) return;
      if (!supported || !globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器或连接不支持麦克风，请使用 HTTPS 或本机地址访问，也可继续文字沟通');
      if (!stream) {
        acquiring = true; changed();
        try {
          const captured = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
          if (closed) { captured.getTracks().forEach(track => track.stop()); return; }
          stream = captured;
          for (const track of stream.getTracks()) track.onended = () => {
            muted = true; stream = null; changed();
            if (!closed) onError('麦克风设备已断开，重新连接设备后可再次开启麦克风');
          };
          await Promise.all([...peers.values()].map(peer => enqueue(peer, () => peer.transceiver.sender.replaceTrack(stream.getAudioTracks()[0]))));
        } catch (error) {
          const messages = { NotAllowedError: '麦克风权限未开启，请在浏览器中允许麦克风后重试', NotFoundError: '没有找到麦克风，请连接设备后重试', NotReadableError: '麦克风正被其他应用占用，请检查设备后重试' };
          throw new Error(messages[error.name] || '暂时无法打开麦克风，可以继续文字交流');
        } finally { acquiring = false; changed(); }
      }
      if (closed) return;
      muted = !muted;
      stream?.getAudioTracks().forEach(track => { track.enabled = !muted; });
      changed();
    },
    toggleSpeaker() { deafened = !deafened; for (const peer of peers.values()) peer.audio.muted = deafened; changed(); },
    async play() { await Promise.all([...peers.values()].filter(peer => peer.audio.srcObject).map(peer => peer.audio.play())); },
    reconnect() {
      for (const peer of peers.values()) enqueue(peer, () => peerId < peer.id ? offer(peer, true) : send(peer.id, { type: 'restart' }));
    },
    close() { closed = true; stream?.getTracks().forEach(track => track.stop()); for (const id of [...peers.keys()]) drop(id); },
  };
}
