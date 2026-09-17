import type { StudyAction } from "@/lib/learning/actions/study-actions";
import type { LearningRecommendationReason } from "@/lib/learning/types";

/**
 * Whether Jami knows enough to draft a plan without asking first.
 *
 * Two ways to start a plan, and the difference between them is how much the
 * Learning Engine can already say. With a term of recorded work behind them, a
 * student should not have to answer five questions Jami could have answered
 * from their evidence -- they should be able to say "just build it". With
 * nothing recorded, the engine has no opinion at all, and the only signal in
 * the room is what the student says about themselves.
 *
 * So this is not a quality bar on the plan. It decides which conversation to
 * open with, and a student may always choose the other one.
 */

/**
 * Reasons that exist precisely because there is no evidence.
 *
 * `untested_exposure` means material was seen and never tested;
 * `not_yet_assessed` means a specification topic nobody has touched. Both are
 * worth acting on and neither is a reason to believe Jami understands this
 * student yet -- a profile made entirely of these knows what exists, not how
 * anyone is doing.
 */
const REASONS_WITHOUT_EVIDENCE: readonly LearningRecommendationReason[] = [
  "untested_exposure",
  "not_yet_assessed",
];

/** Below this many evidence-backed actions, drafting unasked is guesswork. */
export const MIN_EVIDENCED_ACTIONS_TO_DRAFT = 3;

export type PlanDraftReadiness = {
  /** Enough recorded work for Jami to propose a plan straight away. */
  canDraftUnprompted: boolean;
  /** Actions the student could actually start. */
  actionable: number;
  /** Of those, how many rest on recorded answers rather than on absence. */
  evidenced: number;
  /** How many distinct subjects those came from. */
  scopes: number;
};

export function assessPlanDraftReadiness(
  actions: readonly StudyAction[]
): PlanDraftReadiness {
  const actionable = actions.filter((action) => Boolean(action.destination));
  const evidenced = actionable.filter(
    (action) => !REASONS_WITHOUT_EVIDENCE.includes(action.reason)
  );
  const scopes = new Set(
    evidenced.map((action) => action.scope.folderId ?? action.scope.deckId ?? "none")
  );

  return {
    canDraftUnprompted: evidenced.length >= MIN_EVIDENCED_ACTIONS_TO_DRAFT,
    actionable: actionable.length,
    evidenced: evidenced.length,
    scopes: scopes.size,
  };
}

/**
 * How the two starting points are offered, in the student's terms.
 *
 * The wording changes with what Jami can honestly claim. It never says it
 * understands a student it has no evidence about, and it never makes one who
 * has been working for a term explain themselves from scratch.
 */
export function describePlanDraftOffer(readiness: PlanDraftReadiness) {
  return readiness.canDraftUnprompted
    ? {
        headline: "Jami can draft this from your work",
        detail: "Your recent practice is enough to suggest a plan. You can change anything in it.",
        primary: "Draft it for me",
        secondary: "Tell Jami what I need first",
      }
    : {
        headline: "Tell Jami what you're working towards",
        detail:
          "There isn't enough recorded work yet for Jami to guess, so it will ask a few things first.",
        primary: "Tell Jami what I need",
        secondary: "Build it myself",
      };
}
