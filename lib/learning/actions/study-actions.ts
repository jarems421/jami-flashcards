import {
  getCustomStudyHref,
  getDeckHref,
  getFolderHref,
  getQuestionPracticeSetupHref,
  getTopicHref,
} from "@/lib/app/routes";
import { recommendationTargetKey } from "@/lib/learning/recommendations/recommend-focus";
import type { LearnerProfile, LearningRecommendation } from "@/lib/learning/types";

/**
 * Recommendations turned into things a student can actually start.
 *
 * Every destination is a surface Jami already has -- a flashcard session, Past
 * Paper Practice narrowed to a topic, a folder's practice papers, a Topic or
 * deck page. When no surface can carry an action out (a diagnosis on a topic
 * with no cards and no question bank), the action has no destination rather
 * than a link that pretends.
 */

export type StudyActionDestinationKind =
  | "flashcards"
  | "question-practice"
  | "practice-papers"
  | "topic"
  | "deck";

export type StudyActionDestination = {
  kind: StudyActionDestinationKind;
  href: string;
};

export type StudyAction = LearningRecommendation & {
  /** Stable across requests for the same scope, reason and target. */
  id: string;
  scope: { folderId?: string; deckId?: string };
  /** `reason.action`, for logs and for copy that must stay in step with the decision. */
  explanationCode: string;
  destination?: StudyActionDestination;
};

export type StudyActionContext = {
  /** Past Paper Practice is enabled and the folder has a course it can draw on. */
  questionPracticeAvailable: boolean;
};

function topicIdOf(topicKey: string) {
  const separator = topicKey.indexOf(":");
  return separator > 0 ? topicKey.slice(separator + 1) : "";
}

export function resolveStudyActionDestination(
  recommendation: LearningRecommendation,
  profile: Pick<LearnerProfile, "scope" | "topics">,
  context: StudyActionContext
): StudyActionDestination | undefined {
  const folderId = profile.scope.folderId;
  const { target, action } = recommendation;

  if (target.kind === "error") {
    const sources = recommendation.evidence.sources;
    if (folderId && context.questionPracticeAvailable && sources.includes("past-paper")) {
      return { kind: "question-practice", href: getQuestionPracticeSetupHref({ folderId }) };
    }
    if (folderId && sources.includes("practice")) {
      return { kind: "practice-papers", href: getFolderHref(folderId, "practice") };
    }
    return undefined;
  }

  const id = topicIdOf(target.topicKey);
  if (!id) return undefined;

  const state = profile.topics.find((topic) => topic.topicKey === target.topicKey);

  if (target.source === "specification") {
    // Specification topics are practised through the question bank; there are no cards to retrieve.
    if (!folderId || !context.questionPracticeAvailable || action === "teach" || action === "retrieve") {
      return undefined;
    }
    // A concept sits beneath a topic, so its practice narrows to the concept rather than the whole topic.
    return {
      kind: "question-practice",
      href: getQuestionPracticeSetupHref(
        state?.parentKey ? { folderId, conceptIds: [id] } : { folderId, topicIds: [id] }
      ),
    };
  }

  const hasCards =
    (state?.exposure.cards ?? 0) > 0 || recommendation.evidence.sources.includes("flashcards");

  if (target.source === "deck") {
    if (action === "teach") return { kind: "deck", href: getDeckHref(id) };
    return hasCards
      ? { kind: "flashcards", href: getCustomStudyHref({ mode: "custom", deckIds: [id] }) }
      : undefined;
  }

  if (action === "teach") return { kind: "topic", href: getTopicHref(id) };
  if (hasCards) {
    return { kind: "flashcards", href: getCustomStudyHref({ mode: "custom", topicIds: [id] }) };
  }
  // Without cards a topic can still be revisited through its material, but not diagnosed.
  return action === "diagnose" ? undefined : { kind: "topic", href: getTopicHref(id) };
}

export function buildStudyActions(
  profile: LearnerProfile,
  context: StudyActionContext
): StudyAction[] {
  const scope = profile.scope.folderId
    ? { folderId: profile.scope.folderId }
    : profile.scope.deckId
      ? { deckId: profile.scope.deckId }
      : {};
  const scopeKey = scope.folderId ? `folder:${scope.folderId}` : scope.deckId ? `deck:${scope.deckId}` : "none";
  return profile.recommendedFocus.map((recommendation) => {
    const destination = resolveStudyActionDestination(recommendation, profile, context);
    return {
      ...recommendation,
      id: `${scopeKey}|${recommendation.reason}|${recommendationTargetKey(recommendation.target)}`,
      scope,
      explanationCode: `${recommendation.reason}.${recommendation.action}`,
      ...(destination ? { destination } : {}),
    };
  });
}

/**
 * Actions from several scopes, ranked together.
 *
 * Each scope's actions were decided from that scope's evidence alone, so this
 * compares decisions, never mixes subjects. Order: priority, then the scope's
 * own position (most recently used folder first), then id. Two actions leading
 * to the same place are shown once.
 */
export function mergeStudyActions(
  groups: readonly (readonly StudyAction[])[],
  options: { limit: number; executableOnly?: boolean }
): StudyAction[] {
  const ranked = groups
    .flatMap((group, groupIndex) => group.map((action) => ({ action, groupIndex })))
    .filter(({ action }) => !options.executableOnly || Boolean(action.destination))
    .sort(
      (left, right) =>
        right.action.priority - left.action.priority ||
        left.groupIndex - right.groupIndex ||
        left.action.id.localeCompare(right.action.id)
    );
  const seen = new Set<string>();
  const merged: StudyAction[] = [];
  for (const { action } of ranked) {
    const key = action.destination?.href ?? action.id;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(action);
    if (merged.length >= Math.max(0, options.limit)) break;
  }
  return merged;
}
