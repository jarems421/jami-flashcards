import { describe, expect, it } from "vitest";
import {
  EXAM_INGESTION_STAGES,
  examIngestionProgress,
  isExamIngestionFinished,
  nextExamIngestionStage,
  type ExamIngestionJob,
} from "@/lib/practice/exam-ingestion-job";

function job(overrides: Partial<ExamIngestionJob> = {}): ExamIngestionJob {
  return {
    id: "job-1",
    manifest: {} as ExamIngestionJob["manifest"],
    dryRun: false,
    stage: "downloading",
    schemeChunk: 0,
    schemeChunkCount: 0,
    renderIndex: 0,
    attempts: 0,
    startedAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

/**
 * The stage machine, which is what makes a failed paper resumable.
 *
 * Ingestion used to be one request: the same paper finished at 86 seconds and
 * timed out at 103, and every failure discarded the model calls already paid
 * for. What matters here is that a chunked stage holds its place.
 */
describe("advancing an ingestion", () => {
  it("runs the stages in order", () => {
    expect(nextExamIngestionStage(job({ stage: "downloading" }))).toBe("reading");
    expect(nextExamIngestionStage(job({ stage: "reading" }))).toBe("extracting_questions");
    expect(nextExamIngestionStage(job({ stage: "rendering", renderIndex: 0, extracted: 1 }))).toBe("writing");
    expect(nextExamIngestionStage(job({ stage: "writing" }))).toBe("done");
  });

  it("stays on the scheme stage until its last chunk is read", () => {
    const partway = job({ stage: "extracting_schemes", schemeChunk: 0, schemeChunkCount: 4 });
    expect(nextExamIngestionStage(partway)).toBe("extracting_schemes");
    expect(nextExamIngestionStage({ ...partway, schemeChunk: 3 })).toBe("building");
  });

  it("stays on the rendering stage until every question is cut out", () => {
    const partway = job({ stage: "rendering", renderIndex: 2, extracted: 28 });
    expect(nextExamIngestionStage(partway)).toBe("rendering");
    expect(nextExamIngestionStage({ ...partway, renderIndex: 27 })).toBe("writing");
  });

  /*
   * A dry run has produced its whole answer once the checks have run. Going on
   * to render and write would be doing the thing a dry run promises not to.
   */
  it("stops a dry run after the checks, before anything is stored", () => {
    expect(nextExamIngestionStage(job({ stage: "building", dryRun: true }))).toBe("done");
    expect(nextExamIngestionStage(job({ stage: "building", dryRun: false }))).toBe("rendering");
  });

  it("knows when there is nothing left to do", () => {
    expect(isExamIngestionFinished(job({ stage: "done" }))).toBe(true);
    expect(isExamIngestionFinished(job({ stage: "failed" }))).toBe(true);
    expect(isExamIngestionFinished(job({ stage: "rendering" }))).toBe(false);
  });
});

describe("how far along a paper is", () => {
  it("moves forward through the stages and never claims to be finished early", () => {
    const seen = EXAM_INGESTION_STAGES.filter((stage) => stage !== "done").map((stage) =>
      examIngestionProgress(job({ stage }))
    );
    for (let index = 1; index < seen.length; index += 1) {
      expect(seen[index]).toBeGreaterThan(seen[index - 1]);
    }
    expect(Math.max(...seen)).toBeLessThan(1);
    expect(examIngestionProgress(job({ stage: "done" }))).toBe(1);
  });

  it("counts progress within a chunked stage", () => {
    const early = examIngestionProgress(job({ stage: "extracting_schemes", schemeChunk: 0, schemeChunkCount: 4 }));
    const late = examIngestionProgress(job({ stage: "extracting_schemes", schemeChunk: 3, schemeChunkCount: 4 }));
    expect(late).toBeGreaterThan(early);
  });

  it("reports nothing rather than progress for a job that stopped", () => {
    expect(examIngestionProgress(job({ stage: "failed" }))).toBe(0);
  });
});
