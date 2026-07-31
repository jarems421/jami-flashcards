export const MAX_SOURCE_FILE_SIZE = 20 * 1024 * 1024;

export const SOURCE_FILE_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
] as const;

export type SourceFileMimeType = (typeof SOURCE_FILE_MIME_TYPES)[number];
export type SourceFileKind = "image" | "pdf" | "document" | "text";

const SOURCE_FILE_MIME_TYPE_SET = new Set<string>(SOURCE_FILE_MIME_TYPES);
const SOURCE_FILE_EXTENSION_TYPES: Record<string, SourceFileMimeType> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
};

export function isSourceFileMimeType(value: string): value is SourceFileMimeType {
  return SOURCE_FILE_MIME_TYPE_SET.has(value);
}

export function resolveSourceFileMimeType(fileName: string, declaredType: string) {
  if (isSourceFileMimeType(declaredType)) return declaredType;
  if (declaredType.trim()) return null;
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  return SOURCE_FILE_EXTENSION_TYPES[extension] ?? null;
}

export function getSourceFileKind(fileType?: string | null): SourceFileKind | null {
  if (!fileType) return null;
  if (fileType.startsWith("image/")) return "image";
  if (fileType === "application/pdf") return "pdf";
  if (fileType === "text/plain") return "text";
  if (
    fileType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    fileType ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    return "document";
  }
  return null;
}

export function getSourceFileTypeLabel(fileType?: string | null) {
  if (fileType === "application/pdf") return "PDF";
  if (fileType === "image/jpeg") return "JPEG image";
  if (fileType === "image/png") return "PNG image";
  if (fileType === "image/webp") return "WebP image";
  if (
    fileType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "Word document";
  }
  if (
    fileType ===
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    return "PowerPoint";
  }
  if (fileType === "text/plain") return "Text file";
  return "File";
}

export function validateSourceFile(input: { type: string; size: number }) {
  if (!isSourceFileMimeType(input.type)) {
    throw new Error("This file type is not supported.");
  }
  if (input.size <= 0) {
    throw new Error("Choose a file that is not empty.");
  }
  if (input.size >= MAX_SOURCE_FILE_SIZE) {
    throw new Error("Source files must be under 20 MB.");
  }
}
