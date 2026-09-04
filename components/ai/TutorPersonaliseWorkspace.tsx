"use client";

import AppPage from "@/components/layout/AppPage";
import TutorActiveContextSummary from "@/components/ai/TutorActiveContextSummary";
import TutorFolderInstructionsForm from "@/components/ai/TutorFolderInstructionsForm";
import TutorPreferencesForm from "@/components/ai/TutorPreferencesForm";
import {
  Button,
  Card,
  FeedbackBanner,
  PageHero,
  SectionHeader,
  Skeleton,
} from "@/components/ui";
import { useTutorPersonalisation } from "@/hooks/useTutorPersonalisation";

/**
 * Personalising Jami, given room to breathe.
 *
 * The same settings exist in a drawer beside a conversation, where they are
 * necessarily compact. This is where a student comes to actually think about
 * them: one question per block, nothing abbreviated, and the two halves --
 * how Jami teaches, and what it should know about a subject -- as separate
 * cards rather than tabs, because on a page there is no reason to hide one to
 * show the other.
 */
export default function TutorPersonaliseWorkspace() {
  const personalisation = useTutorPersonalisation();
  const {
    data,
    preferences,
    activeCount,
    loading,
    loadFailed,
    loadingFolder,
    saving,
    selectedFolderId,
    setSelectedFolderId,
    instructionsDraft,
    setInstructionsDraft,
    feedback,
    clearFeedback,
    reload,
    savePreferences,
    saveInstructions,
    skipGuide,
  } = personalisation;

  return (
    <AppPage
      title="Personalise Jami"
      backHref="/dashboard/tutor"
      backLabel="Tutor"
      width="lg"
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
        eyebrow="Your tutor"
        title="Tell Jami how you like to be taught"
        description="Nothing here changes what Jami knows — only how it explains, corrects and checks. Leave anything on its recommended setting and Jami keeps deciding for itself."
        aside={
          loading ? null : (
            <TutorActiveContextSummary
              activeFolder={null}
              accountStudyLevel={data?.accountStudyLevel ?? null}
              activeCount={activeCount}
            />
          )
        }
      />

      {loading ? (
        <>
          <Skeleton className="h-64 w-full rounded-2xl" />
          <Skeleton className="h-48 w-full rounded-2xl" />
        </>
      ) : loadFailed ? (
        <Card padding="lg">
          <SectionHeader
            title="Jami could not load your preferences"
            description="Nothing has been changed. Try again, and if it keeps failing your existing settings are still in force."
          />
          <div className="mt-5">
            <Button type="button" variant="secondary" onClick={reload}>
              Try again
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <Card padding="lg">
            <SectionHeader
              eyebrow="How Jami helps"
              title="Five things, and none of them are compulsory"
              description="Each one applies everywhere — every subject, every notebook, every card. You can always override any of them just by asking in the conversation."
            />
            <div className="mt-6">
              <TutorPreferencesForm
                // Remounted whenever a load or save produces a new document, so
                // the fields restart from it without an effect copying values.
                key={preferences.updatedAt}
                preferences={preferences}
                studyLevel={data?.accountStudyLevel ?? null}
                studyLevelSource="account"
                saving={saving}
                onSave={savePreferences}
              />
            </div>
          </Card>

          <Card padding="lg">
            <SectionHeader
              eyebrow="Subject notes"
              title="What Jami should know about one subject"
              description="Exam board, the notation your course uses, how you want work marked. Jami reads these whenever you are working inside that folder, and ignores them everywhere else."
            />
            <div className="mt-6">
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
            </div>
          </Card>
        </>
      )}
    </AppPage>
  );
}
