/**
 * The network and cache side of keeping an installed app current. The rules
 * for when to act live in `lib/app/app-build.ts`.
 */

const VERSION_TIMEOUT_MS = 4_000;

/** The build the server is serving now, or null when it cannot be asked. */
export async function fetchDeployedBuild(): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VERSION_TIMEOUT_MS);
  try {
    const response = await fetch("/api/app-version", {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const build =
      body && typeof body === "object" && "build" in body ? (body as { build: unknown }).build : null;
    return typeof build === "string" ? build : null;
  } catch {
    // Offline or slow: keep running and ask again next time.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Everything a reload could otherwise be answered from.
 *
 * The service worker would serve the old page again if the network were slow,
 * and that page names the old build's chunks, which are cached too. Emptying
 * the caches first means the reload can only come from the server. The worker
 * is asked to update as well, so an older worker does not outlive its caches.
 */
export async function clearCachedBuild() {
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
    const registration = await navigator.serviceWorker?.getRegistration("/");
    await registration?.update();
  } catch {
    // A reload from the network still happens; this only makes it certain.
  }
}
