import {
  createStorageFileId,
  deleteStorageFile,
  getStorageFileDownloadUrl,
  getStorageUploadErrorMessage,
  sanitizeStorageFileName,
  uploadStorageFile,
} from "@/services/firebase/storage-files";
import {
  resolveSourceFileMimeType,
  validateSourceFile,
} from "@/lib/material/source-files";
import { createSource, deleteSource, updateSource } from "@/services/study/sources";

export function validateSourceUploadFile(file: File) {
  const fileType = resolveSourceFileMimeType(file.name, file.type);
  validateSourceFile({ type: fileType ?? file.type, size: file.size });
  return fileType;
}

export function buildSourceStoragePath(input: {
  userId: string;
  sourceId: string;
  fileId: string;
  fileName: string;
}) {
  const userId = input.userId.trim();
  const sourceId = input.sourceId.trim();
  const fileId = input.fileId.trim();
  if (!userId) throw new Error("Missing userId.");
  if (!sourceId) throw new Error("Missing sourceId.");
  if (!fileId) throw new Error("Missing fileId.");
  return `users/${userId}/sourceFiles/${sourceId}/${fileId}-${sanitizeStorageFileName(input.fileName, "source-file")}`;
}

export async function uploadSourceFile(input: {
  userId: string;
  sourceId: string;
  file: File;
  onProgress?: (progress: number) => void;
}) {
  const { userId, sourceId, file, onProgress } = input;
  const fileType = validateSourceUploadFile(file);
  const fileId = createStorageFileId();
  const storagePath = buildSourceStoragePath({
    userId,
    sourceId,
    fileId,
    fileName: file.name,
  });
  try {
    await uploadStorageFile({
      storagePath,
      file,
      contentType: fileType ?? file.type,
      onProgress,
    });

    return {
      fileName: file.name,
      fileType: fileType ?? file.type,
      sizeBytes: file.size,
      storagePath,
    };
  } catch (error) {
    throw new Error(getStorageUploadErrorMessage(error, "source file"));
  }
}

/**
 * A file added to a student's sources: the source, its upload and the file
 * attached to it, undone together if any step fails so no half-made source is
 * left behind. Shared by the Sources page and the sheets beside a notebook page.
 */
export async function createFileSource(input: {
  userId: string;
  file: File;
  title: string;
  folderIds: string[];
  topicIds?: string[];
  onProgress?: (progress: number) => void;
}) {
  const { userId, file, onProgress } = input;
  const fileType = validateSourceUploadFile(file) ?? file.type;
  let sourceId = "";
  let storagePath = "";
  try {
    sourceId = await createSource(userId, {
      title: input.title.trim() || file.name,
      type: "file",
      topicIds: input.topicIds ?? [],
      folderIds: input.folderIds,
      fileName: file.name,
      fileType,
    });
    const upload = await uploadSourceFile({ userId, sourceId, file, onProgress });
    storagePath = upload.storagePath;
    await updateSource(userId, sourceId, {
      fileName: upload.fileName,
      fileType: upload.fileType,
      storagePath: upload.storagePath,
      sizeBytes: upload.sizeBytes,
    });
    return { sourceId, ...upload };
  } catch (error) {
    // Best-effort rollback; the original failure is what the student is told.
    if (storagePath) await deleteSourceFile(storagePath).catch(() => undefined);
    if (sourceId) await deleteSource(userId, sourceId).catch(() => undefined);
    throw error;
  }
}

export async function getSourceFileDownloadUrl(storagePath: string) {
  const normalizedPath = storagePath.trim();
  if (!normalizedPath) throw new Error("Missing source file path.");
  return getStorageFileDownloadUrl(normalizedPath);
}

export async function deleteSourceFile(storagePath: string) {
  const normalizedPath = storagePath.trim();
  if (!normalizedPath) return;
  await deleteStorageFile(normalizedPath);
}
