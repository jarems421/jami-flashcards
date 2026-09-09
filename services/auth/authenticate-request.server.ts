import "server-only";

import type { NextRequest } from "next/server";
import { getBearerToken } from "@/lib/auth/bearer";
import { getAdminAuth } from "@/services/firebase/admin";

/** The caller's uid, or null when the token is missing or not valid. */
export async function authenticateRequest(request: NextRequest) {
  const token = getBearerToken(request.headers.get("authorization"));
  if (!token) return null;
  try {
    return (await getAdminAuth().verifyIdToken(token)).uid || null;
  } catch {
    return null;
  }
}

/**
 * The caller, for a route that stores something on their behalf.
 *
 * Firestore rules refuse a demo account every write in the app, but they are
 * not in the path of a server route -- the Admin SDK writes straight past them.
 * So a route that creates a session, freezes an answer or spends the AI budget
 * has to ask the question itself, and gets null here rather than a uid.
 *
 * `authenticateRequest` stays the right call for a read: a demo account is
 * allowed to look at its own material, it simply cannot add to it.
 */
export async function authenticateWriteRequest(request: NextRequest) {
  const token = getBearerToken(request.headers.get("authorization"));
  if (!token) return null;
  try {
    const claims = await getAdminAuth().verifyIdToken(token);
    return claims.demo === true ? null : claims.uid || null;
  } catch {
    return null;
  }
}

export function apiFailure(error: string, status: number, code: string, extra: Record<string, unknown> = {}) {
  return Response.json({ error, code, ...extra }, { status });
}
