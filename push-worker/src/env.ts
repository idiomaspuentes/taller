export interface Env {
  SUBSCRIPTIONS: KVNamespace;
  /** Set with `wrangler secret put`. */
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  /** Shared with the Door43 webhook so only Door43 can announce notices. */
  WEBHOOK_SECRET: string;
  VAPID_SUBJECT: string;
  ALLOWED_HOSTS: string;
  ALLOWED_ORIGINS: string;
  APP_URL: string;
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((x) => x.trim().replace(/\/$/, ""))
    .filter(Boolean);
}
