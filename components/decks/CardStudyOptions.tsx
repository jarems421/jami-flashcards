"use client";

import type { ReactNode } from "react";
import AnswerListField from "@/components/decks/AnswerListField";
import { FormDisclosure, SettingSwitch, StudyText } from "@/components/ui";
import {
  applyStudySettingsDraft,
  MAX_OWN_ACCEPTED_ANSWERS,
  MAX_OWN_ANSWER_LENGTH,
  MAX_OWN_PINNED_GAPS,
  MAX_OWN_WRONG_ANSWERS,
  OWN_TOGGLEABLE_MODES,
  type StudySettingsDraft,
} from "@/lib/study/card-study-settings";
import { pinAuthorGaps } from "@/lib/study/gap-fill";
import { describeAuthorMultipleChoice } from "@/lib/study/mcq";
import { STUDY_MODE_LABELS, type CardStudySettings, type StudyMode } from "@/lib/study/study-modes";

type CardStudyOptionsProps = {
  front: string;
  back: string;
  /** A picture answer is only ever turned over, so none of this applies. */
  hasBackImage: boolean;
  /** What the card has now, for the settings this section does not show. */
  saved?: CardStudySettings;
  value: StudySettingsDraft;
  onChange: (value: StudySettingsDraft) => void;
  disabled?: boolean;
};

