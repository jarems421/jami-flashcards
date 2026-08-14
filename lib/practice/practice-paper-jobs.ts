import {
  type PracticePaperJobStage,
  type PracticePaperJobStatus,
} from "@/lib/practice/practice-papers";

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
    status === "needs_clarification" ||
    status === "failed" ||
    status === "cancelled"
  );
}

export function canCancelPracticePaperJob(status: PracticePaperJobStatus) {
  return (
    status === "queued" ||
    status === "running" ||
    status === "needs_clarification"
  );
}

export function getPracticePaperJobProgress(stage: PracticePaperJobStage) {
  return PRACTICE_PAPER_JOB_STAGE_PROGRESS[stage];
}
