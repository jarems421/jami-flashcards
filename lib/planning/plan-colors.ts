import { planScopeKey, type RevisionPlan } from "@/lib/planning/types";

/**
 * One colour per subject in a plan, the same everywhere the plan is drawn.
 *
 * Taken from the theme's own tokens rather than fixed hex values, so a subject
 * keeps a colour that reads on every theme, and assigned by the subject's place
 * in the plan so Chemistry is the same colour on Home, in the planner and in
 * the week. Colour is never the only way a subject is told apart: its name is
 * always written beside it.
 */
const PLAN_SCOPE_COLORS = [
  "var(--color-success)",
  "var(--color-accent)",
  "var(--color-warning)",
  "var(--color-error)",
  "var(--color-warm-accent)",
  "var(--color-text-muted)",
] as const;

export function planScopeColor(plan: Pick<RevisionPlan, "scopes"> | null | undefined, scopeKey: string) {
  const index = plan?.scopes.findIndex((scope) => planScopeKey(scope) === scopeKey) ?? -1;
  return PLAN_SCOPE_COLORS[index >= 0 ? index % PLAN_SCOPE_COLORS.length : PLAN_SCOPE_COLORS.length - 1];
}
