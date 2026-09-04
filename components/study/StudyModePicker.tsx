"use client";

import { OptionSwitch, type OptionSwitchOption } from "@/components/ui";
import type { StudyMode, StudyModePolicy } from "@/lib/study/study-modes";

type ModeChoice = "smart" | StudyMode;

const CHOICES: readonly OptionSwitchOption<ModeChoice>[] = [
  {
    value: "smart",
    label: "Smart Mix",
    detail: "Recommended. Varies how each card is asked so no session is one long typing test.",
  },
  { value: "classic", label: "Classic", detail: "Read it, flip it, rate how it went." },
  {
    value: "type-answer",
    label: "Type Answer",
    detail: "Write the answer from memory before it is shown.",
  },
  {
    value: "gap-fill",
    label: "Gap Fill",
    detail: "The answer with its key word hidden.",
  },
  {
    value: "multiple-choice",
    label: "Multiple Choice",
    detail: "Pick the answer from four. Jami writes the three wrong ones.",
  },
];

type StudyModePickerProps = {
  policy: StudyModePolicy;
  onChange: (policy: StudyModePolicy) => void;
};

/**
 * How this session will ask its cards.
 *
 * One control and one line, and nothing else. This has been three designs now:
 * five description cards with a readiness count on each, which turned the
 * calmest screen in the app into a settings panel; then a row of pills, which
 * fixed the size and left five unattached bubbles floating over the setup
 * screen. It is the shared `OptionSwitch` this time, on the same grid as every
 * other choice in the product, with the explanation of whichever mode is
 * selected underneath it.
 *
 * What was removed matters as much as what is here. The per-mode readiness
 * counts are gone -- they existed to warn that a fixed mode would silently drop
 * the cards it could not carry, which is a defect to fix rather than a number
 * to publish. The practice-only warning is gone because multiple choice
 * schedules now. And the Prepare button is gone because preparation is no
 * longer something a student has to know to press: it runs when the session
 * starts, which is the only moment it was ever needed.
 */
export default function StudyModePicker({
  policy,
  onChange,
}: StudyModePickerProps) {
  const active: ModeChoice = policy.kind === "smart" ? "smart" : policy.mode;

  return (
    <div data-study-mode-picker="true" className="space-y-2">
      <OptionSwitch
        label="How to study"
        value={active}
        options={CHOICES}
        columns={5}
        detail="selected"
        onChange={(value) =>
          onChange(
            value === "smart"
              ? { kind: "smart" }
              : { kind: "fixed", mode: value as StudyMode }
          )
        }
      />
      {active !== "classic" ? (
        <p className="text-2xs leading-5 text-text-muted">
          Jami reads any new cards when you start, so the gaps land on the words
          that matter and the wrong answers are worth thinking about. Cards
          you&apos;ve studied before are ready straight away.
        </p>
      ) : null}
    </div>
  );
}
