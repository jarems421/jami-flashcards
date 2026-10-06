"use client";

import { useCallback, useEffect, useState } from "react";
import {
  notebookSheetsFromSources,
  notebookSheetStorageKey,
  parseStoredNotebookSheet,
  type NotebookSheet,
  type StoredNotebookSheet,
} from "@/lib/workspace/notebook-sheet";
import { getNotebookFileDownloadUrl } from "@/services/study/notebook-files";
import { getSourceFileDownloadUrl } from "@/services/study/source-files";
import { getActiveSourcesForFolderPage } from "@/services/study/sources";

function readStored(notebookId: string): StoredNotebookSheet | null {
  if (typeof window === "undefined" || !notebookId) return null;
  try {
    const raw = window.localStorage.getItem(notebookSheetStorageKey(notebookId));
    return raw ? parseStoredNotebookSheet(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeStored(notebookId: string, value: StoredNotebookSheet | null) {
  try {
    const key = notebookSheetStorageKey(notebookId);
    if (value) window.localStorage.setItem(key, JSON.stringify(value));
    else window.localStorage.removeItem(key);
  } catch {
    // A private window keeps the sheet for this visit only.
  }
}

/**
 * The sheet kept beside this notebook's pages, remembered on this device so it
 * is still there the next time the notebook opens.
 */
export function useNotebookSheet(notebookId: string) {
  const [state, setState] = useState(() => ({ notebookId, value: readStored(notebookId) }));
  // Another notebook opened in the same editor reads its own sheet.
  const current = state.notebookId === notebookId ? state.value : readStored(notebookId);

  const update = useCallback(
    (value: StoredNotebookSheet | null) => {
      writeStored(notebookId, value);
      setState({ notebookId, value });
    },
    [notebookId]
  );
  const setOpen = useCallback(
    (open: boolean) => {
      if (current) update({ ...current, open });
    },
    [current, update]
  );

  return {
    sheet: current?.sheet ?? null,
    open: Boolean(current?.open),
    keep: useCallback((sheet: NotebookSheet) => update({ sheet, open: true }), [update]),
    setOpen,
    close: useCallback(() => update(null), [update]),
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
