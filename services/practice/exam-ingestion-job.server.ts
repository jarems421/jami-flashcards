import "server-only";

import { randomUUID } from "node:crypto";
import { getAdminDb, getAdminStorageBucket } from "@/services/firebase/admin";
import {
  EXAM_INGESTION_MAX_ATTEMPTS,
  isExamIngestionFinished,
  nextExamIngestionStage,
  type ExamIngestionJob,
} from "@/lib/practice/exam-ingestion-job";
import type { ExamPaperIngestionManifest } from "@/lib/practice/exam-ingestion-manifest";
import { examDocument } from "@/lib/practice/exam-questions";
import {
  downloadIngestionSources,
  extractPaperQuestions,
  extractSchemeChunk,
  buildIngestionEntries,
  renderIngestionAsset,
  writeIngestionResults,
  type ExamIngestionState,
} from "@/services/practice/exam-question-ingestion.server";

/**
 * Driving one paper through ingestion, a stage at a time.
 *
 * The state a stage produces is too big for a Firestore document -- a paper's
 * page layout alone runs to a couple of hundred kilobytes -- so the job
 * document holds only its position and its counts, and the working state lives
 * beside it in Storage. That also means a resumed job re-reads what it already
 * knows rather than re-downloading and re-extracting it.
 */
const STATE_PREFIX = "internal/examIngestionJobs";

function jobRef(jobId: string) {
  return getAdminDb().collection("examIngestionJobs").doc(jobId);
}

function statePath(jobId: string) {
  return `${STATE_PREFIX}/${jobId}/state.json`;
}

async function readState(jobId: string): Promise<ExamIngestionState> {
  const [bytes] = await getAdminStorageBucket().file(statePath(jobId)).download();
  return JSON.parse(bytes.toString("utf8")) as ExamIngestionState;
}

async function writeState(jobId: string, state: ExamIngestionState) {
  await getAdminStorageBucket().file(statePath(jobId)).save(JSON.stringify(state), {
    resumable: false,
    contentType: "application/json",
    metadata: { cacheControl: "private, no-store" },
  });
}

export async function startExamIngestionJob(input: {
  manifest: ExamPaperIngestionManifest;
  dryRun: boolean;
}): Promise<ExamIngestionJob> {
  const now = Date.now();
  const job: ExamIngestionJob = {
    id: randomUUID().replace(/-/g, "").slice(0, 24),
    manifest: input.manifest,
    dryRun: input.dryRun,
    stage: "downloading",
    schemeChunk: 0,
    schemeChunkCount: 0,
    renderIndex: 0,
    attempts: 0,
    startedAt: now,
    updatedAt: now,
  };
  await jobRef(job.id).set(examDocument(job));
  return job;
}

export async function getExamIngestionJob(jobId: string): Promise<ExamIngestionJob | null> {
  const snapshot = await jobRef(jobId).get();
  return snapshot.exists ? (snapshot.data() as ExamIngestionJob) : null;
}

/**
 * Do the next bounded piece of work, and say where the job got to.
 *
 * A stage that throws is recorded against the job rather than lost, and the
 * caller may come back and try it again -- three times, after which the paper
 * is given up on rather than retried into a bill.
 */
export async function advanceExamIngestionJob(jobId: string): Promise<ExamIngestionJob> {
  const job = await getExamIngestionJob(jobId);
  if (!job) throw new Error("job_not_found");
  if (isExamIngestionFinished(job)) return job;

  const save = async (patch: Partial<ExamIngestionJob>) => {
    const next = { ...job, ...patch, updatedAt: Date.now() };
    await jobRef(jobId).set(examDocument(next));
    return next;
  };

  try {
    switch (job.stage) {
      case "downloading": {
        const state = await downloadIngestionSources(job.manifest);
        await writeState(jobId, state);
        return await save({ stage: "reading", paperId: state.paperId, attempts: 0 });
      }
      case "reading": {
        // The page layout is read once and kept; it is what every later check
        // compares against, and re-reading it on a retry is pure waste.
        return await save({ stage: "extracting_questions", attempts: 0 });
      }
      case "extracting_questions": {
        const state = await readState(jobId);
        const updated = await extractPaperQuestions(state);
        await writeState(jobId, updated);
        const chunkCount = Math.max(1, Math.ceil(updated.questions.length / updated.schemeChunkSize));
        return await save({
          stage: "extracting_schemes",
          schemeChunk: 0,
          schemeChunkCount: updated.questions.length ? chunkCount : 0,
          attempts: 0,
        });
      }
      case "extracting_schemes": {
        if (job.schemeChunkCount === 0) return await save({ stage: "building", attempts: 0 });
        const state = await readState(jobId);
        const updated = await extractSchemeChunk(state, job.schemeChunk);
        await writeState(jobId, updated);
        const stage = nextExamIngestionStage(job);
        return await save({
          stage,
          schemeChunk: stage === "extracting_schemes" ? job.schemeChunk + 1 : job.schemeChunk,
          attempts: 0,
        });
      }
      case "building": {
        const state = await readState(jobId);
        const updated = await buildIngestionEntries(state);
        await writeState(jobId, updated);
        const summary = {
          extracted: updated.summary?.extracted ?? 0,
          published: updated.summary?.published ?? 0,
          needsReview: updated.summary?.needsReview ?? 0,
          rejected: updated.summary?.rejected ?? [],
        };
        // A dry run has produced everything it was asked for: the accounting,
        // without touching the bank.
        return await save({
          ...summary,
          stage: job.dryRun ? "done" : "rendering",
          renderIndex: 0,
          attempts: 0,
        });
      }
      case "rendering": {
        const state = await readState(jobId);
        const updated = await renderIngestionAsset(state, job.renderIndex);
        await writeState(jobId, updated);
        const stage = nextExamIngestionStage(job);
        return await save({
          stage,
          renderIndex: stage === "rendering" ? job.renderIndex + 1 : job.renderIndex,
          attempts: 0,
        });
      }
      case "writing": {
        const state = await readState(jobId);
        await writeIngestionResults(state);
        await getAdminStorageBucket().file(statePath(jobId)).delete({ ignoreNotFound: true });
        return await save({ stage: "done", attempts: 0 });
      }
      default:
        return job;
    }
  } catch (error) {
    const attempts = job.attempts + 1;
    const message = error instanceof Error ? error.message : "Ingestion failed.";
    if (attempts >= EXAM_INGESTION_MAX_ATTEMPTS) {
      return await save({ stage: "failed", attempts, error: message });
    }
    // The stage stays where it is, so coming back retries only what failed.
    return await save({ attempts, error: message });
  }
}
