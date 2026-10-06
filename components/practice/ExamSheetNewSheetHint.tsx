import type { Ref } from "react";

const RING_RADIUS = 16;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * The page being asked for, while it is being asked for.
 *
 * It appears only under the finger's own pull: a student who is writing is
 * never shown a control for running out of paper -- which is also why the
 * "Run out of room?" bar that sat under the last page has gone. The pull
 * writes to it directly during the gesture, so nothing here re-renders the
 * sheet. Opaque rather than blurred, since it sits over the ink.
 */
export default function ExamSheetNewSheetHint({ ref }: { ref: Ref<HTMLDivElement> }) {
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="notebook-floating-control pointer-events-none absolute right-3 top-1/2 z-20 flex flex-col items-center gap-1 rounded-2xl border border-[var(--color-border)] px-3 py-2.5 shadow-e2"
      style={{ opacity: 0, transform: "translateY(-50%) scale(0.72)" }}
    >
      <span className="relative grid h-9 w-9 place-items-center">
        <svg viewBox="0 0 40 40" className="absolute inset-0 h-full w-full -rotate-90">
          <circle
            cx="20"
            cy="20"
            r={RING_RADIUS}
            fill="none"
            strokeWidth="3"
            className="stroke-[var(--color-border)]"
          />
          <circle
            data-pull-ring
            cx="20"
            cy="20"
            r={RING_RADIUS}
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            className="stroke-[var(--color-accent)]"
            strokeDasharray={RING_LENGTH}
            style={{ strokeDashoffset: RING_LENGTH }}
          />
        </svg>
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-text-secondary" aria-hidden="true">
          <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
      <span className="text-2xs font-semibold text-text-secondary">New sheet</span>
    </div>
  );
}
