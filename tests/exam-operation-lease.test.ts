import { describe, expect, it } from "vitest";
import {
  EXAM_AI_JOB_DEADLINE_MS,
  EXAM_OPERATION_LEASE_MS,
  examOperationIsLive,
} from "@/lib/practice/exam-questions";

/**
 * Telling work that is running from work that was killed.
 *
 * Three separate places read this -- resubmitting, finishing the session and
 * deleting its answers -- and all three refused on the status alone, so one
 * dead request locked a student out of their own session for good with "wait
 * for marking to finish".
 *
 * Both operations are durable jobs now, and share one clock. Judging either by
 * a request's lifetime would declare healthy work dead and start a second job
 * beside it -- paying twice, and racing to write the answer. Ninety seconds was
 * that mistake waiting to happen: a supervisor's report alone is sized at 408
 * seconds and a juror's at 515.
 */
const NOW = 1_700_000_000_000;

describe("whether an operation is still running", () => {
  it("counts a mark inside its lease as live", () => {
    expect(examOperationIsLive({ status: "marking", updatedAt: NOW - 1_000 }, NOW)).toBe(true);
  });

  it("counts a mark past its lease as dead, however it is worded", () => {
    expect(
      examOperationIsLive({ status: "marking", updatedAt: NOW - EXAM_OPERATION_LEASE_MS - 1 }, NOW)
    ).toBe(false);
  });

  /*
   * Work that is merely slow is not work that died. A job may take its whole
   * deadline, and it still has to write down that it failed, so the lease has
   * to outlast the deadline rather than the request that queued it.
   */
  it("outlasts the deadline the job was given", () => {
    expect(EXAM_OPERATION_LEASE_MS).toBeGreaterThan(EXAM_AI_JOB_DEADLINE_MS);
    expect(
      examOperationIsLive({ status: "marking", updatedAt: NOW - EXAM_AI_JOB_DEADLINE_MS }, NOW)
    ).toBe(true);
  });

  /*
   * The number a request-bound lease would have used, for both operations.
   * Either job is routinely still working at this point, and calling it dead
   * here is what would buy the same work twice.
   */
  it("does not judge a durable job by a request's lifetime", () => {
    for (const attempt of [
      { status: "marking", updatedAt: NOW - 120_000 },
      { reviewStatus: "reviewing", reviewStartedAt: NOW - 120_000 },
    ]) {
      expect(examOperationIsLive(attempt, NOW)).toBe(true);
    }
  });

  /** A check is durable too, and runs on the same clock from its own start. */
  it("treats an independent review on its own start time", () => {
    expect(examOperationIsLive({ reviewStatus: "reviewing", reviewStartedAt: NOW - 5_000 }, NOW)).toBe(true);
    expect(
      examOperationIsLive({ reviewStatus: "reviewing", reviewStartedAt: NOW - EXAM_OPERATION_LEASE_MS }, NOW)
    ).toBe(false);
  });

  /** A review's clock is its own; a fresh `updatedAt` must not revive it. */
  it("does not let an attempt's own timestamp keep a stale review alive", () => {
    expect(
      examOperationIsLive(
        { status: "marked", reviewStatus: "reviewing", reviewStartedAt: NOW - EXAM_OPERATION_LEASE_MS, updatedAt: NOW },
        NOW
      )
    ).toBe(false);
  });

  it("says nothing is running for every settled state", () => {
    for (const status of ["draft", "marked", "marking_failed", "deleted"]) {
      expect(examOperationIsLive({ status, updatedAt: NOW }, NOW)).toBe(false);
    }
  });

  /** A record with no timestamp at all is not evidence of work in progress. */
  it("treats a missing or unusable timestamp as dead rather than live", () => {
    expect(examOperationIsLive({ status: "marking" }, NOW)).toBe(false);
    expect(examOperationIsLive({ status: "marking", updatedAt: "soon" }, NOW)).toBe(false);
    expect(examOperationIsLive({ status: "marking", updatedAt: Number.NaN }, NOW)).toBe(false);
  });
});
