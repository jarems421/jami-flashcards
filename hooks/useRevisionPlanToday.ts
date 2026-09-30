"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StudyAction } from "@/lib/learning/actions/study-actions";
import {
  buildPlanActivityByScope,
  type PlanActivityCard,
  type PlanActivityDeck,
} from "@/lib/planning/plan-activity";
import { buildPlanWeek, PLAN_WEEK_LENGTH, resolvePlanWeekDays, type PlanWeek } from "@/lib/planning/plan-week";
import { planWeekStartDayKey } from "@/lib/planning/plan-schedule";
import {
  nextPlanSuggestion,
  ownPlanTask,
  pinnedFromAction,
  type PlanSuggestionResult,
} from "@/lib/planning/plan-tasks";
import { planSlotTickKey, resolvePlanDay } from "@/lib/planning/resolve-plan-day";
import {
  planScopeKey,
  type PlanDay,
  type PlanDaySession,
  type PlanSlot,
  type RevisionPlan,
  type RevisionPlanEntry,
} from "@/lib/planning/types";
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
  /** Every day of the week, today resolved against the engine and the rest by their shape. */
  days: PlanDay[];
  toggleSlot: (slot: PlanSlot, dayKey?: string) => void;
  addOwnTask: (dayKey: string, sessionId: string, label: string) => boolean;
  addJamiTask: (session: PlanDaySession) => PlanSuggestionResult;
  removeTask: (dayKey: string, actionId: string) => void;
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

  /*
   * One day's entry, changed and saved.
   *
   * Optimistic, and put back on failure: a tick or a task that silently did
   * not save would have the student planning around something the plan does
   * not know about. Says whether it wrote: while one save is in flight the
   * next is refused, and a task the student typed must not look added when
   * it was not.
   */
  const writeEntry = useCallback(
    (targetDayKey: string, change: (entry: RevisionPlanEntry) => RevisionPlanEntry): boolean => {
      if (!plan || savingRef.current) return false;
      const stored = entries.find((candidate) => candidate.dayKey === targetDayKey);
      const updated = { ...change(stored ?? { dayKey: targetDayKey }), dayKey: targetDayKey };
      const previous = entries;
      setEntries((current) => [
        ...current.filter((candidate) => candidate.dayKey !== targetDayKey),
        updated,
      ]);
      savingRef.current = true;
      void saveRevisionPlanEntry(uid, plan.id, updated)
        .catch(() => {
          setEntries(previous);
        })
        .finally(() => {
          savingRef.current = false;
        });
      return true;
    },
    [entries, plan, uid]
  );

  const toggleSlot = useCallback(
    (slot: PlanSlot, slotDayKey: string = dayKey) => {
      // Only a manual tick is the student's to change; one Jami recorded is
      // reporting work that happened and untick would not undo it.
      if (slot.completedBy === "activity" || slot.state === "skipped") return;
      const key = planSlotTickKey(slot);
      writeEntry(slotDayKey, (entry) => {
        const current = entry.completedSlotIds ?? [];
        return {
          ...entry,
          completedSlotIds: current.includes(key)
            ? current.filter((id) => id !== key)
            : [...current, key],
        };
      });
    },
    [dayKey, writeEntry]
  );

  /** A task the student wrote, added to the end of one sitting. */
  const addOwnTask = useCallback(
    (taskDayKey: string, sessionId: string, label: string) => {
      const item = ownPlanTask(label, sessionId);
      if (!item) return false;
      return writeEntry(taskDayKey, (entry) => ({ ...entry, pinned: [...(entry.pinned ?? []), item] }));
    },
    [writeEntry]
  );

  /**
   * Another of Jami's suggestions for a sitting, kept there.
   *
   * Only today has suggestions to give: the engine answers for the evidence
   * as it is now, and a suggestion made for Saturday would be stale by then.
   */
  const addJamiTask = useCallback(
    (session: PlanDaySession): PlanSuggestionResult => {
      const action = day ? nextPlanSuggestion(day, session.scopeKey, actionsByScope) : null;
      if (!action) return "nothing";
      const item = pinnedFromAction(action, session.id);
      return writeEntry(dayKey, (entry) => ({ ...entry, pinned: [...(entry.pinned ?? []), item] }))
        ? "added"
        : "busy";
    },
    [actionsByScope, day, dayKey, writeEntry]
  );

  /** Something the student put in a day, taken back out, with its tick. */
  const removeTask = useCallback(
    (taskDayKey: string, actionId: string) => {
      writeEntry(taskDayKey, (entry) => ({
        ...entry,
        pinned: (entry.pinned ?? []).filter((item) => item.actionId !== actionId),
        completedSlotIds: (entry.completedSlotIds ?? []).filter((id) => id !== `pin:${actionId}`),
      }));
    },
    [writeEntry]
  );

  const days = useMemo(
    () =>
      plan && week
        ? resolvePlanWeekDays({ plan, week, entries, actionsByScope, activityByScope })
        : [],
    [actionsByScope, activityByScope, entries, plan, week]
  );

  return {
    plan,
    day,
    week,
    days,
    scopeNames,
    loading,
    toggleSlot,
    addOwnTask,
    addJamiTask,
    removeTask,
    refresh: load,
  };
}
