import type { ResolvedWeComAccount, ResponseUrlEntry } from "./types.js";

const TOKEN_CACHE_SAFETY_MARGIN_MS = 5 * 60 * 1000;
const RESPONSE_URL_TTL_MS = 6 * 60 * 1000;

const responseUrlStore = new Map<string, ResponseUrlEntry>();
const accessTokenStore = new Map<string, { token: string; expiresAt: number }>();

export function storeResponseUrl(entry: Omit<ResponseUrlEntry, "expiredAt">): void {
  const key = `${entry.chatId}:${entry.senderUserId}`;
  responseUrlStore.set(key, {
    ...entry,
    expiredAt: Date.now() + RESPONSE_URL_TTL_MS,
  });
}

function getResponseUrl(chatId: string, senderUserId: string): string | null {
  const key = `${chatId}:${senderUserId}`;
  const entry = responseUrlStore.get(key);
  if (!entry) return null;

  if (Date.now() >= entry.expiredAt) {
    responseUrlStore.delete(key);
    return null;
  }

  return entry.responseUrl;
}

async function sendViaResponseUrl(responseUrl: string, content: string, msgType: "text" | "markdown" = "text"): Promise<boolean> {
  const body = msgType === "markdown"
    ? { msgtype: "markdown", markdown: { content } }
    : { msgtype: "text", text: { content } };

  const resp = await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return resp.ok;
}

async function getAccessToken(account: ResolvedWeComAccount): Promise<string> {
  const cacheKey = `${account.corpId}:${account.corpSecret}`;
  const cached = accessTokenStore.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.token;
  }

  const resp = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(account.corpId)}&corpsecret=${encodeURIComponent(account.corpSecret)}`,
  );

  if (!resp.ok) {
    throw new Error(`WeCom gettoken failed: ${resp.status}`);
  }

  const body = (await resp.json()) as { errcode?: number; errmsg?: string; access_token?: string; expires_in?: number };
  if (body.errcode || !body.access_token) {
    throw new Error(`WeCom gettoken failed: ${body.errcode ?? "unknown"} ${body.errmsg ?? ""}`.trim());
  }

  const ttlMs = (body.expires_in && body.expires_in > 0 ? body.expires_in : 7200) * 1000 - TOKEN_CACHE_SAFETY_MARGIN_MS;
  accessTokenStore.set(cacheKey, {
    token: body.access_token,
    expiresAt: Date.now() + Math.max(ttlMs, 60_000),
  });

  return body.access_token;
}

async function sendViaAgentApi(
  account: ResolvedWeComAccount,
  toUser: string,
  content: string,
  msgType: "text" | "markdown" = "text",
): Promise<boolean> {
  if (!account.corpId || !account.corpSecret || !account.agentId || !toUser) {
    return false;
  }

  const token = await getAccessToken(account);
  const body = msgType === "markdown"
    ? {
      touser: toUser,
      msgtype: "markdown",
      agentid: Number(account.agentId),
      markdown: { content },
      safe: 0,
    }
    : {
      touser: toUser,
      msgtype: "text",
      agentid: Number(account.agentId),
      text: { content },
      safe: 0,
    };

  const resp = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(token)}` , {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    return false;
  }

  const result = (await resp.json()) as { errcode?: number; errmsg?: string; msgid?: string };
  return result.errcode === 0;
}

export async function sendTextMessage(
  account: ResolvedWeComAccount,
  to: string,
  content: string,
): Promise<{ channel: string; messageId: string }> {
  const [chatId, senderUserId] = parseTarget(to);

  if (chatId && senderUserId) {
    const responseUrl = getResponseUrl(chatId, senderUserId);
    if (responseUrl) {
      const ok = await sendViaResponseUrl(responseUrl, content);
      if (ok) {
        return { channel: "wecom", messageId: `wecom-rsp-${Date.now()}` };
      }
    }
  }

  if (senderUserId) {
    const ok = await sendViaAgentApi(account, senderUserId, content);
    if (ok) {
      return { channel: "wecom", messageId: `wecom-api-${Date.now()}` };
    }
  }

  throw new Error(`WeCom send failed: no valid delivery path for target "${to}"`);
}

export async function sendMarkdownMessage(
  account: ResolvedWeComAccount,
  to: string,
  content: string,
): Promise<{ channel: string; messageId: string }> {
  const [chatId, senderUserId] = parseTarget(to);

  if (chatId && senderUserId) {
    const responseUrl = getResponseUrl(chatId, senderUserId);
    if (responseUrl) {
      const ok = await sendViaResponseUrl(responseUrl, content, "markdown");
      if (ok) {
        return { channel: "wecom", messageId: `wecom-rsp-${Date.now()}` };
      }
    }
  }

  if (senderUserId) {
    const ok = await sendViaAgentApi(account, senderUserId, content, "markdown");
    if (ok) {
      return { channel: "wecom", messageId: `wecom-api-${Date.now()}` };
    }
  }

  throw new Error(`WeCom markdown send failed for target "${to}"`);
}

function parseTarget(to: string): [string | null, string | null] {
  if (to.includes(":")) {
    const [chatId, senderUserId] = to.split(":", 2);
    return [chatId || null, senderUserId || null];
  }
  return [null, to || null];
}
