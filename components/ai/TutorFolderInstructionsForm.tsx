"use client";

import { useState } from "react";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Select,
  Skeleton,
  Textarea,
} from "@/components/ui";
import {
  FOLDER_INSTRUCTIONS_EXAMPLE,
  MAX_FOLDER_TUTOR_INSTRUCTIONS_LENGTH,
} from "@/lib/ai/tutor-personalisation";
import TutorFolderOnboarding from "@/components/ai/TutorFolderOnboarding";
import { getStudyLevelLabel } from "@/lib/profile/study-level";
import type {
  TutorFolderInstructions,
  TutorFolderSummary,
} from "@/services/ai/tutor-personalisation";

type TutorFolderInstructionsFormProps = {
  folders: TutorFolderSummary[];
  selectedFolderId: string;
  folder: TutorFolderInstructions | null;
  /**
   * The editor's text, owned by the panel.
   *
   * It lives up there because the saved document arrives asynchronously, and
   * the only correct moment to replace what is being edited is when that load
   * returns -- which is a callback, not a render. Keeping it here meant an
   * effect watching for the value to change, which is the same thing done
   * later and less predictably.
   */
  draft: string;
  onDraftChange: (draft: string) => void;
  loadingFolder: boolean;
  guideCompleted: boolean;
  saving: boolean;
  onSelectFolder: (folderId: string) => void;
  onSave: (input: {
    instructions: string;
    completeGuide: boolean;
  }) => Promise<boolean>;
  onSkipGuide: () => Promise<void>;
};

/**
 * One instruction document per folder, and the short guide that writes a first
 * one.
 *
 * The guide exists because a blank four-thousand-character box is a genuinely
 * hard thing to be handed, and because the questions are the actual content:
 * which course, what to focus on, what to avoid. It runs once for the account
 * rather than once per folder -- what the document is for is learned once --
 * and it builds its draft from a template rather than from a model, so it costs
 * nothing and returns the same thing every time.
 */
export default function TutorFolderInstructionsForm({
  folders,
  selectedFolderId,
  folder,
  draft,
  onDraftChange,
  loadingFolder,
  guideCompleted,
  saving,
  onSelectFolder,
  onSave,
  onSkipGuide,
}: TutorFolderInstructionsFormProps) {
  const saved = folder?.instructions ?? "";
  const selected = folders.find((entry) => entry.id === selectedFolderId);

  /*
   * Everything below is scratch state for one folder, and the panel remounts
   * this form when the folder changes, so none of it needs resetting by hand.
   *
   * The course field is prefilled from what is actually known and nothing else.
   * Inventing a plausible exam board would be worse than an empty box: a
   * student would accept it, and Jami would then teach the wrong syllabus with
   * their apparent blessing.
   */
  const [showExample, setShowExample] = useState(false);
  const [pendingFolderId, setPendingFolderId] = useState<string | null>(null);
  const [courseOrSubject] = useState(() =>
    [
      selected?.subject ?? "",
      selected?.studyLevel ? getStudyLevelLabel(selected.studyLevel) : "",
    ]
      .filter(Boolean)
      .join(", ")
  );

  const dirty = draft !== saved;
  const showGuide = !guideCompleted && !saved && !loadingFolder && Boolean(selected);

  if (folders.length === 0) {
    return (
      <EmptyState
        emoji="📁"
        title="No folders yet"
        description="Notes are written for a folder. Make one first."
      />
    );
  }

  const requestFolderChange = (nextFolderId: string) => {
    if (nextFolderId === selectedFolderId) return;
    if (dirty) {
      setPendingFolderId(nextFolderId);
      return;
    }
    onSelectFolder(nextFolderId);
  };

  return (
    <div className="flex flex-col gap-4">
      <Select
        label="Folder"
        value={selectedFolderId}
        disabled={saving}
        onChange={(event) => requestFolderChange(event.target.value)}
      >
        {folders.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name}
            {entry.hasInstructions ? " — has notes" : ""}
          </option>
        ))}
      </Select>

      {loadingFolder ? (
        <Skeleton className="h-48 w-full rounded-2xl" />
      ) : showGuide ? (
        <TutorFolderOnboarding
          folderName={selected?.name ?? "this folder"}
          suggestedCourse={courseOrSubject}
          saving={saving}
          onSave={(instructions) =>
            onSave({ instructions, completeGuide: true })
          }
          onSkip={() => void onSkipGuide()}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <Textarea
              label={`Notes for ${selected?.name ?? "this folder"}`}
              rows={8}
              value={draft}
              disabled={saving}
              maxLength={MAX_FOLDER_TUTOR_INSTRUCTIONS_LENGTH}
              placeholder="Exam board, notation, what to focus on, what to avoid."
              onChange={(event) => onDraftChange(event.target.value)}
            />
            <p className="mt-2 flex items-center justify-between gap-3 text-2xs text-text-muted">
              <button
                type="button"
                className="font-semibold text-accent underline-offset-4 hover:underline"
                onClick={() => setShowExample((current) => !current)}
              >
                {showExample ? "Hide example" : "Example"}
              </button>
              <span aria-hidden="true">
                {draft.length}/{MAX_FOLDER_TUTOR_INSTRUCTIONS_LENGTH}
              </span>
            </p>
          </div>

          {showExample ? (
            <pre className="overflow-x-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4 text-2xs leading-5 text-text-muted">
              {FOLDER_INSTRUCTIONS_EXAMPLE}
            </pre>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              disabled={!dirty || saving}
              onClick={() =>
                void onSave({ instructions: draft, completeGuide: false })
              }
            >
              {saving ? "Saving…" : "Save notes"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={saving || (!draft && !saved)}
              onClick={() => onDraftChange("")}
            >
              Clear
            </Button>
            {dirty && !saving ? (
              <span className="text-xs text-text-muted">Unsaved</span>
            ) : null}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingFolderId !== null}
        title="Discard your changes?"
        description="These notes are not saved. Switching folders loses the edit."
        confirmLabel="Discard and switch"
        cancelLabel="Keep editing"
        onConfirm={() => {
          if (pendingFolderId) onSelectFolder(pendingFolderId);
          setPendingFolderId(null);
        }}
        onClose={() => setPendingFolderId(null)}
      />
    </div>
  );
}
