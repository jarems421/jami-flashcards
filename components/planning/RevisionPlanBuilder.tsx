"use client";

import { useMemo, useState } from "react";
import { Button, Input } from "@/components/ui";
import {
  normalizeRevisionPlanDraft,
  PLAN_PROBLEM_MESSAGES,
} from "@/lib/planning/normalize-plan";
import { clampPlanMinutes } from "@/lib/planning/plan-schedule";
import {
  PLAN_WEEKDAY_LABELS,
  PLAN_WEEKDAYS,
  planScopeKey,
  type PlanWeekday,
  type RevisionPlanDraft,
  type RevisionPlanScope,
} from "@/lib/planning/types";

/**
 * The student building their own week.
 *
 * This is the primary way a plan is made, not the fallback. Jami can draft one
 * and often should, but a student knows their own timetable -- when they have
 * football, which exam is first, that Thursdays are useless -- and none of that
 * is in any evidence Jami holds. So the manual path is the one that has to be
 * good, and the drafted one arrives here to be edited anyway.
 *
 * Three decisions, in the order anyone would make them: what am I revising,
 * when, and until when. Everything inside the sessions is the Learning
 * Engine's, which is why there is nothing here about topics.
 */

const SESSION_LENGTHS = [20, 30, 45, 60, 90];

export type PlanScopeOption = {
  key: string;
  label: string;
  folderId?: string;
  deckId?: string;
};

function WeightDots({ weight }: { weight: number }) {
  return (
    <span aria-hidden="true" className="flex items-center gap-[3px]">
      {[1, 2, 3].map((step) => (
        <span
          key={step}
          className={`h-1.5 w-1.5 rounded-full transition ${
            step <= weight ? "bg-[var(--color-accent)]" : "bg-[var(--color-border-strong)]"
          }`}
        />
      ))}
    </span>
  );
}

