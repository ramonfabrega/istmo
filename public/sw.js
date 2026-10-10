const CACHE = "istmo-shell-v1";
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(["/", "/icon.svg", "/manifest.webmanifest"])),
  );
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      ),
  );
  self.clients.claim();
});
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (
    req.method !== "GET" ||
    url.origin !== location.origin ||
    url.pathname.startsWith("/api/")
  )
    return;
  // Hashed build assets are immutable. Keep the shell network-first so a
  // reopened app gets the current release, with offline fallback.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then(async (response) => {
            if (response.ok)
              await (await caches.open(CACHE)).put(req, response.clone());
            return response;
          }),
      ),
    );
    return;
  }
  event.respondWith(
    fetch(req)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)));
        }
        return response;
      })
      .catch(
        async () =>
          (await caches.match(req)) ||
          (req.mode === "navigate" ? await caches.match("/") : undefined) ||
          new Response("Offline", { status: 503 }),
      ),
  );
});

self.addEventListener("push", (event) => {
  let data = {
    title: "Istmo",
    body: "New earthquake report",
    url: "/",
    tag: "istmo",
  };
  try {
    Object.assign(data, event.data.json());
  } catch {}
  const receivedAt = Date.now();
  event.waitUntil(
    (async () => {
      let shownAt = null;
      try {
        await self.registration.showNotification(data.title, {
          body: data.body,
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          tag: data.tag,
          data: { url: data.url },
        });
        shownAt = Date.now();
      } finally {
        // Showing the notification always comes first. A missing receipt does not
        // prove delivery failed; this best-effort callback can itself be offline.
        const tasks = [
          self.clients
            .matchAll({ type: "window" })
            .then((windows) => {
              for (const client of windows)
                client.postMessage({
                  type: "istmo:report",
                  after: data.delivery?.catalogAfter || 0,
                });
            })
            .catch(() => {}),
        ];
        if (data.delivery?.id && data.delivery?.token) {
          const ua = self.navigator.userAgent;
          const deviceKind =
            /iPhone|iPad|iPod/.test(ua) ||
            (self.navigator.platform === "MacIntel" &&
              self.navigator.maxTouchPoints > 1)
              ? "ios"
              : /Android/.test(ua)
                ? "android"
                : /Macintosh/.test(ua)
                  ? "mac"
                  : /Windows/.test(ua)
                    ? "windows"
                    : "other";
          tasks.push(
            fetch("/api/push/receipt", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ...data.delivery,
                receivedAt,
                shownAt,
                deviceKind,
              }),
              signal: AbortSignal.timeout(5000),
            }).catch(() => {}),
          );
        }
        await Promise.all(tasks);
      }
    })(),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow("/"));
});
