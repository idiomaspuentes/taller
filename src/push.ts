import type { GtSession } from "./dcs/auth";

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
  if (!key.publicKey) throw new Error("El servicio de avisos no respondió.");
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key.publicKey) });
  const res = await deps.fetch(`${deps.url}/subscribe`, { method: "POST", headers: headers(session), body: JSON.stringify({ subscription: sub.toJSON() }) });
  if (!res.ok) {
    await sub.unsubscribe().catch(() => false);
    throw new Error(res.status === 401 ? "No se pudo comprobar tu sesión para activar los avisos." : "No se pudieron activar los avisos.");
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
