import "server-only";

import type { NextRequest } from "next/server";
import { getBearerToken } from "@/lib/auth/bearer";
import { getAdminAuth } from "@/services/firebase/admin";

export async function authenticateAssistantAssetRequest(request: NextRequest) {
  const token = getBearerToken(request.headers.get("authorization"));
  if (!token) return null;
  try {
    return (await getAdminAuth().verifyIdToken(token)).uid;
  } catch {
    return null;
  }
}

export function assistantAssetError(error: string, status: number, code: string) {
  return Response.json({ error, code }, { status });
}

/**
 * The caller, and whether they are a demo account.
 *
 * Firestore rules already refuse a demo account every write in the app, but
 * they are not in the path of a server route: the Admin SDK writes past them.
 * Any route that stores something on a student's behalf therefore has to ask
 * the question itself, and this is where it is asked so the answer is the same
 * everywhere.
 */
export async function authenticateAssistantWriter(request: NextRequest) {
  const token = getBearerToken(request.headers.get("authorization"));
  if (!token) return null;
  try {
    const claims = await getAdminAuth().verifyIdToken(token);
    return { uid: claims.uid, isDemo: claims.demo === true };
  } catch {
    return null;
  }
}
