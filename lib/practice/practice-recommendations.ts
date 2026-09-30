import type { StudyAction } from "@/lib/learning/actions/study-actions";
import type { LearningAction, LearningRecommendationReason } from "@/lib/learning/types";

/**
 * A recommendation the Learning Engine made that a practice set can answer.
 *
 * Either it already leads to real past-paper questions -- a course topic,
 * which the question bank covers and which beats anything Jami could write --
 * or it names something to practise that has no questions to draw on, and a
 * practice set can be written for it on a press. Nothing is written until the
 * student asks: recommendations cost nothing to show.
 */
export type PracticeRecommendation = {
  id: string;
  folderId: string;
  label: string;
  why: string;
  /** Past Paper Practice narrowed to this, where the bank covers it. */
  setupHref?: string;
  /** Specification headings, carried so a written set stays on them. */
  topicIds?: string[];
  conceptIds?: string[];
};

const PRACTISABLE_ACTIONS: ReadonlySet<LearningAction> = new Set([
  "practice",
  "diagnose",
  "reinforce",
  "review",
]);

/**
 * Why, in words that never call a topic weak on thin evidence: a low-confidence
 * or untested topic is described as unknown, which is what it is.
 */
const WHY: Record<LearningRecommendationReason, string> = {
  persistent_error: "Keeps costing marks in your recent answers.",
  declining_mastery: "Your recent answers on this have slipped.",
  knowledge_decay: "You knew this well, but it may be fading.",
  low_mastery: "This has been difficult so far.",
  low_confidence: "Not enough evidence yet — a few questions will tell.",
  due_for_retrieval: "Due for another go.",
  recent_improvement_needs_reinforcement: "Improving — worth locking in.",
  untested_exposure: "You have studied this but not been tested on it.",
  not_yet_assessed: "Not tested yet.",
};

function specificationIdOf(topicKey: string) {
  const separator = topicKey.indexOf(":");
  return separator > 0 ? topicKey.slice(separator + 1) : "";
}

export function selectPracticeRecommendations(
  actions: readonly StudyAction[],
  limit = 3
): PracticeRecommendation[] {
  const chosen: PracticeRecommendation[] = [];
  for (const action of actions) {
    const folderId = action.scope.folderId;
    if (!folderId || chosen.length >= limit) continue;
    const why = WHY[action.reason];
    if (action.destination?.kind === "question-practice") {
      chosen.push({ id: action.id, folderId, label: action.target.label, why, setupHref: action.destination.href });
      continue;
    }
    if (!PRACTISABLE_ACTIONS.has(action.action)) continue;
    const specification =
      action.target.kind === "topic" && action.target.source === "specification"
        ? specificationIdOf(action.target.topicKey)
        : "";
    chosen.push({
      id: action.id,
      folderId,
      label: action.target.label,
      why,
      ...(specification ? { topicIds: [specification] } : {}),
    });
  }
  return chosen;
}
