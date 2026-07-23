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

export const runtime = "nodejs";

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
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let storagePath: string;
  try {
    storagePath = validateOwnedNotebookPdfStoragePath(
      request.nextUrl.searchParams.get("path") ?? "",
      userId
    );
  } catch {
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
    if (!Number.isFinite(size) || size < 1 || size > MAX_NOTEBOOK_FILE_SIZE) {
      return Response.json(
        { error: "This notebook file has an invalid file size." },
        { status: 413 }
      );
    }

    const [bytes] = await file.download();
    const responseBytes = new Uint8Array(bytes.byteLength);
    responseBytes.set(bytes);
    return new Response(responseBytes.buffer, {
      headers: {
        "Cache-Control": "private, max-age=3600",
        "Content-Length": String(bytes.byteLength),
        "Content-Type": contentType,
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

    console.error("Could not download notebook file.", {
      storagePath,
      error,
    });
    return Response.json(
      { error: "This notebook file could not be downloaded." },
      { status: 500 }
    );
  }
}
