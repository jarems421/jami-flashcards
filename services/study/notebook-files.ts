import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytesResumable,
} from "firebase/storage";
import { storage } from "@/services/firebase/client";
import { createNotebookFileMetadata } from "@/services/study/notebooks";
import type { NotebookFile } from "@/lib/workspace/notebooks";

const MAX_NOTEBOOK_FILE_SIZE = 20 * 1024 * 1024;
const ALLOWED_NOTEBOOK_FILE_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

function sanitizeFileName(fileName: string) {
  const [baseName, ...extensionParts] = fileName.trim().split(".");
  const safeBase = (baseName || "notebook-file")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "notebook-file";
  const extension = extensionParts.pop()?.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
  return extension ? `${safeBase}.${extension}` : safeBase;
}

function getUploadErrorMessage(error: unknown) {
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";

  if (code === "storage/unauthorized") {
    return "You do not have permission to upload this notebook file.";
  }
  if (code === "storage/canceled") {
    return "The notebook file upload was cancelled.";
  }
  if (code === "storage/quota-exceeded") {
    return "Notebook file upload quota was exceeded. Try a smaller file.";
  }
  if (code === "storage/retry-limit-exceeded") {
    return "The upload could not finish. Check your connection and try again.";
  }
  return error instanceof Error ? error.message : "Could not upload this notebook file.";
}

export function validateNotebookUploadFile(file: File) {
  if (!ALLOWED_NOTEBOOK_FILE_TYPES.includes(file.type as (typeof ALLOWED_NOTEBOOK_FILE_TYPES)[number])) {
    throw new Error("Upload a PDF, JPEG, PNG, or WebP file.");
  }
  if (file.size > MAX_NOTEBOOK_FILE_SIZE) {
    throw new Error("Notebook files must be under 20 MB.");
  }
}

export function buildNotebookStoragePath(input: {
  userId: string;
  notebookId: string;
  fileId: string;
  fileName: string;
}) {
  const userId = input.userId.trim();
  const notebookId = input.notebookId.trim();
  const fileId = input.fileId.trim();
  if (!userId) throw new Error("Missing userId.");
  if (!notebookId) throw new Error("Missing notebookId.");
  if (!fileId) throw new Error("Missing fileId.");
  return `users/${userId}/notebookFiles/${notebookId}/${fileId}-${sanitizeFileName(input.fileName)}`;
}

export async function uploadNotebookFile(input: {
  userId: string;
  notebookId: string;
  folderId: string;
  file: File;
  onProgress?: (progress: number) => void;
  pageCount?: number;
}): Promise<NotebookFile> {
  const { userId, notebookId, folderId, file, onProgress, pageCount } = input;
  validateNotebookUploadFile(file);

  const fileId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `file-${Date.now()}`;
  const storagePath = buildNotebookStoragePath({
    userId,
    notebookId,
    fileId,
    fileName: file.name,
  });
  const storageRef = ref(storage, storagePath);

  try {
    await new Promise<void>((resolve, reject) => {
      const uploadTask = uploadBytesResumable(storageRef, file, {
        contentType: file.type,
        cacheControl: "private,max-age=3600",
      });

      uploadTask.on(
        "state_changed",
        (snapshot) => {
          const progress =
            snapshot.totalBytes > 0
              ? Math.round(
                  (snapshot.bytesTransferred / snapshot.totalBytes) * 100
                )
              : 0;
          onProgress?.(progress);
        },
        (error) => reject(error),
        () => resolve()
      );
    });

    return await createNotebookFileMetadata(userId, {
      notebookId,
      folderId,
      fileName: file.name,
      fileType: file.type,
      storagePath,
      sizeBytes: file.size,
      pageCount,
    });
  } catch (error) {
    try {
      await deleteObject(storageRef);
    } catch {
      // The object may not have completed uploading.
    }
    throw new Error(getUploadErrorMessage(error));
  }
}

export async function getNotebookFileDownloadUrl(storagePath: string) {
  const normalizedPath = storagePath.trim();
  if (!normalizedPath) throw new Error("Missing notebook file path.");
  return getDownloadURL(ref(storage, normalizedPath));
}

export async function deleteNotebookFile(storagePath: string) {
  const normalizedPath = storagePath.trim();
  if (!normalizedPath) return;
  await deleteObject(ref(storage, normalizedPath));
}
