import type { WeComStreamClient } from "./stream.js";

const clients = new Map<string, WeComStreamClient>();

export function setActiveWeComClient(accountId: string, client: WeComStreamClient): void {
  clients.set(accountId, client);
}

export function getActiveWeComClient(accountId: string): WeComStreamClient | undefined {
  return clients.get(accountId);
}

export function clearActiveWeComClient(accountId: string): void {
  clients.delete(accountId);
}
