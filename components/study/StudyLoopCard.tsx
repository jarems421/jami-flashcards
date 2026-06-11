"use client";

import Link from "next/link";
import { Card, SectionHeader } from "@/components/ui";

const STUDY_LOOP_STEPS = [
  { label: "Create deck", href: "/dashboard/decks", position: "top-0 left-1/2 -translate-x-1/2" },
  { label: "Add cards", href: "/dashboard/cards", position: "right-0 top-1/2 -translate-y-1/2" },
  { label: "Review", href: "/dashboard/study", position: "bottom-0 left-1/2 -translate-x-1/2" },
  { label: "Set goal", href: "/dashboard/goals", position: "left-0 top-1/2 -translate-y-1/2" },
] as const;

export default function StudyLoopCard() {
  return (
    <Card padding="md" className="sm:p-6">
      <SectionHeader
        title="Study loop"
        description="Build, review, reflect, then begin the cycle again."
      />

      <nav aria-label="Jami study loop" className="mx-auto mt-6 w-full max-w-[21rem]">
        <div className="relative aspect-square">
          <svg
            aria-hidden="true"
            viewBox="0 0 320 320"
            className="absolute inset-[12%] h-[76%] w-[76%] overflow-visible text-[var(--color-border-strong)]"
          >
            <defs>
              <marker
                id="study-loop-arrow"
                markerWidth="8"
                markerHeight="8"
                refX="6"
                refY="4"
                orient="auto"
              >
                <path d="M 0 0 L 8 4 L 0 8 Z" fill="currentColor" />
              </marker>
            </defs>
            <path
              d="M 160 18 A 142 142 0 1 1 159.8 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="5"
              strokeLinecap="round"
              markerEnd="url(#study-loop-arrow)"
            />
          </svg>

          <div className="app-subtle-panel absolute left-1/2 top-1/2 grid h-24 w-24 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-[var(--color-border)] text-center shadow-sm">
            <span className="px-3 text-sm font-semibold leading-5 text-text-primary">
              Keep learning
            </span>
          </div>

          {STUDY_LOOP_STEPS.map((step, index) => (
            <Link
              key={step.label}
              href={step.href}
              className={`app-chip absolute z-10 flex min-h-12 min-w-[7.25rem] items-center justify-center rounded-full border border-[var(--color-border)] px-3 py-2 text-center text-sm font-semibold text-text-primary shadow-sm transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-glass-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${step.position}`}
              aria-label={`${index + 1}. ${step.label}`}
            >
              {step.label}
            </Link>
          ))}
        </div>
      </nav>
    </Card>
  );
}
