import { describe, expect, it } from "vitest";
import {
  examGenerationProgress,
  examGenerationStage,
} from "@/lib/practice/exam-generation-progress";

describe("progress while Jami writes questions", () => {
  it("shows a little movement straight away", () => {
    expect(examGenerationProgress(0)).toBeGreaterThan(0);
    expect(examGenerationProgress(-50)).toBe(examGenerationProgress(0));
  });

  it("only ever moves forward", () => {
    let previous = examGenerationProgress(0);
    for (let elapsed = 500; elapsed <= 120_000; elapsed += 500) {
      const next = examGenerationProgress(elapsed);
      expect(next).toBeGreaterThanOrEqual(previous);
      previous = next;
    }
  });

  /*
   * The request can run long, and a bar that reaches the end and then sits
   * there reads as finished-but-broken. It stays short of full until the
   * session opens.
   */
  it("never claims to be finished", () => {
    expect(examGenerationProgress(10 * 60_000)).toBeLessThan(100);
  });

  it("is most of the way there by the typical finish", () => {
    expect(examGenerationProgress(25_000)).toBeGreaterThan(70);
  });
});

describe("the step being described", () => {
  it("walks through the request in order", () => {
    expect(examGenerationStage(1_000, 3)).toBe("Reading your course");
    expect(examGenerationStage(8_000, 3)).toBe("Writing 3 original questions");
    expect(examGenerationStage(25_000, 3)).toBe("Writing a mark scheme for each one");
    expect(examGenerationStage(40_000, 3)).toBe("Checking them and setting up your session");
    expect(examGenerationStage(70_000, 3)).toMatch(/longer than usual/);
  });

  it("speaks about a single question in the singular", () => {
    expect(examGenerationStage(8_000, 1)).toBe("Writing 1 original question");
    expect(examGenerationStage(25_000, 1)).toBe("Writing its mark scheme");
  });
});

/*
 * The server writes twenty-five questions a round, so a fifty-question
 * shortfall takes two. Paced as one, the bar hit its ceiling and the step read
 * "longer than usual" on a request running exactly as long as it should.
 */
describe("pacing a large shortfall", () => {
  it("moves more slowly when there are more rounds to write", () => {
    expect(examGenerationProgress(25_000, 50)).toBeLessThan(examGenerationProgress(25_000, 3));
    expect(examGenerationProgress(25_000, 25)).toBe(examGenerationProgress(25_000, 3));
  });

  it("does not call a two-round request slow while it is on time", () => {
    expect(examGenerationStage(30_000, 50)).toBe("Writing 50 original questions");
    expect(examGenerationStage(50_000, 50)).toBe("Writing a mark scheme for each one");
    expect(examGenerationStage(80_000, 50)).toBe("Checking them and setting up your session");
    expect(examGenerationStage(110_000, 50)).toMatch(/longer than usual/);
  });
});
