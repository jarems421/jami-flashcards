import type {
  PracticePaperMarkingJobStage,
  PracticePaperMarkingJobStatus,
} from "@/lib/practice/practice-papers";

export const PRACTICE_PAPER_MARKING_STAGE_PROGRESS: Record<
  PracticePaperMarkingJobStage,
  number
> = {
  queued: 0,
  preparing_evidence: 12,
  reading_work: 28,
  marking: 52,
  checking_answers: 74,
  finalising: 92,
  ready: 100,
};

export const PRACTICE_PAPER_MARKING_STAGE_LABELS: Record<
  PracticePaperMarkingJobStage,
  string
> = {
  queued: "Queued",
  preparing_evidence: "Preparing your paper",
  reading_work: "Reading your work",
  marking: "Marking",
  checking_answers: "Checking difficult answers",
  finalising: "Finalising",
  ready: "Ready",
};

export function getPracticePaperMarkingProgress(
  stage: PracticePaperMarkingJobStage
) {
  return PRACTICE_PAPER_MARKING_STAGE_PROGRESS[stage];
}

export function canCancelPracticePaperMarkingJob(
  status: PracticePaperMarkingJobStatus
) {
  return status === "queued" || status === "running" || status === "paused";
}

export function isTerminalPracticePaperMarkingJobStatus(
  status: PracticePaperMarkingJobStatus
) {
  return status === "ready" || status === "failed" || status === "cancelled";
}
