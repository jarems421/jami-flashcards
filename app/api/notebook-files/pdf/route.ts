import type { NextRequest } from "next/server";
import { getBearerToken } from "@/lib/auth/bearer";
import {
  MAX_NOTEBOOK_FILE_SIZE,
  validateOwnedNotebookPdfStoragePath,
} from "@/lib/workspace/notebook-pdf";
import {
  getAdminAuth,
  getAdminStorageBucket,
} from "@/services/firebase/admin";
import { createLogger } from "@/lib/observability/logger";
import { createRateLimiter } from "@/lib/http/rate-limit";

export const runtime = "nodejs";

/**
 * Enough for a notebook of scanned pages opened quickly, and far below what a
 * client stuck in a retry loop would ask for. Per instance, so this catches a
 * runaway page rather than a determined caller -- see `lib/http/rate-limit`.
 */
const pdfRequests = createRateLimiter({ limit: 120, windowMs: 60_000 });

const NOTEBOOK_FILE_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export async function GET(request: NextRequest) {
  const token = getBearerToken(request.headers.get("authorization"));
  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let userId: string;
  try {
    userId = (await getAdminAuth().verifyIdToken(token)).uid;
  } catch {
    // An expired, malformed and forged token must be indistinguishable in the
    // response, so the verifier's reason is deliberately not surfaced.
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = pdfRequests.check(userId);
  if (!limit.allowed) {
    return Response.json(
      { error: "Too many notebook file requests." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  let storagePath: string;
  try {
    storagePath = validateOwnedNotebookPdfStoragePath(
      request.nextUrl.searchParams.get("path") ?? "",
      userId
    );
  } catch {
    // The validator throws on any path that is not this user's own notebook
    // PDF. Echoing why would describe the ownership rule to a caller probing
    // for someone else's file, so the rejection stays uniform.
    return Response.json({ error: "Invalid notebook PDF path." }, { status: 400 });
  }

  try {
    const file = getAdminStorageBucket().file(storagePath);
    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size ?? 0);

    const contentType = metadata.contentType ?? "";
    if (!NOTEBOOK_FILE_CONTENT_TYPES.has(contentType)) {
      return Response.json(
        { error: "This notebook file type is not supported." },
        { status: 415 }
      );
    }
    if (!Number.isFinite(size) || size < 1 || size >= MAX_NOTEBOOK_FILE_SIZE) {
      return Response.json(
        { error: "This notebook file has an invalid file size." },
        { status: 413 }
      );
    }

    const [bytes] = await file.download();
    if (bytes.byteLength < 1 || bytes.byteLength >= MAX_NOTEBOOK_FILE_SIZE) {
      return Response.json(
        { error: "This notebook file has an invalid file size." },
        { status: 413 }
      );
    }
    const responseBytes = new Uint8Array(bytes.byteLength);
    responseBytes.set(bytes);
    return new Response(responseBytes.buffer, {
      headers: {
        "Cache-Control": "private, max-age=3600",
        "Content-Length": String(bytes.byteLength),
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? Number((error as { code?: unknown }).code)
        : 0;
    if (code === 404) {
      return Response.json(
        { error: "This notebook file no longer exists." },
        { status: 404 }
      );
    }

    // The last path segment ends in the student's own filename, so the
    // notebook id is logged instead of the path. It is enough to find the
    // file, and a title like "Biology resit notes" is not log material.
    createLogger({ route: "notebook-files.pdf", uid: userId }).error(
      "file.download_failed",
      { notebookId: storagePath.split("/")[3], error }
    );
    return Response.json(
      { error: "This notebook file could not be downloaded." },
      { status: 500 }
    );
  }
}
