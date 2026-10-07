"use client";

import PracticeStep from "@/components/practice/PracticeStep";
import type { PracticePaperTimingMode } from "@/lib/practice/practice-papers";

export type PracticePaperTutorChoice = "off" | "on";

const TIMING_OPTIONS: Array<{ value: PracticePaperTimingMode; label: string; detail: string }> = [
  { value: "timed", label: "Timed", detail: "Use the real paper duration, with optional overtime" },
  { value: "untimed", label: "Untimed", detail: "Work without a countdown or pacing comparison" },
];

const TUTOR_OPTIONS: Array<{ value: PracticePaperTutorChoice; label: string; detail: string }> = [
  { value: "off", label: "Exam conditions", detail: "Jami stays hidden during the sitting" },
  { value: "on", label: "Jami assisted", detail: "Jami helps as normal and the result is labelled assisted" },
];

function ChoiceCards<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; detail: string }>;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-text-secondary">{label}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={`min-h-20 rounded-xl border p-3 text-left transition ${
                selected
                  ? "border-accent/50 bg-accent/10 shadow-e1"
                  : "border-[var(--color-border)] bg-[var(--color-surface-panel)] hover:border-[var(--color-border-strong)]"
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <span className="block text-sm font-semibold text-text-primary">{option.label}</span>
              <span className="mt-1 block text-xs leading-5 text-text-muted">{option.detail}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** How the student sits the paper: against the clock or not, and whether Jami can help. */
export default function PracticePaperSittingStep({
  step,
  timingMode,
  tutorChoice,
  disabled,
  onTimingModeChange,
  onTutorChoiceChange,
}: {
  step: number;
  timingMode: PracticePaperTimingMode;
  tutorChoice: PracticePaperTutorChoice;
  disabled: boolean;
  onTimingModeChange: (value: PracticePaperTimingMode) => void;
  onTutorChoiceChange: (value: PracticePaperTutorChoice) => void;
}) {
  return (
    <PracticeStep
      step={step}
      title="How do you want to sit it?"
      description="You can also switch between timed and untimed when you start the attempt."
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <ChoiceCards
          label="Attempt timing"
          value={timingMode}
          options={TIMING_OPTIONS}
          disabled={disabled}
          onChange={onTimingModeChange}
        />
        <ChoiceCards
          label="Jami during the sitting"
          value={tutorChoice}
          options={TUTOR_OPTIONS}
          disabled={disabled}
          onChange={onTutorChoiceChange}
        />
      </div>
    </PracticeStep>
  );
}
