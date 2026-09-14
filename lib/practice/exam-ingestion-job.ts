import type { ExamPaperIngestionManifest } from "@/lib/practice/exam-ingestion-manifest";

/**
 * Ingesting a paper as a job with stages, rather than as one long request.
 *
 * The same paper succeeded at 86 seconds and failed at 103, twice, on the same
 * code -- because reading two PDFs, extracting the questions, reading four
 * chunks of mark scheme, rendering a region per question and writing them all
 * happened inside one request, and whether that fit was luck. Every failure
 * threw away the paid model calls that had already succeeded.
 *
 * Each stage now does a bounded amount of work, records what it produced, and
 * returns. The caller comes back for the next one. A paper that dies halfway
 * resumes from the last finished stage instead of from the beginning.
 */
export type ExamIngestionStage =
  | "downloading"
  | "reading"
  | "extracting_questions"
  | "extracting_schemes"
  | "building"
  | "rendering"
  | "writing"
  | "done"
  | "failed";

/** Stages in the order they run, for progress and for the next-stage step. */
export const EXAM_INGESTION_STAGES: readonly ExamIngestionStage[] = [
  "downloading",
  "reading",
  "extracting_questions",
  "extracting_schemes",
  "building",
  "rendering",
  "writing",
  "done",
];

export const EXAM_INGESTION_STAGE_LABELS: Record<ExamIngestionStage, string> = {
  downloading: "Fetching the paper and its mark scheme",
  reading: "Reading the pages",
  extracting_questions: "Reading the questions",
  extracting_schemes: "Reading the mark schemes",
  building: "Checking each question against the paper",
  rendering: "Cutting each question out of the page",
  writing: "Saving to the bank",
  done: "Finished",
  failed: "Stopped",
};

export type ExamIngestionJob = {
  id: string;
  manifest: ExamPaperIngestionManifest;
  dryRun: boolean;
  stage: ExamIngestionStage;
  /** Which chunk of mark schemes is next, while in `extracting_schemes`. */
  schemeChunk: number;
  schemeChunkCount: number;
  /** Which question's assets are next, while in `rendering`. */
  renderIndex: number;
  paperId?: string;
  extracted?: number;
  published?: number;
  needsReview?: number;
  rejected?: Array<{ questionNumber: string; reasons: string[] }>;
  /** Why questions were held back, most common first. */
  issueSummary?: Array<{ issue: string; count: number }>;
  /** Why it stopped, when it stopped badly. */
  error?: string;
  attempts: number;
  startedAt: number;
  updatedAt: number;
};

/** How many times a stage may be retried before the job is given up on. */
export const EXAM_INGESTION_MAX_ATTEMPTS = 3;

export function isExamIngestionFinished(job: Pick<ExamIngestionJob, "stage">) {
  return job.stage === "done" || job.stage === "failed";
}

/**
 * The stage after this one, given how much of the current one is left.
 *
 * Chunked stages hold their place until their last chunk is done, which is
 * what makes a job resumable rather than restartable.
 */
export function nextExamIngestionStage(job: ExamIngestionJob): ExamIngestionStage {
  if (job.stage === "extracting_schemes" && job.schemeChunk + 1 < job.schemeChunkCount) {
    return "extracting_schemes";
  }
  if (job.stage === "rendering" && job.renderIndex + 1 < (job.extracted ?? 0)) {
    return "rendering";
  }
  if (job.stage === "building" && job.dryRun) return "done";
  const index = EXAM_INGESTION_STAGES.indexOf(job.stage);
  if (index < 0 || index + 1 >= EXAM_INGESTION_STAGES.length) return "done";
  return EXAM_INGESTION_STAGES[index + 1];
}

/** Roughly how far along, for something honest to show a person. */
export function examIngestionProgress(job: ExamIngestionJob): number {
  if (job.stage === "done") return 1;
  if (job.stage === "failed") return 0;
  const index = Math.max(0, EXAM_INGESTION_STAGES.indexOf(job.stage));
  const total = EXAM_INGESTION_STAGES.length - 1;
  let within = 0;
  if (job.stage === "extracting_schemes" && job.schemeChunkCount > 0) {
    within = job.schemeChunk / job.schemeChunkCount;
  }
  if (job.stage === "rendering" && (job.extracted ?? 0) > 0) {
    within = job.renderIndex / (job.extracted ?? 1);
  }
  return Math.min(0.99, (index + within) / total);
}

/**
 * The questions a mark-scheme request came back without, in groups to ask again.
 *
 * Schemes are read eight questions at a time, and one reply that is not valid
 * JSON used to lose all eight: the parse failed quietly, the chunk held no
 * schemes, and every question in it was rejected. It was the same eight on
 * every run -- the request is at temperature 0 -- so running again never
 * helped. Asking again in smaller groups changes the request, and one scheme
 * that will not parse then costs its own question rather than seven others.
 */
export function schemeRetryGroups(
  wanted: readonly string[],
  found: Iterable<string>,
  size = 2
): string[][] {
  const have = new Set(found);
  const missing = wanted.filter((label) => label && !have.has(label));
  // Nothing smaller to ask for: a single question that failed stays failed.
  if (missing.length === 0 || (wanted.length <= 1 && missing.length === wanted.length)) return [];
  const step = Math.max(1, Math.floor(size));
  const groups: string[][] = [];
  for (let index = 0; index < missing.length; index += step) {
    groups.push(missing.slice(index, index + step));
  }
  return groups;
}
