import type { NextRequest } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import {
  ANALYTICS_SCHEMA_VERSION,
  getAnalyticsDayKey,
  sanitiseAnalyticsBatch,
} from "@/lib/analytics/events";
import { getBearerToken } from "@/lib/auth/bearer";
import { createRateLimiter } from "@/lib/http/rate-limit";
import { createLogger } from "@/lib/observability/logger";
import { getAdminAuth, getAdminDb } from "@/services/firebase/admin";

export const runtime = "nodejs";

const log = createLogger({ route: "analytics.events" });

/**
 * A browser sending more than this is either broken or probing. Per instance,
 * which is the right weight for something that must never slow a page down.
 */
const batches = createRateLimiter({ limit: 60, windowMs: 60_000 });

/**
 * Counts what happened, and stores nothing that could identify a student or
 * what they were working on.
 *
 * Daily aggregates rather than an event log. The question this exists to answer
 * -- which of eleven destinations anybody opens -- is a counting question, and
 * counters stay one document per day however much the app is used, where raw
 * events would grow without bound and hold a browsing history nobody asked for.
 *
 * The client cannot write these directly. Everything arrives through here so
 * the server decides what a valid event is: a browser cannot invent an event
 * name, attach an arbitrary field, or record against another user.
 */
export async function POST(request: NextRequest) {
  const token = getBearerToken(request.headers.get("authorization"));
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let uid: string;
  try {
    uid = (await getAdminAuth().verifyIdToken(token)).uid;
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = batches.check(uid);
  if (!limit.allowed) {
    return Response.json(
      { error: "Too many analytics batches." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  let body: { events?: unknown };
  try {
    body = (await request.json()) as { events?: unknown };
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const now = Date.now();
  const events = sanitiseAnalyticsBatch(body.events, now);
  if (!events.length) return Response.json({ recorded: 0 });

  /*
   * Grouped by the day the event happened rather than the day it arrived, so a
   * batch flushed just after midnight -- or held while a phone was offline --
   * still lands in the day the student was studying.
   */
  const byDay = new Map<string, Record<string, FieldValue>>();
  for (const event of events) {
    const dayKey = getAnalyticsDayKey(event.at);
    const updates = byDay.get(dayKey) ?? {};

    updates[`events.${event.name.replace(/\./g, "_")}`] = FieldValue.increment(1);
    if (typeof event.props?.route === "string") {
      // Slashes and dots are field-path syntax in Firestore, so a route becomes
      // a flat key. `/dashboard/notebooks/[id]` -> `dashboard~notebooks~[id]`.
      const routeKey = event.props.route.replace(/^\//, "").replace(/[./[\]#$]/g, "~") || "root";
      updates[`routes.${routeKey}`] = FieldValue.increment(1);
    }
    byDay.set(dayKey, updates);
  }

  try {
    const db = getAdminDb();
    await Promise.all(
      [...byDay.entries()].map(([dayKey, updates]) =>
        db
          .collection("analyticsDaily")
          .doc(dayKey)
          .set(
            { dayKey, schemaVersion: ANALYTICS_SCHEMA_VERSION, updatedAt: now, ...updates },
            { merge: true }
          )
      )
    );
  } catch (error) {
    // Losing a batch costs a slightly low count. Failing the request costs the
    // student nothing useful, so it is not worth doing.
    log.warn("record.failed", {
      batchSize: events.length,
      errorMessage: error instanceof Error ? error.message : "unknown",
    });
  }

  return Response.json({ recorded: events.length });
}
