import type { ResolvedWeComAccount, WeComOutboundRequest } from "./types.js";
import { getActiveWeComClient } from "./state.js";

function parseTarget(to: string): { chatId: string; reqId?: string } {
  if (to.includes(":")) {
    const [chatId, reqId] = to.split(":", 2);
    return { chatId: chatId || "", reqId: reqId || undefined };
  }
  return { chatId: to };
}

export async function sendTextMessage(
  account: ResolvedWeComAccount,
  to: string,
  content: string,
): Promise<{ channel: string; messageId: string }> {
  const { chatId, reqId } = parseTarget(to);
  if (!chatId) {
    throw new Error("WeCom send failed: missing chatId");
  }

  const req: WeComOutboundRequest = reqId
    ? {
        cmd: "aibot_respond_msg",
        req_id: reqId,
        msg_type: "text",
        content,
      }
    : {
        cmd: "aibot_send_msg",
        chat_id: chatId,
        msg_type: "text",
        content,
      };

  const client = getActiveWeComClient(account.accountId);
  if (!client || !client.isConnected) {
    throw new Error(`WeCom send failed: websocket not connected for account ${account.accountId}`);
  }

  const messageId = await client.sendMessage(req);
  return { channel: "wecom", messageId };
}