const MODE_DESCRIPTIONS: Record<StudyMode, string> = {
  classic: "Turn it over and say how it went.",
  "type-answer": "Type the answer from memory.",
  "gap-fill": "Fill in words blanked from the answer.",
  "multiple-choice": "Pick the answer from four.",
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function Status({ tone, children }: { tone: "ready" | "warning" | "note"; children: ReactNode }) {
  if (tone === "note") return <p className="text-xs leading-5 text-text-muted">{children}</p>;
  return (
    <p role="status" className={`${tone === "ready" ? "app-success" : "app-warning"} rounded-xl px-3 py-2 text-xs leading-5`}>
      {children}
    </p>
  );
}

/** The answer with the chosen words blanked, as Gap Fill will show it. */
function blanked(back: string, gaps: readonly { start: number; end: number }[]) {
  return [...gaps]
    .sort((left, right) => right.start - left.start)
    .reduce((text, gap) => `${text.slice(0, gap.start)}_____${text.slice(gap.end)}`, back);
}

/**
 * A card's own study settings, folded away under the card's fields.
 *
 * Every line says what Learn will make of it, using the same checks Learn
 * uses: three wrong answers are needed that are not the answer said another
 * way and do not give it away, and a word is blanked only if it is in the
 * answer exactly and the answer has room for it. A setting that would quietly
 * do nothing says so here rather than in a study session.
 */
export default function CardStudyOptions({
  front,
  back,
  hasBackImage,
  saved,
  value,
  onChange,
  disabled = false,
}: CardStudyOptionsProps) {
  const set = (patch: Partial<StudySettingsDraft>) => onChange({ ...value, ...patch });
  const isOn = (mode: StudyMode) => !value.disabledModes.includes(mode);
  const summary = [
    value.acceptedAnswers.length ? plural(value.acceptedAnswers.length, "other answer", "other answers") : "",
    value.wrongAnswers.length ? plural(value.wrongAnswers.length, "wrong answer", "wrong answers") : "",
    value.pinnedGaps.length ? plural(value.pinnedGaps.length, "word to blank", "words to blank") : "",
    value.disabledModes.length ? `${value.disabledModes.length} off` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  if (hasBackImage) {
    return (
      <FormDisclosure title="Study options" summary="Not for picture answers">
        <Status tone="note">
          A card with a picture on the back is always turned over in Learn, so there is nothing to type, choose or
          fill in.
        </Status>
      </FormDisclosure>
    );
  }

  const draftCard = {
    id: "draft",
    deckId: "",
    userId: "",
    front,
    back,
    tags: [],
    createdAt: 0,
    studySettings: applyStudySettingsDraft(saved, value),
  };
  const choice = describeAuthorMultipleChoice(draftCard);
  const gaps = value.pinnedGaps.length > 0 ? pinAuthorGaps(back, value.pinnedGaps) : null;

  return (
    <FormDisclosure title="Study options" summary={summary || "Optional"} defaultOpen={summary.length > 0}>
      <div className="space-y-6">
        <AnswerListField
          label="Also mark these right"
          description="Other answers that count when you type this card, like “H₂O” for “water”."
          values={value.acceptedAnswers}
          onChange={(acceptedAnswers) => set({ acceptedAnswers })}
          max={MAX_OWN_ACCEPTED_ANSWERS}
          maxLength={MAX_OWN_ANSWER_LENGTH}
          placeholder="Another right answer"
          disabled={disabled}
        />

        <AnswerListField
          label="Your wrong answers for multiple choice"
          description="Learn shows three beside the answer. Leave this empty and Jami writes them when it can."
          values={value.wrongAnswers}
          onChange={(wrongAnswers) => set({ wrongAnswers })}
          max={MAX_OWN_WRONG_ANSWERS}
          maxLength={MAX_OWN_ANSWER_LENGTH}
          placeholder="A wrong answer"
          disabled={disabled}
          status={
            !isOn("multiple-choice") ? (
              <Status tone="note">Multiple Choice is off for this card.</Status>
            ) : choice.kind === "ready" ? (
              <Status tone="ready">Learn can ask this as multiple choice with your wrong answers.</Status>
            ) : choice.kind === "needs-more" ? (
              <Status tone="warning">
                Add {plural(choice.needed - choice.usable, "more", "more")}: Learn needs {choice.needed}, and none of
                them can be the answer said another way.
              </Status>
            ) : choice.kind === "answer-too-long" ? (
              <Status tone="warning">
                The answer is too long to show as an option, so this card is not asked as multiple choice.
              </Status>
            ) : choice.kind === "answer-stands-out" ? (
              <Status tone="warning">
                The answer would stand out among these. Make them about as long as the answer, and written the same
                way.
              </Status>
            ) : null
          }
        />

        <AnswerListField
          label="Words to blank in Gap Fill"
          description="Copy them from the answer exactly. Leave this empty and Jami chooses."
          values={value.pinnedGaps}
          onChange={(pinnedGaps) => set({ pinnedGaps })}
          max={MAX_OWN_PINNED_GAPS}
          maxLength={MAX_OWN_ANSWER_LENGTH}
          placeholder="Words from the answer"
          disabled={disabled}
          status={
            !gaps ? null : (
              <div className="space-y-2">
                {!isOn("gap-fill") ? <Status tone="note">Gap Fill is off for this card.</Status> : null}
                {gaps.missing.length > 0 ? (
                  <Status tone="warning">
                    {gaps.missing.map((word) => `“${word}”`).join(", ")}{" "}
                    {gaps.missing.length === 1 ? "is" : "are"} not in the answer exactly, so{" "}
                    {gaps.missing.length === 1 ? "it is" : "they are"} not blanked.
                  </Status>
                ) : null}
                {gaps.gaps.length > 0 ? (
                  <div className="app-success rounded-xl px-3 py-2 text-xs leading-5">
                    <p className="font-semibold">Learn will ask:</p>
                    <StudyText as="p" text={blanked(back, gaps.gaps)} className="mt-1 line-clamp-3 whitespace-pre-wrap" />
                  </div>
                ) : gaps.problem?.kind === "answer-too-short" ? (
                  <Status tone="warning">The answer is too short to blank: Gap Fill needs at least four words.</Status>
                ) : gaps.problem?.kind === "too-many" ? (
                  <Status tone="warning">
                    This answer has room for {plural(gaps.problem.allowed, "blank", "blanks")}. Remove one.
                  </Status>
                ) : gaps.problem?.kind === "too-much-hidden" ? (
                  <Status tone="warning">
                    That hides more than a third of the answer. Choose fewer or shorter words.
                  </Status>
                ) : null}
              </div>
            )
          }
        />

        <fieldset className="min-w-0">
          <legend className="text-sm font-medium tracking-[0.01em] text-text-secondary">Ways to ask it</legend>
          <p className="mt-1 text-xs leading-5 text-text-muted">
            Turning it over is always on. Smart Mix chooses among the ways left on.
          </p>
          <div className="mt-2 grid gap-1">
            {OWN_TOGGLEABLE_MODES.map((mode) => (
              <SettingSwitch
                key={mode}
                label={STUDY_MODE_LABELS[mode]}
                description={MODE_DESCRIPTIONS[mode]}
                checked={isOn(mode)}
                disabled={disabled}
                onChange={(on) =>
                  set({
                    disabledModes: on
                      ? value.disabledModes.filter((candidate) => candidate !== mode)
                      : [...value.disabledModes, mode],
                  })
                }
              />
            ))}
          </div>
        </fieldset>
      </div>
    </FormDisclosure>
  );
}
