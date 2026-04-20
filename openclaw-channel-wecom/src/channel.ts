import type { ChannelPlugin, OpenClawConfig } from "openclaw/plugin-sdk";
import type { WeComAccountConfig, ResolvedWeComAccount } from "./types.js";
import { getWeComRuntime } from "./runtime.js";
import { sendTextMessage } from "./send.js";

const CHANNEL_KEY = "wecom";
const DEFAULT_ACCOUNT_ID = "default";
const DEFAULT_WEBSOCKET_URL = "wss://openws.work.weixin.qq.com";

function getChannelSection(cfg: OpenClawConfig): Record<string, unknown> | undefined {
  return (cfg as Record<string, unknown>).channels?.[CHANNEL_KEY] as
    | Record<string, unknown>
    | undefined;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function resolveAccount(cfg: OpenClawConfig, accountId?: string | null): ResolvedWeComAccount {
  const section = getChannelSection(cfg);
  const id = accountId ?? DEFAULT_ACCOUNT_ID;

  const raw = (section?.accounts as Record<string, WeComAccountConfig> | undefined)?.[id]
    ?? (section as WeComAccountConfig | undefined)
    ?? {};

  const botId = String(raw.botId ?? "").trim();
  const secret = String(raw.secret ?? "").trim();

  return {
    accountId: id,
    enabled: raw.enabled !== false,
    configured: Boolean(botId && secret),
    botId,
    secret,
    websocketUrl: String(raw.websocketUrl ?? DEFAULT_WEBSOCKET_URL),
    dmPolicy: raw.dmPolicy ?? "open",
    allowFrom: normalizeStringList(raw.allowFrom),
    groupPolicy: raw.groupPolicy ?? "mention",
    groupAllowFrom: normalizeStringList(raw.groupAllowFrom),
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
    blurb: "WeCom bot messaging via WebSocket mode.",
    aliases: ["qywx"],
  },
  capabilities: {
    chatTypes: ["direct", "channel"],
  },
  config: {
    listAccountIds: (cfg) => {
      const section = getChannelSection(cfg);
      const accounts = (section?.accounts ?? {}) as Record<string, unknown>;
      const accountIds = Object.keys(accounts);
      return accountIds.length > 0 ? accountIds : [DEFAULT_ACCOUNT_ID];
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
      const result = await sendTextMessage(to, text);
      getWeComRuntime().channel.activity.record({
        channel: CHANNEL_KEY,
        accountId: account.accountId,
        direction: "outbound",
      });
      return result;
    },
    sendMedia: async ({ cfg, to, text, mediaUrl, accountId }) => {
      const account = resolveAccount(cfg, accountId);
      const body = mediaUrl ? `${text || ""}\n${mediaUrl}`.trim() : (text || "");
      const result = await sendTextMessage(to, body);
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
