"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TodayStudyAction } from "@/lib/dashboard/today-plan";
import { getStudyDayKey } from "@/lib/study/day";
import { noteMissionStarted } from "@/lib/learning/mission-handoff";
import { noteStudyActionEvent } from "@/services/learning/study-action-events";

function capitalise(text: string) {
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text;
}

/**
 * What to do next, from the student's own recorded work.
 *
 * Only actions Jami can actually open are listed, each with the reason it was
 * chosen, and the list stays short: a surface that always has five more things
 * to do stops being read.
 *
 * This is also where the Learning Engine's loop closes. Until now the engine
 * spoke and never heard back, so it would repeat itself until unrelated
 * evidence happened to arrive, and there was no way to ask whether any of its
 * advice helped. Three things are recorded here:
 *
 * - `shown`, once per action per study day, so a recommendation counts as
 *   given whether or not the student passed it eleven times.
 * - `started`, when they open it. The surface that does the work records
 *   `completed` separately; opening a session is not finishing one.
 * - `dismissed`, when they say no. Three refusals rest the advice for a
 *   fortnight, because a student refusing the same suggestion repeatedly is
 *   telling the engine something its evidence does not contain.
 *
 * Every write is fire-and-forget. A record that fails is a record lost, which
 * is a far smaller harm than a link that hesitates under a student's finger.
 */
export default function StudyActionsCard({
  actions,
  uid,
  onGenerate,
  generatingId = null,
}: {
  actions: TodayStudyAction[];
  uid: string;
  /**
   * Offered for an action whose answer is for Jami to write the material.
   *
   * Absent, those actions keep their link and behave like any other: the
   * surface they lead to is still the right place to be. The button is an
   * extra route, never the only one.
   */
  onGenerate?: (action: TodayStudyAction) => void;
  /** The action currently being written, so it cannot be asked for twice. */
  generatingId?: string | null;
}) {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const shownRef = useRef<Set<string>>(new Set());

  const visible = useMemo(
    () => actions.filter((action) => !dismissed.has(action.id)),
    [actions, dismissed]
  );

  /*
   * Opening a recommendation, recorded twice for two different readers.
   *
   * The event is evidence the engine reads, and rests the advice until newer
   * evidence arrives. The handoff is a note to Today, so that finishing this
   * work is acknowledged when the student comes back.
   *
   * Both, or the loop is only half closed for anything started from this list:
   * the session would offer a way back to a page that had no idea where the
   * student had been.
   */
  const start = (action: TodayStudyAction) => {
    noteStudyActionEvent(uid, action, "started", getStudyDayKey());
    noteMissionStarted({
      actionId: action.id,
      headline: action.title,
      conceptLabel: action.target.label,
      ...(action.targetItems !== undefined ? { targetItems: action.targetItems } : {}),
    });
  };

  useEffect(() => {
    if (!uid) return;
    const studyDayKey = getStudyDayKey();
    for (const action of visible) {
      /*
       * Once per action per mount as well as per day. The write is already
       * deduplicated by its id, but there is no reason to send it again on
       * every render of a page a student leaves open.
       */
      if (shownRef.current.has(action.id)) continue;
      shownRef.current.add(action.id);
      noteStudyActionEvent(uid, action, "shown", studyDayKey);
    }
  }, [uid, visible]);

  if (visible.length === 0) return null;

  /*
   * One line each: the topic, where it is and why, and what to press. They sit
   * in the "Jami suggests" panel under the next step, so they are drawn as the
   * rest of a list rather than as cards of their own.
   */
  return (
    <ul className="divide-y divide-[var(--color-border)]">
      {visible.map((action) => (
        <li key={action.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-1 py-3 sm:flex-nowrap">
          <Link
            href={action.href}
            onClick={() => start(action)}
            className="min-w-0 flex-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
          >
            <span className="block truncate text-sm font-semibold text-text-primary">
              {capitalise(action.target.label)}
            </span>
            <span className="mt-0.5 block truncate text-xs text-text-muted">
              {[action.folderName, action.description].filter(Boolean).join(" · ")}
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-1.5">
            {action.generate && onGenerate ? (
              <button
                type="button"
                disabled={generatingId !== null}
                onClick={() => onGenerate(action)}
                className="app-selected min-h-8 rounded-full px-3 text-xs font-semibold transition duration-fast disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
              >
                {generatingId === action.id
                  ? "Writing…"
                  : action.generate.kind === "create_flashcards"
                    ? "Make cards"
                    : "Create practice"}
              </button>
            ) : null}
            <Link
              href={action.href}
              onClick={() => start(action)}
              className="inline-flex min-h-8 items-center rounded-full border border-[var(--color-border-strong)] px-3 text-xs font-semibold text-text-primary transition duration-fast hover:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
            >
              {action.label}
            </Link>
            <button
              type="button"
              aria-label={`Not now: ${action.title}`}
              title="Not now"
              onClick={() => {
                noteStudyActionEvent(uid, action, "dismissed", getStudyDayKey());
                setDismissed((current) => new Set(current).add(action.id));
              }}
              className="min-h-8 rounded-full px-2 text-xs font-semibold text-text-muted transition duration-fast hover:bg-[var(--color-glass-subtle)] hover:text-text-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
            >
              Not now
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
