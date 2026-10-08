import "server-only";

import type { NextRequest } from "next/server";
import { getBearerToken } from "@/lib/auth/bearer";
import { getAdminAuth } from "@/services/firebase/admin";

/**
 * The caller's uid, or null when the token is missing or not valid.
 *
 * The one token check for every server route. An expired, malformed and forged
 * token all read as "not signed in", so a caller learns nothing about which it
 * was.
 */
export async function authenticateRequest(request: NextRequest) {
  const token = getBearerToken(request.headers.get("authorization"));
  if (!token) return null;
  try {
    return (await getAdminAuth().verifyIdToken(token)).uid || null;
  } catch {
    return null;
  }
}

export function apiFailure(error: string, status: number, code: string, extra: Record<string, unknown> = {}) {
  return Response.json({ error, code, ...extra }, { status });
}
