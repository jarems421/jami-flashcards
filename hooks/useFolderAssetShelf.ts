"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Source } from "@/lib/material/sources";
import type { Deck } from "@/lib/study/decks";
import { addFolderId, removeFolderId } from "@/lib/workspace/folder-links";
import {
  FOLDER_ASSET_PAGE_SIZE,
  mergeNewestFirst,
} from "@/lib/workspace/folder-workspace";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import {
  getDecks,
  getDecksForFolderPage,
  updateDeckFolders,
  type DeckFolderPageCursor,
} from "@/services/study/decks";
import {
  getActiveSources,
  getActiveSourcesForFolderPage,
  updateSource,
  type SourceFolderPageCursor,
} from "@/services/study/sources";

type ShelfItem = { id: string; folderIds: string[] };

/** What `busyId` holds while the picker's selection is being added. */
const PICKER_BUSY_ID = "picker";

/** What differs between the decks a folder links to and its sources. */
export type FolderShelfKind<T extends ShelfItem, Cursor> = {
  singular: string;
  plural: string;
  /** Capitalised plural, for the start of a sentence. */
  title: string;
  label: (item: T) => string;
  /** Newest first, by this. */
  timeOf: (item: T) => number;
  loadPage: (
    uid: string,
    folderId: string,
    options: { cursor?: Cursor | null; pageSize: number }
  ) => Promise<{ items: T[]; nextCursor: Cursor | null }>;
  /**
   * Everything the student has, for the picker. Firestore cannot ask for
   * "folderIds does not contain this folder", so this is read only when the
   * student opens the picker; browsing the folder stays filtered by membership.
   */
  loadAll: (uid: string) => Promise<T[]>;
  saveFolderIds: (uid: string, item: T, folderIds: string[]) => Promise<unknown>;
};

export const DECK_SHELF: FolderShelfKind<Deck, DeckFolderPageCursor> = {
  singular: "deck",
  plural: "decks",
  title: "Decks",
  label: (deck) => deck.name,
  timeOf: (deck) => deck.createdAt,
  loadPage: getDecksForFolderPage,
  loadAll: getDecks,
  saveFolderIds: (uid, deck, folderIds) => updateDeckFolders(uid, deck.id, folderIds),
};

export const SOURCE_SHELF: FolderShelfKind<Source, SourceFolderPageCursor> = {
  singular: "source",
  plural: "sources",
  title: "Sources",
  label: (source) => source.title,
  timeOf: (source) => source.updatedAt,
  loadPage: getActiveSourcesForFolderPage,
  loadAll: getActiveSources,
  saveFolderIds: (uid, source, folderIds) => updateSource(uid, source.id, { folderIds }),
};

