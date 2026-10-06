"use client";

import type { Ref } from "react";

const RING_RADIUS = 20;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

type NotebookCreatePageAffordanceProps = {
  /*
   * While the pull is live the page track writes opacity, scale and the ring
   * straight to these elements, so a drag never waits on a render; the props
   * below only set where they start.
   */
  affordanceRef: Ref<HTMLDivElement>;
  indicatorRef: Ref<HTMLDivElement>;
  progressCircleRef: Ref<SVGCircleElement>;
  /** How far the pull has gone towards making a page, 0 to 1. */
  progress: number;
  /** The page is being made: shown whole, whatever the pull reached. */
  creating: boolean;
  /** The pop played as a pull is released into a new page. */
  bounce: boolean;
};

/** The plus that fills in as a page is pulled past the end of the notebook. */
export default function NotebookCreatePageAffordance({
  affordanceRef,
  indicatorRef,
  progressCircleRef,
  progress,
  creating,
  bounce,
}: NotebookCreatePageAffordanceProps) {
  return (
    <div
      ref={affordanceRef}
      aria-hidden="true"
      className="notebook-create-page-affordance pointer-events-none absolute right-[2.375rem] top-1/2 z-40 -translate-y-1/2 translate-x-1/2"
      style={{ opacity: creating ? 1 : Math.min(1, 0.2 + progress * 0.8) }}
    >
      <div
        ref={indicatorRef}
        className={`grid h-16 w-16 place-items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface-panel)] shadow-e2 ${
          bounce ? "notebook-create-page-pop" : ""
        }`}
        style={{ transform: `scale(${creating ? 1 : 0.72 + progress * 0.28})` }}
      >
        <svg viewBox="0 0 48 48" className="h-11 w-11 -rotate-90">
          <circle
            cx="24"
            cy="24"
            r={RING_RADIUS}
            fill="none"
            stroke="var(--color-border)"
            strokeWidth="3.5"
          />
          <circle
            ref={progressCircleRef}
            cx="24"
            cy="24"
            r={RING_RADIUS}
            fill="none"
            stroke="var(--color-selected-border)"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray={RING_LENGTH}
            strokeDashoffset={RING_LENGTH * (1 - progress)}
            style={{ transition: "stroke-dashoffset 80ms linear" }}
          />
          <path
            d="M24 15v18M15 24h18"
            fill="none"
            stroke="var(--color-selected-border)"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  );
}
