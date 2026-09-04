import {
  MAX_ANALYTICS_BATCH,
  normaliseRoutePath,
  type AnalyticsEvent,
  type AnalyticsEventName,
} from "@/lib/analytics/events";
import { auth } from "@/services/firebase/client";

/**
 * Queues what happened and sends it in batches.
 *
 * Deliberately unreliable in one direction only: an event that cannot be sent
 * is dropped rather than retried forever, and every failure path is silent. A
 * measurement layer that can break a study session, block a navigation, or
 * spam a console has cost more than it is worth.
 *
 * Events go to an authenticated server route rather than straight to Firestore.
 * That keeps the write off the client's Firestore rules entirely, and means the
 * server decides what a valid event is -- a browser cannot invent an event name
 * or attach a field to it.
 */

const FLUSH_AFTER_MS = 10_000;
const FLUSH_AT_COUNT = 20;

let queue: AnalyticsEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

async function send(events: AnalyticsEvent[]) {
  if (!events.length) return;
  const user = auth.currentUser;
  if (!user) return;

  try {
    const token = await user.getIdToken();
    await fetch("/api/analytics/events", {
      method: "POST",
      // Survives the page being closed, which is exactly when the last and most
      // interesting events of a session are sitting in the queue.
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ events }),
    });
  } catch {
    // Dropped on purpose. See the note above.
  }
}

export function flushAnalytics() {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  const pending = queue;
  queue = [];
  void send(pending);
}

function ensureFlushOnLeave() {
  if (listening || typeof document === "undefined") return;
  listening = true;
  // `visibilitychange` fires where `beforeunload` does not, notably on mobile
  // Safari when the app is backgrounded -- which for this app is most sessions.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushAnalytics();
  });
}

/**
 * Records that something happened. Never throws, never blocks, never awaits.
 */
export function track(
  name: AnalyticsEventName,
  props?: Record<string, string | number | boolean>
) {
  if (typeof window === "undefined") return;
  ensureFlushOnLeave();

  queue.push({ name, at: Date.now(), ...(props ? { props } : {}) });
  if (queue.length >= MAX_ANALYTICS_BATCH) {
    flushAnalytics();
    return;
  }
  if (queue.length >= FLUSH_AT_COUNT) {
    flushAnalytics();
    return;
  }
  if (timer === null) {
    timer = setTimeout(flushAnalytics, FLUSH_AFTER_MS);
  }
}

/** Records a page view, with the route reduced to its pattern. */
export function trackRouteView(path: string) {
  track("route.view", { route: normaliseRoutePath(path) });
}
