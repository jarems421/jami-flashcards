"use client";

import Link from "next/link";
import { Button, Card, SectionHeader } from "@/components/ui";
import { usePersistentDisclosure } from "@/lib/app/disclosure-preference";

const STUDY_LOOP_OPEN_STORAGE_KEY = "jami:study-loop-open";

const STUDY_LOOP_STEPS = [
  { label: "Create deck", href: "/dashboard/decks", position: "left-1/2 top-[15%]" },
  { label: "Add cards", href: "/dashboard/cards", position: "left-[85%] top-1/2" },
  { label: "Review", href: "/dashboard/study", position: "left-1/2 top-[85%]" },
  { label: "Set goal", href: "/dashboard/goals", position: "left-[15%] top-1/2" },
] as const;

const CYCLE_ARROWS = [
  { position: "right-[19%] top-[22%]", rotation: "rotate-45" },
  { position: "bottom-[20%] right-[21%]", rotation: "rotate-[135deg]" },
  { position: "bottom-[21%] left-[20%]", rotation: "-rotate-[135deg]" },
  { position: "left-[20%] top-[21%]", rotation: "-rotate-45" },
] as const;

export default function StudyLoopCard() {
  const [open, toggleOpen] = usePersistentDisclosure(
    STUDY_LOOP_OPEN_STORAGE_KEY,
    false,
  );

  return (
    <Card padding="md" className="sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <SectionHeader
          title="Study loop"
          description="Build, review, reflect, then repeat."
        />
        <Button
          type="button"
          onClick={toggleOpen}
          variant="secondary"
          size="sm"
          aria-expanded={open}
        >
          {open ? "Hide" : "Show"}
        </Button>
      </div>

      {open ? (
        <nav aria-label="Jami study loop" className="mx-auto mt-4 w-full max-w-[17rem]">
          <div className="relative aspect-square">
            <div
              aria-hidden="true"
              className="absolute inset-[15%] rounded-full border-[3px] border-[var(--color-border-strong)]"
            />

            {CYCLE_ARROWS.map((arrow) => (
              <svg
                key={arrow.position}
                viewBox="0 0 16 16"
                aria-hidden="true"
                className={`absolute z-[5] h-4 w-4 text-text-muted ${arrow.position} ${arrow.rotation}`}
              >
                <path
                  d="M3 5.5 8 10.5l5-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ))}

            <div className="app-subtle-panel absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-[var(--color-border)] text-center shadow-sm">
              <span className="px-2 text-[0.68rem] font-semibold leading-4 text-text-primary">
                Keep learning
              </span>
            </div>

            {STUDY_LOOP_STEPS.map((step, index) => (
              <Link
                key={step.label}
                href={step.href}
                className={`app-chip absolute z-10 flex min-h-10 min-w-[6.25rem] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--color-border)] px-2.5 py-1.5 text-center text-xs font-semibold text-text-primary shadow-sm transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-glass-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${step.position}`}
                aria-label={`${index + 1}. ${step.label}`}
              >
                {step.label}
              </Link>
            ))}
          </div>
        </nav>
      ) : null}
    </Card>
  );
}
