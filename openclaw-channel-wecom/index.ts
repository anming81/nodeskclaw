import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { setWeComRuntime } from "./src/runtime.js";
import { wecomPlugin, resolveAccount } from "./src/channel.js";
import type { ResolvedWeComAccount, WeComInboundMessage } from "./src/types.js";
import { WeComStreamClient } from "./src/stream.js";
import { clearActiveWeComClient, setActiveWeComClient } from "./src/state.js";
import { sendTextMessage } from "./src/send.js";

const CHANNEL_KEY = "wecom";
const GATEWAY_PORT_DEFAULT = 3000;

let streamClient: WeComStreamClient | null = null;

function getGatewayToken(): string {
  return process.env.GATEWAY_TOKEN || process.env.OPENCLAW_GATEWAY_TOKEN || "";
}

function getGatewayPort(): number {
  return parseInt(process.env.OPENCLAW_GATEWAY_PORT ?? "", 10) || GATEWAY_PORT_DEFAULT;
}

async function routeInboundMessage(
  msg: WeComInboundMessage,
  account: ResolvedWeComAccount,
): Promise<void> {
  const text = msg.text.trim();
  if (!text) {
    return;
  }

  const gatewayPort = getGatewayPort();
  const token = getGatewayToken();
  const url = `http://localhost:${gatewayPort}/v1/chat/completions`;

  const sessionKey = `wecom:${msg.chatId}:${msg.senderId}`;
  const replyTarget = msg.reqId ? `${msg.chatId}:${msg.reqId}` : msg.chatId;

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
        } catch {
          continue;
        }
      }
    }

    if (fullResponse.trim()) {
      await sendTextMessage(account, replyTarget, fullResponse.trim());
    }
  } catch (err) {
    console.error("[wecom] Failed to route message to gateway:", err);
  }
}

const plugin = {
  id: CHANNEL_KEY,
  name: "WeCom",
  description: "WeCom channel plugin via websocket long connection",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setWeComRuntime(api.runtime);
    api.registerChannel({ plugin: wecomPlugin });

    const accounts = wecomPlugin.config.listAccountIds(api.config);
    for (const accountId of accounts) {
      const account = resolveAccount(api.config, accountId);
      if (!account.configured || !account.enabled) continue;

      if (streamClient) {
        streamClient.stop();
        clearActiveWeComClient(account.accountId);
      }

      streamClient = new WeComStreamClient(account, routeInboundMessage);
      setActiveWeComClient(account.accountId, streamClient);
      streamClient.start().catch((err) => {
        console.error("[wecom] Failed to start websocket client:", err);
      });

      console.log(`[wecom] websocket client started for account "${accountId}"`);
      break;
    }
  },
};

export default plugin;
