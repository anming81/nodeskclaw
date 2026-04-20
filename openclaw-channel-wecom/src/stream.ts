import type { WeComInboundFrame, ResolvedWeComAccount } from "./types.js";

const RECONNECT_BASE_MS = 3_000;
const RECONNECT_MAX_MS = 60_000;
const HEARTBEAT_MS = 30_000;

type MessageHandler = (frame: WeComInboundFrame, account: ResolvedWeComAccount) => void;

export class WeComWebSocketClient {
  private account: ResolvedWeComAccount;
  private ws: WebSocket | null = null;
  private onMessage: MessageHandler;
  private stopped = false;
  private reconnectAttempt = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

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
    this.stopHeartbeat();
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
  }

  private connect(): void {
    if (this.stopped) return;
    const ws = new WebSocket(this.account.websocketUrl);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.subscribe();
      this.startHeartbeat();
      console.log("[wecom-stream] WebSocket connected");
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const frame = JSON.parse(String(event.data)) as WeComInboundFrame;
        this.handleFrame(frame);
      } catch (err) {
        console.error("[wecom-stream] Failed to parse frame:", err);
      }
    };

    ws.onerror = (event: Event) => {
      console.error("[wecom-stream] WebSocket error:", event);
    };

    ws.onclose = () => {
      this.stopHeartbeat();
      this.ws = null;
      if (!this.stopped) {
        this.scheduleReconnect();
      }
    };
  }

  private handleFrame(frame: WeComInboundFrame): void {
    const cmd = String(frame.cmd || "");

    if (cmd === "ping") {
      this.send({ cmd: "pong", headers: frame.headers ?? {}, body: {} });
      return;
    }

    if (cmd === "aibot_callback" || cmd === "aibot_event_callback") {
      this.onMessage(frame, this.account);
      return;
    }

    if (cmd === "aibot_subscribe") {
      return;
    }
  }

  private subscribe(): void {
    this.send({
      cmd: "aibot_subscribe",
      headers: { req_id: `sub-${Date.now()}` },
      body: {
        bot_id: this.account.botId,
        secret: this.account.secret,
      },
    });
  }

  send(payload: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(payload));
    } catch (err) {
      console.error("[wecom-stream] Failed to send frame:", err);
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ cmd: "ping" });
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempt, RECONNECT_MAX_MS);
    this.reconnectAttempt++;
    setTimeout(() => this.connect(), delay);
  }
}
