export type WeComAccountConfig = {
  botId: string;
  secret: string;
  websocketUrl?: string;
  corpId?: string;
  corpSecret?: string;
  agentId?: string;
  dmPolicy?: string;
  groupPolicy?: string;
  enabled?: boolean;
};

export type ResolvedWeComAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  botId: string;
  secret: string;
  websocketUrl: string;
  corpId: string;
  corpSecret: string;
  agentId: string;
};

export type WeComStreamFrame = {
  cmd: string;
  errcode?: number;
  errmsg?: string;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
};

export type WeComInboundMessage = {
  msgid: string;
  msgtype: string;
  chatid?: string;
  chattype?: "single" | "group";
  response_url?: string;
  from?: { userid?: string };
  text?: { content?: string };
};

export type ResponseUrlEntry = {
  responseUrl: string;
  expiredAt: number;
  chatId: string;
  senderUserId: string;
};
