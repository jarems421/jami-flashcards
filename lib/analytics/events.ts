/**
 * What gets measured, and what deliberately does not.
 *
 * The app has eleven destinations and no way to tell which of them anybody
 * opens, so every product decision -- including which features to keep -- has
 * been taste. This is the smallest thing that answers "what is actually used",
 * and it is built to be answerable without collecting anything a student would
 * mind being collected.
 *
 * Three rules hold the privacy line, and they are enforced here rather than
 * left to call sites:
 *
 *   1. Event names come from a fixed list. An event this file has not heard of
 *      is dropped, so nothing can start recording something new by accident.
 *   2. Route paths are reduced to their pattern. `/dashboard/notebooks/abc123`
 *      is recorded as `/dashboard/notebooks/[id]`, because the id is the
 *      student's own data and a path full of ids is a behavioural fingerprint.
 *   3. Properties are short scalars from a fixed set of keys. There is no field
 *      a card front, a note, or a search term could travel in.
 */

export const ANALYTICS_SCHEMA_VERSION = 1;

/** How many events one request may carry. */
export const MAX_ANALYTICS_BATCH = 50;

/**
 * Every event the app is allowed to record.
 *
 * Route views answer the question this exists for. The handful of actions
 * beside them are the moments worth knowing about even when a route view
 * cannot tell you: whether somebody who opened a thing ever finished it.
 */
export const ANALYTICS_EVENTS = [
  "route.view",
  "study.session.started",
  "study.session.completed",
  "card.created",
  "deck.created",
  "notebook.created",
  "source.cards.approved",
  "video.import.approved",
  "practice.paper.requested",
  "tutor.message.sent",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

const EVENT_NAMES = new Set<string>(ANALYTICS_EVENTS);

/** The only property keys that may be attached, and what they may hold. */
const ALLOWED_PROPERTY_KEYS = new Set(["route", "count", "seconds", "mode", "source"]);

const MAX_PROPERTY_LENGTH = 64;

export type AnalyticsEvent = {
  name: AnalyticsEventName;
  at: number;
  props?: Record<string, string | number | boolean>;
};

/**
 * A route reduced to the code that rendered it.
 *
 * Firestore ids, uuids and long opaque slugs become `[id]`. What survives is
 * the shape of the route, which is what a usage question is actually about --
 * "do people open notebooks", not "who opened which notebook".
 */
export function normaliseRoutePath(path: string): string {
  const [withoutQuery] = path.split(/[?#]/);
  const segments = withoutQuery.split("/").filter(Boolean);

  const normalised = segments.map((segment) => {
    if (segment.length >= 16) return "[id]";
    if (/^\d+$/.test(segment)) return "[id]";
    // Mixed-case alphanumerics of any length are how Firestore ids read; a
    // real route segment is lowercase words and hyphens.
    if (/[A-Z]/.test(segment) && /\d/.test(segment)) return "[id]";
    if (!/^[a-z0-9-]+$/.test(segment)) return "[id]";
    return segment;
  });

  return `/${normalised.join("/")}`;
}

function sanitiseProperties(value: unknown): Record<string, string | number | boolean> | undefined {
  if (!value || typeof value !== "object") return undefined;

  const props: Record<string, string | number | boolean> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!ALLOWED_PROPERTY_KEYS.has(key)) continue;
    if (typeof raw === "number") {
      if (Number.isFinite(raw)) props[key] = raw;
      continue;
    }
    if (typeof raw === "boolean") {
      props[key] = raw;
      continue;
    }
    if (typeof raw === "string") {
      const trimmed = raw.trim().slice(0, MAX_PROPERTY_LENGTH);
      if (trimmed) props[key] = key === "route" ? normaliseRoutePath(trimmed) : trimmed;
    }
  }

  return Object.keys(props).length > 0 ? props : undefined;
}

/**
 * Turns whatever arrived into an event worth storing, or nothing.
 *
 * Runs on the server against the request body as well as on the client, so a
 * forged request cannot write an event shape the report does not expect.
 */
export function sanitiseAnalyticsEvent(raw: unknown, now: number): AnalyticsEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;

  const name = typeof value.name === "string" ? value.name : "";
  if (!EVENT_NAMES.has(name)) return null;

  /*
   * Client clocks are wrong often enough to matter. A timestamp more than a day
   * out in either direction is replaced rather than trusted, so a device set to
   * 1970 cannot land events outside every report window.
   */
  const DAY_MS = 24 * 60 * 60 * 1000;
  const claimed = typeof value.at === "number" && Number.isFinite(value.at) ? value.at : now;
  const at = Math.abs(claimed - now) > DAY_MS ? now : claimed;

  const props = sanitiseProperties(value.props);
  return { name: name as AnalyticsEventName, at, ...(props ? { props } : {}) };
}

/** Validates a whole batch, dropping anything unrecognised. */
export function sanitiseAnalyticsBatch(raw: unknown, now: number): AnalyticsEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_ANALYTICS_BATCH)
    .map((event) => sanitiseAnalyticsEvent(event, now))
    .filter((event): event is AnalyticsEvent => event !== null);
}

/** The day a report groups by, in UTC. */
export function getAnalyticsDayKey(at: number) {
  return new Date(at).toISOString().slice(0, 10);
}
