// Bumped with the navigation strategy, so the old network-first entries go
// rather than lingering beside the new ones.
const STATIC_CACHE = "jami-static-v3";
const APP_SHELL_URLS = [
  "/",
  "/dashboard",
  "/dashboard/study",
  "/dashboard/decks",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/notification-icon-192.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(APP_SHELL_URLS))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    return;
  }

  if (request.mode === "navigate") {
    /*
     * Answer from the cache and refresh behind it.
     *
     * This used to go to the network first and fall back to the cache only when
     * that failed, which made every launch of the installed app wait for a full
     * round trip before anything at all could paint. That wait is the long dark
     * screen before the logo: the page cannot draw what it has not received,
     * and the markup it needs -- brand, background, the whole opening screen --
     * was already sitting in the cache the whole time.
     *
     * The copy is refreshed on every launch, so it is at most one launch behind.
     * That is the cost, and it buys an app that opens rather than loads.
     */
    event.respondWith(
      caches.match(request).then((cached) => {
        const fromNetwork = fetch(request)
          .then((response) => {
            // A redirect cannot be replayed from the cache, and an error page
            // must not become the shell the app opens on.
            if (response.ok && !response.redirected) {
              const copy = response.clone();
              caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(async () => {
            return (
              cached ||
              (await caches.match("/dashboard/study")) ||
              (await caches.match("/")) ||
              new Response("Offline", { status: 503, statusText: "Offline" })
            );
          });

        if (cached) {
          // Kept running: this is what makes the next launch current. Its
          // failure is nobody's problem, since the page has already been served.
          event.waitUntil(fromNetwork.catch(() => undefined));
          return cached;
        }

        return fromNetwork;
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        if (response.ok && (url.pathname.startsWith("/_next/") || url.pathname.startsWith("/icons/"))) {
          const copy = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});

self.addEventListener("push", (event) => {
  const payload = (() => {
    try {
      return event.data ? event.data.json() : {};
    } catch {
      return {
        title: "Jami Flashcards",
        body: event.data ? event.data.text() : "Your daily study digest is ready.",
      };
    }
  })();

  const title = payload.title || "Jami Flashcards";
  const options = {
    body: payload.body || "Your daily study digest is ready.",
    icon: payload.icon || "/icons/notification-icon-192.png",
    badge: payload.badge || "/icons/notification-icon-192.png",
    tag: payload.tag || "daily-digest",
    data: {
      url: payload.url || "/dashboard",
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = new URL(
    event.notification.data && event.notification.data.url
      ? event.notification.data.url
      : "/dashboard",
    self.location.origin
  ).toString();

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url === targetUrl && "focus" in client) {
          return client.focus();
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }

      return undefined;
    })
  );
});
