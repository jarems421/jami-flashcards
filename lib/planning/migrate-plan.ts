import { PLAN_WEEKDAYS, type PlanWeekday, type RevisionPlanSession } from "@/lib/planning/types";

/**
 * A stored plan read forward into the shape the app uses now.
 *
 * Version 1 wrote `cadence: [{weekday, minutes}]` -- one sitting a day, no
 * clock times, no subject per sitting. Version 2 writes `sessions`, which can
 * say all three and is not obliged to say any of them. The two describe the
 * same week whenever the first one could describe it at all, so a migrated plan
 * must behave *identically*: same days, same lengths, and -- because slot ids
 * are positional and a migrated day has exactly the sittings it had before --
 * the same slot ids, so no student loses a tick they made yesterday.
 *
 * Read-time only. Nothing here writes; a version 1 document stays a version 1
 * document until the student next saves the plan, and is migrated again on
 * every read until they do. That is cheaper than a backfill and cannot leave
 * half a collection converted.
 */

export const LEGACY_PLAN_SCHEMA_VERSION = 1;

type LegacyCadenceEntry = { weekday?: unknown; minutes?: unknown };

/**
 * Version 1 cadence as sessions.
 *
 * The id is derived from the weekday rather than generated, so reading the same
 * document twice gives the same session ids and nothing downstream sees a
 * sitting appear to be replaced between renders.
 */
export function sessionsFromLegacyCadence(cadence: unknown): RevisionPlanSession[] {
  if (!Array.isArray(cadence)) return [];
  const sessions: RevisionPlanSession[] = [];
  const seen = new Set<PlanWeekday>();
  for (const raw of cadence) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as LegacyCadenceEntry;
    const weekday = Number(entry.weekday);
    if (!PLAN_WEEKDAYS.includes(weekday as PlanWeekday)) continue;
    const day = weekday as PlanWeekday;
    // Version 1 held at most one entry per weekday by construction. A document
    // edited by hand could hold two; the first wins, which is what the old
    // reader did.
    if (seen.has(day)) continue;
    seen.add(day);
    sessions.push({ id: `w${day}`, weekday: day, minutes: Number(entry.minutes) });
  }
  return sessions;
}

/**
 * Whatever came out of Firestore, with `sessions` guaranteed to be the truth.
 *
 * `sessions` wins where it exists: a plan saved by this build carries both for
 * one save cycle if an older field lingers in the document, and the newer field
 * is the one the student last edited. `normalizeRevisionPlanDraft` still runs
 * afterwards and is what actually bounds any of it.
 */
export function migrateStoredRevisionPlan(data: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(data.sessions) && data.sessions.length > 0) return data;
  if (!Array.isArray(data.cadence)) return data;
  return { ...data, sessions: sessionsFromLegacyCadence(data.cadence) };
}
