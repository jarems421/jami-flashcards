import type { TutorAttachment } from "@/lib/ai/tutor-attachments";
import type { Source } from "@/lib/material/sources";
import type { NotebookFile } from "@/lib/workspace/notebooks";

/**
 * A sheet kept beside a notebook page: a question sheet, mark scheme or
 * formula sheet the student works from while writing on their own page.
 *
 * It is a view of a file they already have -- one imported into the notebook,
 * one of the folder's sources, or one they sent Tutor -- shown read-only in a
 * panel they can move and resize; up to three at once. Nothing is copied or
 * saved: which sheets are open, and where, is remembered on this device only.
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

/** A sheet's name from its file's: the file name without the extension. */
export function notebookSheetTitleForFile(fileName: string) {
  return fileName.replace(/\.[a-z0-9]{1,5}$/i, "").trim() || fileName;
}

/** The files imported into this notebook, each one a sheet that can sit beside a page. */
export function notebookSheetsFromNotebookFiles(files: readonly NotebookFile[]): NotebookSheet[] {
  return files.flatMap((file) =>
    file.storagePath && isNotebookSheetFileType(file.fileType)
      ? [{ storagePath: file.storagePath, title: notebookSheetTitleForFile(file.fileName), fileType: file.fileType, origin: "notebook" as const }]
      : []
  );
}

/** The folder's uploaded PDFs and pictures. Pasted notes and links have no page to show. */
export function notebookSheetsFromSources(sources: readonly Source[]): NotebookSheet[] {
  return sources.flatMap((source) =>
    source.status === "active" && source.type === "file" && source.storagePath && isNotebookSheetFileType(source.fileType)
      ? [{ storagePath: source.storagePath, title: source.title.trim() || notebookSheetTitleForFile(source.fileName ?? ""), fileType: source.fileType, origin: "folder" as const }]
      : []
  );
}

/** A file just uploaded from the sheet picker, which became one of the folder's sources. */
export function notebookSheetFromUploadedSource(upload: {
  storagePath: string;
  fileName: string;
  fileType: string;
}): NotebookSheet | null {
  return isNotebookSheetFileType(upload.fileType)
    ? {
        storagePath: upload.storagePath,
        title: notebookSheetTitleForFile(upload.fileName),
        fileType: upload.fileType,
        origin: "folder",
      }
    : null;
}

/** A file sent to Tutor, when it is one that can be shown as a sheet. */
export function notebookSheetFromAttachment(attachment: TutorAttachment): NotebookSheet | null {
  return isNotebookSheetFileType(attachment.fileType)
    ? {
        storagePath: attachment.storagePath,
        title: notebookSheetTitleForFile(attachment.fileName),
        fileType: attachment.fileType,
        origin: "chat",
      }
    : null;
}

export function notebookSheetStorageKey(notebookId: string) {
  return `jami:notebook-sheet:v1:${notebookId}`;
}

/** Sheets beside the page at once, like the answers that can be pinned there. */
export const MAX_NOTEBOOK_SHEETS = 3;

/**
 * A kept sheet, the panel slot it sits in (which remembers its own place), and
 * the page of a PDF the student is on, counted from 0.
 */
export type KeptNotebookSheet = { slot: number; sheet: NotebookSheet; page?: number };

/** Every sheet kept beside this notebook, oldest first, shown or hidden together. */
export type NotebookSheets = { sheets: KeptNotebookSheet[]; open: boolean };

export const EMPTY_NOTEBOOK_SHEETS: NotebookSheets = { sheets: [], open: false };

function parseSheet(value: unknown): NotebookSheet | null {
  if (!value || typeof value !== "object") return null;
  const sheet = value as Record<string, unknown>;
  const storagePath = typeof sheet.storagePath === "string" ? sheet.storagePath.trim() : "";
  const title = typeof sheet.title === "string" ? sheet.title.trim().slice(0, 160) : "";
  const origin =
    sheet.origin === "notebook" || sheet.origin === "folder" || sheet.origin === "chat" ? sheet.origin : null;
  if (!storagePath.startsWith("users/") || !title || !origin || !isNotebookSheetFileType(sheet.fileType)) {
    return null;
  }
  return { storagePath, title, fileType: sheet.fileType, origin };
}

