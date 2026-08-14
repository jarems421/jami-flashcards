import type { NextRequest } from "next/server";
import { isOwnedAssistantImagePath } from "@/lib/ai/assistant-illustrations";
import { normalizeAssistantIllustrations } from "@/lib/ai/jami-assistant";
import {
  assistantAssetError,
  authenticateAssistantAssetRequest,
} from "@/services/ai/assistant-assets.server";
import { getAdminDb, getAdminStorageBucket } from "@/services/firebase/admin";

export const runtime = "nodejs";

function normalizedTitle(value: unknown) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, 80)
    : "";
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ threadId: string }> }
) {
  const uid = await authenticateAssistantAssetRequest(request);
  if (!uid) return assistantAssetError("Unauthorized", 401, "unauthorized");
  const threadId = (await context.params).threadId.trim().slice(0, 160);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return assistantAssetError("Invalid request body", 400, "invalid_request");
  }
  const title = normalizedTitle(body.title);
  if (!threadId || !title) {
    return assistantAssetError("Enter a chat name.", 400, "invalid_request");
  }
  const threadRef = getAdminDb()
    .collection("users")
    .doc(uid)
    .collection("assistantThreads")
    .doc(threadId);
  const thread = await threadRef.get();
  if (!thread.exists) {
    return assistantAssetError("That chat could not be found.", 404, "not_found");
  }
  await threadRef.update({ title, updatedAt: Date.now() });
  return Response.json({ title });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ threadId: string }> }
) {
  const uid = await authenticateAssistantAssetRequest(request);
  if (!uid) return assistantAssetError("Unauthorized", 401, "unauthorized");
  const threadId = (await context.params).threadId.trim().slice(0, 160);
  if (!threadId) return assistantAssetError("Invalid chat.", 400, "invalid_request");

  const db = getAdminDb();
  const userRef = db.collection("users").doc(uid);
  const threadRef = userRef.collection("assistantThreads").doc(threadId);
  const thread = await threadRef.get();
  if (!thread.exists) return assistantAssetError("That chat could not be found.", 404, "not_found");

  const messages = await userRef
    .collection("assistantMessages")
    .where("threadId", "==", threadId)
    .get();
  const imagePaths = Array.from(
    new Set(
      messages.docs.flatMap((message) =>
        normalizeAssistantIllustrations(message.data().illustrations)
          .map((item) => item.storagePath)
          .filter((path) => isOwnedAssistantImagePath(path, uid))
      )
    )
  );

  await Promise.all(
    imagePaths.map((path) =>
      getAdminStorageBucket().file(path).delete({ ignoreNotFound: true })
    )
  );
  for (let offset = 0; offset < messages.docs.length; offset += 400) {
    const batch = db.batch();
    messages.docs.slice(offset, offset + 400).forEach((message) => batch.delete(message.ref));
    await batch.commit();
  }
  await userRef
    .collection("assistantRouteState")
    .doc(threadId)
    .delete()
    .catch(() => undefined);
  await threadRef.delete();
  return Response.json({ deleted: true });
}
