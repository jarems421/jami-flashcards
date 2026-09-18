"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui";
import PlanWeightDots from "@/components/planning/PlanWeightDots";
import type { PlanScopeOption } from "@/components/planning/RevisionPlanBuilder";
import { normalizeRevisionPlanDraft, PLAN_PROBLEM_MESSAGES } from "@/lib/planning/normalize-plan";
import { planSessionEndTime } from "@/lib/planning/plan-schedule";
import {
  PLAN_WEEKDAY_FULL_LABELS,
  PLAN_WEEKDAY_LABELS,
  PLAN_WEEKDAYS,
  planScopeKey,
  type PlanWeekday,
  type RevisionPlanDraft,
} from "@/lib/planning/types";

/**
 * The plan taking shape, beside the conversation that is shaping it.
 *
 * Jami used to propose a plan and the chat would vanish, replaced wholesale by
 * the builder -- so a student never saw the thing being built, only the moment
 * it was finished and handed over. Everything they had said scrolled away with
 * it, and asking for one small change meant going back and starting the
 * conversation again.
 *
 * So the plan lives here throughout, empty at first and filling in as they
 * talk, and the two ways out are always on it: edit any part of it by hand, or
 * start it. Neither waits for Jami to decide it is finished, because it is not
 * Jami's to finish.
 *
 * A reading, not a form. Every control here either opens the builder or saves;
 * the editing itself belongs in one place, and that place is the builder.
 */

function isEmptyDraft(draft: RevisionPlanDraft) {
  return draft.scopes.length === 0 && draft.sessions.length === 0;
}

