"use client";

import AppPage from "@/components/layout/AppPage";
import TutorActiveContextSummary from "@/components/ai/TutorActiveContextSummary";
import TutorFolderInstructionsForm from "@/components/ai/TutorFolderInstructionsForm";
import TutorPreferencesForm from "@/components/ai/TutorPreferencesForm";
import TutorStudyProfileForm from "@/components/ai/TutorStudyProfileForm";
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
 * Personalising Jami, with room for the parts that need it.
 *
 * The same three things as the drawer, laid out as cards instead of tabs
 * because on a page there is no reason to hide one to show another. The copy is
 * the drawer's copy: a student who found the settings verbose in a 32rem panel
 * did not want the same paragraphs again at 64rem.
 */
export default function TutorPersonaliseWorkspace() {
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
    studyLevel,
    studySubjects,
    feedback,
    clearFeedback,
    reload,
    savePreferences,
    saveInstructions,
    saveStudyProfile,
    skipGuide,
  } = useTutorPersonalisation();

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
        title="How Jami teaches you"
        description="Your level, your style, your subject notes. All optional — leave anything and Jami decides."
        aside={
          loading ? null : (
            // Width-capped rather than left to its intrinsic size: the hero's
            // aside does not shrink, and three chips in a row would take 28rem
            // out of the headline beside them on a desktop.
            <div className="w-full lg:w-60">
              <TutorActiveContextSummary
                activeFolder={null}
                accountStudyLevel={studyLevel}
                accountStudySubjects={studySubjects}
                activeCount={activeCount}
              />
            </div>
          )
        }
      />

      {loading ? (
        <>
          <Skeleton className="h-48 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </>
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
        <>
          <Card padding="lg">
            <SectionHeader
              eyebrow="Course"
              title="What you are studying"
              description="Sets the vocabulary and assumed knowledge Jami works from."
            />
            <div className="mt-5 max-w-xl">
              <TutorStudyProfileForm
                // Remounted whenever a save produces a new level or list, so the
                // fields restart from it without an effect copying values.
                key={`${studyLevel ?? "none"}:${studySubjects.join("|")}`}
                studyLevel={studyLevel}
                studySubjects={studySubjects}
                saving={saving}
                onSave={saveStudyProfile}
              />
            </div>
          </Card>

          <Card padding="lg">
            <SectionHeader
              eyebrow="Style"
              title="How Jami explains things"
              description="Every one of these has a recommended setting. Change what you care about."
            />
            <div className="mt-5">
              <TutorPreferencesForm
                key={preferences.updatedAt}
                preferences={preferences}
                saving={saving}
                onSave={savePreferences}
              />
            </div>
          </Card>

          <Card padding="lg">
            <SectionHeader
              eyebrow="Subject notes"
              title="Notes for one folder"
              description="Exam board, notation, marking style. Used only inside that folder."
            />
            <div className="mt-5">
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
