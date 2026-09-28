import type { ReactNode } from "react";

const ICON_PROPS = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  className: "h-5 w-5",
  "aria-hidden": true,
} as const;

/**
 * What Jami does that a student cannot already get from one app.
 *
 * Each step is something the product does today, worded so it stays true for
 * every student who reads it: marks are shown against the board's own scheme,
 * never promised to match an examiner's, and the last step names only what the
 * Learning Engine can say without a Topic being linked to its specification.
 */
const WORKFLOW_STEPS: readonly {
  number: string;
  label: string;
  detail: string;
  icon: ReactNode;
}[] = [
  {
    number: "01",
    label: "Practise the real thing",
    detail: "Past-paper questions for your course, typed or handwritten, marked point by point against the official scheme.",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        <path d="M14 3v5h5" />
        <path d="m9 14.5 2 2 4-4.5" />
      </svg>
    ),
  },
  {
    number: "02",
    label: "Keep what you learn",
    detail: "Turn mistakes and notes into flashcards you approve, then review them before you forget.",
    icon: (
      <svg {...ICON_PROPS}>
        <rect x="3" y="8" width="13" height="12" rx="2" />
        <path d="M7.5 8V6a2 2 0 0 1 2-2H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-3" />
      </svg>
    ),
  },
  {
    number: "03",
    label: "Know what is next",
    detail: "Jami spots what is slipping and what you have not tested yet, and says why it matters.",
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="12" cy="12" r="9" />
        <path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8z" />
      </svg>
    ),
  },
];

/**
 * The three steps, as one row of cards joined by a faint line on wide screens
 * so they read as a sequence rather than three unrelated features.
 */
export default function LandingSteps() {
  return (
    <ol className="relative grid gap-4 md:grid-cols-3 md:gap-5">
      <span
        className="pointer-events-none absolute left-[16%] right-[16%] top-[2.9rem] hidden h-px bg-gradient-to-r from-transparent via-[var(--color-border-strong)] to-transparent md:block"
        aria-hidden="true"
      />
      {WORKFLOW_STEPS.map((step) => (
        <li key={step.number} className="signed-out-panel rounded-xl p-6">
          <div className="flex items-center justify-between">
            <span className="grid h-11 w-11 place-items-center rounded-md border border-[var(--color-border-strong)] bg-[var(--color-glass-medium)] text-text-primary shadow-e1">
              {step.icon}
            </span>
            <span className="text-2xs font-semibold tracking-[0.2em] text-text-muted">
              {step.number}
            </span>
          </div>
          <h3 className="mt-5 text-base font-semibold text-text-primary">
            {step.label}
          </h3>
          <p className="mt-2 text-sm leading-6 text-text-muted">{step.detail}</p>
        </li>
      ))}
    </ol>
  );
}
