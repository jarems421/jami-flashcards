// Bumped whenever the navigation strategy changes, so pages cached under the
// old one go rather than lingering beside the new.
const STATIC_CACHE = "jami-static-v4";

/**
 * How long the network gets to produce a current page before the cached one is
 * shown instead.
 *
 * Long enough that an ordinary connection always wins, so the app is running
 * the build that is actually deployed; short enough that a bad one does not
 * mean staring at nothing.
 */
const NAVIGATION_NETWORK_BUDGET_MS = 1_200;
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
     * Take the newest page the network can produce quickly, and the cached one
     * otherwise.
     *
     * Answering from the cache outright is faster and was tried. It is the
     * wrong trade here: the cached page is a whole build of the app, chunk
     * references and all, so serving it means running the *previous* build on
     * every launch. On an app being deployed through the day that means fixes
     * arriving a launch late and bugs reappearing after they were fixed, which
     * costs far more than the wait it saves -- and makes it impossible to tell
     * whether a report is about the current code.
     *
     * The wait it saves is also mostly gone: the reason a launch looked blank
     * was iOS having no launch screen to show, which it now has.
     */
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);

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
          .catch(() => null);

        if (!cached) {
          return (
            (await fromNetwork) ||
            (await caches.match("/dashboard/study")) ||
            (await caches.match("/")) ||
            new Response("Offline", { status: 503, statusText: "Offline" })
          );
        }

        // Something to fall back on, so the network gets a bounded chance to
        // beat it rather than an unlimited one. A slow connection stops meaning
        // a blank screen without a fast one meaning a stale app.
        const timedOut = Symbol("timed out");
        const winner = await Promise.race([
          fromNetwork,
          new Promise((resolve) =>
            setTimeout(() => resolve(timedOut), NAVIGATION_NETWORK_BUDGET_MS)
          ),
        ]);

        if (winner && winner !== timedOut) return winner;

        // Serving what we have; the request above still refreshes the cache.
        event.waitUntil(fromNetwork.catch(() => undefined));
        return cached;
      })()
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
