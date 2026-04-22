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
  cmd?: string;
  id?: string;
  type?: string;
  topic?: string;
  event?: string;
  req_id?: string;
  reqId?: string;
  data?: unknown;
  payload?: unknown;
  text?: string;
  content?: string;
  chat_id?: string;
  chatId?: string;
  from_user_id?: string;
  fromUserId?: string;
  senderId?: string;
  messageId?: string;
  message_id?: string;
};

export type WeComInboundMessage = {
  chatId: string;
  senderId: string;
  text: string;
  messageId: string;
  reqId?: string;
};

export type WeComOutboundRequest = {
  cmd: "aibot_send_msg" | "aibot_respond_msg";
  req_id?: string;
  chat_id?: string;
  msg_type: "text";
  content: string;
};