function WeekRow({ draft }: { draft: RevisionPlanDraft }) {
  const byWeekday = useMemo(() => {
    const minutes = new Map<PlanWeekday, number>();
    for (const session of draft.sessions) {
      minutes.set(session.weekday, (minutes.get(session.weekday) ?? 0) + session.minutes);
    }
    return minutes;
  }, [draft.sessions]);

  return (
    <ul className="grid grid-cols-7 gap-1">
      {PLAN_WEEKDAYS.map((weekday) => {
        const minutes = byWeekday.get(weekday) ?? 0;
        const studying = minutes > 0;
        return (
          <li
            key={weekday}
            className={`flex min-w-0 flex-col items-center gap-1 rounded-lg border px-0.5 py-1.5 transition duration-fast ${
              studying ? "app-selected" : "border-[var(--color-border)]"
            }`}
          >
            <span className="text-2xs font-semibold uppercase tracking-[0.1em]">
              {PLAN_WEEKDAY_LABELS[weekday].slice(0, 1)}
            </span>
            <span className="text-2xs tabular-nums text-text-muted">
              {studying ? `${minutes}m` : "—"}
            </span>
            <span className="sr-only">
              {PLAN_WEEKDAY_FULL_LABELS[weekday]}:{" "}
              {studying ? `${minutes} minutes` : "no study planned"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function SessionLines({
  draft,
  scopeNames,
}: {
  draft: RevisionPlanDraft;
  scopeNames: ReadonlyMap<string, string>;
}) {
  // Only worth listing when there is something a week row cannot show: a clock
  // time, or a sitting tied to one subject.
  const detailed = draft.sessions.filter((session) => session.startTime || session.scopeKey);
  if (detailed.length === 0) return null;

  return (
    <ul className="mt-2.5 space-y-1">
      {detailed.map((session) => {
        const endTime = session.startTime
          ? planSessionEndTime(session.startTime, session.minutes)
          : undefined;
        return (
          <li key={session.id} className="flex items-baseline gap-2 text-2xs">
            <span className="w-8 shrink-0 font-semibold uppercase tracking-[0.1em] text-text-muted">
              {PLAN_WEEKDAY_LABELS[session.weekday]}
            </span>
            <span className="tabular-nums text-text-primary">
              {session.startTime ? `${session.startTime}${endTime ? `–${endTime}` : ""}` : "Any time"}
            </span>
            <span className="min-w-0 flex-1 truncate text-text-muted">
              {session.scopeKey ? (scopeNames.get(session.scopeKey) ?? "A subject you removed") : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export type PlanDraftPreviewProps = {
  draft: RevisionPlanDraft;
  options: readonly PlanScopeOption[];
  /**
   * Changes whenever Jami proposed something, so the panel can show that it
   * moved. A student watching the conversation should not have to compare it
   * against what they remember.
   */
  changeKey?: number;
  saving?: boolean;
  onEdit: () => void;
  onStart: () => void;
};

export default function PlanDraftPreview({
  draft,
  options,
  changeKey = 0,
  saving = false,
  onEdit,
  onStart,
}: PlanDraftPreviewProps) {
  const scopeNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const option of options) names.set(option.key, option.label);
    return names;
  }, [options]);

  const { problems, valid } = useMemo(() => normalizeRevisionPlanDraft(draft), [draft]);
  const empty = isEmptyDraft(draft);
  const perWeek = draft.sessions.reduce((total, session) => total + session.minutes, 0);

  return (
    <section
      aria-label="Your plan so far"
      className="app-panel relative overflow-hidden px-4 py-4 sm:px-5 sm:py-5"
    >
      <div aria-hidden="true" className="plan-aurora" />

      <div className="relative">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-text-muted">
            {empty ? "Your plan" : "Your plan so far"}
          </p>
          {!empty && perWeek > 0 ? (
            <p className="text-2xs tabular-nums text-text-muted">
              {perWeek >= 60 ? `about ${Math.round(perWeek / 60)}h a week` : `${perWeek} min a week`}
            </p>
          ) : null}
        </div>

        {empty ? (
          <p className="mt-2 text-sm leading-6 text-text-secondary">
            Nothing here yet. Tell Jami what you&rsquo;re working towards and this fills in as
            you talk — or set it out yourself.
          </p>
        ) : (
          /* Keyed on the change so a proposal animates in and the student can
             see that something moved without re-reading the whole panel. */
          <div key={changeKey} className="plan-sweep">
            <h3 className="mt-1 truncate text-lg font-semibold tracking-tight text-text-primary">
              {draft.title}
            </h3>

            {draft.scopes.length > 0 ? (
              <ul className="app-rise mt-3 flex flex-wrap gap-1.5">
                {draft.scopes.map((scope) => {
                  const key = planScopeKey(scope);
                  return (
                    <li
                      key={key}
                      className="app-chip flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold"
                    >
                      <span className="truncate">
                        {scopeNames.get(key) ?? "A subject you removed"}
                      </span>
                      <PlanWeightDots weight={scope.weight} />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-3 text-sm leading-6 text-text-secondary">
                No subjects chosen yet.
              </p>
            )}

            <div className="mt-4">
              <WeekRow draft={draft} />
              <SessionLines draft={draft} scopeNames={scopeNames} />
            </div>

            <p className="mt-3 text-2xs text-text-muted">
              {draft.startDayKey} to {draft.endDayKey}
            </p>
          </div>
        )}

        {problems.length > 0 && !empty ? (
          <ul className="mt-3 space-y-1">
            {problems.map((problem) => (
              <li key={problem} className="text-2xs leading-5 text-text-secondary">
                {PLAN_PROBLEM_MESSAGES[problem]}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-4 flex flex-col-reverse gap-2 border-t border-[var(--color-border)] pt-4 sm:flex-row">
          <Button type="button" variant="secondary" size="sm" onClick={onEdit}>
            {empty ? "Build it myself" : "Edit details"}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!valid || saving}
            onClick={onStart}
            className="sm:ml-auto"
          >
            {saving ? "Starting…" : "Start this plan"}
          </Button>
        </div>

        {!valid && !empty ? (
          <p className="mt-2 text-2xs leading-5 text-text-muted">
            A plan needs a subject and at least one day before it can start.
          </p>
        ) : null}
      </div>
    </section>
  );
}
