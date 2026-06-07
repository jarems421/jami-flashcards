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

    if (metadata.contentType !== "application/pdf") {
      return Response.json({ error: "This notebook file is not a PDF." }, { status: 415 });
    }
    if (!Number.isFinite(size) || size < 1 || size > MAX_NOTEBOOK_FILE_SIZE) {
      return Response.json({ error: "This PDF has an invalid file size." }, { status: 413 });
    }

    const [bytes] = await file.download();
    const responseBytes = new Uint8Array(bytes.byteLength);
    responseBytes.set(bytes);
    return new Response(responseBytes.buffer, {
      headers: {
        "Cache-Control": "private, max-age=3600",
        "Content-Length": String(bytes.byteLength),
        "Content-Type": "application/pdf",
      },
    });
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? Number((error as { code?: unknown }).code)
        : 0;
    if (code === 404) {
      return Response.json({ error: "This PDF no longer exists." }, { status: 404 });
    }

    console.error("Could not download notebook PDF.", {
      storagePath,
      error,
    });
    return Response.json(
      { error: "This PDF could not be downloaded." },
      { status: 500 }
    );
  }
}
