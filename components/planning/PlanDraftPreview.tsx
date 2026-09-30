"use client";

import { useMemo, type ReactNode } from "react";
import { Button } from "@/components/ui";
import PlanWeightDots from "@/components/planning/PlanWeightDots";
import type { PlanScopeOption } from "@/components/planning/RevisionPlanBuilder";
import { planScopeColor } from "@/lib/planning/plan-colors";
import {
  PLAN_PRIORITY_LABELS,
  planStepStatus,
  shortPlanDate,
  type PlanInterviewStep,
} from "@/lib/planning/plan-interview";
import { planDaysBetween, planSessionEndTime } from "@/lib/planning/plan-schedule";
import {
  PLAN_WEEKDAY_FULL_LABELS,
  PLAN_WEEKDAY_LABELS,
  PLAN_WEEKDAYS,
  planScopeKey,
  type PlanWeekday,
  type RevisionPlanDraft,
} from "@/lib/planning/types";
import { getStudyDayKey } from "@/lib/study/day";

/**
 * The plan being built, as an outline that fills in.
 *
 * It used to sit empty until Jami proposed a whole plan, and then the whole
 * plan arrived at once -- the student never watched anything being built. Now
 * every section is on screen from the start, waiting, and fills in as its
 * question is answered: exams appear with their countdowns, subjects arrive
 * one by one, days light up as they are tapped. The section Jami is asking
 * about is marked, and any finished one can be reopened with Change.
 *
 * A reading, not a form: the editing happens by answering Jami, or in the full
 * builder behind "Edit by hand".
 */

type SectionStatus = "done" | "current" | "waiting";

