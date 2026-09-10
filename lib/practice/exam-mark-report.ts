import type { PracticePaperCriterionResult, PracticePaperQuestionResult } from "@/lib/practice/practice-papers";

/**
 * Sorting a marked question into what earned marks and what did not.
 *
 * Two separate ways this misled a student. A criterion worth one mark is
 * credited with a boolean and carries no number, so reading the number alone
 * put every credited one-mark criterion in the missed column. And a criterion
 * worth three that earned one was counted as earned and disappeared -- so an
 * answer that dropped three marks was told nothing essential was missing.
 *
 * What is missing is everything not fully credited, which needs each
 * criterion's tariff; that is joined on from the scheme after marking. Where
 * the numbers still do not account for the marks lost -- a banded question with
 * no per-criterion breakdown -- that is said, rather than claiming the answer
 * was complete.
 */
export type ExamMarkReportBreakdown = {
  earned: PracticePaperCriterionResult[];
  missed: PracticePaperCriterionResult[];
  /** Marks were lost that no criterion accounts for. */
  unexplainedShortfall: boolean;
};

function awardedMarks(criterion: PracticePaperCriterionResult) {
  if (typeof criterion.awardedMarks === "number") return criterion.awardedMarks;
  return criterion.awarded ? criterion.maxMarks ?? 1 : 0;
}

function availableMarks(criterion: PracticePaperCriterionResult) {
  if (typeof criterion.maxMarks === "number") return criterion.maxMarks;
  // Without a tariff the only honest reading is one mark, awarded or not.
  return criterion.awarded ? awardedMarks(criterion) : 1;
}

export function breakdownExamMarkReport(
  result: Pick<PracticePaperQuestionResult, "awardedMarks" | "maxMarks" | "criterionResults">
): ExamMarkReportBreakdown {
  const criteria = result.criterionResults ?? [];
  const earned = criteria.filter((item) => item.awarded || awardedMarks(item) > 0);
  const missed = criteria.filter((item) => awardedMarks(item) < availableMarks(item));
  return {
    earned,
    missed,
    unexplainedShortfall: result.awardedMarks < result.maxMarks && missed.length === 0,
  };
}
