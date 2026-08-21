"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AppPage from "@/components/layout/AppPage";
import { useUser } from "@/components/providers/UserProvider";
import {
  Button,
  Card,
  EmptyState,
  FeedbackBanner,
  FileField,
  Input,
  JamiSparklesIcon,
  OptionSwitch,
  ProgressBar,
  Select,
  Skeleton,
  Textarea,
} from "@/components/ui";
import PracticePaperSourcePicker from "@/components/practice/PracticePaperSourcePicker";
import PracticePaperFormatConfirmation from "@/components/practice/PracticePaperFormatConfirmation";
import PracticeStep from "@/components/practice/PracticeStep";
import { useFeedback } from "@/hooks/useFeedback";
import type { Source } from "@/lib/material/sources";
import { rankPracticePaperSources } from "@/lib/ai/practice-paper-generation";
import {
  type PracticePaperJob,
  type PracticePaperTimingMode,
} from "@/lib/practice/practice-papers";
import {
  PRACTICE_PAPER_JOB_STAGE_LABELS,
  canCancelPracticePaperJob,
} from "@/lib/practice/practice-paper-jobs";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import {
  cancelPracticePaperJob,
  clarifyPracticePaperJob,
  confirmPracticePaperFormat,
  createPracticePaperJob,
  getPracticePaperJob,
} from "@/services/ai/practice-papers";
import { getActiveStudyFolders } from "@/services/study/folders";
import { importUploadedNotebook } from "@/services/study/notebook-import";
import { deleteNotebookFile } from "@/services/study/notebook-files";
import { deleteNotebookImportRecords } from "@/services/study/notebooks";
import {
  createUploadedPracticePaper,
} from "@/services/study/practice-papers";
import { createUploadedSource } from "@/services/study/source-upload";
import { deleteSource } from "@/services/study/sources";
import { deleteSourceFile } from "@/services/study/source-files";
import { getActiveSourcesForFolderPage } from "@/services/study/sources";

type CreationPath = "generate" | "upload";

const TIMING_OPTIONS: Array<{
  value: PracticePaperTimingMode;
  label: string;
  detail: string;
}> = [
  { value: "timed", label: "Timed", detail: "Use the real paper duration, with optional overtime" },
  { value: "untimed", label: "Untimed", detail: "Work without a countdown or pacing comparison" },
];

const TUTOR_OPTIONS: Array<{
  value: "off" | "on";
  label: string;
  detail: string;
}> = [
  { value: "off", label: "Exam conditions", detail: "Jami stays hidden during the sitting" },
  { value: "on", label: "Tutor assisted", detail: "Normal Tutor help is available and the result is labelled assisted" },
];

