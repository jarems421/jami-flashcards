import {
  clampPlanMinutes,
  clampPlanWeight,
  isPlanDayKey,
  planDaysBetween,
} from "@/lib/planning/plan-schedule";
import {
  PLAN_MAX_HORIZON_DAYS,
  PLAN_WEEKDAYS,
  planScopeKey,
  type PlanWeekday,
  type RevisionPlanCadence,
  type RevisionPlanDraft,
  type RevisionPlanEmphasis,
  type RevisionPlanScope,
} from "@/lib/planning/types";
import { getStudyDayKey, shiftStudyDayKey } from "@/lib/study/day";

/**
 * A plan forced into a shape the rest of the app can rely on.
 *
 * One function for both ways a plan is made. The student's own builder is
 * bounded by its controls, so most of this never fires for them; a plan drafted
 * by Jami arrives as whatever a language model produced, and is not trusted at
 * all. Running both through the same gate means the builder can never be the
 * only thing standing between a bad value and Firestore.
 */

export const MAX_PLAN_SCOPES = 6;
export const MAX_PLAN_TITLE_LENGTH = 80;
export const MAX_PLAN_NOTE_LENGTH = 240;

export type PlanValidationProblem =
  | "no-scopes"
  | "no-cadence"
  | "bad-dates"
  | "horizon-too-long";

export type NormalizedPlanDraft = {
  draft: RevisionPlanDraft;
  problems: PlanValidationProblem[];
  valid: boolean;
};

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeScopes(input: unknown): RevisionPlanScope[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const scopes: RevisionPlanScope[] = [];
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) continue;
    const candidate = raw as Partial<RevisionPlanScope>;
    const folderId = cleanText(candidate.folderId, 128);
    const deckId = cleanText(candidate.deckId, 128);
    // One or the other, never both: a scope is one profile, and the Learning
    // Engine builds a profile for a folder or for a deck.
    if (!folderId && !deckId) continue;
    const scope: RevisionPlanScope = folderId
      ? { folderId, weight: clampPlanWeight(candidate.weight ?? 1) }
      : { deckId, weight: clampPlanWeight(candidate.weight ?? 1) };
    const key = planScopeKey(scope);
    if (seen.has(key)) continue;
    seen.add(key);
    scopes.push(scope);
    if (scopes.length >= MAX_PLAN_SCOPES) break;
  }
  return scopes;
}

function normalizeCadence(input: unknown): RevisionPlanCadence[] {
  if (!Array.isArray(input)) return [];
  // One entry per weekday. Two sessions on the same Monday is a level of
  // detail the plan does not carry, and merging them silently would tell the
  // student something other than what they set.
  const byWeekday = new Map<PlanWeekday, number>();
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) continue;
    const candidate = raw as Partial<RevisionPlanCadence>;
    const weekday = Number(candidate.weekday);
    if (!PLAN_WEEKDAYS.includes(weekday as PlanWeekday)) continue;
    byWeekday.set(weekday as PlanWeekday, clampPlanMinutes(Number(candidate.minutes)));
  }
  return [...byWeekday.entries()]
    .sort(([left], [right]) => left - right)
    .map(([weekday, minutes]) => ({ weekday, minutes }));
}

function normalizeEmphasis(
  input: unknown,
  scopes: readonly RevisionPlanScope[]
): RevisionPlanEmphasis[] {
  if (!Array.isArray(input)) return [];
  const allowed = new Set(scopes.map(planScopeKey));
  const seen = new Set<string>();
  const emphasis: RevisionPlanEmphasis[] = [];
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) continue;
    const candidate = raw as Partial<RevisionPlanEmphasis>;
    const scopeKey = cleanText(candidate.scopeKey, 160);
    // Emphasis on a subject the plan does not cover is not emphasis, it is a
    // stray reference -- and a drafted plan is exactly where one would appear.
    if (!allowed.has(scopeKey) || seen.has(scopeKey)) continue;
    seen.add(scopeKey);
    const note = cleanText(candidate.note, MAX_PLAN_NOTE_LENGTH);
    emphasis.push({
      scopeKey,
      wants: candidate.wants === "practice" ? "practice" : "diagnose",
      ...(note ? { note } : {}),
    });
  }
  return emphasis;
}

/**
 * Anything at all, turned into a plan and told what is wrong with it.
 *
 * Returns the draft even when it is invalid, so a half-finished plan in the
 * builder still renders what the student has set so far and the problems read
 * as guidance rather than as a wall.
 */
export function normalizeRevisionPlanDraft(
  input: Partial<RevisionPlanDraft> | null | undefined,
  now = Date.now()
): NormalizedPlanDraft {
  const today = getStudyDayKey(now);
  const scopes = normalizeScopes(input?.scopes);
  const cadence = normalizeCadence(input?.cadence);
  const startDayKey = isPlanDayKey(input?.startDayKey) ? input.startDayKey : today;
  const endDayKey = isPlanDayKey(input?.endDayKey)
    ? input.endDayKey
    : shiftStudyDayKey(startDayKey, 27);

  const problems: PlanValidationProblem[] = [];
  if (scopes.length === 0) problems.push("no-scopes");
  if (cadence.length === 0) problems.push("no-cadence");
  const span = planDaysBetween(startDayKey, endDayKey);
  if (span < 0) problems.push("bad-dates");
  else if (span >= PLAN_MAX_HORIZON_DAYS) problems.push("horizon-too-long");

  return {
    draft: {
      title: cleanText(input?.title, MAX_PLAN_TITLE_LENGTH) || "Revision plan",
      status: input?.status === "archived" ? "archived" : "active",
      origin: input?.origin === "tutor" ? "tutor" : "manual",
      startDayKey,
      endDayKey,
      scopes,
      cadence,
      emphasis: normalizeEmphasis(input?.emphasis, scopes),
    },
    problems,
    valid: problems.length === 0,
  };
}

export const PLAN_PROBLEM_MESSAGES: Record<PlanValidationProblem, string> = {
  "no-scopes": "Choose at least one subject to revise.",
  "no-cadence": "Pick at least one day of the week to study.",
  "bad-dates": "The finish date is before the start date.",
  "horizon-too-long": "A plan can run for up to about a year.",
};
