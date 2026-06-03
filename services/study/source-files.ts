import { getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";
import { storage } from "@/services/firebase/client";

const MAX_SOURCE_FILE_SIZE = 20 * 1024 * 1024;
const ALLOWED_SOURCE_FILE_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

function sanitizeFileName(fileName: string) {
  const [baseName, ...extensionParts] = fileName.trim().split(".");
  const safeBase =
    (baseName || "source-file")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "source-file";
  const extension = extensionParts.pop()?.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
  return extension ? `${safeBase}.${extension}` : safeBase;
}

function getUploadErrorMessage(error: unknown) {
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";

  if (code === "storage/unauthorized") {
    return "You do not have permission to upload this source file.";
  }
  if (code === "storage/canceled") {
    return "The source file upload was cancelled.";
  }
  if (code === "storage/quota-exceeded") {
    return "Source file upload quota was exceeded. Try a smaller file.";
  }
  if (code === "storage/retry-limit-exceeded") {
    return "The upload could not finish. Check your connection and try again.";
  }
  return error instanceof Error ? error.message : "Could not upload this source file.";
}

export function validateSourceUploadFile(file: File) {
  if (!ALLOWED_SOURCE_FILE_TYPES.includes(file.type as (typeof ALLOWED_SOURCE_FILE_TYPES)[number])) {
    throw new Error("Upload a PDF, JPEG, PNG, or WebP file.");
  }
  if (file.size > MAX_SOURCE_FILE_SIZE) {
    throw new Error("Source files must be under 20 MB.");
  }
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
  return `users/${userId}/sourceFiles/${sourceId}/${fileId}-${sanitizeFileName(input.fileName)}`;
}

export async function uploadSourceFile(input: {
  userId: string;
  sourceId: string;
  file: File;
}) {
  const { userId, sourceId, file } = input;
  validateSourceUploadFile(file);
  const fileId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `file-${Date.now()}`;
  const storagePath = buildSourceStoragePath({
    userId,
    sourceId,
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

      uploadTask.on("state_changed", undefined, (error) => reject(error), () => resolve());
    });

    return {
      fileName: file.name,
      fileType: file.type,
      sizeBytes: file.size,
      storagePath,
    };
  } catch (error) {
    throw new Error(getUploadErrorMessage(error));
  }
}

export async function getSourceFileDownloadUrl(storagePath: string) {
  const normalizedPath = storagePath.trim();
  if (!normalizedPath) throw new Error("Missing source file path.");
  return getDownloadURL(ref(storage, normalizedPath));
}