function ChoiceCards<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; detail: string }>;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-text-secondary">{label}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={`min-h-20 rounded-xl border p-3 text-left transition ${
                selected
                  ? "border-accent/50 bg-accent/10 shadow-e1"
                  : "border-[var(--color-border)] bg-[var(--color-surface-panel)] hover:border-[var(--color-border-strong)]"
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <span className="block text-sm font-semibold text-text-primary">
                {option.label}
              </span>
              <span className="mt-1 block text-xs leading-5 text-text-muted">
                {option.detail}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export default function PracticePaperCreator() {
  const { user } = useUser();
  const router = useRouter();
  const { feedback, showError, showThrownError, clear } = useFeedback();
  const [folders, setFolders] = useState<StudyFolder[]>([]);
  const [folderId, setFolderId] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingSources, setLoadingSources] = useState(false);
  const [path, setPath] = useState<CreationPath>("generate");
  const [request, setRequest] = useState("");
  const [coverage, setCoverage] = useState("Complete paper or module sitting");
  const [timingMode, setTimingMode] = useState<PracticePaperTimingMode>("timed");
  const [tutorChoice, setTutorChoice] = useState<"off" | "on">("off");
  const [automaticSources, setAutomaticSources] = useState(true);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [confirmedAutomaticSourceIds, setConfirmedAutomaticSourceIds] = useState<string[]>([]);
  const [clarificationQuestion, setClarificationQuestion] = useState("");
  const [clarificationAnswer, setClarificationAnswer] = useState("");
  const [uploadTitle, setUploadTitle] = useState("");
  const [paperFile, setPaperFile] = useState<File | null>(null);
  const [markSchemeFile, setMarkSchemeFile] = useState<File | null>(null);
  const [supportingFiles, setSupportingFiles] = useState<File[]>([]);
  const [uploadedDuration, setUploadedDuration] = useState("");
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [activeJob, setActiveJob] = useState<PracticePaperJob | null>(null);
  const requestedFolderApplied = useRef(false);

  useEffect(() => {
    const jobId = new URLSearchParams(window.location.search).get("job")?.trim();
    if (!jobId) return;
    let active = true;
    void getPracticePaperJob(jobId)
      .then((job) => {
        if (!active) return;
        setActiveJob(job);
        setPath("generate");
        if (job.status === "needs_clarification") {
          setClarificationQuestion(
            job.clarificationQuestion ?? "What assessment format should this follow?"
          );
        } else if (job.status === "ready") {
          router.push(`/dashboard/notebooks/${encodeURIComponent(job.paperId)}`);
        }
      })
      .catch((error) => {
        if (active) showThrownError(error, "Could not reopen that paper request.");
      });
    return () => { active = false; };
  }, [router, showThrownError]);

  useEffect(() => {
    let active = true;
    void getActiveStudyFolders(user.uid)
      .then((items) => {
        if (!active) return;
        setFolders(items);
        const requestedFolder = new URLSearchParams(window.location.search).get("folder") ?? "";
        const initial = items.find((folder) => folder.id === requestedFolder)?.id ?? items[0]?.id ?? "";
        requestedFolderApplied.current = true;
        setFolderId(initial);
      })
      .catch((error) => {
        if (active) showThrownError(error, "Could not load your folders.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [showThrownError, user.uid]);

  useEffect(() => {
    if (!folderId || !requestedFolderApplied.current) {
      setSources([]);
      return;
    }
    let active = true;
    setLoadingSources(true);
    setSelectedSourceIds([]);
    setConfirmedAutomaticSourceIds([]);
    void getActiveSourcesForFolderPage(user.uid, folderId, { pageSize: 100 })
      .then((page) => {
        if (active) setSources(page.items);
      })
      .catch((error) => {
        if (active) showThrownError(error, "Could not load this folder's sources.");
      })
      .finally(() => {
        if (active) setLoadingSources(false);
      });
    return () => {
      active = false;
    };
  }, [folderId, showThrownError, user.uid]);

  useEffect(() => {
    if (!activeJob || !canCancelPracticePaperJob(activeJob.status)) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const job = await getPracticePaperJob(activeJob.id);
        if (!active) return;
        setActiveJob(job);
        if (job.status === "ready") {
          setWorking(false);
          router.push(`/dashboard/notebooks/${encodeURIComponent(job.paperId)}`);
          return;
        }
        if (job.status === "needs_clarification") {
          setWorking(false);
          setClarificationQuestion(job.clarificationQuestion ?? "What exam format should this follow?");
          setClarificationAnswer("");
          return;
        }
        if (job.status === "needs_confirmation") {
          setWorking(false);
          setClarificationQuestion("");
          return;
        }
        if (job.status === "failed" || job.status === "cancelled") {
          setWorking(false);
          if (job.status === "failed") {
            showError(job.failureMessage ?? "Jami could not finish that paper just now.");
          }
          return;
        }
        timer = setTimeout(() => void poll(), 2_500);
      } catch (error) {
        if (!active) return;
        timer = setTimeout(() => void poll(), 5_000);
        console.warn("Could not refresh practice-paper progress.", error);
      }
    };
    timer = setTimeout(() => void poll(), 1_000);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [activeJob, router, showError]);

  const selectedFolder = useMemo(
    () => folders.find((folder) => folder.id === folderId) ?? null,
    [folderId, folders]
  );
  const proposedSources = useMemo(
    () => rankPracticePaperSources(
      sources,
      path === "generate"
        ? `${request} ${coverage}`
        : `${uploadTitle} uploaded complete assessment`
    ),
    [coverage, path, request, sources, uploadTitle]
  );
  const proposedSourceIds = proposedSources.map((source) => source.id);
  const automaticSourcesConfirmed =
    proposedSourceIds.length === confirmedAutomaticSourceIds.length &&
    proposedSourceIds.every((sourceId, index) =>
      sourceId === confirmedAutomaticSourceIds[index]
    );

  const createGenerated = async () => {
    if (activeJob?.status === "needs_confirmation") {
      showError("Confirm or correct the paper format before continuing.");
      return;
    }
    if (activeJob?.status === "needs_clarification") {
      if (!clarificationAnswer.trim()) {
        showError("Answer Jami's question before continuing.");
        return;
      }
      setWorking(true);
      clear();
      try {
        const resumed = await clarifyPracticePaperJob(
          activeJob.id,
          clarificationAnswer.trim()
        );
        setActiveJob(resumed);
        setClarificationQuestion("");
        setClarificationAnswer("");
      } catch (error) {
        showThrownError(error, "Could not resume this practice paper.");
        setWorking(false);
      }
      return;
    }
    if (!folderId) {
      showError("Choose a folder for this paper.");
      return;
    }
    if (!request.trim()) {
      showError("Tell Jami what paper you want to practise.");
      return;
    }
    if (automaticSources && !automaticSourcesConfirmed) {
      showError("Review and confirm the sources Jami proposes for this paper.");
      return;
    }
    if (clarificationQuestion && !clarificationAnswer.trim()) {
      showError("Answer Jami's question before continuing.");
      return;
    }
    const baseSourceIds = automaticSources
      ? confirmedAutomaticSourceIds
      : selectedSourceIds;
    if (baseSourceIds.length + supportingFiles.length > 15) {
      showError("Use no more than 15 folder sources and supporting files in total.");
      return;
    }
    setWorking(true);
    clear();
    let queued = false;
    const temporarySources: Array<{ id: string; storagePath: string }> = [];
    try {
      for (const file of supportingFiles) {
        const uploaded = await createUploadedSource({
          userId: user.uid,
          folderId,
          title: `Temporary paper context: ${file.name}`,
          file,
        });
        temporarySources.push({ id: uploaded.id, storagePath: uploaded.storagePath });
      }
      const job = await createPracticePaperJob({
        folderId,
        request: request.trim(),
        coverage: coverage.trim() || "Whole folder",
        length: "full",
        focus: "balanced",
        focusDetail: "",
        timingMode,
        tutorEnabled: tutorChoice === "on",
        sourceIds: [...baseSourceIds, ...temporarySources.map((source) => source.id)],
      }, crypto.randomUUID(), temporarySources.map((source) => source.id));
      queued = true;
      setActiveJob(job);
    } catch (error) {
      await Promise.all(temporarySources.flatMap((source) => [
        deleteSourceFile(source.storagePath).catch(() => undefined),
        deleteSource(user.uid, source.id).catch(() => undefined),
      ]));
      showThrownError(error, "Could not create this practice paper.");
    } finally {
      if (!queued) setWorking(false);
    }
  };

  const cancelGeneratedJob = async () => {
    if (!activeJob || !canCancelPracticePaperJob(activeJob.status)) return;
    try {
      const cancelled = await cancelPracticePaperJob(activeJob.id);
      setActiveJob(cancelled);
      setWorking(false);
    } catch (error) {
      showThrownError(error, "Could not cancel this paper.");
    }
  };

  const decidePaperFormat = async (
    action: "confirm" | "correct" | "use_custom",
    correction?: string
  ) => {
    if (!activeJob || activeJob.status !== "needs_confirmation") return;
    setWorking(true);
    clear();
    try {
      const resumed = await confirmPracticePaperFormat(activeJob.id, action, correction);
      setActiveJob(resumed);
    } catch (error) {
      showThrownError(error, "Could not resume this practice paper.");
      setWorking(false);
    }
  };

  const createUploaded = async () => {
    if (!folderId || !paperFile || !uploadTitle.trim()) {
      showError("Choose a folder, name the paper, and add the paper file.");
      return;
    }
    if (automaticSources && !automaticSourcesConfirmed) {
      showError("Review and confirm the sources Jami proposes for this paper.");
      return;
    }
    setWorking(true);
    setProgress(null);
    clear();
    let imported: Awaited<ReturnType<typeof importUploadedNotebook>> | null = null;
    let uploadedScheme: Awaited<ReturnType<typeof createUploadedSource>> | null = null;
    try {
      imported = await importUploadedNotebook({
        userId: user.uid,
        folderId,
        title: uploadTitle.trim(),
        file: paperFile,
        color: "indigo",
        icon: "notebook",
        onProgress: setProgress,
      });
      if (markSchemeFile) {
        uploadedScheme = await createUploadedSource({
          userId: user.uid,
          folderId,
          title: `${uploadTitle.trim()} mark scheme`,
          file: markSchemeFile,
          onProgress: setProgress,
        });
      }
      let sourceIds = automaticSources
        ? confirmedAutomaticSourceIds
        : selectedSourceIds;
      let sourceLabels = sourceIds.flatMap((sourceId) => {
        const source = sources.find((candidate) => candidate.id === sourceId);
        return source ? [source.title] : [];
      });
      if (uploadedScheme && !sourceIds.includes(uploadedScheme.id)) {
        sourceIds = [uploadedScheme.id, ...sourceIds].slice(0, 15);
        sourceLabels = [uploadedScheme.title, ...sourceLabels].slice(0, 15);
      }
      await createUploadedPracticePaper({
        userId: user.uid,
        notebook: imported.notebook,
        sourceIds,
        sourceLabels,
        markSchemeSourceId: uploadedScheme?.id,
        durationMinutes: Number.parseInt(uploadedDuration, 10) || 0,
        timingMode,
        tutorEnabled: tutorChoice === "on",
      });
      router.push(`/dashboard/notebooks/${encodeURIComponent(imported.notebook.id)}`);
    } catch (error) {
      if (uploadedScheme) {
        await Promise.all([
          deleteSourceFile(uploadedScheme.storagePath).catch(() => undefined),
          deleteSource(user.uid, uploadedScheme.id).catch(() => undefined),
        ]);
      }
      if (imported) {
        await Promise.all([
          deleteNotebookImportRecords(user.uid, imported.notebook.id).catch(() => undefined),
          deleteNotebookFile(imported.file.storagePath).catch(() => undefined),
        ]);
      }
      showThrownError(error, "Could not create this uploaded paper.");
    } finally {
      setWorking(false);
      setProgress(null);
    }
  };

  if (loading) {
    return (
      <AppPage title="New practice paper" backHref="/dashboard/practice" backLabel="Practice" width="lg">
        <div className="space-y-4">
          <Skeleton className="h-44 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      </AppPage>
    );
  }

  if (folders.length === 0) {
    return (
      <AppPage title="New practice paper" backHref="/dashboard/practice" backLabel="Practice" width="lg">
        <EmptyState
          emoji="Folder"
          title="Create a study folder first"
          description="A practice paper uses the course level, sources, and notes from one folder."
          action={<Button type="button" onClick={() => router.push("/dashboard/practice")}>Back to Practice</Button>}
        />
      </AppPage>
    );
  }

  return (
    <AppPage
      title="New practice paper"
      backHref={folderId ? `/dashboard/folders/${folderId}` : "/dashboard/practice"}
      backLabel={selectedFolder?.name ?? "Practice"}
      width="lg"
      contentClassName="space-y-6"
    >
      {feedback ? (
        <FeedbackBanner type={feedback.type} message={feedback.message} onDismiss={clear} />
      ) : null}

      <div className="flex items-start gap-3.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-accent/12 text-accent">
          <JamiSparklesIcon className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-text-primary sm:text-2xl">
            Build a paper that fits the course.
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-text-secondary">
            Jami reads the level, specification, and paper formats in this folder
            before fixing the questions and the marking guide.
          </p>
        </div>
      </div>

      <Card padding="lg" className="space-y-8">
        <PracticeStep
          step={1}
          title="Which folder is this for?"
          description="The folder decides which sources Jami can read and what level it writes to."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Study folder"
              value={folderId}
              disabled={working}
              onChange={(event) => setFolderId(event.target.value)}
            >
              {folders.map((folder) => (
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
              {
                value: "generate" as const,
                label: "Generate with Jami",
                detail: "An original paper in your exam's format",
              },
              {
                value: "upload" as const,
                label: "Upload a paper",
                detail: "A real paper you already have as a file",
              },
            ]}
            onChange={(value) => {
              setPath(value);
              setClarificationQuestion("");
              clear();
            }}
          />
        </PracticeStep>

        <div className="h-px bg-[var(--color-border)]" />

        {path === "generate" ? (
          <PracticeStep
            step={2}
            title="What should it prepare you for?"
            description="Name the paper, component, or module sitting you want to practise. Jami builds the complete format, not a topic test."
          >
            <Textarea
              rows={4}
              value={request}
              disabled={working}
              placeholder="A complete AQA GCSE Biology Paper 1 in the current format, using my specification and past papers."
              onChange={(event) => setRequest(event.target.value)}
            />

            {activeJob?.status === "needs_confirmation" && activeJob.paperBrief ? (
              <PracticePaperFormatConfirmation
                brief={activeJob.paperBrief}
                disabled={working}
                onConfirm={() => void decidePaperFormat("confirm")}
                onUseCustom={() => void decidePaperFormat("use_custom")}
                onCorrect={(value) => void decidePaperFormat("correct", value)}
                onCancel={() => void cancelGeneratedJob()}
              />
            ) : null}

            {clarificationQuestion ? (
              <div className="rounded-2xl border border-accent/30 bg-accent/8 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-accent">
                  Jami needs one detail
                </p>
                <p className="mt-2 text-sm leading-6 text-text-primary">
                  {clarificationQuestion}
                </p>
                <Input
                  containerClassName="mt-3"
                  label="Your answer"
                  value={clarificationAnswer}
                  disabled={working}
                  onChange={(event) => setClarificationAnswer(event.target.value)}
                />
              </div>
            ) : null}

            <Input
              label="Coverage"
              value={coverage}
              disabled={working}
              placeholder="Paper 1, whole module exam, or full final sitting"
              onChange={(event) => setCoverage(event.target.value)}
            />
          </PracticeStep>
        ) : (
          <PracticeStep
            step={2}
            title="Add the paper"
            description="Your paper stays exactly as it is underneath your ink. With no official mark scheme, Jami labels its marking as estimated."
          >
            <Input
              label="Paper title"
              value={uploadTitle}
              disabled={working}
              onChange={(event) => setUploadTitle(event.target.value)}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <FileField
                label="Paper file"
                hint="PDF, JPG, PNG or WebP"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                file={paperFile}
                disabled={working}
                onChange={setPaperFile}
              />
              <FileField
                label="Official mark scheme"
                hint="Optional — but it makes the marking far more reliable"
                accept="application/pdf,image/jpeg,image/png,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,.pdf,.docx,.pptx,.txt"
                file={markSchemeFile}
                disabled={working}
                onChange={setMarkSchemeFile}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Duration in minutes"
                type="number"
                min={0}
                max={360}
                value={uploadedDuration}
                disabled={working}
                placeholder="Optional"
                onChange={(event) => setUploadedDuration(event.target.value)}
              />
            </div>
          </PracticeStep>
        )}

        <div className="h-px bg-[var(--color-border)]" />

        <PracticeStep
          step={3}
          title="What should Jami read?"
          description="Sources are what keep the questions in your course rather than in general knowledge."
        >
          {loadingSources ? (
            <Skeleton className="h-16 rounded-2xl" />
          ) : (
            <PracticePaperSourcePicker
              sources={sources}
              proposedSources={proposedSources}
              automaticConfirmed={automaticSourcesConfirmed}
              selectedIds={selectedSourceIds}
              automatic={automaticSources}
              disabled={working}
              onAutomaticChange={(value) => {
                setAutomaticSources(value);
                if (value) setConfirmedAutomaticSourceIds([]);
              }}
              onConfirmAutomatic={() =>
                setConfirmedAutomaticSourceIds(proposedSourceIds)
              }
              onChange={setSelectedSourceIds}
            />
          )}
          {path === "generate" ? (
            <div className="rounded-2xl border border-dashed border-[var(--color-border-strong)] p-4">
              <label className="text-sm font-semibold text-text-primary" htmlFor="paper-supporting-files">
                Temporary supporting files
              </label>
              <p className="mt-1 text-xs leading-5 text-text-muted">
                Optional PDFs, documents or images for this build only. They count towards the 15-source total and are removed after the job ends.
              </p>
              <input
                id="paper-supporting-files"
                className="mt-3 block w-full text-xs text-text-secondary file:mr-3 file:rounded-lg file:border-0 file:bg-accent/10 file:px-3 file:py-2 file:font-semibold file:text-accent"
                type="file"
                multiple
                accept="application/pdf,image/jpeg,image/png,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,.pdf,.docx,.pptx,.txt"
                disabled={working}
                onChange={(event) => setSupportingFiles(
                  Array.from(event.target.files ?? []).slice(0, Math.max(0, 15 - (automaticSources ? confirmedAutomaticSourceIds.length : selectedSourceIds.length)))
                )}
              />
              {supportingFiles.length > 0 ? (
                <ul className="mt-2 space-y-1 text-xs text-text-muted">
                  {supportingFiles.map((file) => <li key={`${file.name}-${file.size}`}>{file.name}</li>)}
                </ul>
              ) : null}
            </div>
          ) : null}
        </PracticeStep>

        <div className="h-px bg-[var(--color-border)]" />

        <PracticeStep
          step={4}
          title="How do you want to sit it?"
          description="Both of these can be changed before you start the attempt."
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <ChoiceCards
              label="Attempt timing"
              value={timingMode}
              options={TIMING_OPTIONS}
              disabled={working || (automaticSources && !automaticSourcesConfirmed)}
              onChange={setTimingMode}
            />
            <ChoiceCards
              label="Tutor during the sitting"
              value={tutorChoice}
              options={TUTOR_OPTIONS}
              disabled={working}
              onChange={setTutorChoice}
            />
          </div>
        </PracticeStep>

        {activeJob && canCancelPracticePaperJob(activeJob.status) && activeJob.status !== "needs_confirmation" ? (
          <div className="rounded-2xl border border-accent/25 bg-accent/8 p-4" role="status">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-text-primary">
                  {PRACTICE_PAPER_JOB_STAGE_LABELS[activeJob.stage]}
                </p>
                <p className="mt-1 text-xs leading-5 text-text-muted">
                  You can leave this page. The paper will appear in Practice when it is ready.
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void cancelGeneratedJob()}
              >
                Cancel
              </Button>
            </div>
            <ProgressBar progress={activeJob.progress} size="sm" className="mt-3" />
          </div>
        ) : working && progress !== null ? (
          <div>
            <div className="mb-2 flex justify-between text-xs font-medium text-text-muted">
              <span>Adding files</span>
              <span className="tabular-nums">{progress}%</span>
            </div>
            <ProgressBar progress={progress} size="sm" />
          </div>
        ) : null}

        <div className="flex flex-col-reverse gap-3 border-t border-[var(--color-border)] pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-sm text-xs leading-5 text-text-muted">
            Generated questions are original, and the marking guide is fixed
            before your attempt begins.
          </p>
          <Button
            type="button"
            size="lg"
            className="sm:min-w-[14rem] sm:justify-center"
            disabled={working || activeJob?.status === "needs_confirmation"}
            onClick={() =>
              void (path === "generate" ? createGenerated() : createUploaded())
            }
          >
            {working
              ? path === "generate"
                ? "Jami is building the paper..."
                : "Creating paper..."
              : clarificationQuestion
                ? "Answer and continue"
                : activeJob?.status === "needs_confirmation"
                  ? "Confirm the paper format above"
                : path === "generate"
                  ? "Generate practice paper"
                  : "Create uploaded paper"}
          </Button>
        </div>
      </Card>
    </AppPage>
  );
}
