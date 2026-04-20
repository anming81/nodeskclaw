import type { WeComSendTarget } from "./types.js";

const targetStore = new Map<string, WeComSendTarget>();

export function storeSendTarget(target: WeComSendTarget): void {
  const key = `${target.chatId}:${target.fromUserId}`;
  targetStore.set(key, target);
}

function resolveTarget(to: string): WeComSendTarget | null {
  if (to.includes(":")) {
    const [chatId, fromUserId] = to.split(":", 2);
    if (!chatId || !fromUserId) return null;
    return targetStore.get(`${chatId}:${fromUserId}`) ?? { chatId, fromUserId };
  }

  for (const target of targetStore.values()) {
    if (target.fromUserId === to) return target;
  }
  return null;
}

export async function sendTextMessage(
  to: string,
  content: string,
): Promise<{ channel: string; messageId: string }> {
  const target = resolveTarget(to);
  if (!target?.responseUrl) {
    throw new Error(`WeCom send failed: no response_url for target "${to}"`);
  }

  const resp = await fetch(target.responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      msgtype: "text",
      text: { content },
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`WeCom send failed: ${resp.status} ${text}`);
  }

  return { channel: "wecom", messageId: `wc-${Date.now()}` };
}
