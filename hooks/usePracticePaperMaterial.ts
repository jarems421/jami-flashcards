"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MAX_SOURCE_FOLDER_IDS, type Source } from "@/lib/material/sources";
import { MAX_PRACTICE_PAPER_SOURCE_IDS } from "@/lib/practice/practice-papers";
import { defaultPaperMaterial, paperMaterialTitle } from "@/lib/practice/practice-paper-request";
import { createUploadedSource } from "@/services/study/source-upload";
import { getActiveSources, getActiveSourcesForFolderPage, updateSource } from "@/services/study/sources";

const FOLDER_SOURCE_PAGE_SIZE = 100;

type Feedback = {
  clear: () => void;
  showError: (message: string) => void;
  showThrownError: (error: unknown, fallback: string) => void;
};

/**
 * The material a practice paper can be built from.
 *
 * The chosen folder's sources are held against the folder they were loaded
 * for, so a folder that is still loading -- or failed to -- never shows, or
 * offers to attach, another folder's material. The student's material in
 * other folders is the library they can bring into this one.
 *
 * For an exam the student describes, the material it is built from starts as
 * the folder's past papers then notes, and files added here join the folder
 * so the next paper starts from them too.
 */
export function usePracticePaperMaterial({
  userId,
  folderId,
  feedback,
}: {
  userId: string;
  folderId: string;
  feedback: Feedback;
}) {
  const { clear, showError, showThrownError } = feedback;
  const [loaded, setLoaded] = useState<{ folderId: string; items: Source[] } | null>(null);
  const [allSources, setAllSources] = useState<Source[]>([]);
  const [chosen, setChosen] = useState<{ folderId: string; ids: string[] } | null>(null);
  const [uploading, setUploading] = useState<"paper" | "notes" | null>(null);
  const [addingFromLibrary, setAddingFromLibrary] = useState(false);

  useEffect(() => {
    if (!folderId) return;
    let active = true;
    void getActiveSourcesForFolderPage(userId, folderId, { pageSize: FOLDER_SOURCE_PAGE_SIZE })
      .then((page) => {
        if (active) setLoaded({ folderId, items: page.items });
      })
      .catch((error) => {
        if (!active) return;
        setLoaded({ folderId, items: [] });
        showThrownError(error, "Could not load this folder's sources.");
      });
    return () => {
      active = false;
    };
  }, [folderId, showThrownError, userId]);

  // Everything the student has added anywhere, for bringing into this folder.
  useEffect(() => {
    let active = true;
    void getActiveSources(userId)
      .then((items) => {
        if (active) setAllSources(items);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [userId]);

  const sources = useMemo(
    () => (loaded?.folderId === folderId ? loaded.items : []),
    [folderId, loaded]
  );
  const loadingSources = Boolean(folderId) && loaded?.folderId !== folderId;
  const library = useMemo(
    () => allSources.filter((source) => !source.folderIds.includes(folderId)),
    [allSources, folderId]
  );
  const materialIds = chosen?.folderId === folderId ? chosen.ids : defaultPaperMaterial(sources);

  const setMaterialIds = useCallback((ids: string[]) => setChosen({ folderId, ids }), [folderId]);

  /** Re-reads a folder's sources after adding to it, and picks what was added. */
  const settleAdded = async (forFolderId: string, startingIds: string[], added: string[]) => {
    const page = await getActiveSourcesForFolderPage(userId, forFolderId, {
      pageSize: FOLDER_SOURCE_PAGE_SIZE,
    }).catch(() => null);
    if (page) setLoaded({ folderId: forFolderId, items: page.items });
    setChosen({
      folderId: forFolderId,
      ids: [...startingIds, ...added].slice(0, MAX_PRACTICE_PAPER_SOURCE_IDS),
    });
  };

  const uploadMaterial = async (files: File[], kind: "paper" | "notes") => {
    if (!folderId || uploading) return;
    setUploading(kind);
    clear();
    const forFolderId = folderId;
    const startingIds = materialIds;
    const added: string[] = [];
    try {
      for (const file of files) {
        const uploaded = await createUploadedSource({
          userId,
          folderId: forFolderId,
          title: paperMaterialTitle(file.name, kind),
          file,
        });
        added.push(uploaded.id);
      }
    } catch (error) {
      showThrownError(error, "Could not add that file.");
    } finally {
      await settleAdded(forFolderId, startingIds, added);
      setUploading(null);
    }
  };

  /**
   * Material from the student's library joins this folder rather than being
   * uploaded again. A paper only reads material in its folder, so the link is
   * what makes it usable, and it stays for the next paper.
   */
  const addFromLibrary = async (ids: string[]) => {
    if (!folderId || addingFromLibrary) return;
    setAddingFromLibrary(true);
    clear();
    const forFolderId = folderId;
    const startingIds = materialIds;
    const added: string[] = [];
    try {
      for (const id of ids) {
        const source = library.find((item) => item.id === id);
        if (!source) continue;
        if (source.folderIds.length >= MAX_SOURCE_FOLDER_IDS) {
          showError(
            `"${source.title}" is already in ${MAX_SOURCE_FOLDER_IDS} folders, so it couldn't be added here.`
          );
          continue;
        }
        await updateSource(userId, id, { folderIds: [...source.folderIds, forFolderId] });
        added.push(id);
      }
    } catch (error) {
      showThrownError(error, "Could not add that from your library.");
    } finally {
      await settleAdded(forFolderId, startingIds, added);
      setAllSources((current) =>
        current.map((item) =>
          added.includes(item.id) ? { ...item, folderIds: [...item.folderIds, forFolderId] } : item
        )
      );
      setAddingFromLibrary(false);
    }
  };

  return {
    sources,
    loadingSources,
    library,
    materialIds,
    setMaterialIds,
    uploading,
    addingFromLibrary,
    uploadMaterial,
    addFromLibrary,
  };
}
