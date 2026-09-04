"use client";

import Link from "next/link";
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
import { getStudyLevelLabel, type StudyLevel } from "@/lib/profile/study-level";

type TutorPreferencesFormProps = {
  preferences: TutorPreferences;
  /** The level that will actually apply, and where it came from. */
  studyLevel: StudyLevel | null;
  studyLevelSource: "folder" | "account";
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
 * answers to it. Four labelled radiogroups stacked in a column was accurate and
 * read as a configuration screen: the words were the field names, and nothing
 * on it sounded like studying.
 */
function Choice({
  question,
  helper,
  children,
}: {
  question: string;
  helper: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-[var(--color-border)] pt-6 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold tracking-tight text-text-primary sm:text-base">
        {question}
      </h3>
      <p className="mt-1 max-w-xl text-xs leading-5 text-text-muted sm:text-sm">
        {helper}
      </p>
      <div className="mt-4">{children}</div>
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
 * Saved explicitly, unlike the study level on the Account page. That is a
 * single choice; this is a form with a text box in it, and storing a half-typed
 * sentence on every keystroke is not the same gesture.
 */
export default function TutorPreferencesForm({
  preferences,
  studyLevel,
  studyLevelSource,
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

  const toOptions = <Value extends string>(
    options: readonly { value: Value; label: string; detail: string }[]
  ) =>
    options.map((option) => ({
      value: option.value,
      label: option.label,
      detail: option.detail,
    }));

  return (
    <form
      className="flex flex-col gap-6"
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
      <Choice
        question="When you are stuck"
        helper="How Jami opens when you bring it something you cannot do yet."
      >
        <OptionSwitch
          label="When you are stuck"
          hideLabel
          value={helpApproach}
          disabled={saving}
          onChange={setHelpApproach}
          options={toOptions(TUTOR_HELP_APPROACH_OPTIONS)}
        />
      </Choice>

      <Choice
        question="How much detail you want"
        helper="Jami still chooses a shape that suits the question; this sets the length it aims for."
      >
        <OptionSwitch
          label="How much detail you want"
          hideLabel
          value={explanationDepth}
          disabled={saving}
          onChange={setExplanationDepth}
          options={toOptions(TUTOR_EXPLANATION_DEPTH_OPTIONS)}
        />
      </Choice>

      <Choice
        question="When you get something wrong"
        helper="How Jami tells you. It will not soften the correction itself, whichever you choose."
      >
        <OptionSwitch
          label="When you get something wrong"
          hideLabel
          value={feedbackDirectness}
          disabled={saving}
          onChange={setFeedbackDirectness}
          options={toOptions(TUTOR_FEEDBACK_DIRECTNESS_OPTIONS)}
        />
      </Choice>

      <Choice
        question="Checking it landed"
        helper="Whether Jami finishes by asking you something about what you just covered."
      >
        <OptionSwitch
          label="Checking it landed"
          hideLabel
          value={checkUnderstanding}
          disabled={saving}
          onChange={setCheckUnderstanding}
          options={toOptions(TUTOR_CHECK_UNDERSTANDING_OPTIONS)}
        />
      </Choice>

      <Choice
        question="Anything else Jami should know?"
        helper="A habit that helps you, a way of setting out work, something you always forget. Subject detail belongs in your subject notes below."
      >
        <Textarea
          aria-label="Anything else Jami should know?"
          rows={4}
          value={customGuidance}
          disabled={saving}
          maxLength={MAX_TUTOR_CUSTOM_GUIDANCE_LENGTH}
          placeholder="I follow things better when you name the rule before using it."
          onChange={(event) => setCustomGuidance(event.target.value)}
        />
        <p className="mt-2 text-right text-2xs text-text-muted" aria-hidden="true">
          {customGuidance.length}/{MAX_TUTOR_CUSTOM_GUIDANCE_LENGTH}
        </p>
      </Choice>

      {/*
        Shown, not editable. The control lives on the Account page and a second
        one here would be two places to change one thing -- and the one that
        actually applies inside a folder is the folder's own override, which is
        why this says which is in force rather than just naming a level.
      */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-4 py-3.5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">
            Pitched at {studyLevel ? getStudyLevelLabel(studyLevel) : "no set level"}
            {studyLevel && studyLevelSource === "folder" ? (
              <span className="font-normal text-text-muted"> — set by this folder</span>
            ) : null}
          </p>
          <p className="mt-0.5 text-xs text-text-muted">
            Sets the vocabulary and assumed knowledge Jami works from.
          </p>
        </div>
        <Link
          href="/dashboard/profile"
          className="shrink-0 text-xs font-semibold text-accent underline-offset-4 hover:underline"
        >
          Change
        </Link>
      </div>

      <div className="sticky bottom-0 -mx-1 flex items-center gap-3 rounded-2xl bg-[var(--color-surface-panel-strong)] px-1 py-3">
        <Button type="submit" disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
        <span className="text-xs text-text-muted">
          {saving
            ? "Saving your preferences."
            : dirty
              ? "Unsaved changes"
              : "Jami follows these from your next question."}
        </span>
      </div>
    </form>
  );
}
