"use client";

import { useCallback, useEffect, useState } from "react";
import {
  addNotebookSheet,
  EMPTY_NOTEBOOK_SHEETS,
  isNotebookSheetFileType,
  notebookSheetFromUploadedSource,
  notebookSheetsFromSources,
  notebookSheetTitleForFile,
  notebookSheetStorageKey,
  parseStoredNotebookSheets,
  removeNotebookSheet,
  replaceNotebookSheet,
  setNotebookSheetPage,
  type NotebookSheet,
  type NotebookSheets,
} from "@/lib/workspace/notebook-sheet";
import { getNotebookFileDownloadUrl } from "@/services/study/notebook-files";
import { createFileSource, getSourceFileDownloadUrl } from "@/services/study/source-files";
import { getActiveSourcesForFolderPage } from "@/services/study/sources";

function readStored(notebookId: string): NotebookSheets {
  if (typeof window === "undefined" || !notebookId) return EMPTY_NOTEBOOK_SHEETS;
  try {
    const raw = window.localStorage.getItem(notebookSheetStorageKey(notebookId));
    return raw ? parseStoredNotebookSheets(JSON.parse(raw)) : EMPTY_NOTEBOOK_SHEETS;
  } catch {
    return EMPTY_NOTEBOOK_SHEETS;
  }
}

function writeStored(notebookId: string, value: NotebookSheets) {
  try {
    const key = notebookSheetStorageKey(notebookId);
    if (value.sheets.length > 0) window.localStorage.setItem(key, JSON.stringify(value));
    else window.localStorage.removeItem(key);
  } catch {
    // A private window keeps the sheets for this visit only.
  }
}

/**
 * The sheets kept beside this notebook's pages, remembered on this device so
 * they are still there the next time the notebook opens.
 */
export function useNotebookSheets(notebookId: string) {
  const [state, setState] = useState(() => ({ notebookId, value: readStored(notebookId) }));
  // Another notebook opened in the same editor reads its own sheets.
  const current = state.notebookId === notebookId ? state.value : readStored(notebookId);

  const update = useCallback(
    (value: NotebookSheets) => {
      writeStored(notebookId, value);
      setState({ notebookId, value });
    },
    [notebookId]
  );

  return {
    sheets: current.sheets,
    open: current.open && current.sheets.length > 0,
    /** Keeps a sheet and shows them all; says which panel it is in and whether that panel is new. */
    add: useCallback(
      (sheet: NotebookSheet) => {
        const { next, slot, added } = addNotebookSheet(current, sheet);
        update(next);
        return { slot, added };
      },
      [current, update]
    ),
    replace: useCallback(
      (slot: number, sheet: NotebookSheet) => update(replaceNotebookSheet(current, slot, sheet)),
      [current, update]
    ),
    remove: useCallback((slot: number) => update(removeNotebookSheet(current, slot)), [current, update]),
    setPage: useCallback(
      (slot: number, page: number) => update(setNotebookSheetPage(current, slot, page)),
      [current, update]
    ),
    setOpen: useCallback(
      (open: boolean) => {
        if (current.sheets.length > 0) update({ ...current, open });
      },
      [current, update]
    ),
  };
}

/** The folder's PDFs and pictures, read when the picker opens. */
export function useFolderSheetChoices(input: { userId: string; folderId: string; enabled: boolean }) {
  const [loaded, setLoaded] = useState<{
    key: string;
    sheets: NotebookSheet[];
    failed: boolean;
  } | null>(null);
  const key = `${input.userId}:${input.folderId}`;

  useEffect(() => {
    if (!input.enabled || !input.userId || !input.folderId) return;
    let cancelled = false;
    void getActiveSourcesForFolderPage(input.userId, input.folderId, { pageSize: 100 })
      .then((page) => {
        if (!cancelled) setLoaded({ key, sheets: notebookSheetsFromSources(page.items), failed: false });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key, sheets: [], failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [input.enabled, input.userId, input.folderId, key]);

  const current = loaded?.key === key ? loaded : null;
  return {
    sheets: current?.sheets ?? [],
    loading: input.enabled && current === null,
    failed: current?.failed ?? false,
  };
}

export type NotebookSheetUpload = { progress: number | null; error: string | null };

/**
 * Uploading a sheet from the picker. The file is added to the folder's sources,
 * like any file a student adds there, so it is offered again from the folder
 * and can be used beyond this notebook. A notebook's own files are not the
 * place: in a notebook with no file of its own, the newest one is drawn behind
 * every page.
 */
export function useNotebookSheetUpload({ userId, folderId }: { userId: string; folderId: string }) {
  const [upload, setUpload] = useState<NotebookSheetUpload | null>(null);
  const start = useCallback(
    async (file: File, onUploaded: (sheet: NotebookSheet) => void) => {
      if (!isNotebookSheetFileType(file.type)) {
        setUpload({ progress: null, error: "Choose a PDF, or a JPEG, PNG or WebP picture." });
        return;
      }
      setUpload({ progress: 0, error: null });
      try {
        const created = await createFileSource({
          userId,
          file,
          title: notebookSheetTitleForFile(file.name),
          folderIds: folderId ? [folderId] : [],
          onProgress: (progress) => setUpload({ progress, error: null }),
        });
        const sheet = notebookSheetFromUploadedSource(created);
        setUpload(null);
        if (sheet) onUploaded(sheet);
      } catch (error) {
        setUpload({
          progress: null,
          error: error instanceof Error ? error.message : "That file could not be uploaded. Try again.",
        });
      }
    },
    [folderId, userId]
  );
  return {
    upload,
    start,
    clear: useCallback(() => setUpload(null), []),
  };
}

/** Where to fetch a picture sheet from. PDFs are drawn from their bytes instead. */
export function useNotebookSheetImageUrl(sheet: NotebookSheet | null) {
  const [resolved, setResolved] = useState<{ path: string; url: string | null } | null>(null);
  const path = sheet && sheet.fileType.startsWith("image/") ? sheet.storagePath : null;
  const origin = sheet?.origin ?? null;

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    const loading = origin === "notebook" ? getNotebookFileDownloadUrl(path) : getSourceFileDownloadUrl(path);
    void loading
      .then((url) => {
        if (!cancelled) setResolved({ path, url });
      })
      .catch(() => {
        if (!cancelled) setResolved({ path, url: null });
      });
    return () => {
      cancelled = true;
    };
  }, [path, origin]);

  if (!path) return { url: null, failed: false };
  const current = resolved?.path === path ? resolved : null;
  return { url: current?.url ?? null, failed: current !== null && current.url === null };
}
