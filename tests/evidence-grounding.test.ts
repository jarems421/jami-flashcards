import { describe, expect, it } from "vitest";
import { candidateTextFromParts, checkEvidenceGrounding } from "@/lib/ai/evidence-grounding";
import {
  EXAM_MARKING_STAGES,
  EXAM_REVIEW_STAGES,
  markerStageBudgetMs,
  markerTimeoutMs,
} from "@/lib/practice/marker-stages";
import { EXAM_AI_JOB_DEADLINE_MS } from "@/lib/practice/exam-questions";

function criterion(overrides: Record<string, unknown> = {}) {
  return {
    criterionId: "p1",
    criterion: "Compares the medians",
    awarded: true,
    evidence: "",
    ...overrides,
  } as Parameters<typeof checkEvidenceGrounding>[0]["criteria"][number];
}

/**
 * Requiring evidence per criterion does not establish whose evidence it is.
 *
 * A marker can quote the question back, quote the scheme it was handed, or
 * invent a plausible sentence, and all three satisfy a presence check exactly
 * as well as a real quotation does.
 */
describe("whether a quotation came from the student", () => {
  const answer = "The median for town A is 48 which is greater than 45 for town B, so A is higher.";

  it("finds a quotation the student actually wrote", () => {
    const result = checkEvidenceGrounding({
      criteria: [criterion({ evidence: "the median for town A is 48" })],
      candidateText: answer,
      hasUntypedWorking: false,
    });
    expect(result.status).toBe("grounded");
  });

  it("does not mind punctuation or spacing the marker retyped", () => {
    const result = checkEvidenceGrounding({
      criteria: [criterion({ evidence: "The  median, for Town A, is 48!" })],
      candidateText: answer,
      hasUntypedWorking: false,
    });
    expect(result.status).toBe("grounded");
  });

  it("reports a quotation the answer does not contain, and names the criterion", () => {
    const result = checkEvidenceGrounding({
      criteria: [criterion({ evidence: "the interquartile range is narrower for town B" })],
      candidateText: answer,
      hasUntypedWorking: false,
    });
    expect(result.status).toBe("ungrounded");
    expect(result.unmatched).toEqual(["p1"]);
  });

  /** An unawarded criterion has no mark to substantiate. */
  it("ignores criteria that were not awarded", () => {
    const result = checkEvidenceGrounding({
      criteria: [criterion({ awarded: false, evidence: "something never written down" })],
      candidateText: answer,
      hasUntypedWorking: false,
    });
    expect(result.status).toBe("unverifiable");
  });

  it("treats a zero-mark award as unawarded", () => {
    const result = checkEvidenceGrounding({
      criteria: [criterion({ awardedMarks: 0, evidence: "something never written down" })],
      candidateText: answer,
      hasUntypedWorking: false,
    });
    expect(result.status).toBe("unverifiable");
  });

  /*
   * "4" appears in almost any answer by chance, so checking it measures the
   * alphabet rather than the marking.
   */
  it("does not judge a quotation too short to locate", () => {
    const result = checkEvidenceGrounding({
      criteria: [criterion({ evidence: "48" })],
      candidateText: answer,
      hasUntypedWorking: false,
    });
    expect(result.status).toBe("unverifiable");
  });

  /*
   * Handwriting cannot be searched. Reporting ungrounded would mark every
   * handwritten answer unsupported, which says something about the medium and
   * nothing about the marking.
   */
  it("declines rather than fails when part of the answer is handwritten", () => {
    const result = checkEvidenceGrounding({
      criteria: [criterion({ evidence: "a line the transcription never produced" })],
      candidateText: answer,
      hasUntypedWorking: true,
    });
    expect(result.status).toBe("unverifiable");
  });

  it("declines when there is no typed text at all", () => {
    const result = checkEvidenceGrounding({
      criteria: [criterion({ evidence: "anything at all here" })],
      candidateText: "   ",
      hasUntypedWorking: false,
    });
    expect(result.status).toBe("unverifiable");
  });

  it("counts every unmatched criterion, not just the first", () => {
    const result = checkEvidenceGrounding({
      criteria: [
        criterion({ criterionId: "p1", evidence: "the median for town A is 48" }),
        criterion({ criterionId: "p2", evidence: "the spread is much wider in town B" }),
      ],
      candidateText: answer,
      hasUntypedWorking: false,
    });
    expect(result.unmatched).toEqual(["p2"]);
    expect(result.detail).toContain("1 of 2");
  });
});

/**
 * The wrappers are the product's words, not the candidate's. Searching them
 * would let a marker quote the wrapper and pass.
 */
describe("what counts as the student's own text", () => {
  it("drops the untrusted-reference markers", () => {
    const text = candidateTextFromParts([
      { text: "--- BEGIN UNTRUSTED REFERENCE: ANSWER q1 ---" },
      { text: "My actual answer." },
      { text: "--- END UNTRUSTED REFERENCE: ANSWER q1 ---" },
    ]);
    expect(text).toBe("My actual answer.");
  });

  it("keeps nothing from an image-only answer", () => {
    const text = candidateTextFromParts([
      { inlineData: { data: "abc", mimeType: "image/png" } },
    ]);
    expect(text).toBe("");
  });
});

/**
 * The deadline used to be one chosen number against paths that need more.
 *
 * A marking then an adjudication is 408 seconds of supervisor twice over, and
 * an independent review then reconciliation is 515 plus 408 -- 816 and 923
 * against a 600-second budget. The two paths that exist to recover from
 * disagreement were the two that could not finish.
 */
describe("the budget a job asks for", () => {
  it("covers a marking and the adjudication that may follow it", () => {
    expect(markerStageBudgetMs(EXAM_MARKING_STAGES)).toBe(
      markerTimeoutMs("supervisor") * 2
    );
  });

  it("covers an independent review and its reconciliation", () => {
    expect(markerStageBudgetMs(EXAM_REVIEW_STAGES)).toBe(
      markerTimeoutMs("juror") + markerTimeoutMs("supervisor")
    );
  });

  /** The two blind markers run together, so the pair costs the slower one. */
  it("charges concurrent markers once, not twice", () => {
    expect(markerStageBudgetMs(["primary", "verifier"])).toBe(markerTimeoutMs("supervisor"));
    expect(markerTimeoutMs("worker")).toBeLessThan(markerTimeoutMs("supervisor"));
  });

  it("asks only for the adjudicator once both reports are checkpointed", () => {
    const done = { primary: {}, verifier: {} } as Parameters<typeof markerStageBudgetMs>[1];
    expect(markerStageBudgetMs(EXAM_MARKING_STAGES, done)).toBe(markerTimeoutMs("supervisor"));
  });

  it("asks for nothing when every stage is already paid for", () => {
    const done = { primary: {}, verifier: {}, adjudication: {} } as Parameters<typeof markerStageBudgetMs>[1];
    expect(markerStageBudgetMs(EXAM_MARKING_STAGES, done)).toBe(0);
  });

  /* The bound is a consequence of the measurements, not a number beside them. */
  it("holds the longer of the two paths", () => {
    expect(EXAM_AI_JOB_DEADLINE_MS).toBe(markerStageBudgetMs(EXAM_REVIEW_STAGES));
    expect(EXAM_AI_JOB_DEADLINE_MS).toBeGreaterThanOrEqual(markerStageBudgetMs(EXAM_MARKING_STAGES));
  });

  it("is no longer the ten minutes that could not hold either path", () => {
    expect(EXAM_AI_JOB_DEADLINE_MS).toBeGreaterThan(600_000);
  });
});
