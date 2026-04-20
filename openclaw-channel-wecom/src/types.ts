export type WeComAccountConfig = {
  botId?: string;
  secret?: string;
  websocketUrl?: string;
  connectionMode?: "websocket";
  dmPolicy?: "open" | "allowFrom" | "disabled";
  allowFrom?: string[];
  groupPolicy?: "mention" | "open" | "allowlist" | "disabled";
  groupAllowFrom?: string[];
  enabled?: boolean;
};

export type ResolvedWeComAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  botId: string;
  secret: string;
  websocketUrl: string;
  dmPolicy: "open" | "allowFrom" | "disabled";
  allowFrom: string[];
  groupPolicy: "mention" | "open" | "allowlist" | "disabled";
  groupAllowFrom: string[];
};

export type WeComInboundFrame = {
  cmd: string;
  errcode?: number;
  errmsg?: string;
  headers?: { req_id?: string };
  body?: {
    msgid?: string;
    chatid?: string;
    chattype?: "single" | "group";
    from?: { userid?: string };
    response_url?: string;
    msgtype?: string;
    text?: { content?: string };
  };
};

export type WeComSendTarget = {
  chatId: string;
  fromUserId: string;
  responseUrl?: string;
};
