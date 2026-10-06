"use client";

import { memo } from "react";
import ExamQuestionAssets from "@/components/practice/ExamQuestionAssets";
import { Card, StudyText } from "@/components/ui";
import {
  examQuestionProvenanceLine,
  examQuestionShowsPrintedPage,
  examQuestionTariffNote,
} from "@/lib/practice/exam-question-display";
import type { ExamSessionQuestion } from "@/lib/practice/exam-questions";

function marksLabel(marks: number) {
  return `${marks} mark${marks === 1 ? "" : "s"}`;
}

/**
 * The question, either in full while it is being answered or folded under the
 * mark once it has been. Folded, it keeps its number and source visible so the
 * report still says which question it is about.
 *
 * Memoised: its question does not change while it is being answered, and the
 * session around it re-renders for its save indicator and working sheet.
 */
const ExamQuestionCard = memo(function ExamQuestionCard({
  sessionId,
  question,
  label,
  collapsible = false,
}: {
  sessionId: string;
  question: ExamSessionQuestion;
  /**
   * What the paper calls it -- "3", or "3(b)" for one part of it.
   *
   * It was this part's position in the session, so the fourth part of question
   * 3 was headed "Question 4". A student checking their working against the
   * paper in front of them was reading two different numbering systems.
   */
  label: string;
  collapsible?: boolean;
}) {
  const marks = marksLabel(question.marks);
  const tariff = examQuestionTariffNote(question);
  const chips = (
    <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
      <span className="rounded-full bg-[var(--color-glass-subtle)] px-2.5 py-1 capitalize text-text-secondary">
        {question.difficulty}
      </span>
      {question.origin === "jami_generated" ? (
        <span className="rounded-full bg-warm-accent/15 px-2.5 py-1 text-warm-accent">Jami-created</span>
      ) : null}
    </div>
  );
  // The printed page is the question; its transcription is kept for screen readers.
  const printed = examQuestionShowsPrintedPage(question);
  const body = (
    <>
      <StudyText
        as="div"
        text={question.prompt}
        className={printed ? "sr-only" : "mt-5 whitespace-pre-wrap text-base leading-8 text-text-primary sm:text-lg"}
      />
      <ExamQuestionAssets sessionId={sessionId} questionId={question.id} assets={question.assets} />
    </>
  );

  if (collapsible) {
    return (
      <details className="app-panel group w-full min-w-0 overflow-hidden rounded-xl sm:rounded-2xl">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 sm:px-6 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-text-primary">
              Question {label}
              <span className="font-normal text-text-muted"> · {marks}</span>
            </span>
            <span className="mt-0.5 block truncate text-xs text-text-muted">
              {examQuestionProvenanceLine(question)}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-text-secondary">
            <span className="group-open:hidden">Show question</span>
            <span className="hidden group-open:inline">Hide</span>
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              fill="none"
              className="h-4 w-4 transition-transform duration-fast group-open:rotate-180"
            >
              <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </summary>
        <div className="border-t border-[var(--color-border)] px-4 pb-5 pt-4 sm:px-6">
          {chips}
          {body}
        </div>
      </details>
    );
  }

  return (
    <Card padding="md">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-lg font-semibold tracking-tight text-text-primary">Question {label}</h2>
          {chips}
        </div>
        <span className="shrink-0 rounded-full border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-3 py-1 text-xs font-semibold tabular-nums text-text-primary">
          {marks}
        </span>
      </div>
      <p className="mt-1 text-xs text-text-muted">{examQuestionProvenanceLine(question)}</p>
      {tariff ? <p className="mt-1.5 text-xs leading-5 text-text-muted">{tariff}</p> : null}
      {body}
    </Card>
  );
});

export default ExamQuestionCard;

/**
 * The question as the head of its sheet.
 *
 * With a sheet the question is not a card in another column -- it is the
 * paper below. So what the card would have said moves here: its number, what
 * it is worth, and which paper it came off.
 */
export function ExamSheetQuestionHeader({
  question,
  questionNumber,
  part,
}: {
  question: ExamSessionQuestion;
  questionNumber: string;
  /** Which part of a question with several this is, when it has several. */
  part: { label: string; index: number; count: number } | null;
}) {
  const tariff = examQuestionTariffNote(question);
  return (
    <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-[var(--color-border)] px-4 py-3 sm:px-5">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-base font-semibold tracking-tight text-text-primary">
          Question {questionNumber}
          {part ? <span className="text-text-secondary"> {part.label || `part ${part.index + 1}`}</span> : null}
        </h2>
        {part ? (
          <p className="shrink-0 text-xs text-text-muted">
            Part {part.index + 1} of {part.count}
          </p>
        ) : null}
        <p className="truncate text-xs text-text-muted">{examQuestionProvenanceLine(question)}</p>
      </div>
      <span className="shrink-0 rounded-full border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-2.5 py-1 text-xs font-semibold tabular-nums text-text-primary">
        {marksLabel(question.marks)}
      </span>
      {tariff ? <p className="basis-full text-xs leading-5 text-text-muted">{tariff}</p> : null}
    </header>
  );
}
