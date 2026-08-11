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
  Input,
  JamiSparklesIcon,
  SectionHeader,
  Skeleton,
  Textarea,
} from "@/components/ui";
import PracticePaperSourcePicker from "@/components/practice/PracticePaperSourcePicker";
import { useFeedback } from "@/hooks/useFeedback";
import type { Source } from "@/lib/material/sources";
import { rankPracticePaperSources } from "@/lib/ai/practice-paper-generation";
import type { PracticePaperTimingMode } from "@/lib/practice/practice-papers";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import { generatePracticePaper } from "@/services/ai/practice-papers";
import { getActiveStudyFolders } from "@/services/study/folders";
import { importUploadedNotebook } from "@/services/study/notebook-import";
import { deleteNotebookFile } from "@/services/study/notebook-files";
import { deleteNotebookImportRecords } from "@/services/study/notebooks";
import {
  createGeneratedPracticePaperWorkspace,
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
  const [clarificationContext, setClarificationContext] = useState("");
  const [uploadTitle, setUploadTitle] = useState("");
  const [paperFile, setPaperFile] = useState<File | null>(null);
  const [markSchemeFile, setMarkSchemeFile] = useState<File | null>(null);
  const [uploadedDuration, setUploadedDuration] = useState("");
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const requestedFolderApplied = useRef(false);

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
    setWorking(true);
    clear();
    try {
      const nextClarificationContext = clarificationQuestion
        ? `${clarificationContext}\n\nJami asked: ${clarificationQuestion}\nStudent answered: ${clarificationAnswer.trim()}`
        : clarificationContext;
      const completeRequest = `${request.trim()}${nextClarificationContext}`;
      const generated = await generatePracticePaper({
        folderId,
        request: completeRequest,
        coverage: coverage.trim() || "Whole folder",
        length: "full",
        focus: "balanced",
        focusDetail: "",
        timingMode,
        tutorEnabled: tutorChoice === "on",
        sourceIds: automaticSources ? confirmedAutomaticSourceIds : selectedSourceIds,
      });
      if (generated.status === "needs_clarification") {
        setClarificationContext(nextClarificationContext);
        setClarificationQuestion(generated.question);
        setClarificationAnswer("");
        return;
      }
      const workspace = await createGeneratedPracticePaperWorkspace({
        userId: user.uid,
        folderId,
        request: completeRequest,
        coverage: coverage.trim() || "Whole folder",
        length: "full",
        focus: "balanced",
        focusDetail: "",
        timingMode,
        tutorEnabled: tutorChoice === "on",
        generated,
      });
      router.push(`/dashboard/notebooks/${encodeURIComponent(workspace.notebook.id)}`);
    } catch (error) {
      showThrownError(error, "Could not create this practice paper.");
    } finally {
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

      <Card tone="warm" padding="lg" className="overflow-hidden">
        <div className="flex items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-accent/12 text-accent">
            <JamiSparklesIcon className="h-7 w-7" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-warm-accent">
              Exam-aware practice
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-text-primary sm:text-3xl">
              Build a paper that fits the course.
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">
              Jami checks the study level, specification or module documents, recent paper formats,
              and marking guidance before fixing the questions and rubric.
            </p>
          </div>
        </div>
      </Card>

      <Card padding="lg" className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-text-secondary">Study folder</span>
            <select
              value={folderId}
              disabled={working}
              onChange={(event) => setFolderId(event.target.value)}
              className="app-field min-h-[3.25rem] w-full rounded-2xl px-4 text-sm"
            >
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>{folder.name}</option>
              ))}
            </select>
          </label>
          <div>
            <span className="mb-2 block text-sm font-medium text-text-secondary">Start from</span>
            <div className="app-subtle-panel grid grid-cols-2 gap-1 rounded-2xl p-1">
              {([
                ["generate", "Generate with Jami"],
                ["upload", "Upload a paper"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  disabled={working}
                  aria-pressed={path === value}
                  onClick={() => {
                    setPath(value);
                    setClarificationQuestion("");
                    clear();
                  }}
                  className={`min-h-11 rounded-xl px-3 text-sm font-semibold transition ${
                    path === value ? "app-selected border" : "text-text-muted hover:text-text-primary"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {path === "generate" ? (
          <div className="space-y-6">
            <div>
              <SectionHeader
                eyebrow="Talk to Jami"
                title="What should this paper prepare you for?"
                description="Name the complete exam paper, component, module sitting, or repeated university format you want to practise."
              />
              <Textarea
                className="mt-4"
                rows={5}
                value={request}
                disabled={working}
                placeholder="Create a complete AQA GCSE Biology Paper 1 in the current format, using my specification and past-paper sources."
                onChange={(event) => setRequest(event.target.value)}
              />
            </div>

            {clarificationQuestion ? (
              <div className="rounded-xl border border-accent/25 bg-accent/8 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-accent">Jami needs one detail</p>
                <p className="mt-2 text-sm leading-6 text-text-primary">{clarificationQuestion}</p>
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
              placeholder="For example: Paper 1, whole module exam, or full final sitting"
              onChange={(event) => setCoverage(event.target.value)}
            />
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4">
              <p className="text-sm font-semibold text-text-primary">Complete sitting</p>
              <p className="mt-1 text-xs leading-5 text-text-muted">
                Jami creates the full inferred exam format. Topic tests and single-question work stay separate from full-paper mode.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <SectionHeader
              eyebrow="Use an existing paper"
              title="Add the paper and, if you have it, the official marking guide."
              description="The paper stays immutable underneath your notebook ink. Without an official guide, Jami clearly labels its marking as estimated."
            />
            <Input
              label="Paper title"
              value={uploadTitle}
              disabled={working}
              onChange={(event) => setUploadTitle(event.target.value)}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="app-subtle-panel rounded-xl p-4">
                <span className="block text-sm font-semibold text-text-primary">Paper file</span>
                <span className="mt-1 block text-xs leading-5 text-text-muted">PDF, JPG, PNG or WebP</span>
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  disabled={working}
                  onChange={(event) => setPaperFile(event.target.files?.[0] ?? null)}
                  className="app-field mt-3 block w-full rounded-lg p-2 text-xs"
                />
              </label>
              <label className="app-subtle-panel rounded-xl p-4">
                <span className="block text-sm font-semibold text-text-primary">Official mark scheme</span>
                <span className="mt-1 block text-xs leading-5 text-text-muted">Optional, but gives the most reliable marking</span>
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,.pdf,.docx,.pptx,.txt"
                  disabled={working}
                  onChange={(event) => setMarkSchemeFile(event.target.files?.[0] ?? null)}
                  className="app-field mt-3 block w-full rounded-lg p-2 text-xs"
                />
              </label>
            </div>
            <Input
              label="Duration in minutes (optional)"
              type="number"
              min={0}
              max={360}
              value={uploadedDuration}
              disabled={working}
              onChange={(event) => setUploadedDuration(event.target.value)}
            />
          </div>
        )}

        {loadingSources ? (
          <Skeleton className="h-16 rounded-xl" />
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
            onConfirmAutomatic={() => setConfirmedAutomaticSourceIds(proposedSourceIds)}
            onChange={setSelectedSourceIds}
          />
        )}

        <div className="grid gap-5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-panel)] p-5 lg:grid-cols-2">
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

        {working && progress !== null ? (
          <div>
            <div className="mb-2 flex justify-between text-xs font-medium text-text-muted">
              <span>Adding files</span><span>{progress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--color-glass-medium)]">
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${progress}%` }} />
            </div>
          </div>
        ) : null}

        <div className="flex flex-col-reverse gap-2 border-t border-[var(--color-border)] pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-text-muted">
            Generated questions are original. The marking guide is fixed before the attempt begins.
          </p>
          <Button
            type="button"
            size="lg"
            disabled={working}
            onClick={() => void (path === "generate" ? createGenerated() : createUploaded())}
          >
            {working
              ? path === "generate"
                ? "Jami is building the paper..."
                : "Creating paper..."
              : clarificationQuestion
                ? "Answer and continue"
                : path === "generate"
                  ? "Generate practice paper"
                  : "Create uploaded paper"}
          </Button>
        </div>
      </Card>
    </AppPage>
  );
}
