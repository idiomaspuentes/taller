/**
 * Push subscriptions in KV: ONE key per person (their devices together), so that telling someone
 * costs a single read. The free plan allows 100 000 reads a day but only 1 000 list operations.
 */
export type StoredSubscription = {
  endpoint: string;
  expirationTime: number | null;
  keys: { auth: string; p256dh: string };
};

/** Most devices one person may have subscribed; the oldest is dropped past this. */
export const MAX_DEVICES = 5;

export const personKey = (host: string, login: string) => `u:${host}:${login.toLowerCase()}`;

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

type Device = { sub: StoredSubscription; at: number };

async function readDevices(kv: KVNamespace, key: string): Promise<Device[]> {
  try {
    const raw = JSON.parse((await kv.get(key)) ?? "null") as { devices?: Device[] } | null;
    return (raw?.devices ?? []).filter((d) => d && validSubscription(d.sub));
  } catch {
    return [];
  }
}

async function writeDevices(kv: KVNamespace, key: string, devices: Device[]): Promise<void> {
  if (devices.length === 0) await kv.delete(key);
  else await kv.put(key, JSON.stringify({ devices }));
}

export async function saveSubscription(kv: KVNamespace, host: string, login: string, sub: StoredSubscription, now = Date.now()): Promise<void> {
  const key = personKey(host, login);
  const others = (await readDevices(kv, key)).filter((d) => d.sub.endpoint !== sub.endpoint);
  // Keep the newest devices only.
  const devices = [...others, { sub, at: now }].sort((a, b) => a.at - b.at).slice(-MAX_DEVICES);
  await writeDevices(kv, key, devices);
}

export async function removeSubscription(kv: KVNamespace, host: string, login: string, endpoint: string): Promise<void> {
  const key = personKey(host, login);
  const devices = await readDevices(kv, key);
  const kept = devices.filter((d) => d.sub.endpoint !== endpoint);
  if (kept.length !== devices.length) await writeDevices(kv, key, kept);
}

export async function listSubscriptions(kv: KVNamespace, host: string, login: string): Promise<StoredSubscription[]> {
  return (await readDevices(kv, personKey(host, login))).map((d) => d.sub);
}
