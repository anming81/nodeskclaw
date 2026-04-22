import type { ResolvedWeComAccount } from "./types.js";
import { getActiveWeComClient } from "./state.js";

function parseTarget(to: string): { chatId: string; userId?: string } {
  if (to.includes(":")) {
    const [chatId, userId] = to.split(":", 2);
    return { chatId: chatId || "", userId: userId || undefined };
  }
  return { chatId: to };
}

export async function sendTextMessage(
  account: ResolvedWeComAccount,
  to: string,
  content: string,
): Promise<{ channel: string; messageId: string }> {
  const { chatId } = parseTarget(to);
  if (!chatId) {
    throw new Error("WeCom send failed: missing chatId");
  }
  const client = getActiveWeComClient(account.accountId);
  if (!client || !client.isConnected) {
    throw new Error(`WeCom send failed: websocket not connected for account ${account.accountId}`);
  }
  const messageId = await client.sendText(chatId, content);
  return { channel: "wecom", messageId };
}
