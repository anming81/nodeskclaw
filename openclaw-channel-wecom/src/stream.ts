import type {
  ResolvedWeComAccount,
  WeComInboundMessage,
  WeComOutboundRequest,
  WeComStreamFrame,
} from "./types.js";

const WEBSOCKET_URL_DEFAULT = "wss://openws.work.weixin.qq.com";
const RECONNECT_BASE_MS = 3_000;
const RECONNECT_MAX_MS = 60_000;

type MessageHandler = (msg: WeComInboundMessage, account: ResolvedWeComAccount) => void;

export class WeComStreamClient {
  private account: ResolvedWeComAccount;
  private ws: WebSocket | null = null;
  private onMessage: MessageHandler;
  private stopped = false;
  private reconnectAttempt = 0;

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
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  async sendText(chatId: string, content: string): Promise<string> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WeCom websocket not connected");
    }

    const req: WeComOutboundRequest = {
      action: "send_message",
      requestId: `wecom-${Date.now()}`,
      chatId,
      msgtype: "text",
      text: { content },
    };

    this.ws.send(JSON.stringify(req));
    return req.requestId;
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const wsUrl = buildWsUrl(this.account);
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      console.log("[wecom-stream] WebSocket connected");
    };

    ws.onmessage = (event: MessageEvent) => {
      const frame = parseFrame(String(event.data));
      if (!frame) {
        return;
      }
      this.handleFrame(frame, ws);
    };

    ws.onerror = (event: Event) => {
      console.error("[wecom-stream] WebSocket error:", event);
    };

    ws.onclose = () => {
      this.ws = null;
      if (!this.stopped) {
        this.scheduleReconnect();
      }
    };
  }

  private handleFrame(frame: WeComStreamFrame, ws: WebSocket): void {
    const frameType = (frame.type ?? frame.event ?? frame.topic ?? "").toLowerCase();
    if (frameType.includes("ping") || frameType.includes("heartbeat")) {
      this.sendAck(ws, frame.id ?? frame.messageId);
      return;
    }

    const inbound = extractInboundMessage(frame);
    if (inbound) {
      this.onMessage(inbound, this.account);
      this.sendAck(ws, frame.id ?? inbound.messageId);
      return;
    }

    if (frame.id || frame.messageId) {
      this.sendAck(ws, frame.id ?? frame.messageId);
    }
  }

  private sendAck(ws: WebSocket, frameId?: string): void {
    if (ws.readyState !== WebSocket.OPEN) return;

    const payload = {
      action: "ack",
      messageId: frameId ?? "",
      ts: Date.now(),
    };

    ws.send(JSON.stringify(payload));
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

function buildWsUrl(account: ResolvedWeComAccount): string {
  const base = account.websocketUrl || WEBSOCKET_URL_DEFAULT;
  const url = new URL(base);
  url.searchParams.set("botId", account.botId);
  url.searchParams.set("secret", account.secret);
  return url.toString();
}

function parseFrame(raw: string): WeComStreamFrame | null {
  try {
    const parsed = JSON.parse(raw) as WeComStreamFrame;
    return parsed;
  } catch (err) {
    console.error("[wecom-stream] parse frame failed:", err);
    return null;
  }
}

function extractInboundMessage(frame: WeComStreamFrame): WeComInboundMessage | null {
  const payload = frame.data ?? frame.payload;
  const candidate = typeof payload === "string" ? safeParse(payload) : payload;
  if (!candidate || typeof candidate !== "object") {
    return null;
  }
  const obj = candidate as Record<string, unknown>;

  const chatId = toStringOrEmpty(obj.chatId ?? obj.conversationId ?? frame.chatId);
  const senderId = toStringOrEmpty(obj.fromUserId ?? obj.senderId ?? frame.fromUserId);
  const text = toStringOrEmpty(
    obj.text ?? obj.content ?? (obj.message as Record<string, unknown> | undefined)?.content ?? frame.text,
  ).trim();

  if (!chatId || !senderId || !text) {
    return null;
  }

  const messageId = toStringOrEmpty(obj.messageId ?? obj.msgId ?? frame.messageId) || `wecom-${Date.now()}`;
  return { chatId, senderId, text, messageId };
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
