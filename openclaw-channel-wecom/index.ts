import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { wecomPlugin, resolveAccount } from "./src/channel.js";
import { setWeComRuntime } from "./src/runtime.js";
import { WeComWebSocketClient } from "./src/stream.js";
import { storeSendTarget } from "./src/send.js";
import type { WeComInboundFrame, ResolvedWeComAccount } from "./src/types.js";

const GATEWAY_PORT_DEFAULT = 3000;
let wsClient: WeComWebSocketClient | null = null;

function getGatewayToken(): string {
  return process.env.GATEWAY_TOKEN || process.env.OPENCLAW_GATEWAY_TOKEN || "";
}

function getGatewayPort(): number {
  return parseInt(process.env.OPENCLAW_GATEWAY_PORT ?? "", 10) || GATEWAY_PORT_DEFAULT;
}

function allowInbound(frame: WeComInboundFrame, account: ResolvedWeComAccount): boolean {
  const body = frame.body;
  if (!body) return false;

  const fromUserId = String(body.from?.userid || "").trim();
  const isGroup = body.chattype === "group";
  const text = String(body.text?.content || "").trim();

  if (!fromUserId || !text) return false;

  if (!isGroup) {
    if (account.dmPolicy === "disabled") return false;
    if (account.dmPolicy === "allowFrom" && !account.allowFrom.includes(fromUserId)) {
      return false;
    }
    return true;
  }

  if (account.groupPolicy === "disabled") return false;
  if (account.groupPolicy === "allowlist") {
    const chatId = String(body.chatid || "").trim();
    return Boolean(chatId && account.groupAllowFrom.includes(chatId));
  }

  if (account.groupPolicy === "mention") {
    return text.includes("@") || text.includes("＠");
  }

  return true;
}

function buildTarget(frame: WeComInboundFrame): { chatId: string; fromUserId: string } | null {
  const body = frame.body;
  if (!body) return null;
  const fromUserId = String(body.from?.userid || "").trim();
  const chatId = String(body.chatid || fromUserId).trim();
  if (!fromUserId || !chatId) return null;
  return { chatId, fromUserId };
}

async function routeInboundMessage(
  frame: WeComInboundFrame,
  account: ResolvedWeComAccount,
): Promise<void> {
  const body = frame.body;
  if (!body) return;

  if (body.msgtype !== "text") return;
  if (!allowInbound(frame, account)) return;

  const target = buildTarget(frame);
  if (!target) return;

  if (body.response_url) {
    storeSendTarget({
      chatId: target.chatId,
      fromUserId: target.fromUserId,
      responseUrl: body.response_url,
    });
  }

  const text = String(body.text?.content || "").trim();
  if (!text) return;

  const gatewayPort = getGatewayPort();
  const token = getGatewayToken();
  const url = `http://localhost:${gatewayPort}/v1/chat/completions`;
  const sessionKey = `wecom:${target.chatId}:${target.fromUserId}`;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-OpenClaw-Session-Key": sessionKey,
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: text }],
        stream: true,
      }),
    });

    if (!resp.ok || !resp.body) {
      console.error("[wecom] Gateway returned", resp.status);
      return;
    }

    let fullResponse = "";
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) fullResponse += delta;
        } catch {}
      }
    }

    const reqId = String(frame.headers?.req_id || "").trim();
    if (!fullResponse.trim() || !reqId) return;

    wsClient?.send({
      cmd: "aibot_response",
      headers: { req_id: reqId },
      body: {
        msgtype: "text",
        text: { content: fullResponse.trim() },
      },
    });
  } catch (err) {
    console.error("[wecom] Failed to route message to gateway:", err);
  }
}

const plugin = {
  id: "wecom",
  name: "WeCom",
  description: "WeCom channel plugin via WebSocket mode",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setWeComRuntime(api.runtime);
    api.registerChannel({ plugin: wecomPlugin });

    const accounts = wecomPlugin.config.listAccountIds(api.config);
    for (const accountId of accounts) {
      const account = resolveAccount(api.config, accountId);
      if (!account.configured || !account.enabled) continue;

      if (wsClient) {
        wsClient.stop();
      }

      wsClient = new WeComWebSocketClient(account, routeInboundMessage);
      wsClient.start().catch((err) => {
        console.error("[wecom] Failed to start WebSocket client:", err);
      });

      console.log(`[wecom] WebSocket client started for account "${accountId}"`);
      break;
    }
  },
};

export default plugin;
