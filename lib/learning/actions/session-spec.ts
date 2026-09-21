import { CONFIDENCE_EVIDENCE_SCALE } from "@/lib/learning/scoring/confidence-score";
import { MIN_SIGNAL_CONFIDENCE } from "@/lib/learning/profile/thresholds";
import type { LearningAction, LearningRecommendation } from "@/lib/learning/types";

/**
 * What the engine wants done, in a form a study surface can carry out.
 *
 * Until now a recommendation ended at a link. Today said "practise Osmosis",
 * the student followed the link, and the session that opened was built by the
 * scheduler alone -- which has never heard of the recommendation and selects
 * on its own policy. The engine named the work and then had no say in it.
 *
 * A spec is the missing half: the same intent, expressed as a selection, a
 * size and an emphasis, which the flashcard and practice surfaces execute.
 * The href stays, because the student still has to get there; what changes is
 * that arriving no longer discards the reason for coming.
 *
 * It describes a session. It is not a stored set of items and nothing keeps
 * one: the surface resolves the selection against the student's own material
 * at the moment they start, so a spec made from a stale profile still opens
 * the work that exists now.
 */

/**
 * What kind of work the intent calls for.
 *
 * Distinct from `LearningAction`, which is what the engine decided; this is
 * what the surface should do about it. Several decisions map to one emphasis:
 * `review` and `retrieve` are both retrieval, and differ only in why.
 */
export type StudySessionEmphasis =
  | "retrieve"
  | "practise"
  | "teach"
  | "diagnose"
  | "reinforce";

export type StudySessionSelection = {
  deckIds?: string[];
  topicIds?: string[];
  conceptIds?: string[];
};

export type StudySessionSpec = {
  emphasis: StudySessionEmphasis;
  selection: StudySessionSelection;
  /**
   * How many items this intent is worth, and why that number.
   *
   * A diagnosis is sized to reach a conclusion: enough evidence to clear the
   * confidence floor the engine needs before it will call a topic weak or
   * strong, which is the whole point of diagnosing. Everything else is sized
   * to be finishable -- a recommendation a student abandons halfway teaches
   * the engine nothing and costs them the session.
   */
  targetItems: number;
  /**
   * Whether this session is meant to settle a question about the student.
   *
   * A diagnostic session's results carry the most weight per item, because it
   * was chosen to be informative rather than to be due.
   */
  diagnostic: boolean;
};

const EMPHASIS_BY_ACTION: Record<LearningAction, StudySessionEmphasis> = {
  retrieve: "retrieve",
  review: "retrieve",
  practice: "practise",
  teach: "teach",
  diagnose: "diagnose",
  reinforce: "reinforce",
  leave_alone: "retrieve",
};

/** A session no one finishes is worse than a shorter one they do. */
const MAX_TARGET_ITEMS = 20;
const MIN_TARGET_ITEMS = 5;

/**
 * How many items it takes to know something about this topic.
 *
 * Confidence rises as `1 - e^(-evidence / scale)`, so the answer is that
 * equation read backwards: the evidence needed to reach the floor, less what
 * has already been gathered. A topic with nothing behind it needs the most; a
 * topic just short of the floor needs a handful.
 */
export function itemsToReachConfidence(
  currentConfidence: number,
  target = MIN_SIGNAL_CONFIDENCE
) {
  const capped = Math.min(0.999, Math.max(0, currentConfidence));
  if (capped >= target) return MIN_TARGET_ITEMS;
  const have = -CONFIDENCE_EVIDENCE_SCALE * Math.log(1 - capped);
  const need = -CONFIDENCE_EVIDENCE_SCALE * Math.log(1 - target);
  return Math.ceil(Math.max(0, need - have));
}

function targetItemsFor(
  emphasis: StudySessionEmphasis,
  recommendation: LearningRecommendation
) {
  const { evidence } = recommendation;
  if (emphasis === "diagnose") {
    return clampItems(itemsToReachConfidence(evidence.confidence ?? 0));
  }
  if (emphasis === "retrieve") {
    // Retrieval is the scheduler's own queue: what is due, within a sane cap.
    return clampItems(evidence.dueCards ?? MIN_TARGET_ITEMS);
  }
  if (emphasis === "reinforce") {
    // Confirming a gain needs less than establishing one.
    return MIN_TARGET_ITEMS;
  }
  /*
   * Teaching and practising scale with how far there is to go. A topic at 20%
   * mastery is a longer session than one at 55%, and both are capped.
   */
  const mastery = evidence.mastery ?? 0.5;
  return clampItems(Math.round(MIN_TARGET_ITEMS + (1 - mastery) * MAX_TARGET_ITEMS));
}

function clampItems(value: number) {
  if (!Number.isFinite(value)) return MIN_TARGET_ITEMS;
  return Math.min(MAX_TARGET_ITEMS, Math.max(MIN_TARGET_ITEMS, Math.round(value)));
}

/**
 * The spec for one recommendation, given the selection its destination resolved.
 *
 * Returns nothing when there is no selection to work on: an action with no
 * surface that can carry it out should stay a statement, not become an empty
 * session.
 */
export function buildStudySessionSpec(
  recommendation: LearningRecommendation,
  selection: StudySessionSelection
): StudySessionSpec | undefined {
  const hasSelection =
    (selection.deckIds?.length ?? 0) > 0 ||
    (selection.topicIds?.length ?? 0) > 0 ||
    (selection.conceptIds?.length ?? 0) > 0;
  if (!hasSelection) return undefined;

  const emphasis = EMPHASIS_BY_ACTION[recommendation.action];
  return {
    emphasis,
    selection,
    targetItems: targetItemsFor(emphasis, recommendation),
    diagnostic: emphasis === "diagnose",
  };
}

/** Exposed for the evaluation harness and tests. */
export const STUDY_SESSION_ITEM_BOUNDS = {
  min: MIN_TARGET_ITEMS,
  max: MAX_TARGET_ITEMS,
} as const;
