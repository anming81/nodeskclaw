import type { ResolvedWeComAccount, WeComInboundMessage, WeComStreamFrame } from "./types.js";

const RECONNECT_BASE_MS = 3_000;
const RECONNECT_MAX_MS = 60_000;
const WEBSOCKET_CONNECT_TIMEOUT_MS = 15_000;

type MessageHandler = (msg: WeComInboundMessage, account: ResolvedWeComAccount) => void;

function buildReqId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class WeComStreamClient {
  private account: ResolvedWeComAccount;
  private ws: WebSocket | null = null;
  private onMessage: MessageHandler;
  private stopped = false;
  private reconnectAttempt = 0;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(account: ResolvedWeComAccount, onMessage: MessageHandler) {
    this.account = account;
    this.onMessage = onMessage;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.reconnectAttempt = 0;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
  }

  private connect(): void {
    if (this.stopped) return;

    try {
      this.setupWebSocket();
    } catch (err) {
      console.error("[wecom-stream] Failed to create WebSocket:", err);
      this.scheduleReconnect();
    }
  }

  private setupWebSocket(): void {
    const ws = new WebSocket(this.account.websocketUrl);
    this.ws = ws;

    const connectTimeout = setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) {
        try { ws.close(); } catch {}
      }
    }, WEBSOCKET_CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      clearTimeout(connectTimeout);
      this.reconnectAttempt = 0;
      console.log("[wecom-stream] WebSocket connected");
      this.sendSubscribe(ws);
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const frame = JSON.parse(String(event.data)) as WeComStreamFrame;
        this.handleFrame(frame, ws);
      } catch (err) {
        console.error("[wecom-stream] Failed to parse frame:", err);
      }
    };

    ws.onerror = (event: Event) => {
      console.error("[wecom-stream] WebSocket error:", event);
    };

    ws.onclose = () => {
      clearTimeout(connectTimeout);
      console.log("[wecom-stream] WebSocket closed");
      this.ws = null;
      if (!this.stopped) {
        this.scheduleReconnect();
      }
    };
  }

  private sendSubscribe(ws: WebSocket): void {
    const frame: WeComStreamFrame = {
      cmd: "aibot_subscribe",
      headers: { req_id: buildReqId("subscribe") },
      body: {
        bot_id: this.account.botId,
        secret: this.account.secret,
      },
    };

    try {
      ws.send(JSON.stringify(frame));
    } catch (err) {
      console.error("[wecom-stream] Failed to send subscribe:", err);
    }
  }

  private handleFrame(frame: WeComStreamFrame, ws: WebSocket): void {
    if (frame.cmd === "ping") {
      this.sendPong(ws);
      return;
    }

    if (frame.cmd === "aibot_callback" || frame.cmd === "aibot_event_callback") {
      try {
        this.onMessage(frame.body as WeComInboundMessage, this.account);
      } catch (err) {
        console.error("[wecom-stream] Failed to handle callback:", err);
      }
      return;
    }

    if (frame.cmd === "aibot_subscribe") {
      const errCode = Number(frame.body?.errcode ?? 0);
      if (errCode !== 0) {
        console.error("[wecom-stream] Subscribe failed:", frame.body);
      }
    }
  }

  private sendPong(ws: WebSocket): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    const frame: WeComStreamFrame = {
      cmd: "pong",
      headers: { req_id: buildReqId("pong") },
      body: {},
    };

    try {
      ws.send(JSON.stringify(frame));
    } catch (err) {
      console.error("[wecom-stream] Failed to send pong:", err);
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;

    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempt),
      RECONNECT_MAX_MS,
    );
    this.reconnectAttempt++;

    console.log(`[wecom-stream] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);
    this.connectTimer = setTimeout(() => this.connect(), delay);
  }
}
