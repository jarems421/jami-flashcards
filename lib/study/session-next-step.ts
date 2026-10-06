import type { StudySessionKind } from "@/lib/study/session";

/** What the session summary says comes next. */
export type StudyNextStepMessage =
  | "fresh-required-ready"
  | "simple-clear"
  | "optional-ready"
  | "focused-ready"
  | "new-star"
  | "tidy-cards";

/** The one thing the summary offers to do about it. */
export type StudyNextStepAction =
  | "start-fresh-required"
  | "start-optional"
  | "start-focused"
  | "view-constellation"
  | "edit-cards";

export type StudyNextStep = {
  message: StudyNextStepMessage;
  action: StudyNextStepAction;
};

/**
 * The next best step after a finished session, most urgent first.
 *
 * The message and the action are chosen separately on purpose. A cleared
 * Simple Study pass is worth saying in its own words, but it has no follow-on
 * of its own, so its button falls through to whatever else is ready.
 */
export function chooseStudyNextStep({
  sessionKind,
  sessionWasCarryoverOnly,
  remainingFreshRequired,
  remainingOptional,
  focusedCardCount,
  completedGoals,
}: {
  sessionKind: StudySessionKind;
  /** The session cleared only cards carried over from an earlier day. */
  sessionWasCarryoverOnly: boolean;
  remainingFreshRequired: number;
  remainingOptional: number;
  /** Cards the current Focused Review selection would study. */
  focusedCardCount: number;
  completedGoals: number;
}): StudyNextStep {
  const freshRequiredReady = sessionWasCarryoverOnly && remainingFreshRequired > 0;
  const optionalReady = sessionKind === "daily-required" && remainingOptional > 0;
  const focusedReady = focusedCardCount > 0;
  const earnedStar = completedGoals > 0;

  const message: StudyNextStepMessage = freshRequiredReady
    ? "fresh-required-ready"
    : sessionKind === "simple"
      ? "simple-clear"
      : optionalReady
        ? "optional-ready"
        : focusedReady
          ? "focused-ready"
          : earnedStar
            ? "new-star"
            : "tidy-cards";

  const action: StudyNextStepAction = freshRequiredReady
    ? "start-fresh-required"
    : optionalReady
      ? "start-optional"
      : focusedReady
        ? "start-focused"
        : earnedStar
          ? "view-constellation"
          : "edit-cards";

  return { message, action };
}
