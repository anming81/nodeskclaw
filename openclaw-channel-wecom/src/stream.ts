import type {
  ResolvedWeComAccount,
  WeComInboundMessage,
  WeComOutboundRequest,
  WeComStreamFrame,
} from "./types.js";

const WEBSOCKET_URL_DEFAULT = "wss://openws.work.weixin.qq.com";
const RECONNECT_BASE_MS = 3_000;
const RECONNECT_MAX_MS = 60_000;
const HEARTBEAT_MS = 30_000;

type MessageHandler = (msg: WeComInboundMessage, account: ResolvedWeComAccount) => void;

export class WeComStreamClient {
  private account: ResolvedWeComAccount;
  private ws: WebSocket | null = null;
  private onMessage: MessageHandler;
  private stopped = false;
  private reconnectAttempt = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(account: ResolvedWeComAccount, onMessage: MessageHandler) {
    this.account = account;
    this.onMessage = onMessage;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.reconnectAttempt = 0;
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  async sendMessage(req: WeComOutboundRequest): Promise<string> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WeCom websocket not connected");
    }
    this.ws.send(JSON.stringify(req));
    return req.req_id || `wecom-${Date.now()}`;
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const wsUrl = this.account.websocketUrl || WEBSOCKET_URL_DEFAULT;
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.sendSubscribe(ws);
      this.startHeartbeat(ws);
      console.log("[wecom-stream] WebSocket connected");
    };

    ws.onmessage = (event: MessageEvent) => {
      const frame = parseFrame(String(event.data));
      if (!frame) {
        return;
      }
      this.handleFrame(frame);
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

  private handleFrame(frame: WeComStreamFrame): void {
    const cmd = normalizeCmd(frame);
    if (cmd === "pong" || cmd === "ping") {
      return;
    }

    if (cmd === "aibot_subscribe" || cmd === "aibot_subscribe_ack") {
      return;
    }

    if (cmd === "aibot_msg_callback" || cmd === "aibot_event_callback") {
      const inbound = extractInboundMessage(frame);
      if (inbound) {
        this.onMessage(inbound, this.account);
      }
      return;
    }

    const inbound = extractInboundMessage(frame);
    if (inbound) {
      this.onMessage(inbound, this.account);
    }
  }

  private sendSubscribe(ws: WebSocket): void {
    if (ws.readyState !== WebSocket.OPEN) return;

    const payload = {
      cmd: "aibot_subscribe",
      bot_id: this.account.botId,
      secret: this.account.secret,
    };
    ws.send(JSON.stringify(payload));
  }

  private startHeartbeat(ws: WebSocket): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ cmd: "ping", ts: Date.now() }));
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempt),
      RECONNECT_MAX_MS,
    );
    this.reconnectAttempt += 1;
    setTimeout(() => {
      this.connect().catch((err) => {
        console.error("[wecom-stream] reconnect failed:", err);
      });
    }, delay);
  }
}

function parseFrame(raw: string): WeComStreamFrame | null {
  try {
    return JSON.parse(raw) as WeComStreamFrame;
  } catch (err) {
    console.error("[wecom-stream] parse frame failed:", err);
    return null;
  }
}

function normalizeCmd(frame: WeComStreamFrame): string {
  return String(frame.cmd ?? frame.type ?? frame.event ?? frame.topic ?? "").toLowerCase();
}

function extractInboundMessage(frame: WeComStreamFrame): WeComInboundMessage | null {
  const payload = frame.data ?? frame.payload;
  const candidate = typeof payload === "string" ? safeParse(payload) : payload;
  const obj = (candidate && typeof candidate === "object") ? candidate as Record<string, unknown> : {};

  const chatId = toStringOrEmpty(obj.chat_id ?? obj.chatId ?? frame.chat_id ?? frame.chatId);
  const senderId = toStringOrEmpty(
    obj.from_user_id ?? obj.fromUserId ?? obj.senderId ?? frame.from_user_id ?? frame.fromUserId,
  );
  const text = toStringOrEmpty(obj.content ?? obj.text ?? frame.content ?? frame.text).trim();

  if (!chatId || !senderId || !text) {
    return null;
  }

  const messageId =
    toStringOrEmpty(obj.message_id ?? obj.messageId ?? frame.message_id ?? frame.messageId) || `wecom-${Date.now()}`;
  const reqId = toStringOrEmpty(obj.req_id ?? obj.reqId ?? frame.req_id ?? frame.reqId) || undefined;

  return { chatId, senderId, text, messageId, reqId };
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function toStringOrEmpty(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return "";
}
