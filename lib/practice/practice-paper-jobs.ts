import {
  type PracticePaperJob,
  type PracticePaperJobStage,
  type PracticePaperJobStatus,
} from "@/lib/practice/practice-papers";
import { normalizeOptionalString } from "@/lib/material/content";
import { normalizePracticePaperBrief } from "@/lib/practice/exam-formats";

function integer(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : fallback;
}

export function mapPracticePaperJobData(id: string, data: Record<string, unknown>): PracticePaperJob {
  const statuses = new Set<PracticePaperJobStatus>(["queued", "running", "needs_confirmation", "needs_clarification", "ready", "failed", "cancelled"]);
  const stages = new Set<PracticePaperJobStage>(["queued", "reading_sources", "researching", "designing", "building_mark_scheme", "auditing", "creating_figures", "final_checks", "ready"]);
  return {
    id,
    paperId: normalizeOptionalString(data.paperId, 160) ?? "",
    folderId: normalizeOptionalString(data.folderId, 160) ?? "",
    status: statuses.has(data.status as PracticePaperJobStatus) ? data.status as PracticePaperJobStatus : "queued",
    stage: stages.has(data.stage as PracticePaperJobStage) ? data.stage as PracticePaperJobStage : "queued",
    progress: Math.min(100, integer(data.progress)),
    title: normalizeOptionalString(data.title, 160) ?? "Practice paper",
    paperBrief: normalizePracticePaperBrief(data.paperBrief),
    clarificationQuestion: normalizeOptionalString(data.clarificationQuestion, 600),
    failureCode: normalizeOptionalString(data.failureCode, 120),
    failureMessage: normalizeOptionalString(data.failureMessage, 500),
    workflowRunId: normalizeOptionalString(data.workflowRunId, 200),
    cancellationRequested: data.cancellationRequested === true,
    readyUnread: data.readyUnread === true,
    retryCount: integer(data.retryCount),
    createdAt: integer(data.createdAt),
    startedAt: integer(data.startedAt) || undefined,
    completedAt: integer(data.completedAt) || undefined,
    updatedAt: integer(data.updatedAt),
  };
}

export const PRACTICE_PAPER_JOB_STAGE_PROGRESS: Record<
  PracticePaperJobStage,
  number
> = {
  queued: 0,
  reading_sources: 12,
  researching: 24,
  designing: 42,
  building_mark_scheme: 58,
  auditing: 70,
  creating_figures: 82,
  final_checks: 92,
  ready: 100,
};

export const PRACTICE_PAPER_JOB_STAGE_LABELS: Record<
  PracticePaperJobStage,
  string
> = {
  queued: "Queued",
  reading_sources: "Reading sources",
  researching: "Researching the assessment",
  designing: "Designing the paper",
  building_mark_scheme: "Building the mark scheme",
  auditing: "Auditing the questions",
  creating_figures: "Creating figures",
  final_checks: "Running final checks",
  ready: "Ready",
};

export function isTerminalPracticePaperJobStatus(
  status: PracticePaperJobStatus
) {
  return (
    status === "ready" ||
    status === "needs_confirmation" ||
    status === "needs_clarification" ||
    status === "failed" ||
    status === "cancelled"
  );
}

export function canCancelPracticePaperJob(status: PracticePaperJobStatus) {
  return (
    status === "queued" ||
    status === "running" ||
    status === "needs_confirmation" ||
    status === "needs_clarification"
  );
}

export function getPracticePaperJobProgress(stage: PracticePaperJobStage) {
  return PRACTICE_PAPER_JOB_STAGE_PROGRESS[stage];
}
