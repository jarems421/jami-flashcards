import type { TutorAttachment } from "@/lib/ai/tutor-attachments";
import type { Source } from "@/lib/material/sources";
import type { NotebookFile } from "@/lib/workspace/notebooks";

/**
 * A sheet kept beside a notebook page: a question sheet, mark scheme or
 * formula sheet the student works from while writing on their own page.
 *
 * It is a view of a file they already have -- one imported into the notebook,
 * one of the folder's sources, or one they sent Tutor -- shown read-only in a
 * panel they can move and resize. Nothing is copied or saved: which sheet is
 * open, and where, is remembered on this device only.
 */

export const NOTEBOOK_SHEET_FILE_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export type NotebookSheetFileType = (typeof NOTEBOOK_SHEET_FILE_TYPES)[number];
export type NotebookSheetOrigin = "notebook" | "folder" | "chat";

export type NotebookSheet = {
  /** The file itself, which is also what identifies the sheet. */
  storagePath: string;
  title: string;
  fileType: NotebookSheetFileType;
  origin: NotebookSheetOrigin;
};

export function isNotebookSheetFileType(value: unknown): value is NotebookSheetFileType {
  return typeof value === "string" && (NOTEBOOK_SHEET_FILE_TYPES as readonly string[]).includes(value);
}

function titleFromFileName(fileName: string) {
  return fileName.replace(/\.[a-z0-9]{1,5}$/i, "").trim() || fileName;
}

/** The files imported into this notebook, each one a sheet that can sit beside a page. */
export function notebookSheetsFromNotebookFiles(files: readonly NotebookFile[]): NotebookSheet[] {
  return files.flatMap((file) =>
    file.storagePath && isNotebookSheetFileType(file.fileType)
      ? [{ storagePath: file.storagePath, title: titleFromFileName(file.fileName), fileType: file.fileType, origin: "notebook" as const }]
      : []
  );
}

/** The folder's uploaded PDFs and pictures. Pasted notes and links have no page to show. */
export function notebookSheetsFromSources(sources: readonly Source[]): NotebookSheet[] {
  return sources.flatMap((source) =>
    source.status === "active" && source.type === "file" && source.storagePath && isNotebookSheetFileType(source.fileType)
      ? [{ storagePath: source.storagePath, title: source.title.trim() || titleFromFileName(source.fileName ?? ""), fileType: source.fileType, origin: "folder" as const }]
      : []
  );
}

/** A file sent to Tutor, when it is one that can be shown as a sheet. */
export function notebookSheetFromAttachment(attachment: TutorAttachment): NotebookSheet | null {
  return isNotebookSheetFileType(attachment.fileType)
    ? {
        storagePath: attachment.storagePath,
        title: titleFromFileName(attachment.fileName),
        fileType: attachment.fileType,
        origin: "chat",
      }
    : null;
}

export function notebookSheetStorageKey(notebookId: string) {
  return `jami:notebook-sheet:v1:${notebookId}`;
}

export type StoredNotebookSheet = { sheet: NotebookSheet; open: boolean };

/** Reads what this device remembered, dropping anything malformed. */
export function parseStoredNotebookSheet(value: unknown): StoredNotebookSheet | null {
  if (!value || typeof value !== "object") return null;
  const stored = value as Record<string, unknown>;
  const sheet = stored.sheet as Record<string, unknown> | undefined;
  if (!sheet || typeof sheet !== "object") return null;
  const storagePath = typeof sheet.storagePath === "string" ? sheet.storagePath.trim() : "";
  const title = typeof sheet.title === "string" ? sheet.title.trim().slice(0, 160) : "";
  const origin =
    sheet.origin === "notebook" || sheet.origin === "folder" || sheet.origin === "chat" ? sheet.origin : null;
  if (!storagePath.startsWith("users/") || !title || !origin || !isNotebookSheetFileType(sheet.fileType)) {
    return null;
  }
  return {
    sheet: { storagePath, title, fileType: sheet.fileType, origin },
    open: stored.open !== false,
  };
}
