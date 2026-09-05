"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFeedback } from "@/hooks/useFeedback";
import {
  countActiveTutorPreferences,
  DEFAULT_TUTOR_PREFERENCES,
  type TutorPreferences,
} from "@/lib/ai/tutor-personalisation";
import {
  loadTutorPersonalisation,
  saveFolderTutorInstructions,
  saveTutorPreferences,
  saveTutorStudyProfile,
  type TutorPersonalisation,
} from "@/services/ai/tutor-personalisation";
import type { StudyLevel } from "@/lib/profile/study-level";

/** A stable empty list, so an unloaded panel does not remount its subject form. */
const EMPTY_SUBJECTS: string[] = [];

export type TutorPersonalisationSavePreferences = Pick<
  TutorPreferences,
  | "helpApproach"
  | "explanationDepth"
  | "feedbackDirectness"
  | "checkUnderstanding"
  | "customGuidance"
>;

/**
 * Loading and saving a student's Tutor personalisation, once.
 *
 * The same state serves two very different screens -- a drawer beside a
 * conversation and a full page -- and neither should own the reads. Keeping it
 * here means the page cannot drift from the drawer on what "saved" means, which
 * is exactly the kind of thing that goes wrong when a settings surface is built
 * twice.
 */
export function useTutorPersonalisation(activeFolderIds?: readonly string[]) {
  const [data, setData] = useState<TutorPersonalisation | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [loadingFolder, setLoadingFolder] = useState(false);
  const [saving, setSaving] = useState(false);
  const [instructionsDraft, setInstructionsDraft] = useState("");
  const { feedback, success, showThrownError, clear } = useFeedback();

  /*
   * Only the newest load may report back. Switching folders quickly otherwise
   * lets a slow first request land after a fast second one and show the wrong
   * document under the right folder's name.
   */
  const requestRef = useRef(0);

  const load = useCallback(
    async (folderId: string, options: { folderOnly?: boolean } = {}) => {
      const requestId = requestRef.current + 1;
      requestRef.current = requestId;
      if (options.folderOnly) setLoadingFolder(true);
      else setLoading(true);
      try {
        const result = await loadTutorPersonalisation(
          folderId ? { folderId } : {}
        );
        if (requestRef.current !== requestId) return;
        setData(result);
        setLoadFailed(false);
        // The document that just arrived is what the editor should show. A
        // folder is only switched past the unsaved-changes confirm, so this
        // never lands on top of work the student wanted to keep.
        if (result.folder) setInstructionsDraft(result.folder.instructions);
        else if (folderId) setInstructionsDraft("");
        if (!folderId && result.folders.length > 0) {
          const active =
            activeFolderIds?.length === 1
              ? result.folders.find((entry) => entry.id === activeFolderIds[0])
              : undefined;
          setSelectedFolderId(active?.id ?? result.folders[0].id);
        }
      } catch (error) {
        if (requestRef.current !== requestId) return;
        setLoadFailed(true);
        showThrownError(error, "Jami could not load your preferences.");
      } finally {
        if (requestRef.current === requestId) {
          setLoading(false);
          setLoadingFolder(false);
        }
      }
    },
    [activeFolderIds, showThrownError]
  );

  useEffect(() => {
    void load("");
    // Loading once on mount is the point; the folder reload below is separate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedFolderId || loading) return;
    void load(selectedFolderId, { folderOnly: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFolderId]);

  const preferences = data?.preferences ?? DEFAULT_TUTOR_PREFERENCES;

  const activeFolder = useMemo(() => {
    if (activeFolderIds?.length !== 1 || !data) return null;
    return data.folders.find((entry) => entry.id === activeFolderIds[0]) ?? null;
  }, [activeFolderIds, data]);

  /*
   * The level and its subjects, which the Account page used to own.
   *
   * Saved on its own rather than folded into `savePreferences`, because it is a
   * different document -- the user record, not the tutor settings -- and a
   * student changing their level should not have to press Save on four teaching
   * choices they did not touch.
   */
  const saveStudyProfile = useCallback(
    async (input: {
      studyLevel: StudyLevel | null;
      studySubjects: readonly string[];
    }) => {
      setSaving(true);
      clear();
      try {
        const saved = await saveTutorStudyProfile(input);
        setData((current) =>
          current
            ? {
                ...current,
                accountStudyLevel: saved.studyLevel,
                accountStudySubjects: saved.studySubjects,
              }
            : current
        );
        success("Saved. Jami pitches at this from your next question.");
        return true;
      } catch (error) {
        showThrownError(error, "Jami could not save your study level.");
        return false;
      } finally {
        setSaving(false);
      }
    },
    [clear, showThrownError, success]
  );

  const savePreferences = useCallback(
    async (input: TutorPersonalisationSavePreferences) => {
      setSaving(true);
      clear();
      try {
        const updated = await saveTutorPreferences(input);
        setData((current) =>
          current ? { ...current, preferences: updated } : current
        );
        success("Saved. Jami follows this from your next question.");
        return true;
      } catch (error) {
        showThrownError(error, "Jami could not save your preferences.");
        return false;
      } finally {
        setSaving(false);
      }
    },
    [clear, showThrownError, success]
  );

  const saveInstructions = useCallback(
    async (input: { instructions: string; completeGuide: boolean }) => {
      setSaving(true);
      clear();
      try {
        const savedFolder = await saveFolderTutorInstructions({
          folderId: selectedFolderId,
          instructions: input.instructions,
        });
        const updatedPreferences =
          input.completeGuide && !preferences.folderGuideCompleted
            ? await saveTutorPreferences({ folderGuideCompleted: true })
            : null;
        setData((current) =>
          current
            ? {
                ...current,
                preferences: updatedPreferences ?? current.preferences,
                folders: current.folders.map((entry) =>
                  entry.id === savedFolder.id
                    ? {
                        ...entry,
                        hasInstructions: savedFolder.instructions.length > 0,
                        instructionsUpdatedAt: savedFolder.instructionsUpdatedAt,
                      }
                    : entry
                ),
                folder:
                  current.folder && current.folder.id === savedFolder.id
                    ? { ...current.folder, ...savedFolder }
                    : current.folder,
              }
            : current
        );
        success(
          savedFolder.instructions
            ? "Subject notes saved."
            : "Subject notes cleared."
        );
        return true;
      } catch (error) {
        showThrownError(error, "Jami could not save these notes.");
        return false;
      } finally {
        setSaving(false);
      }
    },
    [clear, preferences.folderGuideCompleted, selectedFolderId, showThrownError, success]
  );

  const skipGuide = useCallback(async () => {
    setSaving(true);
    try {
      const updated = await saveTutorPreferences({ folderGuideCompleted: true });
      setData((current) =>
        current ? { ...current, preferences: updated } : current
      );
    } catch (error) {
      showThrownError(error, "Jami could not save your preferences.");
    } finally {
      setSaving(false);
    }
  }, [showThrownError]);

  return {
    data,
    preferences,
    activeFolder,
    activeCount: countActiveTutorPreferences(preferences),
    loading,
    loadFailed,
    loadingFolder,
    saving,
    selectedFolderId,
    setSelectedFolderId,
    instructionsDraft,
    setInstructionsDraft,
    feedback,
    clearFeedback: clear,
    reload: () => void load(""),
    savePreferences,
    saveInstructions,
    saveStudyProfile,
    skipGuide,
    studyLevel: data?.accountStudyLevel ?? null,
    studySubjects: data?.accountStudySubjects ?? EMPTY_SUBJECTS,
  };
}
