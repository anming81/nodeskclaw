import type { ResolvedWeComAccount, WeComInboundMessage, WeComStreamFrame } from "./types.js";

const RECONNECT_BASE_MS = 3_000;
const RECONNECT_MAX_MS = 60_000;
const HEARTBEAT_INTERVAL_MS = 30_000;

type MessageHandler = (msg: WeComInboundMessage, account: ResolvedWeComAccount) => void;
type WsLike = {
  readyState: number;
  send: (data: string) => void;
  close: () => void;
  onopen?: () => void;
  onmessage?: (event: { data: unknown }) => void;
  onerror?: (event: unknown) => void;
  onclose?: (event: { code?: number; reason?: string }) => void;
  addEventListener?: (name: string, cb: (...args: any[]) => void) => void;
  removeEventListener?: (name: string, cb: (...args: any[]) => void) => void;
  on?: (name: string, cb: (...args: any[]) => void) => void;
  off?: (name: string, cb: (...args: any[]) => void) => void;
  pong?: () => void;
};

function buildReqId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function createWebSocket(url: string): Promise<WsLike> {
  try {
    const wsModule = await import("ws");
    const WS = (wsModule as any).WebSocket ?? (wsModule as any).default;
    if (WS) {
      return new WS(url) as WsLike;
    }
  } catch {}

  return new WebSocket(url) as unknown as WsLike;
}

export class WeComStreamClient {
  private account: ResolvedWeComAccount;
  private ws: WsLike | null = null;
  private onMessage: MessageHandler;
  private stopped = false;
  private reconnectAttempt = 0;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(account: ResolvedWeComAccount, onMessage: MessageHandler) {
    this.account = account;
    this.onMessage = onMessage;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.reconnectAttempt = 0;
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    this.stopHeartbeat();
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;

    try {
      const ws = await createWebSocket(this.account.websocketUrl);
      this.setupWebSocket(ws);
      this.ws = ws;
    } catch (err) {
      console.error("[wecom-stream] Failed to create WebSocket:", err);
      this.scheduleReconnect();
    }
  }

  private setupWebSocket(ws: WsLike): void {
    const onOpen = () => {
      this.reconnectAttempt = 0;
      console.log("[wecom-stream] WebSocket connected");
      this.sendSubscribe(ws);
      this.startHeartbeat(ws);
    };

    const onMessage = (event: { data: unknown }) => {
      try {
        const raw = typeof event.data === "string" ? event.data : String(event.data ?? "");
        const frame = JSON.parse(raw) as WeComStreamFrame;
        this.handleFrame(frame, ws);
      } catch (err) {
        console.error("[wecom-stream] Failed to parse frame:", err);
      }
    };

    const onError = (event: unknown) => {
      console.error("[wecom-stream] WebSocket error:", event);
    };

    const onClose = (event: { code?: number; reason?: string }) => {
      this.stopHeartbeat();
      const code = event?.code ?? 0;
      const reason = event?.reason || "";
      console.warn(`[wecom-stream] WebSocket closed: code=${code} reason=${reason}`);
      this.ws = null;
      if (!this.stopped) {
        this.scheduleReconnect();
      }
    };

    if (ws.on) {
      ws.on("open", onOpen);
      ws.on("message", (data: unknown) => onMessage({ data }));
      ws.on("error", onError);
      ws.on("close", (code: number, reason: any) => {
        onClose({ code, reason: reason?.toString?.() || "" });
      });
      ws.on("ping", () => {
        try { ws.pong?.(); } catch {}
      });
      return;
    }

    ws.onopen = onOpen;
    ws.onmessage = onMessage;
    ws.onerror = onError;
    ws.onclose = onClose;
  }

  private sendSubscribe(ws: WsLike): void {
    const frame: WeComStreamFrame = {
      cmd: "aibot_subscribe",
      headers: { req_id: buildReqId("subscribe") },
      body: {
        bot_id: this.account.botId,
        secret: this.account.secret,
      },
    };

    this.sendFrame(ws, frame, "subscribe");
  }

  private startHeartbeat(ws: WsLike): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (ws.readyState !== 1) return;
      const frame: WeComStreamFrame = {
        cmd: "ping",
        headers: { req_id: buildReqId("ping") },
        body: {},
      };
      this.sendFrame(ws, frame, "heartbeat");
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private sendFrame(ws: WsLike, frame: WeComStreamFrame, action: string): void {
    if (ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify(frame));
    } catch (err) {
      console.error(`[wecom-stream] Failed to send ${action}:`, err);
    }
  }

  private handleFrame(frame: WeComStreamFrame, ws: WsLike): void {
    if (frame.cmd === "aibot_msg_callback" || frame.cmd === "aibot_event_callback") {
      try {
        this.onMessage(frame.body as WeComInboundMessage, this.account);
      } catch (err) {
        console.error("[wecom-stream] Failed to handle callback:", err);
      }
      return;
    }

    if (frame.cmd === "ping") {
      const pong: WeComStreamFrame = {
        cmd: "pong",
        headers: { req_id: buildReqId("pong") },
        body: {},
      };
      this.sendFrame(ws, pong, "pong");
      return;
    }

    if (typeof frame.errcode === "number" && frame.errcode !== 0) {
      console.error(`[wecom-stream] Server returned error: errcode=${frame.errcode} errmsg=${frame.errmsg || ""}`);
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
    this.connectTimer = setTimeout(() => {
      this.connect().catch((err) => {
        console.error("[wecom-stream] Reconnect failed:", err);
      });
    }, delay);
  }
}