export type FolderAssetShelf<T> = {
  /** Linked to the folder. */
  inFolder: T[];
  /** Loaded but not in the folder: what the picker offers. */
  available: T[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  pickerOpen: boolean;
  pickerBusy: boolean;
  togglePicker: () => Promise<void>;
  addToFolder: (ids: string[]) => Promise<boolean>;
  isBusy: (item: T) => boolean;
  toggleLink: (item: T) => Promise<void>;
};

/**
 * Decks or sources linked to a folder: loaded the first time their tab opens,
 * a page at a time, with a picker for adding ones the folder does not have.
 *
 * Linking only changes the item's folder list -- removing a deck from a folder
 * never deletes it. Each load is numbered, so one overtaken by opening the
 * picker, closing it or moving to another folder is dropped when it lands.
 */
export function useFolderAssetShelf<T extends ShelfItem, Cursor>({
  kind,
  uid,
  folderId,
  folder,
  active,
  feedback,
}: {
  kind: FolderShelfKind<T, Cursor>;
  uid: string;
  folderId: string | undefined;
  folder: StudyFolder | null;
  active: boolean;
  feedback: {
    success: (message: string) => void;
    showError: (message: string) => void;
    showThrownError: (error: unknown, fallback: string) => void;
  };
}): FolderAssetShelf<T> {
  const { success, showError, showThrownError } = feedback;
  const [items, setItems] = useState<T[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const generationRef = useRef(0);

  // Another folder starts from nothing; what was shown belonged to the last one.
  const [shelfFolderId, setShelfFolderId] = useState(folderId);
  if (shelfFolderId !== folderId) {
    setShelfFolderId(folderId);
    setItems([]);
    setLoaded(false);
    setCursor(null);
    setLoading(false);
    setLoadingMore(false);
    setPickerOpen(false);
  }

  useEffect(() => {
    generationRef.current += 1;
  }, [folderId]);

  const load = useCallback(async () => {
    if (!folderId || loaded || pickerOpen) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setLoading(true);
    try {
      const page = await kind.loadPage(uid, folderId, { pageSize: FOLDER_ASSET_PAGE_SIZE });
      if (generationRef.current !== generation) return;
      setItems(page.items);
      setCursor(page.nextCursor);
      setLoaded(true);
    } catch (error) {
      if (generationRef.current !== generation) return;
      console.error(error);
      showError(`Could not load this folder’s ${kind.plural}. Try again in a moment.`);
    } finally {
      if (generationRef.current === generation) setLoading(false);
    }
  }, [folderId, kind, loaded, pickerOpen, showError, uid]);

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  const togglePicker = async () => {
    if (pickerOpen) {
      generationRef.current += 1;
      setPickerOpen(false);
      return;
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setLoading(true);
    try {
      const everything = await kind.loadAll(uid);
      if (generationRef.current !== generation) return;
      setItems(everything);
      setCursor(null);
      setLoaded(true);
      setPickerOpen(true);
    } catch (error) {
      if (generationRef.current !== generation) return;
      console.error(`Failed to load the existing-${kind.singular} picker.`, error);
      showError(`Could not load ${kind.plural} to add. Try again in a moment.`);
    } finally {
      if (generationRef.current === generation) setLoading(false);
    }
  };

  const loadMore = async () => {
    if (!folderId || !cursor) return;
    setLoadingMore(true);
    try {
      const page = await kind.loadPage(uid, folderId, {
        cursor,
        pageSize: FOLDER_ASSET_PAGE_SIZE,
      });
      setItems((current) => mergeNewestFirst(current, page.items, kind.timeOf));
      setCursor(page.nextCursor);
    } catch (error) {
      console.error(`Failed to load more folder ${kind.plural}.`, error);
      showError(`Could not load more ${kind.plural}. Try again in a moment.`);
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleLink = async (item: T) => {
    if (!folder) return;
    const shouldLink = !item.folderIds.includes(folder.id);
    const folderIds = shouldLink
      ? addFolderId(item.folderIds, folder.id)
      : removeFolderId(item.folderIds, folder.id);
    setBusyId(item.id);
    try {
      await kind.saveFolderIds(uid, item, folderIds);
      setItems((current) =>
        current.map((entry) => (entry.id === item.id ? { ...entry, folderIds } : entry))
      );
      success(
        shouldLink
          ? `${kind.label(item)} now appears in ${folder.name}`
          : `${kind.label(item)} was removed from ${folder.name}`
      );
    } catch (error) {
      showThrownError(error, `Could not update ${kind.singular} folder link.`);
    } finally {
      setBusyId(null);
    }
  };

  /** Resolves true once every chosen item is in the folder, so the picker can reset. */
  const addToFolder = async (ids: string[]) => {
    if (!folder || ids.length === 0) return false;
    setBusyId(PICKER_BUSY_ID);
    try {
      await Promise.all(
        ids.map((id) => {
          const item = items.find((entry) => entry.id === id);
          return item
            ? kind.saveFolderIds(uid, item, addFolderId(item.folderIds, folder.id))
            : Promise.resolve();
        })
      );
      setItems((current) =>
        current.map((item) =>
          ids.includes(item.id)
            ? { ...item, folderIds: addFolderId(item.folderIds, folder.id) }
            : item
        )
      );
      setPickerOpen(false);
      success(`${kind.title} added to this folder.`);
      return true;
    } catch (error) {
      showThrownError(error, `Could not add ${kind.plural}.`);
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const inFolder = folder ? items.filter((item) => item.folderIds.includes(folder.id)) : [];
  const available = folder ? items.filter((item) => !item.folderIds.includes(folder.id)) : [];

  return {
    inFolder,
    available,
    loading,
    loadingMore,
    hasMore: Boolean(cursor),
    loadMore,
    pickerOpen,
    pickerBusy: busyId === PICKER_BUSY_ID,
    togglePicker,
    addToFolder,
    isBusy: (item: T) => busyId === item.id,
    toggleLink,
  };
}
