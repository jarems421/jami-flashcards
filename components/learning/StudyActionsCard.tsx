"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, SectionHeader } from "@/components/ui";
import type { TodayStudyAction } from "@/lib/dashboard/today-plan";
import { getStudyDayKey } from "@/lib/study/day";
import { noteStudyActionEvent } from "@/services/learning/study-action-events";

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
}: {
  actions: TodayStudyAction[];
  uid: string;
}) {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const shownRef = useRef<Set<string>>(new Set());

  const visible = useMemo(
    () => actions.filter((action) => !dismissed.has(action.id)),
    [actions, dismissed]
  );

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

  return (
    <Card padding="lg">
      <SectionHeader eyebrow="From your recent work" title="Recommended for you" />
      <div className="mt-5 grid gap-3">
        {visible.map((action) => (
          <div
            key={action.id}
            className="app-subtle-panel rounded-lg p-4 transition duration-fast hover:-translate-y-[1px]"
          >
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <Link
                href={action.href}
                onClick={() => noteStudyActionEvent(uid, action, "started", getStudyDayKey())}
                className="min-w-0"
              >
                <div className="break-words text-sm font-semibold text-text-primary">
                  {action.title}
                </div>
                <p className="mt-1 text-sm leading-6 text-text-secondary">{action.description}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
                  {action.folderName ? (
                    <span className="break-words">{action.folderName}</span>
                  ) : null}
                  {action.folderName && action.targetItems ? <span aria-hidden>·</span> : null}
                  {action.targetItems ? <span>About {action.targetItems} to work through</span> : null}
                </div>
              </Link>
              <div className="flex items-center gap-2 justify-self-start sm:justify-self-end">
                <Link
                  href={action.href}
                  onClick={() => noteStudyActionEvent(uid, action, "started", getStudyDayKey())}
                  className="app-chip rounded-full px-3 py-1 text-xs font-semibold"
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
                  className="rounded-full px-2 py-1 text-xs font-semibold text-text-muted transition duration-fast hover:bg-[var(--color-surface-raised)] hover:text-text-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                >
                  Not now
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
