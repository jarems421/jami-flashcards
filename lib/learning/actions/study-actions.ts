import {
  getCustomStudyHref,
  getDeckHref,
  getFolderHref,
  getQuestionPracticeSetupHref,
  getTopicHref,
} from "@/lib/app/routes";
import { recommendationTargetKey } from "@/lib/learning/recommendations/recommend-focus";
import {
  actionCooldown,
  type ActionHistory,
  type CooldownReason,
} from "@/lib/learning/actions/action-cooldown";
import {
  buildStudySessionSpec,
  type StudySessionSelection,
  type StudySessionSpec,
} from "@/lib/learning/actions/session-spec";
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
  /**
   * What the destination should work on, for a surface that can take direction.
   *
   * The href already carries this as query parameters; this is the same choice
   * in a form the engine and its tests can read without parsing a URL.
   */
  selection: StudySessionSelection;
};

export type StudyAction = LearningRecommendation & {
  /** Stable across requests for the same scope, reason and target. */
  id: string;
  scope: { folderId?: string; deckId?: string };
  /** `reason.action`, for logs and for copy that must stay in step with the decision. */
  explanationCode: string;
  destination?: StudyActionDestination;
  /** What the engine wants the destination to do; absent when nothing can carry it out. */
  spec?: StudySessionSpec;
  /**
   * Why this action is being held back, when it is.
   *
   * Kept on the action rather than filtered out here, so a caller that wants
   * the full picture -- the evaluation, a debug view -- can still see it, and
   * only the surfaces choose to hide it.
   */
  cooldown?: CooldownReason;
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
      return {
        kind: "question-practice",
        href: getQuestionPracticeSetupHref({ folderId }),
        // An error spans topics, so its practice is the folder's own question pool.
        selection: {},
      };
    }
    if (folderId && sources.includes("practice")) {
      return {
        kind: "practice-papers",
        href: getFolderHref(folderId, "practice"),
        selection: {},
      };
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
    const narrowing = state?.parentKey ? { conceptIds: [id] } : { topicIds: [id] };
    return {
      kind: "question-practice",
      href: getQuestionPracticeSetupHref({ folderId, ...narrowing }),
      selection: narrowing,
    };
  }

  const hasCards =
    (state?.exposure.cards ?? 0) > 0 || recommendation.evidence.sources.includes("flashcards");

  if (target.source === "deck") {
    if (action === "teach") {
      return { kind: "deck", href: getDeckHref(id), selection: { deckIds: [id] } };
    }
    return hasCards
      ? {
          kind: "flashcards",
          href: getCustomStudyHref({ mode: "custom", deckIds: [id] }),
          selection: { deckIds: [id] },
        }
      : undefined;
  }

  if (action === "teach") {
    return { kind: "topic", href: getTopicHref(id), selection: { topicIds: [id] } };
  }
  if (hasCards) {
    return {
      kind: "flashcards",
      href: getCustomStudyHref({ mode: "custom", topicIds: [id] }),
      selection: { topicIds: [id] },
    };
  }
  // Without cards a topic can still be revisited through its material, but not diagnosed.
  return action === "diagnose"
    ? undefined
    : { kind: "topic", href: getTopicHref(id), selection: { topicIds: [id] } };
}

