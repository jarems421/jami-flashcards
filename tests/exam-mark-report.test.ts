import { describe, expect, it } from "vitest";
import { breakdownExamMarkReport } from "@/lib/practice/exam-mark-report";
import type { PracticePaperCriterionResult } from "@/lib/practice/practice-papers";

/**
 * What a student is told they got right, and what is left to get.
 *
 * The report used to ask one question of each criterion -- did it score
 * anything -- which answers neither case that matters. A one-mark criterion is
 * credited with a boolean and carries no number at all, and a criterion worth
 * three that earned one has two marks still on the table.
 */
function criterion(overrides: Partial<PracticePaperCriterionResult>): PracticePaperCriterionResult {
  return { criterion: "Method", awarded: false, evidence: "", ...overrides };
}

describe("sorting a marked question", () => {
  it("credits a one-mark criterion awarded by verdict alone", () => {
    const { earned, missed } = breakdownExamMarkReport({
      awardedMarks: 1,
      maxMarks: 1,
      criterionResults: [criterion({ awarded: true })],
    });
    expect(earned).toHaveLength(1);
    expect(missed).toHaveLength(0);
  });

  /*
   * The case the whole change is for: five out of eight, every criterion
   * touched, and the report said nothing essential was missing.
   */
  it("still asks for the rest of a partly credited criterion", () => {
    const { earned, missed, unexplainedShortfall } = breakdownExamMarkReport({
      awardedMarks: 5,
      maxMarks: 8,
      criterionResults: [
        criterion({ criterion: "Evaluation", awarded: true, awardedMarks: 2, maxMarks: 5 }),
        criterion({ criterion: "Knowledge", awarded: true, awardedMarks: 3, maxMarks: 3 }),
      ],
    });
    expect(earned.map((item) => item.criterion)).toEqual(["Evaluation", "Knowledge"]);
    expect(missed.map((item) => item.criterion)).toEqual(["Evaluation"]);
    expect(unexplainedShortfall).toBe(false);
  });

  it("says nothing was missing only when nothing was", () => {
    const { missed, unexplainedShortfall } = breakdownExamMarkReport({
      awardedMarks: 3,
      maxMarks: 3,
      criterionResults: [criterion({ awarded: true, awardedMarks: 3, maxMarks: 3 })],
    });
    expect(missed).toHaveLength(0);
    expect(unexplainedShortfall).toBe(false);
  });

  /*
   * A banded question is one judgement about a whole response, so there is no
   * criterion to point at. Saying so beats claiming the answer was complete
   * while showing four marks out of six.
   */
  it("reports a shortfall the criteria cannot account for", () => {
    const { missed, unexplainedShortfall } = breakdownExamMarkReport({
      awardedMarks: 4,
      maxMarks: 6,
      criterionResults: [],
    });
    expect(missed).toHaveLength(0);
    expect(unexplainedShortfall).toBe(true);
  });

  it("counts an uncredited criterion as missing whether or not it carries a tariff", () => {
    const { earned, missed } = breakdownExamMarkReport({
      awardedMarks: 0,
      maxMarks: 2,
      criterionResults: [
        criterion({ criterion: "Method", awarded: false }),
        criterion({ criterion: "Accuracy", awarded: false, awardedMarks: 0, maxMarks: 1 }),
      ],
    });
    expect(earned).toHaveLength(0);
    expect(missed).toHaveLength(2);
  });

  /** Results stored before criterion tariffs existed must still read sensibly. */
  it("reads a result from before criteria carried their marks", () => {
    const { earned, missed, unexplainedShortfall } = breakdownExamMarkReport({
      awardedMarks: 2,
      maxMarks: 3,
      criterionResults: [
        criterion({ criterion: "One", awarded: true }),
        criterion({ criterion: "Two", awarded: true }),
        criterion({ criterion: "Three", awarded: false }),
      ],
    });
    expect(earned.map((item) => item.criterion)).toEqual(["One", "Two"]);
    expect(missed.map((item) => item.criterion)).toEqual(["Three"]);
    expect(unexplainedShortfall).toBe(false);
  });
});
