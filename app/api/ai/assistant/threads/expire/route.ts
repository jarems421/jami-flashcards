import type { NextRequest } from "next/server";
import { createLogger } from "@/lib/observability/logger";
import { getCronAuthorizationStatus } from "@/services/auth/cron-authorization";
import {
  ASSISTANT_THREAD_RETENTION_MS,
  deleteExpiredAssistantThreads,
} from "@/services/ai/assistant-thread-cleanup.server";

export const runtime = "nodejs";
export const maxDuration = 300;

const log = createLogger({ route: "ai.assistant.threads.expire" });

/**
 * Removes Jami chats that have had no new message for the retention window.
 *
 * Bounded per run rather than draining everything at once: a run that tried to
 * clear a backlog in one pass would sit against the function's time limit and
 * be killed part way, and this is a job with no deadline -- whatever is missed
 * is picked up tomorrow, because nothing about an expired thread changes.
 */
export async function GET(request: NextRequest) {
  const authorizationStatus = getCronAuthorizationStatus({
    authorizationHeader: request.headers.get("authorization"),
    configuredSecret: process.env.CRON_SECRET,
  });
  if (authorizationStatus === "misconfigured") {
    log.error("cron.misconfigured", { missing: "CRON_SECRET" });
    return Response.json(
      { ok: false, error: "Chat expiry cron is not configured." },
      { status: 503 }
    );
  }
  if (authorizationStatus === "unauthorized") {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const result = await deleteExpiredAssistantThreads();
    log.info("threads.expired", {
      ...result,
      retentionDays: Math.round(ASSISTANT_THREAD_RETENTION_MS / 86_400_000),
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    log.error("threads.expire_failed", { error });
    return Response.json(
      { ok: false, error: "Chat expiry did not complete." },
      { status: 500 }
    );
  }
}
