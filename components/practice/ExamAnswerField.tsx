"use client";

import { memo, useState } from "react";
import { Textarea } from "@/components/ui";
import {
  examAnswerOpeningLayout,
  examAnswerPartMaxLength,
  joinExamAnswerParts,
  nextExamAnswerPartLabel,
} from "@/lib/practice/exam-answer-parts";
import { EXAM_ANSWER_MAX_LENGTH } from "@/lib/practice/exam-questions";

const PART_ACTION_CLASS =
  "rounded text-xs font-semibold text-accent underline-offset-2 transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The typed answer, holding its own text.
 *
 * Kept apart from the session so a keystroke re-renders this box and nothing
 * else. It opens with a draft typed before the student left the question, if
 * there is one, and reports every change for saving.
 *
 * A question that asks for (a), (b) and (c) gets a box for each, rather than
 * leaving a student to label three answers inside one box, and any answer can
 * be split into parts by hand. However it is typed, it is saved and marked as
 * one labelled answer.
 */
const ExamAnswerField = memo(function ExamAnswerField({
  id,
  attemptId,
  prompt,
  storedText,
  disabled,
  readDraft,
  onDraft,
}: {
  id: string;
  attemptId: string;
  prompt: string;
  storedText: string;
  disabled: boolean;
  readDraft(attemptId: string): string | undefined;
  onDraft(attemptId: string, text: string, storedText: string): void;
}) {
  const [initial] = useState(() => {
    const text = readDraft(attemptId) ?? storedText;
    return { text, ...examAnswerOpeningLayout(prompt, text) };
  });
  const [value, setValue] = useState(initial.text);
  const [labels, setLabels] = useState<string[]>(initial.labels);
  const [texts, setTexts] = useState<string[]>(initial.texts);
  const report = (text: string) => onDraft(attemptId, text, storedText);

  if (labels.length === 0) {
    return (
      <>
        <Textarea
          id={id}
          containerClassName="mt-3"
          className="resize-y leading-6"
          rows={3}
          symbols
          value={value}
          maxLength={EXAM_ANSWER_MAX_LENGTH}
          placeholder="Type your final answer…"
          disabled={disabled}
          onChange={(event) => {
            const text = event.target.value;
            setValue(text);
            report(text);
          }}
        />
        <button
          type="button"
          className={`mt-2 ${PART_ACTION_CLASS}`}
          disabled={disabled}
          onClick={() => {
            const nextLabels = ["(a)", "(b)"];
            const nextTexts = [value, ""];
            setLabels(nextLabels);
            setTexts(nextTexts);
            report(joinExamAnswerParts(nextLabels, nextTexts));
          }}
        >
          Answer in parts (a), (b)…
        </button>
      </>
    );
  }

  const nextLabel = nextExamAnswerPartLabel(labels);
  const lastLabel = labels[labels.length - 1];
  const partMaxLength = examAnswerPartMaxLength(labels.length);
  const changeParts = (nextLabels: string[], nextTexts: string[]) => {
    setLabels(nextLabels);
    setTexts(nextTexts);
    report(joinExamAnswerParts(nextLabels, nextTexts));
  };

  return (
    <div className="mt-3 space-y-2.5">
      {labels.map((label, index) => {
        const fieldId = index === 0 ? id : `${id}-part-${index}`;
        return (
          <div key={label} className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-2">
            <label
              htmlFor={fieldId}
              className="pt-2.5 text-center text-sm font-semibold tabular-nums text-text-secondary"
            >
              {label}
            </label>
            <Textarea
              id={fieldId}
              className="resize-y leading-6"
              rows={2}
              symbols
              value={texts[index] ?? ""}
              maxLength={partMaxLength}
              placeholder={`Answer to part ${label}`}
              disabled={disabled}
              onChange={(event) =>
                changeParts(
                  labels,
                  texts.map((current, textIndex) => (textIndex === index ? event.target.value : current))
                )
              }
            />
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-12">
        {nextLabel ? (
          <button
            type="button"
            className={PART_ACTION_CLASS}
            disabled={disabled}
            onClick={() => changeParts([...labels, nextLabel], [...texts, ""])}
          >
            Add part {nextLabel}
          </button>
        ) : null}
        {labels.length > 2 && lastLabel && !(texts[labels.length - 1] ?? "").trim() ? (
          <button
            type="button"
            className={PART_ACTION_CLASS}
            disabled={disabled}
            onClick={() => changeParts(labels.slice(0, -1), texts.slice(0, -1))}
          >
            Remove part {lastLabel}
          </button>
        ) : null}
        <button
          type="button"
          className={PART_ACTION_CLASS}
          disabled={disabled}
          onClick={() => {
            const joined = joinExamAnswerParts(labels, texts);
            setValue(joined);
            setLabels([]);
            setTexts([]);
            report(joined);
          }}
        >
          Use one box
        </button>
      </div>
    </div>
  );
});

export default ExamAnswerField;
