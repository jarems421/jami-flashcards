import { auth } from "@/services/firebase/client";
import {
  createStorageFileId,
  deleteStorageFile,
  getStorageFileDownloadUrl,
  getStorageUploadErrorMessage,
  sanitizeStorageFileName,
  uploadStorageFile,
} from "@/services/firebase/storage-files";
import { createNotebookFileMetadata } from "@/services/study/notebooks";
import { MAX_NOTEBOOK_FILE_SIZE } from "@/lib/workspace/notebook-pdf";
import type { NotebookFile } from "@/lib/workspace/notebooks";

const NOTEBOOK_FILE_DOWNLOAD_TIMEOUT_MS = 30_000;
const ALLOWED_NOTEBOOK_FILE_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

function getMetadataErrorMessage(error: unknown) {
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";

  if (code === "permission-denied") {
    return "The file uploaded, but Jami could not save its notebook metadata. Check Firestore permissions and try again.";
  }
  return error instanceof Error
    ? `The file uploaded, but its notebook metadata could not be saved: ${error.message}`
    : "The file uploaded, but its notebook metadata could not be saved.";
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
  return `users/${userId}/notebookFiles/${notebookId}/${fileId}-${sanitizeStorageFileName(input.fileName, "notebook-file")}`;
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

  const fileId = createStorageFileId();
  const storagePath = buildNotebookStoragePath({
    userId,
    notebookId,
    fileId,
    fileName: file.name,
  });
  try {
    await uploadStorageFile({
      storagePath,
      file,
      contentType: file.type,
      onProgress,
    });

    try {
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
      throw new Error(getMetadataErrorMessage(error));
    }
  } catch (error) {
    try {
      await deleteStorageFile(storagePath);
    } catch {
      // The object may not have completed uploading.
    }
    throw new Error(getStorageUploadErrorMessage(error, "notebook file"));
  }
}

export async function getNotebookFileDownloadUrl(storagePath: string) {
  const normalizedPath = storagePath.trim();
  if (!normalizedPath) throw new Error("Missing notebook file path.");
  return getStorageFileDownloadUrl(normalizedPath);
}

export async function getNotebookFileBytes(storagePath: string) {
  const normalizedPath = storagePath.trim();
  if (!normalizedPath) throw new Error("Missing notebook file path.");
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in again to load this notebook file.");
  const token = await user.getIdToken();
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    NOTEBOOK_FILE_DOWNLOAD_TIMEOUT_MS
  );

  try {
    const response = await fetch(
      `/api/notebook-files/pdf?path=${encodeURIComponent(normalizedPath)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "force-cache",
        signal: controller.signal,
      }
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: unknown;
      } | null;
      throw new Error(
        typeof body?.error === "string"
          ? body.error
          : `Notebook file download failed (${response.status}).`
      );
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_NOTEBOOK_FILE_SIZE) {
      throw new Error("Notebook files must be under 20 MB.");
    }
    return new Uint8Array(bytes);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("The notebook file took too long to load. Try again.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function deleteNotebookFile(storagePath: string) {
  const normalizedPath = storagePath.trim();
  if (!normalizedPath) return;
  await deleteStorageFile(normalizedPath);
}
