import type { PracticePaperMarkSchemeItem } from "@/lib/practice/mark-schemes";

/**
 * When a single question is marked twice rather than once.
 *
 * Past Paper Practice does not run the full blind ensemble on every answer.
 * One marker handles a one-mark recall question; a second marker is bought
 * where the mark is most likely to be wrong and most expensive to get wrong --
 * a high tariff, a judgement-based regime, handwriting to read, or a scheme
 * whose marks depend on each other.
 *
 * This lives here, apart from the route, because an evaluation that does not
 * apply the same rule is not measuring what students get. The corpus evaluator
 * ran the whole-paper marker -- two blind markers on every question, plus a
 * juror -- and described itself as "what a student's submission goes through",
 * which stopped being true when single-question marking became adaptive. Any
 * quality figure taken that way flatters the product, because it measures an
 * ensemble the student is not given.
 */
export function examMarkingNeedsVerification(
  item: PracticePaperMarkSchemeItem,
  marks: number,
  hasWorking: boolean
) {
  return (
    marks >= 6 ||
    ["banded", "weightedTraits", "competency"].includes(item.marking) ||
    (hasWorking && marks >= 4) ||
    ((item.marking === "additive" || item.marking === "pointPool") &&
      item.points.some((point) => point.dep.length > 0 || point.ft))
  );
}
