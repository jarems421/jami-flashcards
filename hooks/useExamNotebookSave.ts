"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Notebook } from "@/lib/workspace/notebooks";
import { saveExamAttemptToNotebook } from "@/services/study/exam-practice";
import { getActiveNotebooks } from "@/services/study/notebooks";

/**
 * Keeping a marked answer as a notebook page.
 *
 * Only the session folder's notebooks are offered. A session started from a
 * notebook goes back to that notebook by default: making the student find it
 * again in a list broke the loop the feature is built around -- notebook to
 * practice and back -- and picking the wrong one is a page in the wrong book.
 */
export function useExamNotebookSave({
  userId,
  sessionId,
  folderId,
  originNotebookId,
  markedAttemptId,
  onError,
}: {
  userId: string;
  sessionId: string;
  folderId: string | undefined;
  originNotebookId: string | undefined;
  markedAttemptId: string | undefined;
  onError: (message: string) => void;
}) {
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  /** The student's own pick, if they have made one. */
  const [pickedNotebookId, setPickedNotebookId] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedNotebookId, setSavedNotebookId] = useState("");

  useEffect(() => {
    if (!userId) return;
    void getActiveNotebooks(userId)
      .then(setNotebooks)
      .catch(() => undefined);
  }, [userId]);

  const choices = useMemo(
    () => notebooks.filter((item) => item.folderId === folderId),
    [folderId, notebooks]
  );
  const originChoice = choices.some((item) => item.id === originNotebookId) ? (originNotebookId ?? "") : "";
  const notebookId = pickedNotebookId || originChoice;

  const save = useCallback(async () => {
    if (!markedAttemptId || !notebookId) return;
    setSaving(true);
    onError("");
    try {
      const saved = await saveExamAttemptToNotebook({ sessionId, attemptId: markedAttemptId, notebookId });
      setSavedNotebookId(saved.notebookId);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "This work could not be saved to your notebook.");
    } finally {
      setSaving(false);
    }
  }, [markedAttemptId, notebookId, onError, sessionId]);

  /** Another question: its own page has not been saved anywhere yet. */
  const forgetSaved = useCallback(() => setSavedNotebookId(""), []);

  return {
    choices,
    notebookId,
    pickNotebook: setPickedNotebookId,
    saving,
    savedNotebookId,
    save,
    forgetSaved,
  };
}
