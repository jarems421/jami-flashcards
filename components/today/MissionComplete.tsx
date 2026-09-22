import type { MissionCompletionCopy } from "@/lib/dashboard/today-mission";

/**
 * What the student did, shown at the top of what they should do next.
 *
 * Inside the mission card rather than above it, and that is the whole design.
 * A banner would say "you finished something" and the recommendation below
 * would be a separate, unrelated-looking suggestion; in one card the student
 * reads the two together -- *this is done, so this is next* -- which is the
 * only place the Learning Engine's loop is ever actually visible to them.
 *
 * It also means there is nothing to dismiss. The handoff behind it is read
 * once, so it is gone by their next visit without anybody having to close it.
 *
 * **Not the eight-ray star.** The obvious flourish here would be minting one,
 * and it would be wrong: in Jami a star means a goal was completed, nothing
 * else mints one, and a star that arrives for finishing a revision session
 * would quietly devalue every star the student actually earned. The mark used
 * instead is the plan's own done-tick, which already means "this piece of work
 * happened" everywhere else in the app.
 */

function DoneMark({ complete }: { complete: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`mission-done-mark relative grid h-7 w-7 shrink-0 place-items-center rounded-full border ${
        complete
          ? "border-transparent bg-[var(--color-accent)] text-accent-on shadow-accent"
          : "border-[var(--color-border-strong)] text-text-secondary"
      }`}
    >
      <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4">
        <path
          d={complete ? "m3.5 8.5 3 3 6-7" : "M4 8h8"}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export default function MissionComplete({ copy }: { copy: MissionCompletionCopy }) {
  return (
    <div className="mission-complete border-b border-[var(--color-border)] pb-6">
      <div className="flex items-start gap-3">
        <DoneMark complete={copy.complete} />
        <div className="min-w-0">
          <p className="text-base font-medium leading-tight text-text-primary">{copy.headline}</p>
          <p className="mt-1.5 text-sm tabular-nums text-text-secondary">{copy.detail}</p>
          <p className="mt-1 text-xs leading-5 text-text-muted">{copy.note}</p>
        </div>
      </div>
    </div>
  );
}
