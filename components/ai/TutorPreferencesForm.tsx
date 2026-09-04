"use client";

import Link from "next/link";
import { useState } from "react";
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
 * The preferences that apply everywhere, and only those.
 *
 * Four guided choices and a free note. Each one becomes a line competing with
 * the others in the same system instruction, so every option's default
 * contributes nothing at all -- an account that has changed none of them adds
 * not one word to the prompt, and a student who changes one has moved exactly
 * one thing rather than joining an argument between five.
 *
 * Saved explicitly rather than on change, unlike the study level on the Account
 * page. That one is a single choice; this is a form with a text box in it, and
 * saving a half-typed sentence on every keystroke is not the same gesture.
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
      <OptionSwitch
        label="Help approach"
        value={helpApproach}
        disabled={saving}
        onChange={setHelpApproach}
        options={TUTOR_HELP_APPROACH_OPTIONS.map((option) => ({
          value: option.value,
          label: option.label,
          detail: option.detail,
        }))}
      />

      <OptionSwitch
        label="Explanation depth"
        value={explanationDepth}
        disabled={saving}
        onChange={setExplanationDepth}
        options={TUTOR_EXPLANATION_DEPTH_OPTIONS.map((option) => ({
          value: option.value,
          label: option.label,
          detail: option.detail,
        }))}
      />

      <OptionSwitch
        label="Feedback directness"
        value={feedbackDirectness}
        disabled={saving}
        onChange={setFeedbackDirectness}
        options={TUTOR_FEEDBACK_DIRECTNESS_OPTIONS.map((option) => ({
          value: option.value,
          label: option.label,
          detail: option.detail,
        }))}
      />

      <OptionSwitch
        label="Check understanding"
        value={checkUnderstanding}
        disabled={saving}
        onChange={setCheckUnderstanding}
        options={TUTOR_CHECK_UNDERSTANDING_OPTIONS.map((option) => ({
          value: option.value,
          label: option.label,
          detail: option.detail,
        }))}
      />

      <div>
        <Textarea
          label="Anything else Tutor should know?"
          rows={4}
          value={customGuidance}
          disabled={saving}
          maxLength={MAX_TUTOR_CUSTOM_GUIDANCE_LENGTH}
          placeholder="I find it easier when you name the rule before using it."
          onChange={(event) => setCustomGuidance(event.target.value)}
        />
        <p className="mt-2 flex items-center justify-between gap-3 text-2xs text-text-muted">
          <span>Applies to every subject. Subject detail belongs in folder instructions.</span>
          <span aria-hidden="true">
            {customGuidance.length}/{MAX_TUTOR_CUSTOM_GUIDANCE_LENGTH}
          </span>
        </p>
      </div>

      {/*
        Shown, not editable. The control lives on the Account page and a second
        one here would be two places to change one thing -- and the one that
        actually applies inside a folder is the folder's own override, which is
        why this says which is in force rather than just naming a level.
      */}
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm font-medium text-text-secondary">
            Study level
          </span>
          <Link
            href="/dashboard/profile"
            className="text-xs font-semibold text-accent underline-offset-4 hover:underline"
          >
            Change in Account
          </Link>
        </div>
        <p className="mt-1 text-sm text-text-primary">
          {studyLevel ? getStudyLevelLabel(studyLevel) : "Not specified"}
          {studyLevel && studyLevelSource === "folder" ? (
            <span className="text-text-muted"> — set by this folder</span>
          ) : null}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
        {dirty && !saving ? (
          <span className="text-xs text-text-muted">Unsaved changes</span>
        ) : null}
      </div>
    </form>
  );
}