export default function RevisionPlanBuilder({
  options,
  initial,
  saving,
  onSave,
  onCancel,
}: {
  options: readonly PlanScopeOption[];
  initial?: RevisionPlanDraft;
  saving?: boolean;
  onSave: (draft: RevisionPlanDraft) => void;
  onCancel?: () => void;
}) {
  const start = normalizeRevisionPlanDraft(initial).draft;
  const [title, setTitle] = useState(initial ? start.title : "");
  const [scopes, setScopes] = useState<RevisionPlanScope[]>(start.scopes);
  const [cadence, setCadence] = useState(start.cadence);
  const [startDayKey, setStartDayKey] = useState(start.startDayKey);
  const [endDayKey, setEndDayKey] = useState(start.endDayKey);
  /** One length for the whole week; a per-day length is a spreadsheet, not a plan. */
  const [minutes, setMinutes] = useState(start.cadence[0]?.minutes ?? 45);

  const chosen = useMemo(() => new Set(scopes.map(planScopeKey)), [scopes]);
  const days = useMemo(() => new Set(cadence.map((entry) => entry.weekday)), [cadence]);

  const draft: RevisionPlanDraft = useMemo(
    () => ({
      title: title.trim() || "Revision plan",
      status: "active",
      origin: initial?.origin ?? "manual",
      startDayKey,
      endDayKey,
      scopes,
      cadence: [...days].sort().map((weekday) => ({ weekday, minutes: clampPlanMinutes(minutes) })),
      emphasis: start.emphasis,
    }),
    [days, endDayKey, initial?.origin, minutes, scopes, start.emphasis, startDayKey, title]
  );

  const { problems } = normalizeRevisionPlanDraft(draft);

  const toggleScope = (option: PlanScopeOption) => {
    setScopes((current) => {
      const key = option.key;
      if (current.some((scope) => planScopeKey(scope) === key)) {
        return current.filter((scope) => planScopeKey(scope) !== key);
      }
      return [
        ...current,
        option.folderId
          ? { folderId: option.folderId, weight: 1 }
          : { deckId: option.deckId as string, weight: 1 },
      ];
    });
  };

  const cycleWeight = (key: string) =>
    setScopes((current) =>
      current.map((scope) =>
        planScopeKey(scope) === key
          ? { ...scope, weight: scope.weight >= 3 ? 1 : scope.weight + 1 }
          : scope
      )
    );

  const toggleDay = (weekday: PlanWeekday) =>
    setCadence((current) =>
      current.some((entry) => entry.weekday === weekday)
        ? current.filter((entry) => entry.weekday !== weekday)
        : [...current, { weekday, minutes: clampPlanMinutes(minutes) }]
    );

  return (
    <div className="space-y-7">
      <section className="space-y-2">
        <label
          htmlFor="plan-title"
          className="block text-xs font-semibold uppercase tracking-[0.18em] text-text-muted"
        >
          What is this for
        </label>
        <Input
          id="plan-title"
          value={title}
          maxLength={80}
          placeholder="Summer exams"
          className="text-lg"
          onChange={(event) => setTitle(event.target.value)}
        />
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
            What you&rsquo;re revising
          </h3>
          <p className="mt-1.5 text-sm leading-6 text-text-secondary">
            Tap a subject to include it. Tap its dots to give it more of the week.
          </p>
        </div>
        {options.length === 0 ? (
          <p className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-4 py-3 text-sm text-text-secondary">
            Make a folder or a deck first — a plan revises something.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {options.map((option) => {
              const active = chosen.has(option.key);
              const weight = scopes.find((scope) => planScopeKey(scope) === option.key)?.weight ?? 1;
              return (
                <span key={option.key} className="inline-flex">
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleScope(option)}
                    className={`min-h-11 rounded-full border px-4 text-sm font-semibold transition ${
                      active ? "app-selected" : "app-chip"
                    } ${active ? "rounded-r-none border-r-0 pr-3" : ""}`}
                  >
                    {option.label}
                  </button>
                  {active ? (
                    <button
                      type="button"
                      aria-label={`How much of the week ${option.label} takes`}
                      onClick={() => cycleWeight(option.key)}
                      className="app-selected min-h-11 rounded-full rounded-l-none border-l border-l-[var(--color-border-strong)] px-3"
                    >
                      <WeightDots weight={weight} />
                    </button>
                  ) : null}
                </span>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
            When you study
          </h3>
          <p className="mt-1.5 text-sm leading-6 text-text-secondary">
            Only the days you&rsquo;ll really sit down. An empty day is rest, not failure.
          </p>
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {PLAN_WEEKDAYS.map((weekday) => {
            const active = days.has(weekday);
            return (
              <button
                key={weekday}
                type="button"
                aria-pressed={active}
                aria-label={PLAN_WEEKDAY_LABELS[weekday]}
                onClick={() => toggleDay(weekday)}
                className={`min-h-12 rounded-2xl border text-xs font-semibold transition ${
                  active ? "app-selected" : "app-chip"
                }`}
              >
                {PLAN_WEEKDAY_LABELS[weekday].slice(0, 1)}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-sm text-text-secondary">Each session</span>
          {SESSION_LENGTHS.map((length) => (
            <button
              key={length}
              type="button"
              aria-pressed={minutes === length}
              onClick={() => setMinutes(length)}
              className={`min-h-9 rounded-full border px-3 text-xs font-semibold transition ${
                minutes === length ? "app-selected" : "app-chip"
              }`}
            >
              {length} min
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
          How long it runs
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            type="date"
            aria-label="Starts"
            value={startDayKey}
            onChange={(event) => setStartDayKey(event.target.value)}
          />
          <Input
            type="date"
            aria-label="Finishes"
            value={endDayKey}
            onChange={(event) => setEndDayKey(event.target.value)}
          />
        </div>
      </section>

      {problems.length > 0 ? (
        <ul className="space-y-1.5">
          {problems.map((problem) => (
            <li key={problem} className="text-sm leading-6 text-text-secondary">
              {PLAN_PROBLEM_MESSAGES[problem]}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-col-reverse gap-2 border-t border-[var(--color-border)] pt-5 sm:flex-row sm:justify-end">
        {onCancel ? (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button
          type="button"
          disabled={problems.length > 0 || saving}
          onClick={() => onSave(draft)}
        >
          {saving ? "Saving…" : initial ? "Save changes" : "Start this plan"}
        </Button>
      </div>
    </div>
  );
}
