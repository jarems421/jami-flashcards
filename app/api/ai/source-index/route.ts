import { after } from "next/server";
import type { NextRequest } from "next/server";
import { getBearerToken } from "@/lib/auth/bearer";
import { createLogger } from "@/lib/observability/logger";
import {
  deleteSourceIndex,
  rebuildSourceIndex,
} from "@/services/ai/source-index.server";
import { getAdminAuth } from "@/services/firebase/admin";

export const runtime = "nodejs";
export const maxDuration = 120;

async function authenticate(request: NextRequest) {
  const token = getBearerToken(request.headers.get("authorization"));
  if (!token) return null;
  try {
    return (await getAdminAuth().verifyIdToken(token)).uid;
  } catch {
    return null;
  }
}

async function sourceIdFrom(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    return typeof body.sourceId === "string"
      ? body.sourceId.trim().slice(0, 160)
      : "";
  } catch {
    return "";
  }
}

export async function POST(request: NextRequest) {
  const uid = await authenticate(request);
  if (!uid) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const sourceId = await sourceIdFrom(request);
  if (!sourceId) return Response.json({ error: "Source is required" }, { status: 400 });
  const log = createLogger({ route: "ai.source-index", uid, sourceId });
  after(async () => {
    try {
      const result = await rebuildSourceIndex(uid, sourceId);
      log.info("source.indexed", result);
    } catch (error) {
      log.error("source.index_failed", { error });
    }
  });
  return Response.json({ status: "queued" }, { status: 202 });
}

export async function DELETE(request: NextRequest) {
  const uid = await authenticate(request);
  if (!uid) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const sourceId = await sourceIdFrom(request);
  if (!sourceId) return Response.json({ error: "Source is required" }, { status: 400 });
  const deleted = await deleteSourceIndex(uid, sourceId);
  return Response.json({ status: "deleted", deleted });
}