function StatusMark({ status }: { status: SectionStatus }) {
  if (status === "done") {
    return (
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--color-accent)] text-accent-on">
        <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3">
          <path d="m2.5 6.2 2.2 2.2 4.8-4.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  return (
    <span
      className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${
        status === "current"
          ? "plan-outline-current border-[var(--color-accent)]"
          : "border-[var(--color-border-strong)]"
      }`}
    >
      {status === "current" ? <span className="h-2 w-2 rounded-full bg-[var(--color-accent)]" /> : null}
    </span>
  );
}

/** Where a section's content will go, before its question is answered. */
function Placeholder({ text }: { text: string }) {
  return (
    <p className="rounded-xl border border-dashed border-[var(--color-border)] px-3 py-2.5 text-xs leading-5 text-text-muted">
      {text}
    </p>
  );
}

function Section({
  title,
  status,
  last = false,
  onChange,
  children,
}: {
  title: string;
  status: SectionStatus;
  last?: boolean;
  onChange?: () => void;
  children: ReactNode;
}) {
  return (
    <li className="relative flex gap-3.5">
      {/* The line down the outline, from this step to the next. */}
      {!last ? (
        <span
          aria-hidden="true"
          className={`absolute bottom-0 left-3 top-7 w-px -translate-x-1/2 transition-colors duration-slow ${
            status === "done" ? "bg-[var(--color-accent)]" : "bg-[var(--color-border)]"
          }`}
        />
      ) : null}
      <StatusMark status={status} />
      <div className={`min-w-0 flex-1 ${last ? "" : "pb-6"}`}>
        <div className="flex min-h-6 items-center justify-between gap-3">
          <h4
            className={`text-sm font-semibold tracking-tight ${
              status === "waiting" ? "text-text-muted" : "text-text-primary"
            }`}
          >
            {title}
            {status === "current" ? (
              <span className="ml-2 text-2xs font-medium text-[var(--color-accent)]">Jami&rsquo;s asking</span>
            ) : null}
          </h4>
          {onChange && status === "done" ? (
            <button
              type="button"
              onClick={onChange}
              aria-label={`Change ${title.toLowerCase()}`}
              className="rounded-lg px-2 py-1 text-xs font-semibold text-[var(--color-accent)] transition hover:bg-[var(--color-glass-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
            >
              Change
            </button>
          ) : null}
        </div>
        <div className="mt-2.5">{children}</div>
      </div>
    </li>
  );
}

function GoalContent({ draft, status }: { draft: RevisionPlanDraft; status: SectionStatus }) {
  const today = getStudyDayKey();
  const exams = draft.exams ?? [];
  if (exams.length === 0) {
    return status === "done" ? (
      <p className="plan-build-in text-sm text-text-secondary">
        No exams — until <span className="font-semibold text-text-primary">{shortPlanDate(draft.endDayKey)}</span>
      </p>
    ) : (
      <Placeholder text="Your exams and the date you want to be ready by." />
    );
  }
  return (
    <ul className="space-y-1.5">
      {exams.map((exam) => {
        const days = planDaysBetween(today, exam.dayKey);
        return (
          <li
            key={exam.id}
            className="plan-build-in flex items-baseline justify-between gap-3 rounded-xl bg-[var(--color-glass-subtle)] px-3 py-2"
          >
            <span className="min-w-0 truncate text-sm font-medium text-text-primary">{exam.label}</span>
            <span className="shrink-0 text-xs tabular-nums text-text-muted">
              {shortPlanDate(exam.dayKey)}
              {days >= 0 ? ` · ${days === 0 ? "today" : `${days}d`}` : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function SubjectContent({
  draft,
  scopeNames,
}: {
  draft: RevisionPlanDraft;
  scopeNames: ReadonlyMap<string, string>;
}) {
  if (draft.scopes.length === 0) return <Placeholder text="Which subjects, and which need the most time." />;
  return (
    <ul className="space-y-1.5">
      {draft.scopes.map((scope) => {
        const key = planScopeKey(scope);
        const weight = Math.min(3, Math.max(1, scope.weight)) as 1 | 2 | 3;
        return (
          <li key={key} className="plan-build-in flex items-center gap-2.5 rounded-xl bg-[var(--color-glass-subtle)] px-3 py-2">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: planScopeColor(draft, key) }}
            />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
              {scopeNames.get(key) ?? "A subject you removed"}
            </span>
            {/* Keyed so a change of weight settles in rather than snapping. */}
            <span key={weight} className="plan-build-in flex shrink-0 items-center gap-2 text-2xs text-text-muted">
              {PLAN_PRIORITY_LABELS[weight]}
              <PlanWeightDots weight={weight} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function WeekContent({
  draft,
  scopeNames,
}: {
  draft: RevisionPlanDraft;
  scopeNames: ReadonlyMap<string, string>;
}) {
  const byWeekday = useMemo(() => {
    const minutes = new Map<PlanWeekday, number>();
    for (const session of draft.sessions) {
      minutes.set(session.weekday, (minutes.get(session.weekday) ?? 0) + session.minutes);
    }
    return minutes;
  }, [draft.sessions]);
  const timed = draft.sessions.filter((session) => session.startTime || session.scopeKey);

  return (
    <div className="space-y-2.5">
      <ul className="grid grid-cols-7 gap-1">
        {PLAN_WEEKDAYS.map((weekday) => {
          const minutes = byWeekday.get(weekday) ?? 0;
          const studying = minutes > 0;
          return (
            <li
              // Remounted when the day turns on, so it lights up as it is tapped.
              key={`${weekday}-${studying}`}
              className={`flex min-w-0 flex-col items-center gap-1 rounded-xl border px-0.5 py-2 ${
                studying ? "plan-build-in app-selected" : "border-dashed border-[var(--color-border)]"
              }`}
            >
              <span aria-hidden="true" className="text-2xs font-semibold">
                {PLAN_WEEKDAY_LABELS[weekday]}
              </span>
              <span aria-hidden="true" className="text-2xs tabular-nums text-text-muted">
                {studying ? `${minutes}m` : "—"}
              </span>
              <span className="sr-only">
                {PLAN_WEEKDAY_FULL_LABELS[weekday]}: {studying ? `${minutes} minutes` : "no study planned"}
              </span>
            </li>
          );
        })}
      </ul>
      {timed.length > 0 ? (
        <ul className="space-y-1">
          {timed.map((session) => {
            const endTime = session.startTime ? planSessionEndTime(session.startTime, session.minutes) : undefined;
            return (
              <li key={session.id} className="plan-build-in flex items-baseline gap-2 text-2xs">
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
      ) : null}
    </div>
  );
}

export type PlanDraftPreviewProps = {
  draft: RevisionPlanDraft;
  options: readonly PlanScopeOption[];
  /** The question Jami is on, which decides what is done and what is waiting. */
  step: PlanInterviewStep;
  onEdit: () => void;
  /** Reopens a finished section's question. */
  onJumpToStep?: (step: PlanInterviewStep) => void;
};

export default function PlanDraftPreview({ draft, options, step, onEdit, onJumpToStep }: PlanDraftPreviewProps) {
  const scopeNames = useMemo(() => new Map(options.map((option) => [option.key, option.label])), [options]);
  const perWeek = draft.sessions.reduce((total, session) => total + session.minutes, 0);
  const status = (section: PlanInterviewStep): SectionStatus => planStepStatus(section, step);
  const finalStatus: SectionStatus = step === "extras" || step === "review" ? "current" : "waiting";
  const reopen = (section: PlanInterviewStep) => (onJumpToStep ? () => onJumpToStep(section) : undefined);
  const named = status("goal") === "done" || draft.title !== "Revision plan";

  return (
    <section aria-label="Your plan so far" className="app-panel relative overflow-hidden px-5 py-5 sm:px-6 sm:py-6">
      <div aria-hidden="true" className="plan-aurora" />

      <div className="relative">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-text-muted">
            {step === "review" ? "Ready for a last check" : "Your plan · building"}
          </p>
          {perWeek > 0 ? (
            <p key={perWeek} className="plan-build-in text-2xs tabular-nums text-text-muted">
              {perWeek >= 60 ? `about ${Math.round(perWeek / 60)}h a week` : `${perWeek} min a week`}
            </p>
          ) : null}
        </div>
        <h3
          key={named ? draft.title : "untitled"}
          className={`plan-build-in mt-1 truncate text-lg font-semibold tracking-tight ${
            named ? "text-text-primary" : "text-text-muted"
          }`}
        >
          {named ? draft.title : "Your revision plan"}
        </h3>

        <ol className="mt-5">
          <Section title="Working towards" status={status("goal")} onChange={reopen("goal")}>
            <GoalContent draft={draft} status={status("goal")} />
          </Section>
          <Section title="Subjects" status={status("subjects")} onChange={reopen("subjects")}>
            <SubjectContent draft={draft} scopeNames={scopeNames} />
          </Section>
          <Section title="Your week" status={status("time")} onChange={reopen("time")}>
            {draft.sessions.length > 0 || status("time") !== "waiting" ? (
              <WeekContent draft={draft} scopeNames={scopeNames} />
            ) : (
              <Placeholder text="The days you'll study, and for how long." />
            )}
          </Section>
          <Section title="Last check" status={finalStatus} last>
            <p className="text-xs leading-5 text-text-muted">
              {step === "review"
                ? "Anything to change or add? Tell Jami, or start it."
                : step === "extras"
                  ? "Anything else to fit around, then one last look before it starts."
                  : "Before it starts, Jami asks if anything's missing."}
            </p>
          </Section>
        </ol>

        <div className="mt-5 flex items-center justify-between gap-3 border-t border-[var(--color-border)] pt-4">
          <p className="text-2xs leading-5 text-text-muted">Rather set it out yourself?</p>
          <Button type="button" variant="secondary" size="sm" onClick={onEdit}>
            Edit by hand
          </Button>
        </div>
      </div>
    </section>
  );
}
