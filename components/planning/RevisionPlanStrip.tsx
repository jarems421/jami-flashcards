"use client";

import Link from "next/link";
import { useMemo } from "react";
import { formatStudyDayLabel } from "@/lib/study/day";
import { planDaysBetween } from "@/lib/planning/plan-schedule";
import type { PlanDay, PlanSlot, RevisionPlan } from "@/lib/planning/types";

/**
 * Today's slice of the plan, at the top of Today.
 *
 * The one thing the strip must not become is a second opinion. Today already
 * proposes work from the Learning Engine, and a plan that argued with it would
 * leave a student choosing between two versions of Jami. So this shows the same
 * study actions the rest of the page draws on, arranged into the shape the
 * student asked for -- it is the same answer, laid out on their week.
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
      className={`relative grid h-6 w-6 shrink-0 place-items-center rounded-full border transition duration-fast ${
        done
          ? "border-transparent bg-[var(--color-accent)] text-accent-on shadow-accent"
          : "border-[var(--color-border-strong)] text-transparent group-hover:border-[var(--color-accent)]"
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

function SlotRow({
  slot,
  scopeName,
  onToggle,
}: {
  slot: PlanSlot;
  scopeName?: string;
  onToggle?: (slot: PlanSlot) => void;
}) {
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
            done ? "text-text-muted line-through decoration-[var(--color-border-strong)]" : "text-text-primary"
          }`}
        >
          <SlotLabel slot={slot} />
        </span>
        <span className="mt-0.5 block truncate text-2xs text-text-muted">
          {[scopeName, `${slot.minutes} min`].filter(Boolean).join(" · ")}
          {slot.completedBy === "activity" ? " · done" : ""}
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
    <li className="group flex items-center gap-3 rounded-2xl px-2 py-1.5 transition hover:bg-[var(--color-glass-subtle)]">
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={`Mark done`}
        disabled={locked || !onToggle}
        onClick={() => onToggle?.(slot)}
        className="group/mark -m-1 grid shrink-0 place-items-center rounded-full p-1 disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
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

export type RevisionPlanStripProps = {
  plan: RevisionPlan;
  day: PlanDay;
  /** Folder and deck names, so a slot can say which subject it belongs to. */
  scopeNames?: ReadonlyMap<string, string>;
  onToggleSlot?: (slot: PlanSlot) => void;
  planHref: string;
};

export default function RevisionPlanStrip({
  plan,
  day,
  scopeNames,
  onToggleSlot,
  planHref,
}: RevisionPlanStripProps) {
  const daysLeft = useMemo(
    () => Math.max(0, planDaysBetween(day.dayKey, plan.endDayKey)),
    [day.dayKey, plan.endDayKey]
  );
  const complete = day.scheduled && day.doneCount >= day.slots.length && day.slots.length > 0;

  return (
    <section
      aria-label="Today in your revision plan"
      className="app-panel relative px-5 py-4 sm:px-6 sm:py-5"
    >
      {/*
       * A thin band of accent light along the top edge, and nothing drawn. The
       * design system reserves star shapes for earned stars, so what atmosphere
       * there is comes from light and space -- never from minting another star.
       *
       * Anchored at the top and falling away downward. Anchored at the bottom of
       * its own band, as this was, the brightest part landed across the rows and
       * the strip read as washed rather than lit.
       */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-20 opacity-70"
        style={{
          background:
            "radial-gradient(70% 100% at 50% 0%, var(--color-accent-muted) 0%, transparent 70%)",
        }}
      />

      <div className="relative flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-text-muted">
            {complete ? "Today is done" : "Today in your plan"}
          </p>
          <h2 className="mt-1 truncate text-lg font-semibold tracking-tight text-text-primary">
            {plan.title}
          </h2>
        </div>
        <Link
          href={planHref}
          className="shrink-0 rounded-full px-1 text-xs font-semibold text-[var(--color-accent)] underline-offset-4 transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
        >
          {daysLeft > 0 ? `${daysLeft} days left` : "Last day"}
        </Link>
      </div>

      {day.scheduled && day.slots.length > 0 ? (
        <ul className="relative mt-3 space-y-0.5">
          {day.slots.map((slot) => (
            <SlotRow
              key={slot.id}
              slot={slot}
              scopeName={scopeNames?.get(slot.scopeKey)}
              onToggle={onToggleSlot}
            />
          ))}
        </ul>
      ) : (
        <p className="relative mt-2 text-sm leading-6 text-text-secondary">
          {day.skipped
            ? "You marked today off. Your plan picks up again next study day."
            : `Nothing scheduled today — your next session is on the plan. Rest counts.`}
        </p>
      )}

      {day.scheduled && day.slots.length > 0 ? (
        <p className="relative mt-3 text-2xs text-text-muted">
          {complete
            ? `All ${day.slots.length} done · ${formatStudyDayLabel(day.dayKey)}`
            : `${day.doneCount} of ${day.slots.length} done · ${day.minutes} min set aside`}
        </p>
      ) : null}
    </section>
  );
}
