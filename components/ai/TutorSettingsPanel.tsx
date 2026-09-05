"use client";

import Link from "next/link";
import { useState } from "react";
import TutorActiveContextSummary from "@/components/ai/TutorActiveContextSummary";
import TutorFolderInstructionsForm from "@/components/ai/TutorFolderInstructionsForm";
import TutorPreferencesForm from "@/components/ai/TutorPreferencesForm";
import TutorStudyProfileForm from "@/components/ai/TutorStudyProfileForm";
import { Button, FeedbackBanner, Skeleton } from "@/components/ui";
import { useTutorPersonalisation } from "@/hooks/useTutorPersonalisation";

type TutorSettingsPanelProps = {
  /**
   * The folders the current conversation's material belongs to.
   *
   * Exactly one means that folder's notes apply. More than one means none do,
   * because two documents cannot be merged and choosing between them would be a
   * guess. The chip strip says which of those is true rather than leaving the
   * student to work it out from a silent Tutor.
   */
  activeFolderIds?: readonly string[];
  onBack?: () => void;
  /**
   * What leaving is called here. "Back to chat" when the settings covered a
   * conversation, "Done" when they arrived as a drawer over a page.
   */
  backLabel?: string;
};

type SettingsView = "course" | "style" | "notes";

/**
 * Three words, not three phrases.
 *
 * The tab row is the widest fixed thing in a 32rem drawer, and "How Jami helps"
 * beside "Subject notes" spent that width on grammar. Each of these names one
 * question: what am I studying, how do you teach me, what does this subject
 * need.
 */
const VIEWS: { id: SettingsView; label: string }[] = [
  { id: "course", label: "Course" },
  { id: "style", label: "Style" },
  { id: "notes", label: "Notes" },
];

/**
 * The same personalisation, beside a conversation.
 *
 * Views rather than the page's stacked cards, because the drawer is the
 * narrowest surface in the app and a student who opened it mid-question wants
 * one thing, not a screen to read. Anything that needs room -- writing a
 * subject document from scratch -- has a full page, and this links to it rather
 * than trying to be it.
 */
export default function TutorSettingsPanel({
  activeFolderIds,
  onBack,
  backLabel = "Back to chat",
}: TutorSettingsPanelProps) {
  const [view, setView] = useState<SettingsView>("course");
  const {
    data,
    preferences,
    activeFolder,
    activeCount,
    loading,
    loadFailed,
    loadingFolder,
    saving,
    selectedFolderId,
    setSelectedFolderId,
    instructionsDraft,
    setInstructionsDraft,
    studyLevel,
    studySubjects,
    feedback,
    clearFeedback,
    reload,
    savePreferences,
    saveInstructions,
    saveStudyProfile,
    skipGuide,
  } = useTutorPersonalisation(activeFolderIds);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-3.5">
        <h2 className="min-w-0 truncate text-base font-medium tracking-tight text-text-primary">
          Personalise Jami
        </h2>
        {onBack ? (
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            {backLabel}
          </Button>
        ) : null}
      </div>

      {/*
        The status strip sits above the tabs rather than inside one, because
        what Jami is currently using is true of all three views and repeating it
        in each was the panel telling a student the same thing three times.
      */}
      {loading ? null : (
        <div className="border-b border-[var(--color-border)] px-5 py-2.5">
          <TutorActiveContextSummary
            {...(activeFolderIds ? { activeFolderIds } : {})}
            activeFolder={activeFolder}
            accountStudyLevel={studyLevel}
            accountStudySubjects={studySubjects}
            activeCount={activeCount}
          />
        </div>
      )}

      <div
        role="tablist"
        aria-label="Personalise Jami"
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
              className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 ${
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
        className="flex-1 overflow-y-auto px-5 py-4"
      >
        {feedback ? (
          <div className="mb-4">
            <FeedbackBanner
              type={feedback.type}
              message={feedback.message}
              onDismiss={clearFeedback}
            />
          </div>
        ) : null}

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full rounded-2xl" />
            <Skeleton className="h-24 w-full rounded-2xl" />
          </div>
        ) : loadFailed ? (
          <Button type="button" variant="secondary" onClick={reload}>
            Try again
          </Button>
        ) : view === "course" ? (
          <TutorStudyProfileForm
            // Restarted from whatever a save or a reload produced, rather than
            // by an effect copying values back into fields.
            key={`${studyLevel ?? "none"}:${studySubjects.join("|")}`}
            studyLevel={studyLevel}
            studySubjects={studySubjects}
            folderLevel={activeFolder?.studyLevel ?? null}
            folderName={activeFolder?.name ?? null}
            saving={saving}
            onSave={saveStudyProfile}
          />
        ) : view === "style" ? (
          <TutorPreferencesForm
            key={preferences.updatedAt}
            preferences={preferences}
            saving={saving}
            onSave={savePreferences}
          />
        ) : (
          <TutorFolderInstructionsForm
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

        <p className="mt-5 border-t border-[var(--color-border)] pt-3 text-2xs text-text-muted">
          <Link
            href="/dashboard/tutor/personalise"
            className="font-semibold text-accent underline-offset-4 hover:underline"
          >
            Open the full page
          </Link>{" "}
          for more room.
        </p>
      </div>
    </div>
  );
}
