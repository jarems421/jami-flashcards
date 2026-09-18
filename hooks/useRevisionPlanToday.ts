"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StudyAction } from "@/lib/learning/actions/study-actions";
import {
  buildPlanActivityByScope,
  type PlanActivityCard,
  type PlanActivityDeck,
} from "@/lib/planning/plan-activity";
import { buildPlanWeek, PLAN_WEEK_LENGTH, type PlanWeek } from "@/lib/planning/plan-week";
import { planWeekStartDayKey } from "@/lib/planning/plan-schedule";
import { resolvePlanDay } from "@/lib/planning/resolve-plan-day";
import { planScopeKey, type PlanSlot, type RevisionPlan, type RevisionPlanEntry } from "@/lib/planning/types";
import {
  loadActiveRevisionPlan,
  loadRevisionPlanEntries,
  saveRevisionPlanEntry,
} from "@/services/planning/revision-plans";
import { getStudyDayKey, shiftStudyDayKey } from "@/lib/study/day";

/**
 * Today's plan, resolved against whatever the Learning Engine currently says.
 *
 * The plan and the engine are loaded separately and joined here, every time,
 * rather than the plan storing what it decided when it was made. That join is
 * the feature: tick something off, do the work, and tomorrow's slots are
 * answered from the evidence that work left behind.
 *
 * Failing quietly is deliberate. A plan is decoration on top of Today, and
 * Today has to work without it -- the same rule the Learning Engine follows
 * about Tutor and studying.
 */

export type RevisionPlanTodayState = {
  plan: RevisionPlan | null;
  day: ReturnType<typeof resolvePlanDay> | null;
  /** The week today sits in, for the strip above the agenda. */
  week: PlanWeek | null;
  scopeNames: Map<string, string>;
  loading: boolean;
  toggleSlot: (slot: PlanSlot) => void;
  refresh: () => Promise<void>;
};

export function useRevisionPlanToday(input: {
  uid: string;
  enabled: boolean;
  actions: readonly StudyAction[];
  folders: readonly { id: string; name: string }[];
  cards: readonly PlanActivityCard[];
  decks: readonly (PlanActivityDeck & { name?: string })[];
}): RevisionPlanTodayState {
  const { uid, enabled } = input;
  const [plan, setPlan] = useState<RevisionPlan | null>(null);
  /**
   * The whole visible week, not just today.
   *
   * Seven documents at most, and only the ones the student actually changed
   * exist, so this is usually one read returning one or two rows. Today is
   * picked back out of it rather than fetched separately.
   */
  const [entries, setEntries] = useState<RevisionPlanEntry[]>([]);
  const [loading, setLoading] = useState(enabled);
  const dayKey = getStudyDayKey();
  const weekStartDayKey = planWeekStartDayKey(dayKey);
  // Held so an optimistic tick can be written without the save racing a reload.
  const savingRef = useRef(false);

  const load = useCallback(async () => {
    if (!enabled || !uid) {
      setPlan(null);
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const active = await loadActiveRevisionPlan(uid);
      setPlan(active);
      if (!active) {
        setEntries([]);
        return;
      }
      setEntries(
        await loadRevisionPlanEntries(uid, active.id, {
          fromDayKey: weekStartDayKey,
          toDayKey: shiftStudyDayKey(weekStartDayKey, PLAN_WEEK_LENGTH - 1),
          max: PLAN_WEEK_LENGTH,
        })
      );
    } catch {
      // Today must render without a plan. A plan that cannot be read is the
      // same as not having one, and saying so loudly on the home page would be
      // worse than the absence.
      setPlan(null);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [enabled, uid, weekStartDayKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const actionsByScope = useMemo(() => {
    const grouped = new Map<string, StudyAction[]>();
    for (const action of input.actions) {
      const key = planScopeKey(action.scope);
      const list = grouped.get(key);
      if (list) list.push(action);
      else grouped.set(key, [action]);
    }
    return grouped;
  }, [input.actions]);

  const activityByScope = useMemo(
    () =>
      plan
        ? buildPlanActivityByScope({
            scopes: plan.scopes,
            cards: input.cards,
            decks: input.decks,
            dayKey,
          })
        : new Map<string, number>(),
    [dayKey, input.cards, input.decks, plan]
  );

  const entry = useMemo(
    () => entries.find((stored) => stored.dayKey === dayKey) ?? null,
    [dayKey, entries]
  );

  const day = useMemo(
    () =>
      plan
        ? resolvePlanDay({ plan, dayKey, entry, actionsByScope, activityByScope })
        : null,
    [actionsByScope, activityByScope, dayKey, entry, plan]
  );

  /*
   * The week from stored entries alone.
   *
   * Only today is resolved against the Learning Engine; the other six say how
   * much they ask for and how much the student ticked off. See `plan-week.ts`
   * for why replaying the engine across a week is not worth seven profile
   * reads to draw seven bars.
   */
  const week = useMemo(
    () =>
      plan ? buildPlanWeek({ plan, entries, todayDayKey: dayKey, weekStartDayKey }) : null,
    [dayKey, entries, plan, weekStartDayKey]
  );

  const scopeNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const folder of input.folders) names.set(`folder:${folder.id}`, folder.name);
    for (const deck of input.decks) {
      if (deck.name) names.set(`deck:${deck.id}`, deck.name);
    }
    return names;
  }, [input.decks, input.folders]);

  const toggleSlot = useCallback(
    (slot: PlanSlot) => {
      if (!plan || savingRef.current) return;
      // Only a manual tick is the student's to change; one Jami recorded is
      // reporting work that happened and untick would not undo it.
      if (slot.completedBy === "activity" || slot.state === "skipped") return;

      const current = entry?.completedSlotIds ?? [];
      const next = current.includes(slot.id)
        ? current.filter((id) => id !== slot.id)
        : [...current, slot.id];
      const updated: RevisionPlanEntry = { ...(entry ?? { dayKey }), dayKey, completedSlotIds: next };
      const previous = entries;
      setEntries((current) => [
        ...current.filter((stored) => stored.dayKey !== dayKey),
        updated,
      ]);
      savingRef.current = true;
      void saveRevisionPlanEntry(uid, plan.id, updated)
        .catch(() => {
          // Put it back rather than leaving a tick that did not save.
          setEntries(previous);
        })
        .finally(() => {
          savingRef.current = false;
        });
    },
    [dayKey, entries, entry, plan, uid]
  );

  return { plan, day, week, scopeNames, loading, toggleSlot, refresh: load };
}
