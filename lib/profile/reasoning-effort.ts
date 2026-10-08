/**
 * How hard the student wants Jami to think: Auto, unless they choose.
 *
 * Effort alone does not separate the levels. Measured on Tutor-sized questions,
 * the fast model answered in one to five seconds whatever effort it was asked
 * for, and the thinking model took fifteen to a hundred seconds whatever effort
 * it was asked for, and a third of the time broke before it finished. What a
 * level really chooses is how a question is answered, which is a tier
 * (`lib/ai/tutor-thinking.ts`):
 *
 * - Auto picks the tier for each question from what it asks.
 * - Low answers everything quickly.
 * - Medium has the fast model think on everything.
 * - High sends everything to the thinking model, which is slower and costs more.
 *
 * A challenged answer keeps its stronger route at every level, and no model is
 * asked for less effort than its role needs: a preference cannot make a
 * disputed mark cheaper to adjudicate than the juror needs it to be.
 */
export const REASONING_EFFORT_OPTIONS = [
  {
    value: "auto",
    label: "Auto",
    description: "Thinks as much as each question needs",
  },
  {
    value: "low",
    label: "Low",
    description: "Fastest, for quick questions",
  },
  {
    value: "medium",
    label: "Medium",
    description: "Thinks more on every question",
  },
  {
    value: "high",
    label: "High",
    description: "Deepest thinking on everything, and slower",
  },
] as const;

export type ReasoningEffortPreference =
  (typeof REASONING_EFFORT_OPTIONS)[number]["value"];

/** What a student who has not chosen gets. */
export const DEFAULT_REASONING_EFFORT: ReasoningEffortPreference = "auto";

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
    "Auto"
  );
}
