import { normalizeOptionalString, normalizeStringArray } from "@/lib/material/content";

export type PracticePaperMarkingJobKind = "full" | "question_recheck";
export type PracticePaperMarkingJobStatus = "queued" | "running" | "paused" | "ready" | "failed" | "cancelled";
export type PracticePaperMarkingJobStage = "queued" | "preparing_evidence" | "reading_work" | "marking" | "checking_answers" | "finalising" | "ready";

export type PracticePaperMarkingJob = {
  id: string;
  paperId: string;
  attemptId: string;
  kind: PracticePaperMarkingJobKind;
  questionId?: string;
  status: PracticePaperMarkingJobStatus;
  stage: PracticePaperMarkingJobStage;
  progress: number;
  title: string;
  failureCode?: string;
  failureMessage?: string;
  workflowRunId?: string;
  cancellationRequested: boolean;
  readyUnread: boolean;
  retryCount: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  updatedAt: number;
};

export type PracticePaperMarkRange = {
  lower: number;
  upper: number;
  calibrationVersion: string;
  earlyEstimate: boolean;
  reasons: string[];
};

export type PracticePaperEvidenceIssue = {
  code: string;
  severity: "warning" | "error";
  message: string;
  questionId?: string;
  pageId?: string;
};

export type PracticePaperEvidencePage = {
  id: string;
  kind: "question" | "mark_scheme" | "answer" | "within_time_answer";
  questionIds: string[];
  storagePath: string;
  sha256: string;
  mimeType: string;
  width?: number;
  height?: number;
  legibility: "clear" | "uncertain" | "unreadable";
};

export type PracticePaperEvidenceManifest = {
  version: 1;
  id: string;
  paperId: string;
  attemptId: string;
  storagePrefix: string;
  paperSnapshotPath: string;
  paperSnapshotSha256: string;
  markSchemeSnapshotPath: string;
  markSchemeSnapshotSha256: string;
  typedAnswers: Array<{ pageId: string; questionIds: string[]; sha256: string }>;
  pages: PracticePaperEvidencePage[];
  issues: PracticePaperEvidenceIssue[];
  createdAt: number;
};

export type PracticePaperManualCorrectionAudit = {
  questionId: string;
  reason: string;
  previousMarks: number;
  revisedMarks: number;
  createdAt: number;
};

function integer(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : fallback;
}

export function mapPracticePaperMarkingJobData(id: string, data: Record<string, unknown>): PracticePaperMarkingJob {
  const statuses = new Set<PracticePaperMarkingJobStatus>(["queued", "running", "paused", "ready", "failed", "cancelled"]);
  const stages = new Set<PracticePaperMarkingJobStage>(["queued", "preparing_evidence", "reading_work", "marking", "checking_answers", "finalising", "ready"]);
  return {
    id,
    paperId: normalizeOptionalString(data.paperId, 160) ?? "",
    attemptId: normalizeOptionalString(data.attemptId, 160) ?? "",
    kind: data.kind === "question_recheck" ? "question_recheck" : "full",
    questionId: normalizeOptionalString(data.questionId, 80),
    status: statuses.has(data.status as PracticePaperMarkingJobStatus) ? data.status as PracticePaperMarkingJobStatus : "queued",
    stage: stages.has(data.stage as PracticePaperMarkingJobStage) ? data.stage as PracticePaperMarkingJobStage : "queued",
    progress: Math.min(100, integer(data.progress)),
    title: normalizeOptionalString(data.title, 160) ?? "Practice paper",
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

export function normalizePracticePaperMarkRange(value: unknown, maximum: number): PracticePaperMarkRange | undefined {
  if (!value || typeof value !== "object") return undefined;
  const range = value as Record<string, unknown>;
  const lower = Math.max(0, Math.min(maximum, integer(range.lower)));
  const upper = Math.max(lower, Math.min(maximum, integer(range.upper)));
  const calibrationVersion = normalizeOptionalString(range.calibrationVersion, 120);
  if (!calibrationVersion) return undefined;
  return {
    lower,
    upper,
    calibrationVersion,
    earlyEstimate: range.earlyEstimate === true,
    reasons: normalizeStringArray(range.reasons, 6, 500),
  };
}

export function normalizeManualCorrectionAudits(value: unknown): PracticePaperManualCorrectionAudit[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-30).flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const audit = candidate as Record<string, unknown>;
    const questionId = normalizeOptionalString(audit.questionId, 80) ?? "";
    if (!questionId) return [];
    return [{
      questionId,
      reason: normalizeOptionalString(audit.reason, 500) ?? "Student correction",
      previousMarks: integer(audit.previousMarks),
      revisedMarks: integer(audit.revisedMarks),
      createdAt: integer(audit.createdAt),
    }];
  });
}
