import type { NextRequest } from "next/server";
import { getCronAuthorizationStatus } from "@/services/auth/cron-authorization";
import { runNotificationDigest } from "@/services/notifications/digest";
import { createLogger } from "@/lib/observability/logger";

export const runtime = "nodejs";
export const maxDuration = 300;

const log = createLogger({ route: "notifications.digest" });

/**
 * Called every hour. Each student's nudges follow their own clock -- 4pm, and
 * 7pm while Daily Review is waiting -- so every run looks at everyone and sends
 * only what is due where they are.
 */
export async function GET(request: NextRequest) {
  const authorizationStatus = getCronAuthorizationStatus({
    authorizationHeader: request.headers.get("authorization"),
    configuredSecret: process.env.CRON_SECRET,
  });
  if (authorizationStatus === "misconfigured") {
    log.error("cron.misconfigured", { missing: "CRON_SECRET" });
    return Response.json(
      { ok: false, error: "Notification digest cron is not configured." },
      { status: 503 }
    );
  }
  if (authorizationStatus === "unauthorized") {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const summary = await runNotificationDigest({ now: Date.now() });
    return Response.json({ ok: true, ...summary });
  } catch (error) {
    log.error("digest.failed", { error });
    return Response.json(
      { ok: false, error: "Notification digest could not be completed." },
      { status: 500 }
    );
  }
}
