/** Push subscriptions in KV: one key per device, grouped by Door43 host and login. */
export type StoredSubscription = {
  endpoint: string;
  expirationTime: number | null;
  keys: { auth: string; p256dh: string };
};

/** Most devices one person may have subscribed; the oldest is dropped past this. */
export const MAX_DEVICES = 5;

async function hash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const prefix = (host: string, login: string) => `s:${host}:${login.toLowerCase()}:`;

export function validSubscription(value: unknown): value is StoredSubscription {
  const s = value as Partial<StoredSubscription> | null;
  return Boolean(
    s &&
      typeof s.endpoint === "string" &&
      s.endpoint.startsWith("https://") &&
      s.endpoint.length < 600 &&
      s.keys &&
      typeof s.keys.auth === "string" &&
      typeof s.keys.p256dh === "string",
  );
}

export async function saveSubscription(kv: KVNamespace, host: string, login: string, sub: StoredSubscription, now = Date.now()): Promise<void> {
  const key = `${prefix(host, login)}${await hash(sub.endpoint)}`;
  await kv.put(key, JSON.stringify({ sub, at: now }));
  // Keep the newest devices only.
  const all = await kv.list({ prefix: prefix(host, login) });
  if (all.keys.length > MAX_DEVICES) {
    const rows = await Promise.all(all.keys.map(async (k) => ({ name: k.name, at: (JSON.parse((await kv.get(k.name)) ?? "{}") as { at?: number }).at ?? 0 })));
    rows.sort((a, b) => a.at - b.at);
    for (const old of rows.slice(0, rows.length - MAX_DEVICES)) await kv.delete(old.name);
  }
}

export async function removeSubscription(kv: KVNamespace, host: string, login: string, endpoint: string): Promise<void> {
  await kv.delete(`${prefix(host, login)}${await hash(endpoint)}`);
}

export async function listSubscriptions(kv: KVNamespace, host: string, login: string): Promise<{ key: string; sub: StoredSubscription }[]> {
  const all = await kv.list({ prefix: prefix(host, login) });
  const rows = await Promise.all(
    all.keys.map(async (k) => {
      try {
        const raw = JSON.parse((await kv.get(k.name)) ?? "null") as { sub?: StoredSubscription } | null;
        return raw?.sub && validSubscription(raw.sub) ? { key: k.name, sub: raw.sub } : null;
      } catch {
        return null;
      }
    }),
  );
  return rows.filter((r): r is { key: string; sub: StoredSubscription } => r !== null);
}
