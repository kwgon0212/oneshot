type MessageHandler = (msg: any) => void;
type FrameHandler = (blob: Blob) => void;

class WsManager {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private onMessage: MessageHandler = () => {};
  private onFrame: FrameHandler = () => {};
  private onDisconnect: () => void = () => {};
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  setHandlers(opts: { onMessage: MessageHandler; onFrame: FrameHandler; onDisconnect: () => void }) {
    this.onMessage = opts.onMessage;
    this.onFrame = opts.onFrame;
    this.onDisconnect = opts.onDisconnect;
  }

  connect(token: string) {
    this.token = token;
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
      if (this.pingInterval) clearInterval(this.pingInterval);
      if (this.token) this.onDisconnect();
    };
    this.ws.onerror = () => {};
  }

  send(msg: any) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.token = null;
    this.ws?.close();
  }

  getToken() { return this.token; }
}

export const ws = new WsManager();
