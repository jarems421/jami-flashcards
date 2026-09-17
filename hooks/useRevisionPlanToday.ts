"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StudyAction } from "@/lib/learning/actions/study-actions";
import {
  buildPlanActivityByScope,
  type PlanActivityCard,
  type PlanActivityDeck,
} from "@/lib/planning/plan-activity";
import { resolvePlanDay } from "@/lib/planning/resolve-plan-day";
import { planScopeKey, type PlanSlot, type RevisionPlan, type RevisionPlanEntry } from "@/lib/planning/types";
import {
  loadActiveRevisionPlan,
  loadRevisionPlanEntries,
  saveRevisionPlanEntry,
} from "@/services/planning/revision-plans";
import { getStudyDayKey } from "@/lib/study/day";

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
  const [entry, setEntry] = useState<RevisionPlanEntry | null>(null);
  const [loading, setLoading] = useState(enabled);
  const dayKey = getStudyDayKey();
  // Held so an optimistic tick can be written without the save racing a reload.
  const savingRef = useRef(false);

  const load = useCallback(async () => {
    if (!enabled || !uid) {
      setPlan(null);
      setEntry(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const active = await loadActiveRevisionPlan(uid);
      setPlan(active);
      if (!active) {
        setEntry(null);
        return;
      }
      const entries = await loadRevisionPlanEntries(uid, active.id, {
        fromDayKey: dayKey,
        toDayKey: dayKey,
        max: 1,
      });
      setEntry(entries[0] ?? null);
    } catch {
      // Today must render without a plan. A plan that cannot be read is the
      // same as not having one, and saying so loudly on the home page would be
      // worse than the absence.
      setPlan(null);
      setEntry(null);
    } finally {
      setLoading(false);
    }
  }, [dayKey, enabled, uid]);

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

  const day = useMemo(
    () =>
      plan
        ? resolvePlanDay({ plan, dayKey, entry, actionsByScope, activityByScope })
        : null,
    [actionsByScope, activityByScope, dayKey, entry, plan]
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
      setEntry(updated);
      savingRef.current = true;
      void saveRevisionPlanEntry(uid, plan.id, updated)
        .catch(() => {
          // Put it back rather than leaving a tick that did not save.
          setEntry(entry);
        })
        .finally(() => {
          savingRef.current = false;
        });
    },
    [dayKey, entry, plan, uid]
  );

  return { plan, day, scopeNames, loading, toggleSlot, refresh: load };
}
