import type { WeComSendTarget } from "./types.js";

const targetStore = new Map<string, WeComSendTarget>();
const TARGET_TTL_MS = 6 * 60 * 60 * 1000;
const targetSeenAt = new Map<string, number>();

export function storeSendTarget(target: WeComSendTarget): void {
  const key = `${target.chatId}:${target.fromUserId}`;
  targetStore.set(key, target);
  targetSeenAt.set(key, Date.now());
  cleanupExpiredTargets();
}

function resolveTarget(to: string): WeComSendTarget | null {
  cleanupExpiredTargets();
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

function cleanupExpiredTargets(): void {
  const now = Date.now();
  for (const [key, seenAt] of targetSeenAt.entries()) {
    if (now - seenAt > TARGET_TTL_MS) {
      targetSeenAt.delete(key);
      targetStore.delete(key);
    }
  }
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
