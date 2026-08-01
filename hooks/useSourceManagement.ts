"use client";

import { useState } from "react";
import type { Source } from "@/lib/material/sources";
import { deleteSource, updateSource } from "@/services/study/sources";
import { deleteSourceFile } from "@/services/study/source-files";

export type SourceManagementAction = "archive" | "delete" | null;

export type SourceManagementController = {
  busyAction: string | null;
  renameOpen: boolean;
  renameTitle: string;
  confirmation: SourceManagementAction;
  setRenameTitle: (title: string) => void;
  openRename: () => void;
  closeRename: () => void;
  requestArchive: () => void;
  requestDelete: () => void;
  closeConfirmation: () => void;
  saveRename: () => Promise<void>;
  archive: () => Promise<void>;
  restore: () => Promise<void>;
  deleteEverywhere: () => Promise<void>;
};

type UseSourceManagementOptions = {
  userId: string;
  source: Source | null;
  onChanged: (message: string, restored?: boolean) => Promise<void>;
  onError: (error: unknown, fallback: string) => void;
};

/** Owns rename/archive/restore/delete state and mutations for one source. */
export function useSourceManagement({
  userId,
  source,
  onChanged,
  onError,
}: UseSourceManagementOptions): SourceManagementController {
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [confirmation, setConfirmation] =
    useState<SourceManagementAction>(null);

  const saveRename = async () => {
    if (!source || !renameTitle.trim()) return;
    setBusyAction("rename-source");
    try {
      await updateSource(userId, source.id, { title: renameTitle });
      setRenameOpen(false);
      await onChanged("Source renamed.");
    } catch (error) {
      onError(error, "Could not rename source.");
    } finally {
      setBusyAction(null);
    }
  };

  const archive = async () => {
    if (!source) return;
    setBusyAction("archive-source");
    try {
      await updateSource(userId, source.id, { status: "archived" });
      setConfirmation(null);
      await onChanged(
        "Source archived. Its folders and original file were kept."
      );
    } catch (error) {
      onError(error, "Could not archive source.");
    } finally {
      setBusyAction(null);
    }
  };

  const restore = async () => {
    if (!source) return;
    setBusyAction("restore-source");
    try {
      await updateSource(userId, source.id, { status: "active" });
      await onChanged("Source restored.", true);
    } catch (error) {
      onError(error, "Could not restore source.");
    } finally {
      setBusyAction(null);
    }
  };

  const deleteEverywhere = async () => {
    if (!source) return;
    const sourceToDelete = source;
    setBusyAction("delete-source");
    try {
      await deleteSource(userId, sourceToDelete.id);
      if (sourceToDelete.storagePath) {
        try {
          await deleteSourceFile(sourceToDelete.storagePath);
        } catch (error) {
          console.warn("Source record deleted, but file cleanup failed.", error);
        }
      }
      setConfirmation(null);
      await onChanged("Source deleted from Sources and its folders.");
    } catch (error) {
      onError(error, "Could not delete source.");
    } finally {
      setBusyAction(null);
    }
  };

  return {
    busyAction,
    renameOpen,
    renameTitle,
    confirmation,
    setRenameTitle,
    openRename: () => {
      if (!source) return;
      setRenameTitle(source.title);
      setRenameOpen(true);
    },
    closeRename: () => setRenameOpen(false),
    requestArchive: () => setConfirmation("archive"),
    requestDelete: () => setConfirmation("delete"),
    closeConfirmation: () => setConfirmation(null),
    saveRename,
    archive,
    restore,
    deleteEverywhere,
  };
}
