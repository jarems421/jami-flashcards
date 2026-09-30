"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFeedback } from "@/hooks/useFeedback";
import {
  countChangedTutorStyle,
  DEFAULT_TUTOR_PREFERENCES,
  type TutorStyleChoices,
} from "@/lib/ai/tutor-personalisation";
import {
  loadTutorPersonalisation,
  saveFolderTutorNotes,
  saveTutorPreferences,
  saveTutorStudyProfile,
  type TutorPersonalisation,
} from "@/services/ai/tutor-personalisation";
import type { StudyLevel } from "@/lib/profile/study-level";

/** A stable empty list, so an unloaded panel does not remount its subject form. */
const EMPTY_SUBJECTS: string[] = [];

/**
 * Where the quiet saves are, for the one line of status beside them.
 *
 * Style choices and notes save the moment they change, so there is no Save
 * button to disable and no "Unsaved" to warn about -- only this.
 */
export type TutorSaveStatus = "idle" | "saving" | "saved" | "failed";

/**
 * Loading and saving a student's Tutor personalisation, once.
 *
 * The same state serves two very different screens -- a drawer beside a
 * conversation and a full page -- and neither should own the reads. Keeping it
 * here means the page cannot drift from the drawer on what "saved" means, which
 * is exactly the kind of thing that goes wrong when a settings surface is built
 * twice.
 *
 * Every change but the study level saves as it is made. They are applied here
 * first and sent in order through one queue, so two quick taps cannot arrive at
 * the server the wrong way round; a failure puts back what that change replaced
 * and says so.
 */
export function useTutorPersonalisation(activeFolderIds?: readonly string[]) {
  const [data, setData] = useState<TutorPersonalisation | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [loadingFolder, setLoadingFolder] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [saveStatus, setSaveStatus] = useState<TutorSaveStatus>("idle");
  const { feedback, success, showThrownError, clear } = useFeedback();

  /*
   * Only the newest load may report back. Switching folders quickly otherwise
   * lets a slow first request land after a fast second one and show the wrong
   * notes under the right folder's name.
   */
  const requestRef = useRef(0);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingRef = useRef(0);
  const failedRef = useRef(false);
  /** Which edit last touched each field, so a failed save undoes only its own. */
  const editRef = useRef({ next: 0, latest: new Map<string, number>() });

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
        // A folder switch replaces the folder and nothing else, so a style
        // change still on its way to the server is not undone by a read that
        // started before it landed.
        setData((current) =>
          options.folderOnly && current
            ? { ...current, folder: result.folder }
            : result
        );
        setLoadFailed(false);
        if (!folderId && result.folders.length > 0) {
          const active =
            activeFolderIds?.length === 1
              ? result.folders.find((entry) => entry.id === activeFolderIds[0])
              : undefined;
          setSelectedFolderId(active?.id ?? result.folders[0].id);
        }
      } catch (error) {
        if (requestRef.current !== requestId) return;
        if (!options.folderOnly) setLoadFailed(true);
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
   * Saves run in order, and a failed one is undone -- but only for the fields
   * no later edit has changed since. Two quick changes to the same setting
   * queue two saves; if the first fails, putting back what it replaced would
   * erase the second, which is still on its way to the server and will land.
   */
  const enqueueSave = useCallback(
    (
      fields: readonly string[],
      send: () => Promise<unknown>,
      undo: (owns: (field: string) => boolean) => void,
      failure: string
    ) => {
      const edits = editRef.current;
      edits.next += 1;
      const edit = edits.next;
      for (const field of fields) edits.latest.set(field, edit);
      pendingRef.current += 1;
      setSaveStatus("saving");
      queueRef.current = queueRef.current.then(async () => {
        try {
          await send();
        } catch (error) {
          failedRef.current = true;
          undo((field) => edits.latest.get(field) === edit);
          showThrownError(error, failure);
        } finally {
          pendingRef.current -= 1;
          if (pendingRef.current === 0) {
            setSaveStatus(failedRef.current ? "failed" : "saved");
            failedRef.current = false;
          }
        }
      });
    },
    [showThrownError]
  );

  const saveStyle = useCallback(
    (patch: Partial<TutorStyleChoices>) => {
      const previous = { ...preferences };
      clear();
      setData((current) =>
        current
          ? { ...current, preferences: { ...current.preferences, ...patch } }
          : current
      );
      const keys = Object.keys(patch) as (keyof TutorStyleChoices)[];
      enqueueSave(
        keys.map((key) => `style:${key}`),
        () => saveTutorPreferences(patch),
        (owns) =>
          setData((current) => {
            if (!current) return current;
            const restored = { ...current.preferences };
            for (const key of keys) {
              if (owns(`style:${key}`)) Object.assign(restored, { [key]: previous[key] });
            }
            return { ...current, preferences: restored };
          }),
        "Jami could not save that change."
      );
    },
    [clear, enqueueSave, preferences]
  );

  const saveGeneralNotes = useCallback(
    (notes: string[]) => {
      const previous = preferences.notes;
      clear();
      setData((current) =>
        current
          ? { ...current, preferences: { ...current.preferences, notes } }
          : current
      );
      enqueueSave(
        ["notes"],
        () => saveTutorPreferences({ notes }),
        (owns) =>
          setData((current) =>
            current && owns("notes")
              ? {
                  ...current,
                  preferences: { ...current.preferences, notes: previous },
                }
              : current
          ),
        "Jami could not save your notes."
      );
    },
    [clear, enqueueSave, preferences.notes]
  );

  const saveFolderNotes = useCallback(
    (notes: string[]) => {
      const folderId = selectedFolderId;
      const previous = data?.folder?.id === folderId ? data.folder.notes : [];
      const apply = (next: string[]) =>
        setData((current) =>
          current
            ? {
                ...current,
                folders: current.folders.map((entry) =>
                  entry.id === folderId
                    ? { ...entry, noteCount: next.length }
                    : entry
                ),
                folder:
                  current.folder?.id === folderId
                    ? { ...current.folder, notes: next }
                    : current.folder,
              }
            : current
        );
      clear();
      apply(notes);
      enqueueSave(
        [`folder:${folderId}`],
        () => saveFolderTutorNotes({ folderId, notes }),
        (owns) => {
          if (owns(`folder:${folderId}`)) apply(previous);
        },
        "Jami could not save these notes."
      );
    },
    [clear, data, enqueueSave, selectedFolderId]
  );

  /*
   * The level and its subjects, which the Account page used to own.
   *
   * Saved on its own and with an explicit button, because it is a different
   * document -- the user record, not the tutor settings -- and because a level
   * change without its subjects is not a state worth storing on the way.
   */
  const saveStudyProfile = useCallback(
    async (input: {
      studyLevel: StudyLevel | null;
      studySubjects: readonly string[];
    }) => {
      setSavingProfile(true);
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
        setSavingProfile(false);
      }
    },
    [clear, showThrownError, success]
  );

  return {
    data,
    preferences,
    activeFolder,
    changedStyleCount: countChangedTutorStyle(preferences),
    loading,
    loadFailed,
    loadingFolder,
    savingProfile,
    saveStatus,
    selectedFolderId,
    setSelectedFolderId,
    feedback,
    clearFeedback: clear,
    reload: () => void load(""),
    saveStyle,
    saveGeneralNotes,
    saveFolderNotes,
    saveStudyProfile,
    studyLevel: data?.accountStudyLevel ?? null,
    studySubjects: data?.accountStudySubjects ?? EMPTY_SUBJECTS,
  };
}
