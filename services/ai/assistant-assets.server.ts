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
