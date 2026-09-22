import Link from "next/link";
import type { PlanDay, PlanSlot } from "@/lib/planning/types";

/**
 * How much, and on what -- never why.
 *
 * The division this component exists to hold: the Learning Engine decides what
 * is worth doing and the plan decides when and how much of it. Today already
 * shows the engine's answer at full size, so a plan that also argued about
 * what to work on would leave a student choosing between two versions of Jami
 * on one screen.
 *
 * So this is minutes and names. No reasons, no evidence, no recommendation
 * wording, and nothing that could be read as a second opinion. The full day,
 * with its sessions and its ticks, is a page away.
 */

const MAX_VISIBLE_SLOTS = 3;

function slotLabel(slot: PlanSlot) {
  if (slot.item.kind === "pinned") return slot.item.pinned.label;
  if (slot.item.kind === "action") return slot.item.action.target.label;
  return "Open study time";
}

export default function PlanSummary({
  day,
  planHref,
  scopeName,
}: {
  day: PlanDay;
  planHref: string;
  /** The subject a slot belongs to, where the plan is scoped by folder. */
  scopeName?: (slot: PlanSlot) => string | undefined;
}) {
  const visible = day.slots.slice(0, MAX_VISIBLE_SLOTS);
  const overflow = day.slots.length - visible.length;

  return (
    <div className="app-subtle-panel rounded-xl p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-2xs font-semibold uppercase tracking-[0.16em] text-text-muted">
          Your plan
        </span>
        <span className="text-2xs tabular-nums text-text-muted">
          {day.doneCount} / {day.slots.length} done
        </span>
      </div>

      {day.scheduled && day.slots.length > 0 ? (
        <>
          <div className="mt-3 text-sm font-semibold text-text-primary tabular-nums">
            Today · {day.minutes} min
          </div>
          <ul className="mt-3 grid gap-2">
            {visible.map((slot) => {
              const scope = scopeName?.(slot);
              return (
                <li key={slot.id} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm text-text-secondary">
                    {slotLabel(slot)}
                    {scope ? (
                      <span className="text-text-muted"> · {scope}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-text-muted">
                    {slot.minutes} min
                  </span>
                </li>
              );
            })}
          </ul>
          {overflow > 0 ? (
            <p className="mt-2 text-xs text-text-muted">
              and {overflow} more {overflow === 1 ? "slot" : "slots"}
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-3 text-sm leading-6 text-text-muted">
          {day.skipped ? "You marked today as a rest day." : "Nothing scheduled for today."}
        </p>
      )}

      <Link
        href={planHref}
        className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-text-secondary transition duration-fast hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
      >
        <span>View plan</span>
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="h-3.5 w-3.5"
        >
          <path d="M3.5 8h9" />
          <path d="m8.5 3 4.5 5-4.5 5" />
        </svg>
      </Link>
    </div>
  );
}
