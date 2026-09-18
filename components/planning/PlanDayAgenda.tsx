"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Card, ProgressBar } from "@/components/ui";
import PlanWeekStrip from "@/components/planning/PlanWeekStrip";
import { planDaysBetween } from "@/lib/planning/plan-schedule";
import { nextScheduledPlanDay, type PlanWeek } from "@/lib/planning/plan-week";
import {
  PLAN_WEEKDAY_FULL_LABELS,
  type PlanDay,
  type PlanDaySession,
  type PlanSlot,
  type RevisionPlan,
} from "@/lib/planning/types";

/**
 * Today's slice of the plan, at the top of Today.
 *
 * The one thing this must not become is a second opinion. Today already
 * proposes work from the Learning Engine, and a plan that argued with it would
 * leave a student choosing between two versions of Jami. So this shows the same
 * study actions the rest of the page draws on, arranged into the shape the
 * student asked for -- it is the same answer, laid out on their week.
 *
 * What it used to be was one flat list under a title, which read as a reminder
 * rather than as a plan: nothing said what a session was, when it was, how many
 * there were, or that a week existed around it. So the day is drawn as a
 * timeline now -- one unbroken spine with the time down the left -- and the
 * week sits above it. The work inside is unchanged, and still chosen fresh on
 * the day.
 *
 * Calm rather than busy: the plan is read every morning, most mornings it says
 * roughly what it said yesterday, and a surface read that often earns its place
 * by being quiet.
 */

function SlotLabel({ slot }: { slot: PlanSlot }) {
  if (slot.item.kind === "pinned") return <>{slot.item.pinned.label}</>;
  if (slot.item.kind === "action") return <>{slot.item.action.target.label}</>;
  return <>Open study time</>;
}

function slotHref(slot: PlanSlot) {
  if (slot.item.kind === "pinned") return slot.item.pinned.href;
  if (slot.item.kind === "action") return slot.item.action.destination?.href;
  return undefined;
}

