type MessageHandler = (msg: any) => void;
type FrameHandler = (blob: Blob) => void;

class WsManager {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private onMessage: MessageHandler = () => {};
  private onFrame: FrameHandler = () => {};
  private onDisconnect: () => void = () => {};
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // 탭 복귀 시 자동 재연결
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.token) {
        if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
          console.log('[ws] 탭 복귀 — 재연결');
          this.connect(this.token);
        }
      }
    });
  }

  setHandlers(opts: { onMessage: MessageHandler; onFrame: FrameHandler; onDisconnect: () => void }) {
    this.onMessage = opts.onMessage;
    this.onFrame = opts.onFrame;
    this.onDisconnect = opts.onDisconnect;
  }

  connect(token: string) {
    this.token = token;
    // 기존 연결 정리
    if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
    if (this.ws) { try { this.ws.close(); } catch {} }

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(proto + '//' + location.host);
    this.ws.binaryType = 'blob';

    this.ws.onopen = () => {
      this.ws!.send(JSON.stringify({ type: 'auth', token }));
      this.pingInterval = setInterval(() => {
        if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ type: 'ping', t: Date.now() }));
      }, 2000);
    };

    this.ws.onmessage = (ev) => {
      if (ev.data instanceof Blob) { this.onFrame(ev.data); return; }
      try { this.onMessage(JSON.parse(ev.data)); } catch {}
    };

    this.ws.onclose = () => {
      if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
      if (this.token) this.onDisconnect();
    };
    this.ws.onerror = () => {};
  }

  send(msg: any) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.token = null;
    if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
    this.ws?.close();
  }

  getToken() { return this.token; }
}

export const ws = new WsManager();
