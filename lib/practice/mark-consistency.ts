import { schemeCriteria, type PracticePaperMarkSchemeItem } from "@/lib/practice/mark-schemes";
import type { PracticePaperCriterionResult } from "@/lib/practice/practice-papers";

/**
 * Whether a question's total agrees with the awards it was built from.
 *
 * A marker returns both a question total and a set of criterion decisions, and
 * nothing reconciled them. A result saying "1 mark" above criteria that award
 * 2 went through the parser untouched, was stored, and reached the student as
 * a score with feedback that contradicted it -- and neither number is
 * obviously the wrong one, so the student is shown a mark that cannot be
 * justified by the reasons printed beside it.
 *
 * Each regime is a different arithmetic and gets its own rule. Summing is
 * right for exactly one of them: adding a banded question's descriptors
 * together produces a number the scheme never contemplated, and a pool has a
 * cap that summing ignores.
 *
 * Three outcomes rather than two. `unverifiable` matters as much as the other
 * two: where a marker reports no criteria, or none that can be matched to the
 * scheme, there is nothing to reconcile, and treating that as agreement would
 * quietly bless exactly the reports that show their working least.
 */
/**
 * What a passing check actually established, which is not the same in every
 * regime.
 *
 *   arithmetic  the awards were added, capped or combined and match the total.
 *   bounds      the mark sits inside a band the scheme defines. It says
 *               nothing about whether that is the right band: choosing between
 *               them is a judgement about the response, and no arithmetic
 *               reaches it.
 *   tariff      the mark does not exceed what the question is worth. For a
 *               competency scheme that is the only rule there is to check
 *               here; whether the competency rules were applied correctly is
 *               untouched by it.
 *
 * Recorded so a report cannot call a banded or competency mark "validated" on
 * the strength of a check that never looked at the reasoning.
 */
export type MarkConsistencyScope = "arithmetic" | "bounds" | "tariff";

export type MarkConsistency =
  | { status: "consistent"; expected: number; checked: MarkConsistencyScope }
  | { status: "inconsistent"; expected: number; detail: string }
  | { status: "unverifiable"; detail: string };

/** What a marker actually gave a criterion, where it can be determined. */
function awardOf(criterion: PracticePaperCriterionResult, available: number): number | null {
  if (typeof criterion.awardedMarks === "number") {
    return Math.max(0, Math.min(available, criterion.awardedMarks));
  }
  // A boolean is exact only on a one-mark criterion. On a larger one it says
  // something was credited and not how much, which is not a number.
  if (available === 1) return criterion.awarded ? 1 : 0;
  return criterion.awarded ? null : 0;
}

function matched(
  item: PracticePaperMarkSchemeItem,
  criteria: readonly PracticePaperCriterionResult[]
) {
  const scheme = schemeCriteria(item);
  if (scheme.length === 0) return null;
  const byId = new Map(criteria.flatMap((c) => (c.criterionId ? [[c.criterionId, c] as const] : [])));
  const pairs: { available: number; awarded: number }[] = [];
  for (const entry of scheme) {
    const reported = byId.get(entry.id);
    if (!reported) return null;
    const awarded = awardOf(reported, entry.marks);
    if (awarded === null) return null;
    pairs.push({ available: entry.marks, awarded });
  }
  return pairs;
}

export function checkMarkConsistency(input: {
  item: PracticePaperMarkSchemeItem;
  reportedMarks: number;
  criteria: readonly PracticePaperCriterionResult[];
}): MarkConsistency {
  const { item, reportedMarks, criteria } = input;

  if (item.marking === "banded") {
    /*
     * A band is a judgement about the whole response, so there is nothing to
     * add up. What must hold is that the mark sits inside a band the scheme
     * actually defines.
     */
    if (item.bands.length === 0) return { status: "unverifiable", detail: "The scheme defines no bands." };
    const band = item.bands.find(
      (candidate) => reportedMarks >= candidate.minMarks && reportedMarks <= candidate.maxMarks
    );
    return band
      ? { status: "consistent", expected: reportedMarks, checked: "bounds" }
      : {
          status: "inconsistent",
          expected: reportedMarks,
          detail: `${reportedMarks} marks falls outside every band this scheme defines.`,
        };
  }

  if (item.marking === "competency") {
    /*
     * Competencies are met or not met, and the scheme states no arithmetic
     * from them to a mark. The only rule that can be checked is the tariff.
     */
    if (reportedMarks > item.maxMarks) {
      return {
        status: "inconsistent",
        expected: item.maxMarks,
        detail: `${reportedMarks} marks exceeds the ${item.maxMarks} this question is worth.`,
      };
    }
    return {
      status: "unverifiable",
      detail: "A competency scheme states no arithmetic, so only its tariff was checked.",
    };
  }

  if (item.marking === "weightedTraits") {
    // Traits carry their own maxima, and the weighting is those maxima: the
    // question's mark is the traits added, not an average of their bands.
    const pairs = matched(item, criteria);
    if (!pairs) {
      return { status: "unverifiable", detail: "The marker reported no trait scores to combine." };
    }
    const expected = pairs.reduce((sum, pair) => sum + pair.awarded, 0);
    return expected === reportedMarks
      ? { status: "consistent", expected, checked: "arithmetic" }
      : {
          status: "inconsistent",
          expected,
          detail: `Traits combine to ${expected} marks against a reported ${reportedMarks}.`,
        };
  }

  const pairs = matched(item, criteria);
  if (!pairs) {
    return { status: "unverifiable", detail: "The marker reported no criterion awards to reconcile." };
  }
  const awarded = pairs.reduce((sum, pair) => sum + pair.awarded, 0);

  if (item.marking === "pointPool") {
    /*
     * A pool credits at most `awardable` of its points, whatever the marker
     * ticked. Summing without the cap is how a pool of six offering two ends
     * up awarding six.
     */
    const perPoint = item.points[0]?.marks ?? 1;
    const cap = item.awardable * perPoint;
    const expected = Math.min(awarded, cap);
    return expected === reportedMarks
      ? { status: "consistent", expected, checked: "arithmetic" }
      : {
          status: "inconsistent",
          expected,
          detail:
            awarded > cap
              ? `The pool credits at most ${cap} marks; ${awarded} were awarded and ${reportedMarks} reported.`
              : `Pool awards total ${expected} marks against a reported ${reportedMarks}.`,
        };
  }

  return awarded === reportedMarks
    ? { status: "consistent", expected: awarded, checked: "arithmetic" }
    : {
        status: "inconsistent",
        expected: awarded,
        detail: `Criterion awards total ${awarded} marks against a reported ${reportedMarks}.`,
      };
}
