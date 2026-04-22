export type WeComAccountConfig = {
  botId: string;
  secret: string;
  websocketUrl?: string;
  enabled?: boolean;
  dmPolicy?: string;
  groupPolicy?: string;
  allowFrom?: string[];
};

export type ResolvedWeComAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  botId: string;
  secret: string;
  websocketUrl: string;
};

export type WeComStreamFrame = {
  id?: string;
  type?: string;
  topic?: string;
  event?: string;
  data?: unknown;
  payload?: unknown;
  text?: string;
  content?: string;
  chatId?: string;
  fromUserId?: string;
  senderId?: string;
  conversationId?: string;
  messageId?: string;
};

export type WeComInboundMessage = {
  chatId: string;
  senderId: string;
  text: string;
  messageId: string;
};

export type WeComOutboundRequest = {
  action: "send_message";
  requestId: string;
  chatId: string;
  msgtype: "text" | "markdown";
  text?: { content: string };
  markdown?: { content: string };
};
