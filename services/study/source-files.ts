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
} from "@/lib/practice/source-files";

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
