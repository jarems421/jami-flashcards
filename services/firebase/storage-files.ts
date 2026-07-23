import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytesResumable,
} from "firebase/storage";
import { storage } from "@/services/firebase/client";

export function createStorageFileId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `file-${Date.now()}`;
}

export function sanitizeStorageFileName(fileName: string, fallback: string) {
  const [baseName, ...extensionParts] = fileName.trim().split(".");
  const safeBase =
    (baseName || fallback)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || fallback;
  const extension = extensionParts
    .pop()
    ?.toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 12);
  return extension ? `${safeBase}.${extension}` : safeBase;
}

export async function uploadStorageFile(input: {
  storagePath: string;
  file: File;
  contentType: string;
  onProgress?: (progress: number) => void;
}) {
  const storageRef = ref(storage, input.storagePath);
  await new Promise<void>((resolve, reject) => {
    const uploadTask = uploadBytesResumable(storageRef, input.file, {
      contentType: input.contentType,
      cacheControl: "private,max-age=3600",
    });

    uploadTask.on(
      "state_changed",
      (snapshot) => {
        const progress =
          snapshot.totalBytes > 0
            ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
            : 0;
        input.onProgress?.(progress);
      },
      reject,
      resolve,
    );
  });
}

export function getStorageUploadErrorMessage(error: unknown, label: string) {
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
  const capitalizedLabel = `${label.charAt(0).toUpperCase()}${label.slice(1)}`;

  if (code === "storage/unauthorized") {
    return `You do not have permission to upload this ${label}.`;
  }
  if (code === "storage/canceled") {
    return `The ${label} upload was cancelled.`;
  }
  if (code === "storage/quota-exceeded") {
    return `${capitalizedLabel} upload quota was exceeded. Try a smaller file.`;
  }
  if (code === "storage/retry-limit-exceeded") {
    return "The upload could not finish. Check your connection and try again.";
  }
  return error instanceof Error
    ? error.message
    : `Could not upload this ${label}.`;
}

export async function getStorageFileDownloadUrl(storagePath: string) {
  return getDownloadURL(ref(storage, storagePath));
}

export async function deleteStorageFile(storagePath: string) {
  await deleteObject(ref(storage, storagePath));
}
