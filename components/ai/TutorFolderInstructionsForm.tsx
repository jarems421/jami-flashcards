"use client";

import { useState } from "react";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Input,
  Select,
  Skeleton,
  Textarea,
} from "@/components/ui";
import {
  buildFolderInstructionsDraft,
  FOLDER_INSTRUCTIONS_EXAMPLE,
  MAX_FOLDER_TUTOR_INSTRUCTIONS_LENGTH,
} from "@/lib/ai/tutor-personalisation";
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

type GuideStep = "questions" | "preview";

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
  const [guideStep, setGuideStep] = useState<GuideStep>("questions");
  const [courseOrSubject, setCourseOrSubject] = useState(() =>
    [
      selected?.subject ?? "",
      selected?.studyLevel ? getStudyLevelLabel(selected.studyLevel) : "",
    ]
      .filter(Boolean)
      .join(", ")
  );
  const [focusOn, setFocusOn] = useState("");
  const [avoid, setAvoid] = useState("");

  const dirty = draft !== saved;
  const showGuide = !guideCompleted && !saved && !loadingFolder && Boolean(selected);

  if (folders.length === 0) {
    return (
      <EmptyState
        emoji="📁"
        title="No folders yet"
        description="Folder instructions are written for a folder, so make one first. Everything you write there is used whenever Jami helps with that subject."
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
    <div className="flex flex-col gap-5">
      <Select
        label="Folder"
        value={selectedFolderId}
        disabled={saving}
        onChange={(event) => requestFolderChange(event.target.value)}
      >
        {folders.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name}
            {entry.hasInstructions ? " — has instructions" : ""}
          </option>
        ))}
      </Select>

      {loadingFolder ? (
        <Skeleton className="h-48 w-full rounded-2xl" />
      ) : showGuide ? (
        <div className="flex flex-col gap-5">
          <div className="rounded-2xl border border-accent/35 bg-accent/10 p-4">
            <p className="text-sm font-medium text-text-primary">
              Let&rsquo;s write your first set of instructions
            </p>
            <p className="mt-1 text-xs leading-5 text-text-muted">
              Three short answers. Jami turns them into a document you can edit
              before saving.
            </p>
          </div>

          {guideStep === "questions" ? (
            <>
              <Input
                label="What course or subject is this for?"
                value={courseOrSubject}
                disabled={saving}
                maxLength={200}
                placeholder="AQA A-level Biology"
                onChange={(event) => setCourseOrSubject(event.target.value)}
              />
              <Textarea
                label="What should Tutor focus on?"
                rows={3}
                value={focusOn}
                disabled={saving}
                maxLength={800}
                placeholder="Use specification wording. Show mark allocations when checking my work."
                onChange={(event) => setFocusOn(event.target.value)}
              />
              <Textarea
                label="What should Tutor avoid?"
                rows={3}
                value={avoid}
                disabled={saving}
                maxLength={800}
                placeholder="Don't give the full answer before I've attempted it."
                onChange={(event) => setAvoid(event.target.value)}
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  disabled={saving || !(courseOrSubject || focusOn || avoid)}
                  onClick={() => {
                    onDraftChange(
                      buildFolderInstructionsDraft({
                        courseOrSubject,
                        focusOn,
                        avoid,
                      })
                    );
                    setGuideStep("preview");
                  }}
                >
                  Continue
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => void onSkipGuide()}
                >
                  Skip to editor
                </Button>
              </div>
            </>
          ) : (
            <>
              <Textarea
                label="Your instructions"
                rows={12}
                value={draft}
                disabled={saving}
                maxLength={MAX_FOLDER_TUTOR_INSTRUCTIONS_LENGTH}
                onChange={(event) => onDraftChange(event.target.value)}
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  disabled={saving || !draft.trim()}
                  onClick={() =>
                    void onSave({ instructions: draft, completeGuide: true })
                  }
                >
                  {saving ? "Saving…" : "Save instructions"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => setGuideStep("questions")}
                >
                  Back
                </Button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <Textarea
              label={`Instructions for ${selected?.name ?? "this folder"}`}
              rows={12}
              value={draft}
              disabled={saving}
              maxLength={MAX_FOLDER_TUTOR_INSTRUCTIONS_LENGTH}
              placeholder="Which course this is, what to focus on, and what to avoid."
              onChange={(event) => onDraftChange(event.target.value)}
            />
            <p className="mt-2 flex items-center justify-between gap-3 text-2xs text-text-muted">
              <button
                type="button"
                className="font-semibold text-accent underline-offset-4 hover:underline"
                onClick={() => setShowExample((current) => !current)}
              >
                {showExample ? "Hide example" : "See an example"}
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
              {saving ? "Saving…" : "Save instructions"}
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
              <span className="text-xs text-text-muted">Unsaved changes</span>
            ) : null}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingFolderId !== null}
        title="Discard your changes?"
        description="You have edited these instructions without saving them. Switching folders will lose the edit."
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
