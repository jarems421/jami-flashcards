"use client";

import { type ReactNode } from "react";
import AppPage from "@/components/layout/AppPage";
import TutorBrief from "@/components/ai/TutorBrief";
import TutorFolderNotes from "@/components/ai/TutorFolderNotes";
import TutorNotesList from "@/components/ai/TutorNotesList";
import TutorStudyProfileForm from "@/components/ai/TutorStudyProfileForm";
import TutorStyleChoices from "@/components/ai/TutorStyleChoices";
import {
  Button,
  Card,
  FeedbackBanner,
  PageHero,
  SectionHeader,
  Skeleton,
} from "@/components/ui";
import { useTutorPersonalisation } from "@/hooks/useTutorPersonalisation";
import {
  GENERAL_NOTE_SUGGESTIONS,
  MAX_TUTOR_GENERAL_NOTES,
} from "@/lib/ai/tutor-personalisation";

/** One part of the page: a numbered step, its question, and its controls. */
function Step({
  number,
  eyebrow,
  title,
  description,
  children,
}: {
  number: number;
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card padding="lg">
      <div className="flex gap-4">
        <span
          aria-hidden="true"
          className="hidden h-8 w-8 shrink-0 place-items-center rounded-full border border-[var(--color-border)] bg-[var(--color-glass-subtle)] text-xs font-semibold text-text-secondary sm:grid"
        >
          {number}
        </span>
        <div className="min-w-0 flex-1">
          <SectionHeader eyebrow={eyebrow} title={title} description={description} />
          <div className="mt-5">{children}</div>
        </div>
      </div>
    </Card>
  );
}

/**
 * Personalising Jami, as one account of how you like to be taught.
 *
 * Four steps from the broadest to the most specific -- who you are, how Jami
 * teaches, what it should always keep in mind, what one subject needs -- with
 * a running read-back beside them of what that adds up to. Everything but the
 * study level saves as it changes, so the page has no Save buttons to find and
 * nothing to lose by leaving.
 *
 * It used to be three stacked forms: a free-text "Anything else?" box bolted
 * under the style choices, and a Markdown document per folder behind a
 * one-time scripted chat. Both are now short lists of notes, which is easier to
 * write and is what the tutor is actually handed.
 */
export default function TutorPersonaliseWorkspace() {
  const {
    data,
    preferences,
    loading,
    loadFailed,
    loadingFolder,
    savingProfile,
    saveStatus,
    selectedFolderId,
    setSelectedFolderId,
    studyLevel,
    studySubjects,
    feedback,
    clearFeedback,
    reload,
    saveStyle,
    saveGeneralNotes,
    saveFolderNotes,
    saveStudyProfile,
  } = useTutorPersonalisation();

  const selectedFolder =
    data?.folder && data.folder.id === selectedFolderId ? data.folder : null;

  return (
    <AppPage
      title="Personalise Jami"
      backHref="/dashboard/tutor"
      backLabel="Jami"
      width="xl"
      contentClassName="space-y-4"
    >
      {feedback ? (
        <FeedbackBanner
          type={feedback.type}
          message={feedback.message}
          onDismiss={clearFeedback}
        />
      ) : null}

      <PageHero
        eyebrow="Personalise"
        title="How Jami teaches you"
        description="Tell Jami what you study, how you like to learn, and what each subject needs. All optional. Anything you leave, Jami decides for you."
      />

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-4">
            <Skeleton className="h-48 w-full rounded-2xl" />
            <Skeleton className="h-64 w-full rounded-2xl" />
          </div>
          <Skeleton className="h-72 w-full rounded-2xl" />
        </div>
      ) : loadFailed ? (
        <Card padding="lg">
          <SectionHeader
            title="Jami could not load your preferences"
            description="Nothing has changed. Your existing settings are still in force."
          />
          <div className="mt-5">
            <Button type="button" variant="secondary" onClick={reload}>
              Try again
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-4">
            <Step
              number={1}
              eyebrow="You"
              title="What you're studying"
              description="Sets the vocabulary and assumed knowledge Jami starts from."
            >
              <div className="max-w-xl">
                <TutorStudyProfileForm
                  // Remounted whenever a save produces a new level or list, so
                  // the fields restart from it without an effect copying values.
                  key={`${studyLevel ?? "none"}:${studySubjects.join("|")}`}
                  studyLevel={studyLevel}
                  studySubjects={studySubjects}
                  saving={savingProfile}
                  onSave={saveStudyProfile}
                />
              </div>
            </Step>

            <Step
              number={2}
              eyebrow="Style"
              title="How Jami teaches"
              description="Each one starts on the recommended setting. Change only what you care about."
            >
              <TutorStyleChoices value={preferences} onChange={saveStyle} />
            </Step>

            <Step
              number={3}
              eyebrow="Every subject"
              title="Things Jami should always do"
              description="Short lines, one habit each. Jami follows them in every subject."
            >
              <TutorNotesList
                label="Notes for every subject"
                notes={preferences.notes}
                max={MAX_TUTOR_GENERAL_NOTES}
                suggestions={GENERAL_NOTE_SUGGESTIONS}
                placeholder="Name the rule before you use it"
                emptyText="Nothing yet. Add a habit you'd want from any tutor, or tap an idea below."
                onChange={saveGeneralNotes}
              />
            </Step>

            <Step
              number={4}
              eyebrow="One subject"
              title="What each subject needs"
              description="Exam wording, notation, how you like your work checked. Used only when you're working in that folder, and it wins over everything above."
            >
              <TutorFolderNotes
                layout="split"
                folders={data?.folders ?? []}
                selectedFolderId={selectedFolderId}
                folder={data?.folder ?? null}
                loadingFolder={loadingFolder}
                onSelectFolder={setSelectedFolderId}
                onChange={saveFolderNotes}
              />
            </Step>
          </div>

          <aside className="lg:sticky lg:top-4">
            <TutorBrief
              studyLevel={studyLevel}
              studySubjects={studySubjects}
              preferences={preferences}
              folder={selectedFolder}
              saveStatus={saveStatus}
            />
          </aside>
        </div>
      )}
    </AppPage>
  );
}
