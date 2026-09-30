import { describeStudyAction } from "@/lib/dashboard/today-plan";
import type { StudyAction } from "@/lib/learning/actions/study-actions";
import {
  OWN_TASK_PREFIX,
  isOwnPlanTask,
  type PinnedPlanItem,
  type PlanDay,
  type PlanDaySession,
  type PlanSlot,
} from "@/lib/planning/types";

/**
 * One piece of work in a plan, as a student reads it.
 *
 * Every task says where it came from, because the plan is shared between the
 * student and Jami and the difference matters: Jami's suggestions change as the
 * evidence does, and anything the student put there stays exactly where they
 * put it.
 */

export const MAX_OWN_TASK_LENGTH = 120;

export type PlanTaskSource = "jami" | "you" | "open";

/** What asking Jami for another task came to: one added, none to give, or a save still in flight. */
export type PlanSuggestionResult = "added" | "nothing" | "busy";

export type PlanTask = {
  slot: PlanSlot;
  label: string;
  /** Why Jami suggested it, in the engine's own evidence-bounded words. */
  description?: string;
  /** What the button says: "Practise", "Review", "Test yourself". */
  actionLabel?: string;
  href?: string;
  source: PlanTaskSource;
  /** A task the student wrote themselves, which only they can tick or remove. */
  own: boolean;
};

export function planTask(slot: PlanSlot): PlanTask {
  if (slot.item.kind === "action") {
    const copy = describeStudyAction(slot.item.action);
    return {
      slot,
      label: copy.title,
      description: copy.description,
      actionLabel: copy.label,
      ...(slot.item.action.destination?.href ? { href: slot.item.action.destination.href } : {}),
      source: "jami",
      own: false,
    };
  }
  if (slot.item.kind === "pinned") {
    return {
      slot,
      label: slot.item.pinned.label,
      ...(slot.item.pinned.href ? { href: slot.item.pinned.href } : {}),
      source: "you",
      own: isOwnPlanTask(slot.item.pinned),
    };
  }
  return { slot, label: "Open study time", source: "open", own: false };
}

/**
 * What a sitting is about, in a few words.
 *
 * The student's own name for it first ("Paper 1 Q4"), then the topic of the
 * first thing Jami put in it. Nothing when neither says: a subject name alone
 * is shown by whatever renders the sitting.
 */
export function planSessionFocus(session: PlanDaySession): string | undefined {
  if (session.label) return session.label;
  for (const slot of session.slots) {
    if (slot.item.kind === "action") return slot.item.action.target.label;
  }
  return undefined;
}

/**
 * The next thing to do today: the first piece of work not yet done, in the
 * order the day runs. Open time is skipped -- "open study time" is not
 * something a student can start.
 */
export function planUpNext(day: PlanDay | null | undefined): { session: PlanDaySession; task: PlanTask } | null {
  if (!day || day.skipped) return null;
  for (const session of day.sessions) {
    for (const slot of session.slots) {
      if (slot.state === "todo" && slot.item.kind !== "open") return { session, task: planTask(slot) };
    }
  }
  return null;
}

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

/** A task the student wrote, for one sitting. Empty text is no task at all. */
export function ownPlanTask(label: string, sessionId: string, id = randomId()): PinnedPlanItem | null {
  const text = label.replace(/\s+/g, " ").trim().slice(0, MAX_OWN_TASK_LENGTH);
  if (!text) return null;
  return { actionId: `${OWN_TASK_PREFIX}${id}`, label: text, sessionId };
}

/** One of Jami's suggestions, kept by the student for one sitting. */
export function pinnedFromAction(action: StudyAction, sessionId: string): PinnedPlanItem {
  return {
    actionId: action.id,
    label: describeStudyAction(action).title,
    ...(action.destination?.href ? { href: action.destination.href } : {}),
    sessionId,
  };
}

/**
 * Another of Jami's suggestions for a sitting's subject, when the student asks
 * for one: the first the engine ranks that leads somewhere and is not already
 * in the day.
 */
export function nextPlanSuggestion(
  day: PlanDay,
  scopeKey: string,
  actionsByScope: ReadonlyMap<string, readonly StudyAction[]>
): StudyAction | null {
  const inDay = new Set(
    day.slots.flatMap((slot) =>
      slot.item.kind === "action" ? [slot.item.action.id] : slot.item.kind === "pinned" ? [slot.item.pinned.actionId] : []
    )
  );
  return (actionsByScope.get(scopeKey) ?? []).find((action) => action.destination && !inDay.has(action.id)) ?? null;
}
