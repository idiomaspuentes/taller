/* Taller service worker: lets the app install and open offline (shell only).
 * Door43 requests are never cached: they are cross-origin and always live. */
const CACHE = "taller-shell-v2";

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

/* Notices with the app closed (Web Push). The push Worker sends {title, body, url, tag, grouped}.
 * Many notices must not mean many buzzes:
 *  - a notice whose tag is already on screen REPLACES it, silently, and counts ("3 avisos nuevos en …");
 *  - past MAX_VISIBLE different notices on screen, they all fold into one summary. */
const MAX_VISIBLE = 4;
const SUMMARY = "resumen";

/** The page that lists everything: where a grouped notice leads. */
function listUrl(url) {
  try {
    const u = new URL(url, self.registration.scope);
    u.hash = "#/mis-tareas";
    return u.href;
  } catch {
    return "./#/mis-tareas";
  }
}

function showNotice(notice, count, silent, url) {
  return self.registration.showNotification(notice.title || "Taller", {
    body: notice.body || "",
    tag: notice.tag || undefined,
    // renotify would buzz again on every replacement: only the first notice of a group does.
    renotify: false,
    silent,
    icon: "icon-192.png",
    badge: "icon-192.png",
    data: { url: url || notice.url || "./", count },
  });
}

async function handlePush(notice) {
  const shown = await self.registration.getNotifications();
  const summary = shown.find((n) => n.tag === SUMMARY);
  const same = shown.find((n) => n.tag === notice.tag && n.tag !== SUMMARY);

  // A summary is already up: everything new joins it.
  if (summary) {
    const count = ((summary.data && summary.data.count) || 1) + 1;
    return showNotice({ title: `${count} avisos nuevos en Taller`, body: notice.title || "", tag: SUMMARY }, count, true, listUrl(notice.url || "./"));
  }

  // The same subtarea (or the same kind of notice) is already up: replace it, quietly.
  if (same) {
    const count = ((same.data && same.data.count) || 1) + 1;
    const grouped = notice.grouped ? notice.grouped.replace("{n}", String(count)) : notice.title;
    const url = notice.tag === "asignaciones" ? listUrl(notice.url || "./") : notice.url;
    return showNotice({ ...notice, title: grouped }, count, true, url);
  }

  // Too many different notices: fold them into one.
  if (shown.length >= MAX_VISIBLE) {
    const total = shown.reduce((sum, n) => sum + ((n.data && n.data.count) || 1), 0) + 1;
    shown.forEach((n) => n.close());
    return showNotice({ title: `${total} avisos nuevos en Taller`, body: "Toca para ver tus tareas.", tag: SUMMARY }, total, true, listUrl(notice.url || "./"));
  }

  return showNotice(notice, 1, false, notice.url);
}

self.addEventListener("push", (event) => {
  let notice = {};
  try {
    notice = event.data ? event.data.json() : {};
  } catch {
    notice = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(handlePush(notice));
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