/**
 * Reads what this device remembered, dropping anything malformed. A device
 * that kept a single sheet, before there could be several, keeps it.
 */
export function parseStoredNotebookSheets(value: unknown): NotebookSheets {
  if (!value || typeof value !== "object") return EMPTY_NOTEBOOK_SHEETS;
  const stored = value as Record<string, unknown>;
  const open = stored.open !== false;
  if (!Array.isArray(stored.sheets)) {
    const single = parseSheet(stored.sheet);
    return single ? { sheets: [{ slot: 0, sheet: single }], open } : EMPTY_NOTEBOOK_SHEETS;
  }
  const sheets: KeptNotebookSheet[] = [];
  for (const entry of stored.sheets) {
    if (!entry || typeof entry !== "object") continue;
    const kept = entry as Record<string, unknown>;
    const slot = typeof kept.slot === "number" && Number.isInteger(kept.slot) ? kept.slot : -1;
    const sheet = parseSheet(kept.sheet);
    const page = typeof kept.page === "number" && Number.isInteger(kept.page) && kept.page > 0 ? kept.page : 0;
    if (
      sheet &&
      slot >= 0 &&
      slot < MAX_NOTEBOOK_SHEETS &&
      !sheets.some((other) => other.slot === slot || other.sheet.storagePath === sheet.storagePath)
    ) {
      sheets.push({ slot, sheet, ...(page > 0 ? { page } : {}) });
    }
  }
  return sheets.length > 0 ? { sheets: sheets.slice(-MAX_NOTEBOOK_SHEETS), open } : EMPTY_NOTEBOOK_SHEETS;
}

/**
 * Keeps another sheet beside the page and shows them all.
 *
 * A sheet already kept is not opened twice. With every slot taken, the oldest
 * makes way, as the oldest pinned answer does, and the new sheet takes its
 * panel where it is. `added` says whether a new panel is coming on screen,
 * which is when it needs placing.
 */
export function addNotebookSheet(
  current: NotebookSheets,
  sheet: NotebookSheet
): { next: NotebookSheets; slot: number; added: boolean } {
  const existing = current.sheets.find((kept) => kept.sheet.storagePath === sheet.storagePath);
  if (existing) return { next: { ...current, open: true }, slot: existing.slot, added: false };
  const full = current.sheets.length >= MAX_NOTEBOOK_SHEETS;
  const kept = full ? current.sheets.slice(1) : current.sheets;
  const free = Array.from({ length: MAX_NOTEBOOK_SHEETS }, (_, slot) => slot).find(
    (slot) => !kept.some((other) => other.slot === slot)
  );
  const slot = free ?? current.sheets[0].slot;
  return { next: { sheets: [...kept, { slot, sheet }], open: true }, slot, added: !full };
}

/** Puts a different sheet in one panel, where that panel already is. */
export function replaceNotebookSheet(current: NotebookSheets, slot: number, sheet: NotebookSheet): NotebookSheets {
  const elsewhere = current.sheets.find(
    (kept) => kept.slot !== slot && kept.sheet.storagePath === sheet.storagePath
  );
  // Already open in another panel: this one goes, rather than showing it twice.
  if (elsewhere) return { sheets: current.sheets.filter((kept) => kept.slot !== slot), open: true };
  return {
    sheets: current.sheets.map((kept) => (kept.slot === slot ? { slot, sheet } : kept)),
    open: true,
  };
}

/** Remembers the page a PDF sheet was left on, so hiding and showing it keeps the student's place. */
export function setNotebookSheetPage(current: NotebookSheets, slot: number, page: number): NotebookSheets {
  const next = Math.max(0, Math.floor(page));
  return {
    ...current,
    sheets: current.sheets.map((kept) =>
      kept.slot === slot ? { slot: kept.slot, sheet: kept.sheet, ...(next > 0 ? { page: next } : {}) } : kept
    ),
  };
}

export function removeNotebookSheet(current: NotebookSheets, slot: number): NotebookSheets {
  const sheets = current.sheets.filter((kept) => kept.slot !== slot);
  return sheets.length > 0 ? { ...current, sheets } : EMPTY_NOTEBOOK_SHEETS;
}
