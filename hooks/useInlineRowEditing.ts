"use client";

import { useCallback, useMemo, useState } from "react";

export type InlineRowEditing<TDraft> = {
  /** Row currently open for editing, or null. */
  editingId: string | null;
  /** The in-progress values for that row. */
  draft: TDraft | null;
  isEditing: (id: string) => boolean;
  isSaving: (id: string) => boolean;
  isDeleting: (id: string) => boolean;
  /** True while any row is being deleted, for disabling the whole list. */
  deleteInFlight: boolean;
  startEditing: (id: string, draft: TDraft) => void;
  updateDraft: (patch: Partial<TDraft>) => void;
  cancelEditing: () => void;
  setSaving: (id: string | null) => void;
  setDeleting: (id: string | null) => void;
};

/**
 * Editing a row in place: which row is open, what is being typed into it, and
 * which row has a save or delete in flight.
 *
 * Pages held these as three separate id states plus a draft field per column,
 * so "stop editing" meant remembering to reset several of them. Cancelling
 * here clears the draft with the row.
 */
export function useInlineRowEditing<TDraft>(): InlineRowEditing<TDraft> {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TDraft | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const startEditing = useCallback((id: string, nextDraft: TDraft) => {
    setEditingId(id);
    setDraft(nextDraft);
  }, []);

  const updateDraft = useCallback((patch: Partial<TDraft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingId(null);
    setDraft(null);
  }, []);

  const isEditing = useCallback(
    (id: string) => editingId === id,
    [editingId]
  );
  const isSaving = useCallback((id: string) => savingId === id, [savingId]);
  const isDeleting = useCallback(
    (id: string) => deletingId === id,
    [deletingId]
  );

  return useMemo(
    () => ({
      editingId,
      draft,
      isEditing,
      isSaving,
      isDeleting,
      deleteInFlight: deletingId !== null,
      startEditing,
      updateDraft,
      cancelEditing,
      setSaving: setSavingId,
      setDeleting: setDeletingId,
    }),
    [
      cancelEditing,
      deletingId,
      draft,
      editingId,
      isDeleting,
      isEditing,
      isSaving,
      startEditing,
      updateDraft,
    ]
  );
}
