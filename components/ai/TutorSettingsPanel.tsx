"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TutorFolderInstructionsForm from "@/components/ai/TutorFolderInstructionsForm";
import TutorPreferencesForm from "@/components/ai/TutorPreferencesForm";
import { Button, FeedbackBanner, Skeleton } from "@/components/ui";
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
  type TutorPersonalisation,
} from "@/services/ai/tutor-personalisation";

type TutorSettingsPanelProps = {
  /**
   * The folders the current conversation's material belongs to.
   *
   * Exactly one means that folder's instructions apply. More than one means
   * none do, because two instruction documents cannot be merged and choosing
   * between them would be a guess. The summary says which of those is true
   * rather than leaving the student to work it out from a silent Tutor.
   */
  activeFolderIds?: readonly string[];
  onBack?: () => void;
  /**
   * What leaving is called here. "Back to chat" when the settings covered a
   * conversation, "Done" when they arrived as a drawer over a page -- there is
   * no chat to go back to in the second case, and saying so would be the
   * button describing somewhere the student has never been.
   */
  backLabel?: string;
};

/**
 * What the summary can honestly say about folder instructions.
 *
 * A surface that does not know which folders its material is in is not the same
 * as one that knows the answer is none, and saying "none apply" when the truth
 * is "not established here" is the kind of small lie that makes a student stop
 * believing the rest of the panel.
 */
function describeFolderScope(input: {
  activeFolderIds?: readonly string[];
  activeFolderName?: string;
  hasInstructions: boolean;
}) {
  if (!input.activeFolderIds) {
    return "Folder instructions apply when the material you are asking about sits in exactly one folder.";
  }
  if (input.activeFolderIds.length > 1) {
    return "This material belongs to more than one folder, so no folder instructions are being applied.";
  }
  if (input.activeFolderIds.length === 0) {
    return "This material is not in a folder, so no folder instructions apply.";
  }
  return input.hasInstructions
    ? `Folder instructions from ${input.activeFolderName ?? "this folder"}`
    : `No instructions written for ${input.activeFolderName ?? "this folder"} yet`;
}

type SettingsView = "preferences" | "folders";

const VIEWS: { id: SettingsView; label: string }[] = [
  { id: "preferences", label: "Preferences" },
  { id: "folders", label: "Folder instructions" },
];

/**
 * Every durable Tutor setting, in one place.
 *
 * It is a panel rather than a page so the same thing can be a drawer beside a
 * conversation and a full-screen sheet on a phone. Nothing else in the app
 * grows its own Tutor settings form: a folder, a notebook and a deck all send
 * the student here, which is the only way "where did I set that?" stays
 * answerable.
 */
