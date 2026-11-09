// manual webrtc: offer/answer encoded as copy-pasteable codes, one data channel.
// no signaling server. the codes ARE the signaling.

const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const GATHER_TIMEOUT_MS = 2500;

// url-safe base64
function toB64(bytes) {
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
function fromB64(str) {
  str = str.replaceAll('-', '+').replaceAll('_', '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// "CHS1.<base64 of {t, s}>"
export function encodeCode(desc) {
  const bytes = new TextEncoder().encode(JSON.stringify({ t: desc.type, s: desc.sdp }));
  return 'CHS1.' + toB64(bytes);
}
export function decodeCode(code) {
  code = code.trim();
  if (!code.startsWith('CHS1.')) throw new Error('not an ampersand code (expecting CHS1.…)');
  const obj = JSON.parse(new TextDecoder().decode(fromB64(code.slice(5))));
  return { type: obj.t, sdp: obj.s };
}

// wait for ice gathering to settle so the code is complete.
// (unfinalized sdp = the classic silent-failure trap)
function waitGather(pc, ms = GATHER_TIMEOUT_MS) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const timer = setTimeout(resolve, ms);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

export class Conn {
  constructor({ onOpen, onMessage, onClose, onState } = {}) {
    this.h = { onOpen, onMessage, onClose, onState };
    this.pc = null;
    this.dc = null;
  }

  #wireDC(dc) {
    dc.onopen = () => this.h.onOpen?.();
    dc.onmessage = (e) => {
      try { this.h.onMessage?.(JSON.parse(e.data)); } catch { /* garbage, ignore */ }
    };
    dc.onclose = () => this.h.onClose?.();
  }

  #wirePC(pc) {
    pc.onconnectionstatechange = () => this.h.onState?.(pc.connectionState);
  }

  // host: returns offer code to send to friend
  async host() {
    this.close();
    const pc = this.pc = new RTCPeerConnection(ICE);
    this.#wirePC(pc);
    this.dc = pc.createDataChannel('chess');
    this.#wireDC(this.dc);
    await pc.setLocalDescription(await pc.createOffer());
    await waitGather(pc);
    return encodeCode(pc.localDescription);
  }

  // guest: takes offer code, returns reply code to send back
  async join(code) {
    this.close();
    const pc = this.pc = new RTCPeerConnection(ICE);
    this.#wirePC(pc);
    pc.ondatachannel = (e) => {
      this.dc = e.channel;
      this.#wireDC(e.channel);
    };
    await pc.setRemoteDescription(decodeCode(code));
    await pc.setLocalDescription(await pc.createAnswer());
    await waitGather(pc);
    return encodeCode(pc.localDescription);
  }

  // host: apply guest's reply code
  async acceptReply(code) {
    if (!this.pc) throw new Error('create a game code first');
    await this.pc.setRemoteDescription(decodeCode(code));
  }

  send(obj) {
    if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(obj));
  }

  close() {
    try { this.pc?.close(); } catch { /* already closed */ }
    this.pc = null;
    this.dc = null;
  }
}
