import "server-only";

import type { NextRequest } from "next/server";
import { getBearerToken } from "@/lib/auth/bearer";
import { getAdminAuth } from "@/services/firebase/admin";

function reviewerUids() {
  return new Set(
    (process.env.PAPER_QUALITY_REVIEWER_UIDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => /^[A-Za-z0-9:_-]{4,160}$/.test(value))
  );
}

export function paperQualityReviewerConfigured() {
  return reviewerUids().size > 0;
}

export async function authenticatePaperQualityReviewer(request: NextRequest) {
  const allowed = reviewerUids();
  if (allowed.size === 0) return { ok: false as const, status: 503, code: "reviewer_not_configured" };
  const token = request.headers.get("x-jami-firebase-id-token")?.trim()
    ?? getBearerToken(request.headers.get("authorization"));
  if (!token) return { ok: false as const, status: 401, code: "unauthorized" };
  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    if (!allowed.has(decoded.uid)) return { ok: false as const, status: 403, code: "forbidden" };
    return { ok: true as const, uid: decoded.uid };
  } catch {
    return { ok: false as const, status: 401, code: "unauthorized" };
  }
}
