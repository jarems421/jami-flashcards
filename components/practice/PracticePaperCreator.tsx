"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import AppPage from "@/components/layout/AppPage";
import { useUser } from "@/components/providers/UserProvider";
import {
  Button,
  Card,
  EmptyState,
  FeedbackBanner,
  Input,
  JamiTutorIcon,
  OptionSwitch,
  Select,
  Skeleton,
} from "@/components/ui";
import PaperMaterialPicker from "@/components/practice/PaperMaterialPicker";
import PaperTopicPicker from "@/components/practice/PaperTopicPicker";
import PracticePaperExamFields from "@/components/practice/PracticePaperExamFields";
import PracticePaperFormatConfirmation from "@/components/practice/PracticePaperFormatConfirmation";
import PracticePaperJobBanner from "@/components/practice/PracticePaperJobBanner";
import PracticePaperSittingStep, { type PracticePaperTutorChoice } from "@/components/practice/PracticePaperSittingStep";
import PracticePaperSourcesStep from "@/components/practice/PracticePaperSourcesStep";
import PracticePaperSubmitBar from "@/components/practice/PracticePaperSubmitBar";
import PracticePaperUploadStep, { type UploadedPaperForm } from "@/components/practice/PracticePaperUploadStep";
import PracticeStep from "@/components/practice/PracticeStep";
import { useFeedback } from "@/hooks/useFeedback";
import { usePracticePaperExam } from "@/hooks/usePracticePaperExam";
import { usePracticePaperFolders } from "@/hooks/usePracticePaperFolders";
import { usePracticePaperJob } from "@/hooks/usePracticePaperJob";
import { usePracticePaperMaterial } from "@/hooks/usePracticePaperMaterial";
import { usePracticePaperSourceChoice } from "@/hooks/usePracticePaperSourceChoice";
import { practicePaperSourceRole } from "@/lib/ai/practice-paper-generation";
import { describedExamRequest, generatedPaperRequestProblem } from "@/lib/practice/practice-paper-request";
import type { PracticePaperTimingMode } from "@/lib/practice/practice-papers";
import { notifyAllowanceSpent } from "@/services/billing/plan-summary-store";
import {
  createUploadedPracticePaperFromFiles,
  requestGeneratedPracticePaper,
} from "@/services/study/practice-paper-builder";

type CreationPath = "generate" | "upload";

const EMPTY_UPLOAD: UploadedPaperForm = { title: "", paperFile: null, markSchemeFile: null, duration: "" };

function StepDivider() {
  return <div className="h-px bg-[var(--color-border)]" />;
}

function NewPaperPage({ children }: { children: ReactNode }) {
  return (
    <AppPage title="New paper" backHref="/dashboard/practice" backLabel="Practice" width="lg">
      {children}
    </AppPage>
  );
}

/**
 * The practice paper builder: a paper Jami writes in a chosen exam's format,
 * or a real paper the student uploads.
 *
 * The page composes what the builder needs -- the folder, which exam, the
 * material, the request to Jami -- each from its own hook, and lays the steps
 * out in the order a student fills them in.
 */
