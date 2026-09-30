import { hasExposure } from "@/lib/learning/profile/exposure";
import type { LearningTopicState } from "@/lib/learning/types";

/**
 * Whether Jami has enough material to teach or test a concept through.
 *
 * A fourth quantity, alongside mastery, confidence and exposure, and it must
 * not be confused with any of them. Mastery says how well the student knows
 * something. Confidence says how much evidence stands behind that. Exposure
 * says they have material on it. Coverage says something about *Jami*: whether
 * there is anything here to work with.
 *
 * The reason it earns its own place is that the honest sentence differs:
 *
 *   "This concept isn't covered in your revision material."   valid
 *   "You don't know this concept."                            not valid
 *
 * from the same fact. A specification concept with no cards, no questions and
 * no notes is a gap in the shelf, not a gap in the student -- and the engine
 * will already be saying `diagnose`, because it has no evidence either way.
 * Offering to build the material is the honest response; announcing a weakness
 * is not.
 *
 * Nothing here reads a score, and nothing here may ever be folded into one.
 */

export type CoverageKind = "flashcards" | "practice" | "past-paper" | "material";

export type ConceptCoverage = {
  /** Cards on this concept, including finer concepts beneath it. */
  flashcards: number;
  /** Generated practice questions written against it. */
  practice: number;
  /** Real exam questions the corpus can serve for it. */
  pastPaper: number;
  /** Notebooks and sources linked to it. */
  material: number;
};

/**
 * How well covered a concept is, as a word rather than a count.
 *
 * `untested` is the one that matters most and the one most easily lost:
 * material exists, and the student has never been asked anything about it. It
 * is not weakness, and the engine's own `untested_exposure` says the same
 * thing from the evidence side.
 */
export type CoverageLevel = "none" | "partial" | "covered";

export type ConceptCoverageState = {
  topicKey: string;
  coverage: ConceptCoverage;
  level: CoverageLevel;
  /** Material exists and no evidence has ever been gathered against it. */
  untested: boolean;
  /** The kinds that are missing entirely, in a fixed order. */
  missing: CoverageKind[];
};

/**
 * Below this a concept has material in the way a shelf with one book has a
 * library. Deliberately low: the cost of offering to add more is a declined
 * suggestion, and the cost of never offering is a gap that stays open.
 */
export const MIN_COVERED_ITEMS = 3;

const KINDS: readonly CoverageKind[] = ["flashcards", "practice", "past-paper", "material"];

function countOf(coverage: ConceptCoverage, kind: CoverageKind) {
  switch (kind) {
    case "flashcards":
      return coverage.flashcards;
    case "practice":
      return coverage.practice;
    case "past-paper":
      return coverage.pastPaper;
    case "material":
      return coverage.material;
  }
}

export function emptyCoverage(): ConceptCoverage {
  return { flashcards: 0, practice: 0, pastPaper: 0, material: 0 };
}

export function totalCoverage(coverage: ConceptCoverage) {
  return coverage.flashcards + coverage.practice + coverage.pastPaper + coverage.material;
}

/**
 * How well covered, and what is missing.
 *
 * `covered` needs one kind to be genuinely stocked rather than several to be
 * thin: three cards and nothing else is something to study; one card, one
 * question and one note is a concept nobody has built for yet, however many
 * kinds it technically touches.
 */
export function describeCoverage(
  topicKey: string,
  coverage: ConceptCoverage,
  hasEvidence: boolean
): ConceptCoverageState {
  const total = totalCoverage(coverage);
  const stocked = KINDS.some((kind) => countOf(coverage, kind) >= MIN_COVERED_ITEMS);
  const level: CoverageLevel = total === 0 ? "none" : stocked ? "covered" : "partial";
  return {
    topicKey,
    coverage,
    level,
    // Material on the shelf that nobody has been asked anything from.
    untested: total > 0 && !hasEvidence,
    missing: KINDS.filter((kind) => countOf(coverage, kind) === 0),
  };
}

/**
 * Coverage from what the profile already knows, plus what it cannot see.
 *
 * Exposure already counts cards, notebooks and sources per concept, so most of
 * this is a read rather than a new calculation. Practice and past-paper counts
 * are not in the profile -- they are facts about the question bank rather than
 * about the student -- so the caller supplies them, and a caller that cannot
 * supplies nothing. Zero from an unavailable source and zero from a genuinely
 * empty one are indistinguishable here, which is why `missing` is advisory and
 * `level` never on its own claims anything about the student.
 */
export function buildConceptCoverage(
  state: LearningTopicState,
  questionCounts?: { practice?: number; pastPaper?: number }
): ConceptCoverageState {
  const coverage: ConceptCoverage = {
    flashcards: state.exposure.cards,
    practice: Math.max(0, questionCounts?.practice ?? 0),
    pastPaper: Math.max(0, questionCounts?.pastPaper ?? 0),
    material: state.exposure.notebooks + state.exposure.sources,
  };
  const hasEvidence = (state.signal?.attempts ?? 0) > 0;
  return describeCoverage(state.topicKey, coverage, hasEvidence);
}

/**
 * Specification concepts the student has nothing to work from.
 *
 * Deterministic, and built only from concepts the catalogue itself names --
 * never from a model's opinion about what a course contains. A concept is a
 * gap when the specification declares it and coverage is `none`; a concept
 * with thin coverage is reported separately, because "there is nothing" and
 * "there is not much" call for different sentences.
 */
export function findCoverageGaps(
  states: readonly ConceptCoverageState[],
  topics: readonly LearningTopicState[]
): { uncovered: ConceptCoverageState[]; thin: ConceptCoverageState[] } {
  const declared = new Map(
    topics
      .filter((topic) => topic.source === "specification" && topic.declared)
      .map((topic) => [topic.topicKey, topic])
  );
  const uncovered: ConceptCoverageState[] = [];
  const thin: ConceptCoverageState[] = [];
  for (const state of states) {
    if (!declared.has(state.topicKey)) continue;
    if (state.level === "none") uncovered.push(state);
    else if (state.level === "partial") thin.push(state);
  }
  return { uncovered, thin };
}

/**
 * Whether a concept has material the student has simply never tested against.
 *
 * Reads the profile's own exposure rather than the counts above, so it agrees
 * with `untested_exposure` by construction instead of by coincidence.
 */
export function isUntestedMaterial(state: LearningTopicState) {
  return hasExposure(state.exposure) && (state.signal?.attempts ?? 0) === 0;
}