export function buildStudyActions(
  profile: LearnerProfile,
  context: StudyActionContext,
  /**
   * What has already become of this student's advice, by action id.
   *
   * Optional: a caller with no history loaded gets the engine's raw opinion,
   * which is the right answer for the evaluation and for a first request.
   */
  history?: ReadonlyMap<string, ActionHistory>,
  now = Date.now()
): StudyAction[] {
  const scope = profile.scope.folderId
    ? { folderId: profile.scope.folderId }
    : profile.scope.deckId
      ? { deckId: profile.scope.deckId }
      : {};
  const scopeKey = scope.folderId ? `folder:${scope.folderId}` : scope.deckId ? `deck:${scope.deckId}` : "none";
  return profile.recommendedFocus.map((recommendation) => {
    const id = `${scopeKey}|${recommendation.reason}|${recommendationTargetKey(recommendation.target)}`;
    const destination = resolveStudyActionDestination(recommendation, profile, context);
    const spec = destination
      ? buildStudySessionSpec(recommendation, destination.selection)
      : undefined;
    /*
     * A flashcard session is the one destination that can be told what to do,
     * so its link carries the spec. The others are pages rather than sessions:
     * a Topic page has no queue to shape, and Past Paper Practice picks its own
     * questions from the corpus. Rebuilt here rather than inside the resolver
     * because the spec is derived from the selection the resolver returns.
     */
    const directed =
      destination && spec && destination.kind === "flashcards"
        ? {
            ...destination,
            href: getCustomStudyHref({
              mode: "custom",
              ...(destination.selection.deckIds ? { deckIds: destination.selection.deckIds } : {}),
              ...(destination.selection.topicIds ? { topicIds: destination.selection.topicIds } : {}),
              focus: { emphasis: spec.emphasis, targetItems: spec.targetItems },
              fromActionId: id,
            }),
          }
        : destination;
    const cooldown = actionCooldown(history?.get(id), recommendation.evidence, now);
    return {
      ...recommendation,
      id,
      scope,
      explanationCode: `${recommendation.reason}.${recommendation.action}`,
      ...(directed ? { destination: directed } : {}),
      ...(spec ? { spec } : {}),
      ...(cooldown ? { cooldown } : {}),
    };
  });
}

/**
 * Actions from several scopes, ranked together without letting one subject win.
 *
 * Each scope's actions were decided from that scope's evidence alone, so this
 * compares decisions and never mixes subjects. But raw priority is not fully
 * comparable across scopes: within a reason band it is scaled by confidence,
 * and confidence grows with how much evidence a folder happens to hold. Ranked
 * on that alone, the folder a student has worked in most takes every slot and
 * their other subjects silently vanish from Today -- which is the opposite of
 * what someone revising four subjects needs.
 *
 * So each scope gets a fair share of the limit first, taken in priority order
 * within the scope. Slots no scope claims are then filled from everything left,
 * highest priority first, so a student with one active subject still gets a
 * full list. Actions in cooldown are skipped unless nothing else can fill the
 * space, and two actions leading to the same place are shown once.
 */
export function mergeStudyActions(
  groups: readonly (readonly StudyAction[])[],
  options: { limit: number; executableOnly?: boolean; includeCooling?: boolean }
): StudyAction[] {
  const limit = Math.max(0, options.limit);
  if (limit === 0) return [];

  const ranked = groups
    .flatMap((group, groupIndex) => group.map((action) => ({ action, groupIndex })))
    .filter(({ action }) => !options.executableOnly || Boolean(action.destination))
    .filter(({ action }) => options.includeCooling || !action.cooldown)
    .sort(
      (left, right) =>
        right.action.priority - left.action.priority ||
        left.groupIndex - right.groupIndex ||
        left.action.id.localeCompare(right.action.id)
    );

  const scopesPresent = new Set(ranked.map(({ groupIndex }) => groupIndex)).size;
  const share = scopesPresent > 1 ? Math.max(1, Math.ceil(limit / scopesPresent)) : limit;

  const seen = new Set<string>();
  const takenPerGroup = new Map<number, number>();
  const merged: StudyAction[] = [];
  const deferred: typeof ranked = [];

  const take = ({ action, groupIndex }: (typeof ranked)[number]) => {
    const key = action.destination?.href ?? action.id;
    if (seen.has(key)) return;
    seen.add(key);
    takenPerGroup.set(groupIndex, (takenPerGroup.get(groupIndex) ?? 0) + 1);
    merged.push(action);
  };

  for (const entry of ranked) {
    if (merged.length >= limit) break;
    if ((takenPerGroup.get(entry.groupIndex) ?? 0) >= share) {
      deferred.push(entry);
      continue;
    }
    take(entry);
  }

  // A student with one active subject still gets a full list.
  for (const entry of deferred) {
    if (merged.length >= limit) break;
    take(entry);
  }

  return merged;
}