/** A tick that reads as lit rather than as a form control. */
function SlotMark({ slot }: { slot: PlanSlot }) {
  const done = slot.state === "done";
  return (
    <span
      aria-hidden="true"
      className={`relative grid h-6 w-6 shrink-0 place-items-center rounded-full border transition duration-normal ease-spring ${
        done
          ? "scale-105 border-transparent bg-[var(--color-accent)] text-accent-on shadow-accent"
          : "border-[var(--color-border-strong)] text-transparent group-hover:scale-105 group-hover:border-[var(--color-accent)]"
      }`}
    >
      <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
        <path
          d="m3.5 8.5 3 3 6-7"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function SlotRow({ slot, onToggle }: { slot: PlanSlot; onToggle?: (slot: PlanSlot) => void }) {
  const href = slotHref(slot);
  const done = slot.state === "done";
  /*
   * A slot Jami watched being done is not the student's to untick. Saying it
   * did not happen would not remove the work, and the tick is only ever
   * reporting what the rest of the app already recorded.
   */
  const locked = slot.completedBy === "activity" || slot.state === "skipped";

  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-sm font-medium transition ${
            done
              ? "text-text-muted line-through decoration-[var(--color-border-strong)]"
              : "text-text-primary"
          }`}
        >
          <SlotLabel slot={slot} />
        </span>
        <span className="mt-0.5 block truncate text-2xs text-text-muted">
          {slot.minutes} min
          {slot.item.kind === "pinned" ? " · you added this" : ""}
          {slot.completedBy === "activity" ? " · Jami saw this" : ""}
        </span>
      </span>
      {href && !done ? (
        <span
          aria-hidden="true"
          className="shrink-0 text-2xs font-semibold uppercase tracking-[0.14em] text-[var(--color-accent)] opacity-0 transition group-hover:opacity-100"
        >
          Open
        </span>
      ) : null}
    </>
  );

  return (
    <li className="group flex items-center gap-3 rounded-xl px-2 py-1.5 transition duration-fast hover:translate-x-[2px] hover:bg-[var(--color-glass-subtle)]">
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label="Mark done"
        disabled={locked || !onToggle}
        onClick={() => onToggle?.(slot)}
        className="-m-1 grid shrink-0 place-items-center rounded-full p-1 transition duration-fast ease-spring active:scale-90 disabled:cursor-default disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
      >
        <SlotMark slot={slot} />
      </button>
      {href ? (
        <Link
          href={href}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
        >
          {body}
        </Link>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-3">{body}</span>
      )}
    </li>
  );
}

/**
 * One sitting, on the spine.
 *
 * The time rail is what makes this read as a timetable rather than a list, and
 * it has to stay honest when there is no time: a sitting with no clock says
 * which number it is, because "Session 2" is true and an invented time is not.
 */
function SessionBlock({
  session,
  scopeName,
  total,
  onToggleSlot,
}: {
  session: PlanDaySession;
  scopeName?: string;
  total: number;
  onToggleSlot?: (slot: PlanSlot) => void;
}) {
  return (
    <li className="relative pl-[4.75rem] sm:pl-[5.5rem]">
      {/* The rail sits outside the flow so the work beside it can wrap freely. */}
      <div className="absolute left-0 top-0 w-[3.75rem] text-right sm:w-[4.5rem]">
        {session.startTime ? (
          <>
            <p className="text-sm font-semibold tabular-nums tracking-tight text-text-primary transition duration-fast">
              {session.startTime}
            </p>
            {session.endTime ? (
              <p className="mt-0.5 text-2xs tabular-nums text-text-muted">{session.endTime}</p>
            ) : null}
          </>
        ) : (
          <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-text-muted">
            {total > 1 ? `Session ${session.index + 1}` : "Session"}
          </p>
        )}
      </div>

      {/*
       * No node on the spine.
       *
       * There was a small glowing circle per sitting, which read as a bullet
       * competing with the tick beside every piece of work below it -- two
       * circles in a column, one of them meaningless. The line alone carries
       * the day.
       */}

      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h3 className="truncate text-sm font-semibold text-text-primary">
            {session.label || scopeName || "Study"}
          </h3>
          <p className="text-2xs text-text-muted">
            {session.minutes} min
            {session.label && scopeName ? ` · ${scopeName}` : ""}
          </p>
        </div>
        <ul className="mt-1.5 space-y-0.5">
          {session.slots.map((slot) => (
            <SlotRow key={slot.id} slot={slot} onToggle={onToggleSlot} />
          ))}
        </ul>
      </div>
    </li>
  );
}

export type PlanDayAgendaProps = {
  plan: RevisionPlan;
  day: PlanDay;
  /** The week this day sits in, for the strip above the agenda. */
  week?: PlanWeek | null;
  /** Folder and deck names, so a sitting can say which subject it belongs to. */
  scopeNames?: ReadonlyMap<string, string>;
  onToggleSlot?: (slot: PlanSlot) => void;
  planHref: string;
};

export default function PlanDayAgenda({
  plan,
  day,
  week,
  scopeNames,
  onToggleSlot,
  planHref,
}: PlanDayAgendaProps) {
  const daysLeft = useMemo(
    () => Math.max(0, planDaysBetween(day.dayKey, plan.endDayKey)),
    [day.dayKey, plan.endDayKey]
  );
  const ahead = useMemo(() => nextScheduledPlanDay(plan, day.dayKey), [day, plan]);
  const complete = day.scheduled && day.slots.length > 0 && day.doneCount >= day.slots.length;
  const hasAgenda = day.scheduled && day.sessions.length > 0;

  const aheadLine = ahead
    ? `${PLAN_WEEKDAY_FULL_LABELS[ahead.weekday]} · ${
        ahead.sessions.length > 1 ? `${ahead.sessions.length} sessions, ` : ""
      }${ahead.minutes} min`
    : null;

  return (
    <Card padding="md" className="relative overflow-hidden">
      {/*
       * A slow wash of light along the top edge, and nothing drawn. The design
       * system reserves star shapes for earned stars, so what atmosphere there
       * is comes from light and space -- never from minting another star. It
       * drifts over about half a minute, which is slow enough to be felt rather
       * than watched.
       */}
      <div aria-hidden="true" className="plan-aurora" />

      <div className="relative">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <p
              className={`text-2xs font-semibold uppercase tracking-[0.18em] transition duration-slow ${
                complete ? "text-[var(--color-accent)]" : "text-text-muted"
              }`}
            >
              {complete ? "Today is done" : "Today in your plan"}
            </p>
            <h2 className="mt-1 truncate text-lg font-semibold tracking-tight text-text-primary">
              {plan.title}
            </h2>
          </div>
          <div className="shrink-0 text-right">
            {hasAgenda ? (
              <p className="text-sm font-semibold tabular-nums text-text-primary">
                {day.doneCount} of {day.slots.length}
              </p>
            ) : null}
            <Link
              href={planHref}
              className="rounded-full text-2xs font-semibold text-[var(--color-accent)] underline-offset-4 transition duration-fast hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
            >
              {daysLeft > 0 ? `${daysLeft} days left` : "Last day"}
            </Link>
          </div>
        </div>

        {/* The day's progress as one quiet line, rather than a second number to
            read. It fills as slots are ticked, so the card visibly responds to
            the work instead of only relabelling itself. */}
        {hasAgenda ? (
          <div className="mt-3">
            <ProgressBar
              grow
              size="sm"
              progress={(day.doneCount / Math.max(1, day.slots.length)) * 100}
            />
          </div>
        ) : null}

        {week ? (
          <div className="mt-4 border-y border-[var(--color-border)] py-3">
            <PlanWeekStrip week={week} planHref={planHref} />
          </div>
        ) : null}

        {hasAgenda ? (
          <div className="relative mt-4">
            {/* One spine behind every node, stopping at the last one rather
                than trailing off past the end of the day. Light travels down it
                every few seconds -- the day has a direction, and this is the
                cheapest way to say so. */}
            <span
              aria-hidden="true"
              className="plan-spine bottom-3 left-[4.4rem] top-3 sm:left-[5.15rem]"
            />
            <ul className="app-rise space-y-5">
              {day.sessions.map((session) => (
                <SessionBlock
                  key={session.id}
                  session={session}
                  total={day.sessions.length}
                  scopeName={scopeNames?.get(session.scopeKey)}
                  onToggleSlot={onToggleSlot}
                />
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-3 text-sm leading-6 text-text-secondary">
            {day.skipped
              ? "You marked today off. Your plan picks up again next study day."
              : "Nothing scheduled today — your next session is on the plan. Rest counts."}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-[var(--color-border)] pt-3">
          <p className="text-2xs text-text-muted">
            {hasAgenda
              ? `${day.minutes} min set aside${
                  day.sessions.length > 1 ? ` across ${day.sessions.length} sessions` : ""
                }`
              : "No sessions today"}
          </p>
          {aheadLine ? (
            <p className="text-2xs text-text-muted">
              <span className="font-semibold uppercase tracking-[0.12em]">Next</span> · {aheadLine}
            </p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