export default function PracticePaperCreator() {
  const { user } = useUser();
  const router = useRouter();
  const { feedback, showError, showThrownError, clear } = useFeedback();
  const feedbackActions = { clear, showError, showThrownError };
  const [path, setPath] = useState<CreationPath>("generate");
  const [working, setWorking] = useState(false);
  /** Upload progress of the files being added, while an uploaded paper is made. */
  const [progress, setProgress] = useState<number | null>(null);
  /** Whether a course picked for a folder without one is saved on the folder. */
  const [rememberCourse, setRememberCourse] = useState(true);
  const [timingMode, setTimingMode] = useState<PracticePaperTimingMode>("timed");
  const [tutorChoice, setTutorChoice] = useState<PracticePaperTutorChoice>("off");
  const [supportingFiles, setSupportingFiles] = useState<File[]>([]);
  const [upload, setUpload] = useState<UploadedPaperForm>(EMPTY_UPLOAD);

  const generating = path === "generate";
  const folders = usePracticePaperFolders(user.uid, showThrownError);
  const { folderId, selectedFolder } = folders;
  const exam = usePracticePaperExam({ folderId, folder: selectedFolder, generating });
  const { course, described } = exam;
  const material = usePracticePaperMaterial({ userId: user.uid, folderId, feedback: feedbackActions });
  const { sources, materialIds } = material;
  const sourceChoice = usePracticePaperSourceChoice({
    folderId,
    sources,
    query: generating ? `${exam.moduleName} ${exam.examined}` : `${upload.title} uploaded complete assessment`,
    optional: Boolean(course),
  });
  const paperJob = usePracticePaperJob({
    feedback: feedbackActions,
    setWorking,
    onReopened: () => setPath("generate"),
  });
  const { job } = paperJob;
  const clarificationQuestion = generating ? paperJob.clarificationQuestion : "";
  const withPastPapers = sources.some(
    (source) => materialIds.includes(source.id) && practicePaperSourceRole(source) === "paper"
  );

  const createGenerated = async () => {
    if (job?.status === "needs_confirmation") {
      showError("Confirm or correct the paper format before continuing.");
      return;
    }
    if (job?.status === "needs_clarification") {
      await paperJob.answerClarification();
      return;
    }
    const sourceIds = described ? materialIds : sourceChoice.chosenIds;
    // Supporting files are offered only for a picked course, so only then are they sent.
    const buildFiles = course ? supportingFiles : [];
    const problem = generatedPaperRequestProblem({
      folderId,
      hasCourse: Boolean(course),
      schoolFolder: exam.schoolFolder,
      moduleName: exam.moduleName,
      topicsRequired: exam.topicsRequired,
      topicCount: exam.topicSelection.topicIds.length + exam.topicSelection.conceptIds.length,
      sourcesUnconfirmed: !described && sourceChoice.unconfirmed,
      materialCount: sourceIds.length + buildFiles.length,
    });
    if (problem) {
      showError(problem);
      return;
    }
    setWorking(true);
    clear();
    if (course && selectedFolder && !selectedFolder.examCourse && rememberCourse) {
      await folders.rememberCourse(selectedFolder, course);
    }
    try {
      const { chosenPaper, topicSelection } = exam;
      const queued = await requestGeneratedPracticePaper({
        userId: user.uid,
        supportingFiles: buildFiles,
        request: {
          folderId,
          request: describedExamRequest({
            module: exam.moduleName.trim(),
            kind: exam.kind,
            length: exam.length,
            withPastPapers: described && withPastPapers,
          }),
          coverage: exam.examined.trim() || "Everything taught in the module",
          ...(course
            ? {
                scope: {
                  course,
                  ...(chosenPaper ? { paper: { code: chosenPaper.code, title: chosenPaper.title } } : {}),
                  topicIds: topicSelection.topicIds,
                  conceptIds: topicSelection.conceptIds,
                },
              }
            : {}),
          length: "full",
          focus: "balanced",
          focusDetail: "",
          timingMode,
          tutorEnabled: tutorChoice === "on",
          sourceIds,
        },
      });
      // The builder stays busy while Jami builds; the request clears it when it stops.
      paperJob.setJob(queued);
      notifyAllowanceSpent();
    } catch (error) {
      showThrownError(error, "Could not create this practice paper.");
      setWorking(false);
    }
  };

  const createUploaded = async () => {
    const title = upload.title.trim();
    if (!folderId || !upload.paperFile || !title) {
      showError("Choose a folder, name the paper, and add the paper file.");
      return;
    }
    /*
     * No waiting on the proposed sources here. An uploaded paper is already
     * written, so sources are only extra context for marking it -- and the
     * proposal is re-ranked from the title on every keystroke, so demanding a
     * confirmation refused the upload of anyone who had not found that step,
     * or who had confirmed and then touched the title. What the student
     * confirmed or picked is attached; otherwise nothing is.
     */
    setWorking(true);
    setProgress(null);
    clear();
    const sourceIds = sourceChoice.chosenIds;
    try {
      const { notebookId } = await createUploadedPracticePaperFromFiles({
        userId: user.uid,
        folderId,
        title,
        paperFile: upload.paperFile,
        markSchemeFile: upload.markSchemeFile,
        sourceIds,
        sourceLabels: sourceIds.flatMap((sourceId) => {
          const source = sources.find((candidate) => candidate.id === sourceId);
          return source ? [source.title] : [];
        }),
        durationMinutes: Number.parseInt(upload.duration, 10) || 0,
        timingMode,
        tutorEnabled: tutorChoice === "on",
        onProgress: setProgress,
      });
      router.push(`/dashboard/notebooks/${encodeURIComponent(notebookId)}`);
    } catch (error) {
      showThrownError(error, "Could not create this uploaded paper.");
    } finally {
      setWorking(false);
      setProgress(null);
    }
  };

  if (folders.loading) {
    return (
      <NewPaperPage>
        <div className="space-y-4">
          <Skeleton className="h-44 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      </NewPaperPage>
    );
  }

  if (folders.folders.length === 0) {
    return (
      <NewPaperPage>
        <EmptyState
          emoji="Folder"
          title="Create a study folder first"
          description="A practice paper uses the course level, sources, and notes from one folder."
          action={
            <Button type="button" onClick={() => router.push("/dashboard/practice")}>
              Back to Practice
            </Button>
          }
        />
      </NewPaperPage>
    );
  }

  return (
    <AppPage
      title="New paper"
      backHref={folderId ? `/dashboard/folders/${folderId}` : "/dashboard/practice"}
      backLabel={selectedFolder?.name ?? "Practice"}
      width="lg"
      contentClassName="space-y-6"
    >
      {feedback ? <FeedbackBanner type={feedback.type} message={feedback.message} onDismiss={clear} /> : null}

      <div className="flex items-start gap-3.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-accent/12 text-accent">
          <JamiTutorIcon className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-text-primary sm:text-2xl">Build a practice paper</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-text-secondary">
            Choose the exam and what it covers. Jami writes a full paper in that exam&apos;s format, with a marking
            guide, ready to sit in a notebook.
          </p>
        </div>
      </div>

      <PracticePaperJobBanner
        job={job}
        working={working}
        onRetry={() => void paperJob.retry()}
        onDismiss={() => void paperJob.dismiss()}
        onCancel={() => void paperJob.cancel()}
      />

      <Card padding="lg" className="space-y-8">
        <PracticeStep step={1} title="Which folder is this for?" description="Your paper is kept in the folder for that subject.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Study folder"
              value={folderId}
              disabled={working}
              onChange={(event) => folders.setFolderId(event.target.value)}
            >
              {folders.folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </Select>
          </div>
          <OptionSwitch
            label="Start from"
            value={path}
            disabled={working}
            options={[
              { value: "generate" as const, label: "Generate with Jami", detail: "An original paper in your exam's format" },
              { value: "upload" as const, label: "Upload a paper", detail: "A real paper you already have as a file" },
            ]}
            onChange={(value) => {
              setPath(value);
              clear();
            }}
          />
        </PracticeStep>

        <StepDivider />

        {described ? (
          <>
            <PracticeStep
              step={2}
              title="Your past papers and notes"
              description="Everything Jami builds the paper from. The more past papers you add, the closer the new paper matches your real exam."
            >
              {material.loadingSources ? (
                <Skeleton className="h-32 rounded-2xl" />
              ) : (
                <PaperMaterialPicker
                  sources={sources}
                  selectedIds={materialIds}
                  onChange={material.setMaterialIds}
                  onUpload={(files, kind) => void material.uploadMaterial(files, kind)}
                  library={material.library}
                  onAddFromLibrary={(ids) => void material.addFromLibrary(ids)}
                  addingFromLibrary={material.addingFromLibrary}
                  uploading={material.uploading}
                  disabled={working}
                />
              )}
            </PracticeStep>
            <StepDivider />
          </>
        ) : null}

        {generating ? (
          <PracticeStep
            step={described ? 3 : 2}
            title={exam.schoolFolder ? "Which paper?" : "About the exam"}
            description={
              exam.schoolFolder
                ? selectedFolder?.examCourse
                  ? "Filled in from your folder. Change the board or course if this paper is for something else."
                  : "Pick your exam board, course and paper. Jami writes it in that paper's real format."
                : "Tell us about the exam you're preparing for, and Jami writes a paper like it."
            }
          >
            <PracticePaperExamFields
              exam={exam}
              folder={selectedFolder}
              disabled={working}
              rememberCourse={rememberCourse}
              onRememberCourseChange={setRememberCourse}
              withPastPapers={withPastPapers}
            />

            {job?.status === "needs_confirmation" && job.paperBrief ? (
              <PracticePaperFormatConfirmation
                brief={job.paperBrief}
                disabled={working}
                onConfirm={() => void paperJob.decideFormat("confirm")}
                onUseCustom={() => void paperJob.decideFormat("use_custom")}
                onCorrect={(value) => void paperJob.decideFormat("correct", value)}
                onCancel={() => void paperJob.cancel()}
              />
            ) : null}

            {clarificationQuestion ? (
              <div className="rounded-2xl border border-accent/30 bg-accent/8 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-accent">Jami needs one detail</p>
                <p className="mt-2 text-sm leading-6 text-text-primary">{clarificationQuestion}</p>
                <Input
                  containerClassName="mt-3"
                  label="Your answer"
                  value={paperJob.clarificationAnswer}
                  disabled={working}
                  onChange={(event) => paperJob.setClarificationAnswer(event.target.value)}
                />
              </div>
            ) : null}
          </PracticeStep>
        ) : (
          <PracticePaperUploadStep
            form={upload}
            disabled={working}
            onChange={(change) => setUpload((current) => ({ ...current, ...change }))}
          />
        )}

        <StepDivider />

        {course ? (
          <>
            <PracticeStep
              step={3}
              title="Which topics should it cover?"
              description="Every topic is in by default. Take out anything you're already strong on, or open a topic to keep only some of it."
            >
              <PaperTopicPicker
                specificationId={course.specificationId}
                value={exam.topicSelection}
                disabled={working}
                onChange={exam.setTopicSelection}
              />
            </PracticeStep>
            <StepDivider />
          </>
        ) : null}

        {described ? null : (
          <>
            <PracticePaperSourcesStep
              step={course ? 4 : 3}
              optional={Boolean(course)}
              sources={sources}
              loading={material.loadingSources}
              choice={sourceChoice}
              supportingFiles={generating && course ? supportingFiles : null}
              onSupportingFilesChange={setSupportingFiles}
              disabled={working}
            />
            <StepDivider />
          </>
        )}

        <PracticePaperSittingStep
          step={generating && course ? 5 : 4}
          timingMode={timingMode}
          tutorChoice={tutorChoice}
          disabled={working}
          onTimingModeChange={setTimingMode}
          onTutorChoiceChange={setTutorChoice}
        />

        <PracticePaperSubmitBar
          generating={generating}
          working={working}
          progress={progress}
          answering={Boolean(clarificationQuestion)}
          confirmingFormat={job?.status === "needs_confirmation"}
          onSubmit={() => void (generating ? createGenerated() : createUploaded())}
        />
      </Card>
    </AppPage>
  );
}
