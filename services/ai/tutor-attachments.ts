import { TUTOR_ATTACHMENT_ID_PREFIX, type TutorAttachment } from "@/lib/ai/tutor-attachments";
import { isSourceFileMimeType } from "@/lib/material/source-files";
import { createStorageFileId } from "@/services/firebase/storage-files";
import {
  deleteSourceFile,
  getSourceFileDownloadUrl,
  uploadSourceFile,
  validateSourceUploadFile,
} from "@/services/study/source-files";
import { createUploadedSource } from "@/services/study/source-upload";

/**
 * Uploads a file a student attached to a Tutor message.
 *
 * Stored with their source files under a `chat-` id, so the same storage
 * rules and size and type limits apply. Nothing reads it until the message is
 * sent; the chat deletes it when the chat is deleted.
 */
export async function uploadTutorAttachment(input: {
  userId: string;
  file: File;
  onProgress?: (progress: number) => void;
}): Promise<TutorAttachment> {
  validateSourceUploadFile(input.file);
  const uploaded = await uploadSourceFile({
    userId: input.userId,
    sourceId: `${TUTOR_ATTACHMENT_ID_PREFIX}${createStorageFileId()}`,
    file: input.file,
    onProgress: input.onProgress,
  });
  if (!isSourceFileMimeType(uploaded.fileType)) {
    await deleteSourceFile(uploaded.storagePath).catch(() => undefined);
    throw new Error("Jami cannot read that kind of file.");
  }
  return {
    storagePath: uploaded.storagePath,
    fileName: uploaded.fileName,
    fileType: uploaded.fileType,
    sizeBytes: uploaded.sizeBytes,
  };
}

/** Removes an attachment the student took off before sending. */
export async function discardTutorAttachment(attachment: TutorAttachment) {
  await deleteSourceFile(attachment.storagePath).catch(() => undefined);
}

export async function getTutorAttachmentUrl(attachment: TutorAttachment) {
  return getSourceFileDownloadUrl(attachment.storagePath);
}

/**
 * Makes an ordinary source of an attachment, in the folder the student chose.
 *
 * A copy rather than a move: the chat keeps its own file, deleted with the
 * chat, and the source keeps one that lives as long as the source. The file
 * still in memory is used when there is one; a chat reopened later fetches it.
 */
export async function saveTutorAttachmentAsSource(input: {
  userId: string;
  attachment: TutorAttachment;
  title: string;
  folderId: string;
  file?: File;
}) {
  let file = input.file;
  if (!file) {
    const response = await fetch(await getTutorAttachmentUrl(input.attachment));
    if (!response.ok) throw new Error("That file is no longer in this chat.");
    const blob = await response.blob();
    file = new File([blob], input.attachment.fileName, { type: input.attachment.fileType });
  }
  return createUploadedSource({
    userId: input.userId,
    folderId: input.folderId,
    title: input.title,
    file,
  });
}
