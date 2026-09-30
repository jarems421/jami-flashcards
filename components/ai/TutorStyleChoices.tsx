"use client";

import { type ReactNode } from "react";
import { OptionSwitch } from "@/components/ui";
import {
  TUTOR_CHECK_UNDERSTANDING_OPTIONS,
  TUTOR_EXPLANATION_DEPTH_OPTIONS,
  TUTOR_FEEDBACK_DIRECTNESS_OPTIONS,
  TUTOR_HELP_APPROACH_OPTIONS,
  type TutorStyleChoices as TutorStyleChoicesValue,
} from "@/lib/ai/tutor-personalisation";

/**
 * One question per block, asked the way a student would ask it.
 *
 * The heading is the question -- "When you're stuck" -- and the choices are
 * answers to it. The options explain themselves, and the chosen one explains
 * itself in one line beneath the row.
 */
function Choice({ question, children }: { question: string; children: ReactNode }) {
  return (
    <section className="border-t border-[var(--color-border)] pt-4 first:border-t-0 first:pt-0">
      <h4 className="mb-2.5 text-sm font-semibold tracking-tight text-text-primary">
        {question}
      </h4>
      {children}
    </section>
  );
}

/**
 * How this student likes to be taught, saved as each choice is made.
 *
 * Every option's default contributes no line to the prompt, so an untouched set
 * leaves Jami exactly as it was. These used to share a Save button with a free
 * text box underneath, which is why picking a setting felt like filling in a
 * form: the box has moved to its own list, and a choice is now just a choice.
 */
export default function TutorStyleChoices({
  value,
  onChange,
}: {
  value: TutorStyleChoicesValue;
  onChange: (patch: Partial<TutorStyleChoicesValue>) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Choice question="When you're stuck">
        <OptionSwitch
          label="When you're stuck"
          hideLabel
          detail="selected"
          columns={4}
          value={value.helpApproach}
          onChange={(helpApproach) => onChange({ helpApproach })}
          options={TUTOR_HELP_APPROACH_OPTIONS}
        />
      </Choice>

      <Choice question="How much detail">
        <OptionSwitch
          label="How much detail"
          hideLabel
          detail="selected"
          columns={4}
          value={value.explanationDepth}
          onChange={(explanationDepth) => onChange({ explanationDepth })}
          options={TUTOR_EXPLANATION_DEPTH_OPTIONS}
        />
      </Choice>

      <Choice question="When you get it wrong">
        <OptionSwitch
          label="When you get it wrong"
          hideLabel
          detail="selected"
          columns={4}
          value={value.feedbackDirectness}
          onChange={(feedbackDirectness) => onChange({ feedbackDirectness })}
          options={TUTOR_FEEDBACK_DIRECTNESS_OPTIONS}
        />
      </Choice>

      <Choice question="Checking it landed">
        <OptionSwitch
          label="Checking it landed"
          hideLabel
          detail="selected"
          columns={3}
          value={value.checkUnderstanding}
          onChange={(checkUnderstanding) => onChange({ checkUnderstanding })}
          options={TUTOR_CHECK_UNDERSTANDING_OPTIONS}
        />
      </Choice>
    </div>
  );
}
