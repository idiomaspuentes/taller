/* TAS service worker: lets the app install and open offline (shell only).
 * Door43 requests are never cached: they are cross-origin and always live. */
const CACHE = "tas-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(["./", "./manifest.webmanifest", "./icon-192.png"])),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Pages: network first, the cached shell when there is no connection.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put("./", copy));
          return response;
        })
        .catch(() => caches.match("./")),
    );
    return;
  }

  // Built files carry a hash in their name: safe to keep and reuse.
  if (url.pathname.includes("/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
  }
});

/* Notices with the app closed (Web Push). The push Worker sends {title, body, url, tag}. */
self.addEventListener("push", (event) => {
  let notice = {};
  try {
    notice = event.data ? event.data.json() : {};
  } catch {
    notice = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(notice.title || "TAS", {
      body: notice.body || "",
      // The same subtarea replaces its earlier notice instead of piling up.
      tag: notice.tag || undefined,
      renotify: Boolean(notice.tag),
      icon: "icon-192.png",
      badge: "icon-192.png",
      data: { url: notice.url || "./" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "./";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if ("focus" in client) {
          client.focus();
          if ("navigate" in client) client.navigate(url).catch(() => {});
          return undefined;
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
