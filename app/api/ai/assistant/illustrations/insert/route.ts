import type { NextRequest } from "next/server";
import {
  getAssistantImageExtension,
  isOwnedAssistantImagePath,
} from "@/lib/ai/assistant-illustrations";
import { normalizeAssistantIllustrations } from "@/lib/ai/jami-assistant";
import {
  createCenteredNotebookImageRef,
  MAX_NOTEBOOK_IMAGE_REFS,
  normalizeNotebookImageRefs,
} from "@/lib/workspace/notebooks";
import {
  assistantAssetError,
  authenticateAssistantAssetRequest,
} from "@/services/ai/assistant-assets.server";
import { getAdminDb, getAdminStorageBucket } from "@/services/firebase/admin";

export const runtime = "nodejs";

function id(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 160) : "";
}

export async function POST(request: NextRequest) {
  const uid = await authenticateAssistantAssetRequest(request);
  if (!uid) return assistantAssetError("Unauthorized", 401, "unauthorized");
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return assistantAssetError("Invalid request body", 400, "invalid_request");
  }
  const assetId = id(body.assetId);
  const messageId = id(body.messageId);
  const notebookId = id(body.notebookId);
  const pageId = id(body.pageId);
  const storagePath = typeof body.storagePath === "string" ? body.storagePath.trim() : "";
  if (!assetId || !messageId || !notebookId || !pageId || !isOwnedAssistantImagePath(storagePath, uid)) {
    return assistantAssetError("Invalid illustration target.", 400, "invalid_request");
  }

  const db = getAdminDb();
  const userRef = db.collection("users").doc(uid);
  const messageRef = userRef.collection("assistantMessages").doc(messageId);
  const notebookRef = userRef.collection("notebooks").doc(notebookId);
  const pageRef = userRef.collection("notebookPages").doc(pageId);
  const [messageSnapshot, notebookSnapshot, pageSnapshot] = await Promise.all([
    messageRef.get(),
    notebookRef.get(),
    pageRef.get(),
  ]);
  const illustration = normalizeAssistantIllustrations(
    messageSnapshot.data()?.illustrations
  ).find((item) => item.id === assetId && item.storagePath === storagePath);
  if (!messageSnapshot.exists || messageSnapshot.data()?.role !== "assistant" || !illustration) {
    return assistantAssetError("That Tutor visual could not be found.", 404, "illustration_not_found");
  }
  if (
    !notebookSnapshot.exists ||
    !pageSnapshot.exists ||
    pageSnapshot.data()?.notebookId !== notebookId
  ) {
    return assistantAssetError("That notebook page could not be found.", 404, "page_not_found");
  }
  const initiallyStoredImages = normalizeNotebookImageRefs(
    pageSnapshot.data()?.imageRefs
  );
  const initiallyInserted = initiallyStoredImages.find(
    (item) => item.sourceAssetId === assetId
  );
  if (initiallyInserted) {
    const initialRevision = pageSnapshot.data()?.contentRevision;
    return Response.json({
      imageRef: initiallyInserted,
      contentRevision:
        typeof initialRevision === "number" && Number.isFinite(initialRevision)
          ? Math.max(0, Math.round(initialRevision))
          : 0,
    });
  }

  const extension = getAssistantImageExtension(illustration.mimeType);
  if (!extension) return assistantAssetError("Unsupported illustration.", 415, "invalid_image");
  const copiedPath = `users/${uid}/notebookFiles/${notebookId}/${assetId}-jami-illustration.${extension}`;
  const imageRef = createCenteredNotebookImageRef({
    id: `jami-${assetId}`,
    storagePath: copiedPath,
    width: illustration.width,
    height: illustration.height,
    altText: illustration.altText,
    sourceAssetId: assetId,
  });

  let copyAlreadyExisted = false;
  try {
    const copiedFile = getAdminStorageBucket().file(copiedPath);
    [copyAlreadyExisted] = await copiedFile.exists();
    await getAdminStorageBucket().file(storagePath).copy(copiedPath);
    const result = await db.runTransaction(async (transaction) => {
      const latest = await transaction.get(pageRef);
      if (!latest.exists || latest.data()?.notebookId !== notebookId) {
        throw new Error("Notebook page no longer exists.");
      }
      const current = normalizeNotebookImageRefs(latest.data()?.imageRefs);
      const existing = current.find((item) => item.sourceAssetId === assetId);
      const remoteRevision =
        typeof latest.data()?.contentRevision === "number"
          ? Math.max(0, Math.round(latest.data()!.contentRevision as number))
          : 0;
      if (existing) return { imageRef: existing, contentRevision: remoteRevision };
      if (current.length >= MAX_NOTEBOOK_IMAGE_REFS) {
        throw new Error(`This page can hold up to ${MAX_NOTEBOOK_IMAGE_REFS} images.`);
      }
      const contentRevision = remoteRevision + 1;
      transaction.update(pageRef, {
        imageRefs: [...current, imageRef],
        contentRevision,
        updatedAt: Date.now(),
      });
      return { imageRef, contentRevision };
    });
    return Response.json(result);
  } catch (error) {
    // A failed transaction must not leave an untracked private copy behind.
    // Re-read first because another concurrent idempotent request may have
    // successfully attached this exact object while this request was failing.
    const latestPage = await pageRef.get().catch(() => null);
    const copyIsReferenced = latestPage?.exists
      ? normalizeNotebookImageRefs(latestPage.data()?.imageRefs).some(
          (item) => item.storagePath === copiedPath
        )
      : false;
    if (!copyAlreadyExisted && !copyIsReferenced) {
      await getAdminStorageBucket()
        .file(copiedPath)
        .delete({ ignoreNotFound: true })
        .catch(() => undefined);
    }
    return assistantAssetError(
      error instanceof Error ? error.message : "That visual could not be added to this page.",
      409,
      "insert_failed"
    );
  }
}