export default function TutorSettingsPanel({
  activeFolderIds,
  onBack,
  backLabel = "Back to chat",
}: TutorSettingsPanelProps) {
  const [view, setView] = useState<SettingsView>("preferences");
  const [data, setData] = useState<TutorPersonalisation | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [loadingFolder, setLoadingFolder] = useState(false);
  /**
   * The folder-instructions editor's text.
   *
   * Owned here because the only correct moment to replace it is when a load
   * returns with the saved document, and that is a callback rather than a
   * render. Held in the form it needed an effect watching the loaded value,
   * which does the same thing one render later.
   */
  const [instructionsDraft, setInstructionsDraft] = useState("");
  const [saving, setSaving] = useState(false);
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
        // The document that just arrived is what the editor should be showing.
        // A folder is only switched past the unsaved-changes confirm, so this
        // never lands on top of work the student wanted to keep.
        if (result.folder) setInstructionsDraft(result.folder.instructions);
        else if (folderId) setInstructionsDraft("");
        if (!folderId && result.folders.length > 0) {
          // Preselect the conversation's own folder when there is exactly one,
          // which is the folder whose instructions are actually in force.
          const active =
            activeFolderIds?.length === 1
              ? result.folders.find((entry) => entry.id === activeFolderIds[0])
              : undefined;
          setSelectedFolderId(active?.id ?? result.folders[0].id);
        }
      } catch (error) {
        if (requestRef.current !== requestId) return;
        setLoadFailed(true);
        showThrownError(error, "Jami could not load your Tutor settings.");
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

  // Counted where the prompt counts them, so the number a student is shown is
  // the number of lines their settings actually add.
  const activeCount = countActiveTutorPreferences(preferences);

  const savePreferences = async (
    input: Pick<
      TutorPreferences,
      | "helpApproach"
      | "explanationDepth"
      | "feedbackDirectness"
      | "checkUnderstanding"
      | "customGuidance"
    >
  ) => {
    setSaving(true);
    clear();
    try {
      const updated = await saveTutorPreferences(input);
      setData((current) =>
        current ? { ...current, preferences: updated } : current
      );
      success("Preferences saved.");
      return true;
    } catch (error) {
      showThrownError(error, "Jami could not save your preferences.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveInstructions = async (input: {
    instructions: string;
    completeGuide: boolean;
  }) => {
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
          ? "Instructions saved."
          : "Instructions cleared."
      );
      return true;
    } catch (error) {
      showThrownError(error, "Jami could not save these instructions.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const skipGuide = async () => {
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
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
        <h2 className="text-base font-medium tracking-tight text-text-primary">
          Tutor settings
        </h2>
        {onBack ? (
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            {backLabel}
          </Button>
        ) : null}
      </div>

      <div
        role="tablist"
        aria-label="Tutor settings"
        className="flex gap-1 border-b border-[var(--color-border)] px-5"
      >
        {VIEWS.map((entry) => {
          const selected = entry.id === view;
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              id={`tutor-settings-tab-${entry.id}`}
              aria-selected={selected}
              aria-controls="tutor-settings-panel"
              onClick={() => setView(entry.id)}
              className={`-mb-px border-b-2 px-3 py-3 text-sm font-medium transition duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 ${
                selected
                  ? "border-accent text-text-primary"
                  : "border-transparent text-text-muted hover:text-text-secondary"
              }`}
            >
              {entry.label}
            </button>
          );
        })}
      </div>

      <div
        id="tutor-settings-panel"
        role="tabpanel"
        aria-labelledby={`tutor-settings-tab-${view}`}
        className="flex-1 overflow-y-auto px-5 py-5"
      >
        {feedback ? (
          <div className="mb-4">
            <FeedbackBanner
              type={feedback.type}
              message={feedback.message}
              onDismiss={clear}
            />
          </div>
        ) : null}

        {/*
          What is actually in force, shown only here. A permanent banner over
          every conversation would be the app explaining itself during the part
          where the student is trying to think.
        */}
        <div className="mb-5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4">
          <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-text-secondary">
            Active for this chat
          </p>
          <ul className="mt-2 space-y-1 text-xs leading-5 text-text-muted">
            <li>
              {activeFolder?.studyLevel || data?.accountStudyLevel
                ? "Study level is set"
                : "No study level set"}
              {activeFolder?.studyLevel ? " by this folder" : ""}
            </li>
            <li>
              {describeFolderScope({
                activeFolderIds,
                activeFolderName: activeFolder?.name,
                hasInstructions: activeFolder?.hasInstructions === true,
              })}
            </li>
            <li>
              {activeCount === 0
                ? "No saved preferences — Jami is adapting to each question"
                : `${activeCount} saved preference${activeCount === 1 ? "" : "s"}`}
            </li>
          </ul>
        </div>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full rounded-2xl" />
            <Skeleton className="h-24 w-full rounded-2xl" />
          </div>
        ) : loadFailed ? (
          <Button type="button" variant="secondary" onClick={() => void load("")}>
            Try again
          </Button>
        ) : view === "preferences" ? (
          <TutorPreferencesForm
            // Remounted whenever a load or save produces a new document, so the
            // fields restart from it without an effect copying values across.
            key={preferences.updatedAt}
            preferences={preferences}
            studyLevel={activeFolder?.studyLevel ?? data?.accountStudyLevel ?? null}
            studyLevelSource={activeFolder?.studyLevel ? "folder" : "account"}
            saving={saving}
            onSave={savePreferences}
          />
        ) : (
          <TutorFolderInstructionsForm
            // Remounted per folder, so the guide step, the example toggle and
            // the prefilled course field all start fresh without a reset.
            key={selectedFolderId}
            folders={data?.folders ?? []}
            selectedFolderId={selectedFolderId}
            folder={data?.folder ?? null}
            draft={instructionsDraft}
            onDraftChange={setInstructionsDraft}
            loadingFolder={loadingFolder}
            guideCompleted={preferences.folderGuideCompleted}
            saving={saving}
            onSelectFolder={setSelectedFolderId}
            onSave={saveInstructions}
            onSkipGuide={skipGuide}
          />
        )}
      </div>
    </div>
  );
}
