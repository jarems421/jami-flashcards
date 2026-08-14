import type { NextRequest } from "next/server";
import { isOwnedAssistantImagePath } from "@/lib/ai/assistant-illustrations";
import {
  assistantAssetError,
  authenticateAssistantAssetRequest,
} from "@/services/ai/assistant-assets.server";
import { getAdminStorageBucket } from "@/services/firebase/admin";

export const runtime = "nodejs";

const CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export async function GET(request: NextRequest) {
  const uid = await authenticateAssistantAssetRequest(request);
  if (!uid) return assistantAssetError("Unauthorized", 401, "unauthorized");
  const storagePath = request.nextUrl.searchParams.get("path")?.trim() ?? "";
  if (!isOwnedAssistantImagePath(storagePath, uid)) {
    return assistantAssetError("Invalid illustration path.", 400, "invalid_path");
  }

  try {
    const file = getAdminStorageBucket().file(storagePath);
    const [metadata] = await file.getMetadata();
    const contentType = metadata.contentType ?? "";
    const size = Number(metadata.size ?? 0);
    if (!CONTENT_TYPES.has(contentType) || !Number.isFinite(size) || size < 1 || size > MAX_IMAGE_BYTES) {
      return assistantAssetError("This illustration is invalid.", 415, "invalid_image");
    }
    const [bytes] = await file.download();
    return new Response(new Uint8Array(bytes).buffer, {
      headers: {
        "Cache-Control": "private, max-age=3600",
        "Content-Length": String(bytes.byteLength),
        "Content-Type": contentType,
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? Number((error as { code?: unknown }).code)
        : 0;
    return assistantAssetError(
      code === 404 ? "This illustration no longer exists." : "This illustration could not be loaded.",
      code === 404 ? 404 : 500,
      code === 404 ? "not_found" : "download_failed"
    );
  }
}
