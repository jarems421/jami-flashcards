/**
 * How hard the student wants Jami to think.
 *
 * Reasoning is bought with waiting, and the amounts are not small: measured on
 * the worker model, the same tutor question came back in 4.4 seconds with
 * little thinking and 12.4 seconds when the model was left to think as much as
 * it liked, for an answer that was four words longer. That is a trade worth
 * offering rather than deciding on somebody's behalf -- a student stuck on a
 * hard proof will happily wait, and the same student looking up a definition
 * will not.
 *
 * The route already picks a level from the difficulty of the request. This only
 * ever raises it: a preference cannot make a disputed mark cheaper to
 * adjudicate than the juror needs it to be.
 */
export const REASONING_EFFORT_OPTIONS = [
  {
    value: "low",
    label: "Low",
    description: "Fastest for straightforward questions",
  },
  {
    value: "medium",
    label: "Medium",
    description: "More thought when useful",
  },
  {
    value: "high",
    label: "High",
    description: "Deepest reasoning for difficult work",
  },
] as const;

export type ReasoningEffortPreference =
  (typeof REASONING_EFFORT_OPTIONS)[number]["value"];

export function isReasoningEffort(
  value: unknown
): value is ReasoningEffortPreference {
  return REASONING_EFFORT_OPTIONS.some((option) => option.value === value);
}

export function normalizeReasoningEffort(
  value: unknown
): ReasoningEffortPreference | undefined {
  return isReasoningEffort(value) ? value : undefined;
}

export function getReasoningEffortLabel(value: ReasoningEffortPreference) {
  return (
    REASONING_EFFORT_OPTIONS.find((option) => option.value === value)?.label ??
    "Medium"
  );
}
