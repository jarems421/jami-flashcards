import { MIN_COVERED_ITEMS, type ConceptCoverageState } from "@/lib/learning/interventions/coverage";
import type { LearningTopicState } from "@/lib/learning/types";

/**
 * Which concepts are worth asking the question banks about.
 *
 * Asking is expensive -- the corpus scan costs more than a whole profile
 * build, measured -- so it is done for the few concepts where the answer could
 * change what Jami says, and not for the rest. A concept with thirty cards is
 * not a coverage gap whatever the corpus holds, so the corpus is never asked
 * about it.
 *
 * This is selective evaluation rather than approximation. The cheap signals
 * cannot produce a false negative here: student material is counted exactly,
 * and a concept that fails the cheap test genuinely has little of the
 * student's own material. What the banks add is the other half of the
 * question -- whether material exists that the student has not made
 * themselves -- and that half is only in doubt for the candidates.
 */

/**
 * Whether the student's own material is too thin to settle the question.
 *
 * Deliberately the same threshold Phase B uses, read from the same place: a
 * second number here would let "covered" and "worth asking about" drift apart,
 * and the pair only makes sense held together.
 */
export function needsBankLookup(coverage: ConceptCoverageState) {
  // Only what the student has: cards, notebooks, sources. The banks are the
  // question being asked, so their counts cannot be part of asking it.
  const own = coverage.coverage.flashcards + coverage.coverage.material;
  return own < MIN_COVERED_ITEMS;
}

/**
 * Specification concepts whose coverage cannot be settled without asking.
 *
 * Only declared specification concepts: a student's own Topic is never a hole
 * in a syllabus, and asking the corpus about one would spend the scan to learn
 * nothing that could be said.
 */
export function gapCandidates(
  topics: readonly LearningTopicState[],
  coverageByKey: ReadonlyMap<string, ConceptCoverageState>
): LearningTopicState[] {
  return topics.filter((topic) => {
    if (topic.source !== "specification" || !topic.declared) return false;
    const coverage = coverageByKey.get(topic.topicKey);
    return coverage ? needsBankLookup(coverage) : true;
  });
}

export type GapVerdict =
  /** Nothing anywhere: the student has none and the banks hold none. */
  | "uncovered"
  /** The banks hold material even though the student has made none. */
  | "covered_by_bank"
  /** A bank could not be read, so no gap may be claimed. */
  | "unknown";

/**
 * Whether a candidate is genuinely a gap, once the banks have answered.
 *
 * `unknown` is the answer that matters. A corpus that timed out and a corpus
 * that is empty are indistinguishable from the outside, and only one of them
 * justifies telling a student their syllabus is not covered. Jami says nothing
 * rather than blame an outage on the shelf.
 */
export function settleGap(input: {
  ownMaterial: number;
  pastPaper?: number;
  practice?: number;
  pastPaperAvailable: boolean;
  practiceAvailable: boolean;
}): GapVerdict {
  if ((input.pastPaper ?? 0) > 0 || (input.practice ?? 0) > 0) return "covered_by_bank";
  if (input.ownMaterial >= MIN_COVERED_ITEMS) return "covered_by_bank";
  // Every bank that might hold something has to have actually answered.
  if (!input.pastPaperAvailable || !input.practiceAvailable) return "unknown";
  return "uncovered";
}
