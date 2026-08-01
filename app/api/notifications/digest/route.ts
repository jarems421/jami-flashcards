import type { NextRequest } from "next/server";
import {
  getStudyDayKey,
  isWithinStudyDayBoundaryWindow,
} from "@/lib/study/day";
import { getCronAuthorizationStatus } from "@/services/auth/cron-authorization";
import { runNotificationDigest } from "@/services/notifications/digest";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authorizationStatus = getCronAuthorizationStatus({
    authorizationHeader: request.headers.get("authorization"),
    configuredSecret: process.env.CRON_SECRET,
  });
  if (authorizationStatus === "misconfigured") {
    console.error("Notification digest cron is disabled because CRON_SECRET is missing.");
    return Response.json(
      { ok: false, error: "Notification digest cron is not configured." },
      { status: 503 }
    );
  }
  if (authorizationStatus === "unauthorized") {
    return new Response("Unauthorized", { status: 401 });
  }

  const now = Date.now();
  const studyDayKey = getStudyDayKey(now);
  if (!isWithinStudyDayBoundaryWindow(now, 20 * 60 * 1000)) {
    return Response.json({
      ok: true,
      skipped: true,
      reason: "outside-study-window",
      studyDayKey,
    });
  }

  try {
    const summary = await runNotificationDigest({ now, studyDayKey });
    return Response.json({
      ok: true,
      studyDayKey,
      ...summary,
    });
  } catch (error) {
    console.error("Notification digest orchestration failed.", error);
    return Response.json(
      { ok: false, error: "Notification digest could not be completed." },
      { status: 500 }
    );
  }
}
