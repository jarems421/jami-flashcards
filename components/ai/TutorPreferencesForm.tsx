"use client";

import { useState, type ReactNode } from "react";
import { Button, OptionSwitch, Textarea } from "@/components/ui";
import {
  MAX_TUTOR_CUSTOM_GUIDANCE_LENGTH,
  TUTOR_CHECK_UNDERSTANDING_OPTIONS,
  TUTOR_EXPLANATION_DEPTH_OPTIONS,
  TUTOR_FEEDBACK_DIRECTNESS_OPTIONS,
  TUTOR_HELP_APPROACH_OPTIONS,
  type TutorCheckUnderstanding,
  type TutorExplanationDepth,
  type TutorFeedbackDirectness,
  type TutorHelpApproach,
  type TutorPreferences,
} from "@/lib/ai/tutor-personalisation";

type TutorPreferencesFormProps = {
  preferences: TutorPreferences;
  saving: boolean;
  onSave: (input: {
    helpApproach: TutorHelpApproach;
    explanationDepth: TutorExplanationDepth;
    feedbackDirectness: TutorFeedbackDirectness;
    checkUnderstanding: TutorCheckUnderstanding;
    customGuidance: string;
  }) => Promise<boolean>;
};

/**
 * One question per block, asked the way a student would ask it.
 *
 * The heading is the question -- "When you are stuck" -- and the choices are
 * answers to it. It used to carry a helper sentence under each heading as well,
 * which said again what the four option labels underneath already said; four
 * questions each with a paragraph and four descriptions was a page of reading
 * on a screen nobody opened to read. The options explain themselves, and the
 * chosen one explains itself in one line beneath the row.
 */
function Choice({ question, children }: { question: string; children: ReactNode }) {
  return (
    <section className="border-t border-[var(--color-border)] pt-4 first:border-t-0 first:pt-0">
      <h3 className="mb-2.5 text-sm font-semibold tracking-tight text-text-primary">
        {question}
      </h3>
      {children}
    </section>
  );
}

/**
 * How this student likes to be taught.
 *
 * Every option's default contributes no line to the prompt, so an untouched
 * form leaves Jami exactly as it was. Changing one changes one thing, which is
 * why each block is a separate question rather than a row in a settings table.
 *
 * Saved explicitly. This is a form with a text box in it, and storing a
 * half-typed sentence on every keystroke is not the same gesture as picking a
 * setting.
 */
export default function TutorPreferencesForm({
  preferences,
  saving,
  onSave,
}: TutorPreferencesFormProps) {
  const [helpApproach, setHelpApproach] = useState(preferences.helpApproach);
  const [explanationDepth, setExplanationDepth] = useState(
    preferences.explanationDepth
  );
  const [feedbackDirectness, setFeedbackDirectness] = useState(
    preferences.feedbackDirectness
  );
  const [checkUnderstanding, setCheckUnderstanding] = useState(
    preferences.checkUnderstanding
  );
  const [customGuidance, setCustomGuidance] = useState(
    preferences.customGuidance
  );

  /*
   * No effect syncs these back from `preferences`. The panel remounts this form
   * when a load or a save produces a new settings document, so the fields start
   * from whatever arrived and there is nothing to re-copy on a later render.
   */
  const dirty =
    helpApproach !== preferences.helpApproach ||
    explanationDepth !== preferences.explanationDepth ||
    feedbackDirectness !== preferences.feedbackDirectness ||
    checkUnderstanding !== preferences.checkUnderstanding ||
    customGuidance !== preferences.customGuidance;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!dirty || saving) return;
        void onSave({
          helpApproach,
          explanationDepth,
          feedbackDirectness,
          checkUnderstanding,
          customGuidance,
        });
      }}
    >
      <Choice question="When you are stuck">
        <OptionSwitch
          label="When you are stuck"
          hideLabel
          detail="selected"
          columns={4}
          value={helpApproach}
          disabled={saving}
          onChange={setHelpApproach}
          options={TUTOR_HELP_APPROACH_OPTIONS}
        />
      </Choice>

      <Choice question="How much detail">
        <OptionSwitch
          label="How much detail"
          hideLabel
          detail="selected"
          columns={4}
          value={explanationDepth}
          disabled={saving}
          onChange={setExplanationDepth}
          options={TUTOR_EXPLANATION_DEPTH_OPTIONS}
        />
      </Choice>

      <Choice question="When you get it wrong">
        <OptionSwitch
          label="When you get it wrong"
          hideLabel
          detail="selected"
          columns={4}
          value={feedbackDirectness}
          disabled={saving}
          onChange={setFeedbackDirectness}
          options={TUTOR_FEEDBACK_DIRECTNESS_OPTIONS}
        />
      </Choice>

      <Choice question="Checking it landed">
        <OptionSwitch
          label="Checking it landed"
          hideLabel
          detail="selected"
          columns={3}
          value={checkUnderstanding}
          disabled={saving}
          onChange={setCheckUnderstanding}
          options={TUTOR_CHECK_UNDERSTANDING_OPTIONS}
        />
      </Choice>

      <Choice question="Anything else?">
        <Textarea
          aria-label="Anything else Jami should know?"
          rows={3}
          value={customGuidance}
          disabled={saving}
          maxLength={MAX_TUTOR_CUSTOM_GUIDANCE_LENGTH}
          placeholder="Name the rule before you use it."
          onChange={(event) => setCustomGuidance(event.target.value)}
        />
      </Choice>

      <div className="sticky bottom-0 -mx-1 flex items-center gap-3 rounded-2xl bg-[var(--color-surface-panel-strong)] px-1 py-3">
        <Button type="submit" disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
        <span className="text-xs text-text-muted">
          {saving ? "Saving…" : dirty ? "Unsaved" : "Applies to your next question."}
        </span>
      </div>
    </form>
  );
}
