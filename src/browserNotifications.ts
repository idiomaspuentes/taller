import { useCallback, useEffect, useState } from "react";
import {
  emptyNotified,
  notificationHref,
  parseNotified,
  type NotifiedDoc,
  type NotifyCandidate,
  type NotifyPermission,
} from "./domain/browserNotify";

/** Page Notification API only (no service worker, no push). */
export function notificationPermission(): NotifyPermission {
  if (typeof window === "undefined" || !("Notification" in window) || !window.isSecureContext) {
    return "unsupported";
  }
  const value = Notification.permission;
  return value === "granted" || value === "denied" ? value : "default";
}

export async function requestNotificationPermission(): Promise<NotifyPermission> {
  if (notificationPermission() === "unsupported") return "unsupported";
  try {
    // Older Safari only supports the callback form.
    await new Promise<NotificationPermission>((resolve) => {
      const maybe = Notification.requestPermission(resolve);
      if (maybe) void maybe.then(resolve, () => resolve(Notification.permission));
    });
  } catch {
    /* fall through to the current value */
  }
  return notificationPermission();
}

export function loadNotified(key: string): NotifiedDoc {
  try {
    return parseNotified(localStorage.getItem(key));
  } catch {
    return emptyNotified();
  }
}

export function saveNotified(key: string, doc: NotifiedDoc): void {
  try {
    localStorage.setItem(key, JSON.stringify(doc));
  } catch {
    /* quota / private mode: worst case one repeated notification */
  }
}

export function showAttentionNotification(candidate: NotifyCandidate): void {
  if (notificationPermission() !== "granted") return;
  try {
    const notification = new Notification(candidate.title, {
      body: candidate.body,
      lang: "es",
      // Same item from two tabs replaces instead of stacking.
      tag: `tas-${candidate.id}`,
    });
    notification.onclick = () => {
      window.focus();
      window.location.hash = notificationHref(candidate);
      notification.close();
    };
  } catch {
    /* some browsers (Android Chrome) require a service worker; skip */
  }
}

/** Current permission, refreshed on focus and when the browser reports a change. */
export function useNotificationPermission(): {
  permission: NotifyPermission;
  request: () => Promise<void>;
  refresh: () => void;
} {
  const [permission, setPermission] = useState<NotifyPermission>(notificationPermission);
  const refresh = useCallback(() => setPermission(notificationPermission()), []);

  useEffect(() => {
    window.addEventListener("focus", refresh);
    let status: PermissionStatus | null = null;
    let cancelled = false;
    navigator.permissions
      ?.query({ name: "notifications" as PermissionName })
      .then((result) => {
        if (cancelled) return;
        status = result;
        status.onchange = refresh;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refresh);
      if (status) status.onchange = null;
    };
  }, [refresh]);

  const request = useCallback(async () => {
    setPermission(await requestNotificationPermission());
  }, []);

  return { permission, request, refresh };
}
