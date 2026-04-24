import type { ChannelPlugin, OpenClawConfig } from "openclaw/plugin-sdk";
import type { ResolvedWeComAccount, WeComAccountConfig } from "./types.js";
import { getWeComRuntime } from "./runtime.js";
import { sendMarkdownMessage, sendTextMessage } from "./send.js";

const CHANNEL_KEY = "wecom";
const DEFAULT_ACCOUNT_ID = "default";
const DEFAULT_WEBSOCKET_URL = "wss://openws.work.weixin.qq.com";

function getChannelSection(cfg: OpenClawConfig): Record<string, unknown> | undefined {
  return (cfg as Record<string, unknown>).channels?.[CHANNEL_KEY] as
    | Record<string, unknown>
    | undefined;
}

function isFlatAccountConfig(section: Record<string, unknown> | undefined): boolean {
  if (!section || typeof section !== "object") return false;
  return Boolean(section.botId || section.secret);
}

function resolveAccount(cfg: OpenClawConfig, accountId?: string | null): ResolvedWeComAccount {
  const section = getChannelSection(cfg);
  const accounts = (section?.accounts ?? {}) as Record<string, WeComAccountConfig>;
  const id = accountId ?? DEFAULT_ACCOUNT_ID;
  const raw = accounts[id] ?? (id === DEFAULT_ACCOUNT_ID && isFlatAccountConfig(section)
    ? (section as unknown as WeComAccountConfig)
    : undefined);

  if (!raw) {
    return {
      accountId: id,
      enabled: false,
      configured: false,
      botId: "",
      secret: "",
      websocketUrl: DEFAULT_WEBSOCKET_URL,
      corpId: "",
      corpSecret: "",
      agentId: "",
    };
  }

  return {
    accountId: id,
    enabled: raw.enabled !== false,
    configured: Boolean(raw.botId && raw.secret),
    botId: raw.botId ?? "",
    secret: raw.secret ?? "",
    websocketUrl: raw.websocketUrl ?? DEFAULT_WEBSOCKET_URL,
    corpId: raw.corpId ?? "",
    corpSecret: raw.corpSecret ?? "",
    agentId: raw.agentId ?? "",
  };
}

export { resolveAccount };

export const wecomPlugin: ChannelPlugin<ResolvedWeComAccount> = {
  id: CHANNEL_KEY,
  meta: {
    id: CHANNEL_KEY,
    label: "WeCom",
    selectionLabel: "WeCom (企业微信)",
    docsPath: "/channels/wecom",
    blurb: "WeCom bot messaging via WebSocket protocol.",
    aliases: ["weixin-work", "qywx"],
  },
  capabilities: {
    chatTypes: ["direct", "channel"],
  },
  config: {
    listAccountIds: (cfg) => {
      const section = getChannelSection(cfg);
      const ids = Object.keys((section?.accounts ?? {}) as Record<string, unknown>);
      if (ids.length > 0) return ids;
      if (isFlatAccountConfig(section)) return [DEFAULT_ACCOUNT_ID];
      return [];
    },
    resolveAccount: (cfg, accountId) => resolveAccount(cfg, accountId),
    isConfigured: (account) => account.configured,
    isEnabled: (account) => account.enabled,
    describeAccount: (account) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
    }),
  },
  outbound: {
    deliveryMode: "direct",
    sendText: async ({ cfg, to, text, accountId }) => {
      const account = resolveAccount(cfg, accountId);
      const result = await sendTextMessage(account, to, text);

      getWeComRuntime().channel.activity.record({
        channel: CHANNEL_KEY,
        accountId: account.accountId,
        direction: "outbound",
      });

      return result;
    },
    sendMedia: async ({ cfg, to, text, mediaUrl, accountId }) => {
      const account = resolveAccount(cfg, accountId);
      const body = mediaUrl ? `${text || ""}\n[${mediaUrl}]`.trim() : (text || "");
      const result = await sendMarkdownMessage(account, to, body);

      getWeComRuntime().channel.activity.record({
        channel: CHANNEL_KEY,
        accountId: account.accountId,
        direction: "outbound",
      });

      return result;
    },
  },
  status: {
    buildAccountSnapshot: ({ account }) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
    }),
  },
};
