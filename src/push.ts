import type { GtSession } from "./dcs/auth";
import type { Ask } from "./domain/askNotices";
import { getUiLanguage, onUiLanguageChange } from "./i18n/language";
import { tNow } from "./i18n/messages";

/**
 * Notices with the app closed (Web Push). The device subscribes with the browser's push service and
 * registers itself in the push Worker (push-worker/) with the person's Door43 token, which the Worker only uses to
 * learn who they are. Off unless `VITE_PUSH_URL` points at the Worker.
 */

export type PushState = "unsupported" | "off" | "on" | "denied";

type Subscription = { toJSON(): unknown; endpoint: string; unsubscribe(): Promise<boolean> };
type PushRegistration = {
  pushManager: { getSubscription(): Promise<Subscription | null>; subscribe(options: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }): Promise<Subscription> };
};
export type PushDeps = {
  /** Address of the Worker (no trailing slash); empty = the feature is off. */
  url: string;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  /** The state of the browser's permission. */
  permission: () => NotificationPermission | "unsupported";
  requestPermission: () => Promise<NotificationPermission>;
  registration: () => Promise<PushRegistration | null>;
};

/** The key the Worker serves comes base64url encoded; the browser wants bytes. */
export function urlBase64ToUint8Array(value: string): Uint8Array {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function headers(session: Pick<GtSession, "token" | "host">): Record<string, string> {
  return { authorization: `token ${session.token}`, "x-door43-host": session.host.replace(/\/$/, ""), "content-type": "application/json" };
}

export async function pushState(deps: PushDeps): Promise<PushState> {
  if (!deps.url) return "unsupported";
  const permission = deps.permission();
  if (permission === "unsupported") return "unsupported";
  if (permission === "denied") return "denied";
  const reg = await deps.registration().catch(() => null);
  if (!reg) return "unsupported";
  return (await reg.pushManager.getSubscription().catch(() => null)) ? "on" : "off";
}

export async function enablePush(deps: PushDeps, session: Pick<GtSession, "token" | "host">): Promise<PushState> {
  if (!deps.url || deps.permission() === "unsupported") return "unsupported";
  const permission = deps.permission() === "granted" ? "granted" : await deps.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const reg = await deps.registration();
  if (!reg) return "unsupported";
  const key = (await (await deps.fetch(`${deps.url}/vapid`)).json()) as { publicKey?: string };
  if (!key.publicKey) throw new Error(tNow("push.noKey"));
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key.publicKey) });
  const res = await deps.fetch(`${deps.url}/subscribe`, { method: "POST", headers: headers(session), body: JSON.stringify({ subscription: sub.toJSON(), lang: getUiLanguage() }) });
  if (!res.ok) {
    await sub.unsubscribe().catch(() => false);
    throw new Error(tNow(res.status === 401 ? "push.noAuth" : "push.failed"));
  }
  return "on";
}

export async function disablePush(deps: PushDeps, session: Pick<GtSession, "token" | "host">): Promise<PushState> {
  const reg = await deps.registration().catch(() => null);
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  if (sub) {
    await deps.fetch(`${deps.url}/subscribe`, { method: "DELETE", headers: headers(session), body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => undefined);
    await sub.unsubscribe().catch(() => false);
  }
  return "off";
}

/**
 * Tell the Worker the language this device reads in, when it is already subscribed: notices are worded for each
 * device. Called when the app opens and when the person changes the language.
 */
export async function syncPushLanguage(deps: PushDeps, session: Pick<GtSession, "token" | "host">): Promise<void> {
  if (!deps.url || deps.permission() !== "granted") return;
  const reg = await deps.registration().catch(() => null);
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  if (!sub) return;
  await deps.fetch(`${deps.url}/subscribe`, { method: "POST", headers: headers(session), body: JSON.stringify({ subscription: sub.toJSON(), lang: getUiLanguage() }) }).catch(() => undefined);
}

/** Keep the Worker told of this device's language for as long as the session lasts; returns how to stop. */
export function keepPushLanguage(session: Pick<GtSession, "token" | "host">): () => void {
  const deps = browserPushDeps();
  void syncPushLanguage(deps, session);
  return onUiLanguageChange(() => void syncPushLanguage(deps, session));
}

/** The most notices one action asks for: closing a subtarea frees a few, not a book. */
const MAX_ASKS = 12;

/**
 * Ask the Worker to tell people what Door43 does not announce (see `domain/askNotices`). On the side: nothing waits
 * for it and nothing fails because of it. Off when the Worker is not configured.
 */
export function askNotices(session: Pick<GtSession, "token" | "host">, where: { org: string; repo: string }, asks: Ask[]): void {
  const url = String(import.meta.env.VITE_PUSH_URL ?? "").replace(/\/$/, "");
  if (!url || typeof fetch === "undefined") return;
  for (const ask of asks.slice(0, MAX_ASKS)) {
    void fetch(`${url}/notify`, { method: "POST", headers: headers(session), body: JSON.stringify({ ...where, ...ask }) }).catch(() => undefined);
  }
}

/** The browser's real pieces, for the app. */
export function browserPushDeps(): PushDeps {
  const url = String(import.meta.env.VITE_PUSH_URL ?? "").replace(/\/$/, "");
  const supported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && window.isSecureContext;
  return {
    url: supported ? url : "",
    fetch: (input, init) => fetch(input, init),
    permission: () => (typeof Notification === "undefined" ? "unsupported" : Notification.permission),
    requestPermission: () => Notification.requestPermission(),
    registration: async () => {
      if (!("serviceWorker" in navigator)) return null;
      // Right after opening the app the worker may still be starting: wait for it a moment.
      const ready = await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
      return (ready ?? (await navigator.serviceWorker.getRegistration()) ?? null) as unknown as PushRegistration | null;
    },
  };
}
