import type { StudyAction } from "@/lib/learning/actions/study-actions";
import type { LearningRecommendationReason } from "@/lib/learning/types";

/**
 * The engine's advice to practise, about the material a student has open.
 *
 * Tutor is where students spend their time, and it used to be a dead end in
 * the loop: it read what the engine believed and could only talk about it. The
 * engine already decides, deterministically, when working exam-style questions
 * will help more than revising a topic again -- `practice`, reached when recall
 * is holding up and application is not, or when marked answers have slipped --
 * and it already knows where that practice is done. It also checks a suspected
 * gap with exam questions rather than more revision. This picks that advice out
 * for what the student is looking at, so Tutor can offer the same action Today
 * would, with the same id, and the offer is recorded like any other.
 *
 * Nothing here judges the student. It filters decisions the engine has made;
 * it never makes one, and a topic the engine would leave alone, or would rather
 * teach or have retrieved, gets no offer from here.
 */

/** Where one piece of material sits in the engine's concept space. */
export function materialTopicKeys(input: {
  /** The student's own Topics the material is filed under. */
  topicIds?: readonly string[];
  /** A card's deck, which stands in for a concept when the card has no Topic. */
  deckId?: string;
  /** Specification topics and concepts, for a past-paper question. */
  specificationIds?: readonly string[];
}): string[] {
  const clean = (ids: readonly string[] | undefined) =>
    (ids ?? []).map((id) => id.trim()).filter(Boolean);
  const topicIds = clean(input.topicIds);
  const keys = [
    ...topicIds.map((id) => `topic:${id}`),
    ...clean(input.specificationIds).map((id) => `spec:${id}`),
    // A card with Topics is read under them, never under its deck as well.
    ...(topicIds.length === 0 && input.deckId?.trim() ? [`deck:${input.deckId.trim()}`] : []),
  ];
  return Array.from(new Set(keys));
}

/**
 * Reasons that mean the student is struggling, as opposed to maintaining or
 * never having been tested. The same four the profile treats as problems.
 */
const STRUGGLING_REASONS: ReadonlySet<LearningRecommendationReason> = new Set([
  "low_mastery",
  "low_confidence",
  "declining_mastery",
  "knowledge_decay",
]);

/**
 * Whether the engine's way of meeting this need is exam-style questions.
 *
 * Its `practice` decision, or the action it chose for any other decision when
 * that action is real or written questions -- a suspected gap is checked with
 * exam questions, for instance. A topic the engine would rather teach, or have
 * the student retrieve from cards, is not turned into practice from here.
 */
function isPracticeAction(action: StudyAction) {
  const type = action.intervention?.type;
  if (type) return type === "past_paper" || type === "create_practice";
  return action.action === "practice";
}

/**
 * The practice action about this material, or nothing.
 *
 * Only for a topic the student is struggling with, only a real destination,
 * and only advice that is not resting: a student who has just done the
 * practice, or has turned it down three times, is not offered it again from
 * here either. Several matches go to the one the engine ranks highest.
 */
export function practiceActionForMaterial(
  actions: readonly StudyAction[],
  topicKeys: readonly string[]
): StudyAction | undefined {
  if (topicKeys.length === 0) return undefined;
  const keys = new Set(topicKeys);
  return actions
    .filter(
      (action) =>
        STRUGGLING_REASONS.has(action.reason) &&
        isPracticeAction(action) &&
        Boolean(action.destination) &&
        !action.cooldown &&
        action.target.kind === "topic" &&
        keys.has(action.target.topicKey)
    )
    .sort((left, right) => right.priority - left.priority)[0];
}

/**
 * The engine's next step for the whole scope, for Tutor to offer when the
 * student asks what to do next.
 *
 * Today's first action, held to the same rules as the practice offer: a real
 * destination, a topic, and nothing resting. Picked here rather than by the
 * model, so Tutor can only ever hand over advice the engine actually gave.
 */
export function nextStudyAction(actions: readonly StudyAction[]): StudyAction | undefined {
  return actions
    .filter(
      (action) =>
        Boolean(action.destination) && !action.cooldown && action.target.kind === "topic"
    )
    .sort((left, right) => right.priority - left.priority)[0];
}
