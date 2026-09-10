import { describe, expect, it } from "vitest";
import { EXAM_OPERATION_LEASE_MS, examOperationIsLive } from "@/lib/practice/exam-questions";

/**
 * Telling a request that is running from one that was killed.
 *
 * Marking happens inside the request that starts it, so a process killed
 * mid-flight leaves the attempt reading "marking" with nothing left to finish
 * it. Three separate places read that flag -- resubmitting, finishing the
 * session and deleting its answers -- and all three refused on the flag alone,
 * so one dead request locked a student out of their own session for good with
 * "wait for marking to finish".
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
   * The route that starts a mark has 60 seconds to live, so the lease has to
   * outlast it -- otherwise a slow but healthy mark would be declared dead and
   * a second one started beside it.
   */
  it("outlasts the route that starts the work", () => {
    expect(EXAM_OPERATION_LEASE_MS).toBeGreaterThan(60_000);
  });

  it("treats an independent review the same way, on its own clock", () => {
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
