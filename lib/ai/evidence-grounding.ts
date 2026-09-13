import type { AiContentPart } from "@/lib/ai/content-parts";
import type { PracticePaperCriterionResult } from "@/lib/practice/practice-papers";

/**
 * Whether a criterion's quotation actually came from the student.
 *
 * Requiring evidence for every awarded criterion stops one quotation
 * substantiating a whole award, but it does not establish that the quotation
 * is the candidate's. A marker can quote the question back, quote the scheme
 * it was given, or write a plausible sentence the student never wrote, and
 * each of those satisfies a presence check exactly as well as a real one.
 *
 * So a typed answer is searched for what was quoted. This never overturns a
 * mark: the verdict is recorded beside it the way `markConsistency` is,
 * because a quotation that cannot be located is a reason to look again, not
 * proof the mark is wrong -- a marker paraphrasing a correct answer is
 * ungrounded and right.
 */
export type EvidenceGrounding = {
  status: "grounded" | "ungrounded" | "unverifiable";
  /** Which criteria quoted something the answer does not contain. */
  unmatched?: string[];
  detail?: string;
};

/**
 * Short quotations are not evidence of anything.
 *
 * "4", "x = 2" and "no" appear in almost any answer by chance, so checking
 * them measures the alphabet rather than the marking. Below this length the
 * quotation is left alone instead of being counted as either kind of answer.
 */
const MEANINGFUL_QUOTE_LENGTH = 12;

/**
 * Compared on what was written, not how it was typed.
 *
 * A marker transcribing handwriting or re-typing a line will not reproduce
 * spacing and punctuation exactly, and failing it for that would report
 * ungrounded on most of a real paper. Letters and digits are what carry the
 * claim, so those are what is compared.
 */
function comparable(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isAwarded(criterion: PracticePaperCriterionResult) {
  return criterion.awardedMarks !== undefined ? criterion.awardedMarks > 0 : criterion.awarded;
}

export function checkEvidenceGrounding(input: {
  criteria: readonly PracticePaperCriterionResult[];
  /** Everything the student typed, with the prompt's own wrappers removed. */
  candidateText: string;
  /** Whether any of the answer was handwritten, which cannot be searched. */
  hasUntypedWorking: boolean;
}): EvidenceGrounding {
  /*
   * Handwriting is not searchable, so the check is declined rather than
   * failed. Reporting ungrounded here would mark every handwritten answer as
   * unsupported, which says something about the medium and nothing about the
   * marking.
   */
  if (input.hasUntypedWorking) {
    return { status: "unverifiable", detail: "Part of the answer is handwritten and cannot be searched." };
  }
  const haystack = comparable(input.candidateText);
  if (!haystack) {
    return { status: "unverifiable", detail: "The answer carries no typed text to search." };
  }

  const checked: string[] = [];
  const unmatched: string[] = [];
  for (const criterion of input.criteria) {
    if (!isAwarded(criterion)) continue;
    const quote = comparable(criterion.evidence ?? "");
    if (quote.length < MEANINGFUL_QUOTE_LENGTH) continue;
    checked.push(criterion.criterionId ?? criterion.criterion ?? "criterion");
    if (!haystack.includes(quote)) {
      unmatched.push(criterion.criterionId ?? criterion.criterion ?? "criterion");
    }
  }

  // Nothing long enough to look for is not the same as everything found.
  if (checked.length === 0) {
    return { status: "unverifiable", detail: "No awarded criterion quoted enough text to locate." };
  }
  return unmatched.length > 0
    ? {
        status: "ungrounded",
        unmatched,
        detail: `${unmatched.length} of ${checked.length} awarded criteria quote text the answer does not contain.`,
      }
    : { status: "grounded" };
}

/**
 * The student's own words, taken out of the parts the marker was shown.
 *
 * The answer is wrapped in `BEGIN/END UNTRUSTED REFERENCE` markers before it
 * reaches a model, and those lines are the product's, not the candidate's.
 * Searching them would let a marker quote the wrapper and pass.
 */
export function candidateTextFromParts(parts: readonly AiContentPart[]) {
  return parts
    .flatMap((part) => ("text" in part && typeof part.text === "string" ? [part.text] : []))
    .filter((text) => !/^---\s*(BEGIN|END)\s+UNTRUSTED REFERENCE/i.test(text.trim()))
    .join("\n");
}
