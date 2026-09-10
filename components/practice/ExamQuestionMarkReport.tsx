"use client";

import { Button, Card, StudyText } from "@/components/ui";
import type { PublicExamAttempt } from "@/lib/practice/exam-projections";
import { breakdownExamMarkReport } from "@/lib/practice/exam-mark-report";
import ExamSubmittedAnswer from "@/components/practice/ExamSubmittedAnswer";

/**
 * What the mark actually was, and what would have earned more.
 *
 * The order is deliberate and does not change: the mark first, because that is
 * the question the student asked; then what the scheme credited, so the number
 * is evidenced rather than asserted; then what it wanted and did not get. The
 * worked answer comes last, after they have read why their own fell short.
 */
export default function ExamQuestionMarkReport({
  attempt,
  firstAttempt,
  sessionId,
  onRetry,
  onReview,
  onAsk,
  onNext,
  nextLabel,
  reviewing,
}: {
  attempt: PublicExamAttempt;
  firstAttempt?: PublicExamAttempt;
  sessionId: string;
  onRetry?: () => void;
  onReview?: () => void;
  onAsk?: () => void;
  /**
   * Absent when the report is a reference rather than a step in the session --
   * during a guided retry, where the first mark has to stay readable without
   * offering to move the student on from the answer they are writing.
   */
  onNext?: () => void;
  nextLabel?: string;
  reviewing?: boolean;
}) {
  const result = attempt.result;
  if (!result) return null;
  const { earned, missed, unexplainedShortfall } = breakdownExamMarkReport(result);
  const guidance = (result.improvements ?? []).filter(Boolean);
  const percent = result.maxMarks ? Math.round((result.awardedMarks / result.maxMarks) * 100) : 0;
  const improved =
    attempt.attemptNumber === 2 && firstAttempt?.result
      ? result.awardedMarks - firstAttempt.result.awardedMarks
      : null;

  return (
    <div className="space-y-4">
      <Card tone="warm" padding="lg">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary">
          {attempt.attemptNumber === 2 ? "Your second try" : "Your mark"}
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-x-3 gap-y-1">
          <span className="text-5xl font-semibold tracking-tight text-text-primary">
            {result.awardedMarks}
          </span>
          <span className="pb-1 text-lg text-text-muted">/ {result.maxMarks}</span>
          <span className="pb-1.5 ml-auto text-sm font-medium tabular-nums text-text-muted">
            {percent}%
          </span>
        </div>
        <div
          aria-hidden="true"
          className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-glass-strong)]"
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-500"
            style={{ width: `${Math.max(2, percent)}%` }}
          />
        </div>
        {improved !== null && firstAttempt?.result ? (
          <p className="mt-4 text-sm text-text-secondary">
            First try {firstAttempt.result.awardedMarks}/{firstAttempt.result.maxMarks}
            {improved > 0 ? ` · ${improved} mark${improved === 1 ? "" : "s"} better` : ""}
            {improved === 0 ? " · the same mark this time" : ""}
          </p>
        ) : null}
        {/*
          * A checked mark said nothing about having been checked. The button
          * disappeared, the number sometimes moved, and a student had no way to
          * tell a correction from a misremembered score.
          */}
        {attempt.reviewUsed ? (
          <p className="mt-3 text-sm font-medium text-text-secondary">
            {typeof attempt.reviewOriginalScore === "number" &&
            attempt.reviewOriginalScore !== result.awardedMarks
              ? `Checked: ${attempt.reviewOriginalScore}/${result.maxMarks} → ${result.awardedMarks}/${result.maxMarks}`
              : "Checked — your mark stayed the same."}
          </p>
        ) : null}
        {/*
          * The same maths-aware renderer as the question. Feedback, credited
          * evidence and criteria all quote the student's own expressions back
          * at them, and rendering those as plain text meant the same formula
          * appeared one way in the question and another in the explanation of
          * why it did not earn a mark.
          */}
        {/*
          * A mark that could not be reconciled against its own criteria is
          * shown as what it is. It has already been through a second marker --
          * an unreconciled result triggers one -- so this is what is left when
          * that did not settle it, and presenting it as a finished score would
          * be the quiet part of the problem: the number rests on reasons that
          * could not be checked.
          */}
        {result.markConsistency?.status === "unverifiable" ? (
          <p className="mt-4 rounded-2xl border border-warm-accent/30 bg-warm-accent/10 p-3 text-sm leading-5 text-text-secondary">
            Jami could not check this mark against the scheme point by point, so treat it as a guide
            rather than a settled score. Asking for a second opinion below is worthwhile here.
          </p>
        ) : null}
        <StudyText
          as="p"
          text={result.feedback}
          className="mt-4 text-sm leading-6 text-text-secondary"
        />
      </Card>

      {earned.length > 0 ? (
        <Card padding="md">
          <h3 className="text-base font-semibold text-text-primary">What earned marks</h3>
          <ul className="mt-3 space-y-2">
            {earned.map((item, index) => (
              <li
                key={`${item.criterion}-${index}`}
                className="rounded-2xl border border-success/25 bg-success/10 p-3"
              >
                <StudyText as="p" text={item.criterion} className="text-sm font-medium text-text-primary" />
                {item.evidence ? (
                  <StudyText as="p" text={item.evidence} className="mt-1 text-sm leading-5 text-text-muted" />
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card padding="md">
        <h3 className="text-base font-semibold text-text-primary">What to add next time</h3>
        {missed.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {missed.map((item, index) => (
              <li
                key={`${item.criterion}-${index}`}
                className="rounded-2xl bg-[var(--color-glass-subtle)] p-3"
              >
                <StudyText as="p" text={item.criterion} className="text-sm font-medium text-text-primary" />
                {typeof item.maxMarks === "number" && (item.awardedMarks ?? 0) > 0 ? (
                  <p className="mt-1 text-xs font-medium text-text-secondary">
                    {item.awardedMarks} of {item.maxMarks} marks
                  </p>
                ) : null}
                {item.schemeValue ? (
                  <StudyText
                    as="p"
                    text={`The scheme wanted: ${item.schemeValue}`}
                    className="mt-1 text-sm leading-5 text-text-muted"
                  />
                ) : null}
              </li>
            ))}
          </ul>
        ) : unexplainedShortfall ? (
          <>
            {guidance.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {guidance.map((item, index) => (
                  <li
                    key={`${item}-${index}`}
                    className="rounded-2xl bg-[var(--color-glass-subtle)] p-3 text-sm leading-5 text-text-primary"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-text-muted">
                {result.maxMarks - result.awardedMarks} mark
                {result.maxMarks - result.awardedMarks === 1 ? " was" : "s were"} not awarded. Read
                the feedback above for where they went.
              </p>
            )}
          </>
        ) : (
          <p className="mt-2 text-sm text-text-muted">Nothing essential was missing.</p>
        )}
        {result.nextStep ? (
          <p className="mt-4 rounded-2xl bg-[var(--color-glass-subtle)] p-3 text-sm font-medium leading-5 text-text-secondary">
            Next: {result.nextStep}
          </p>
        ) : null}
      </Card>

      {/*
        * The evidence the mark was given for, typed answer included. Showing
        * the working alone meant a mark could only be read against a memory of
        * what was written, and after a retry the first attempt's words were off
        * the screen altogether.
        */}
      <ExamSubmittedAnswer
        attempt={attempt}
        sessionId={sessionId}
        title="What Jami marked"
        note="Exactly what was sent, as it was sent."
      />

      {firstAttempt && firstAttempt.id !== attempt.id ? (
        <ExamSubmittedAnswer
          attempt={firstAttempt}
          sessionId={sessionId}
          title="Your first attempt"
          note={`Marked ${firstAttempt.result?.awardedMarks ?? 0}/${firstAttempt.result?.maxMarks ?? 0}.`}
        />
      ) : null}

      {result.transcriptionNote ? (
        <p className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-3 text-sm leading-5 text-text-muted">
          {result.transcriptionNote}
        </p>
      ) : null}

      {result.modelAnswer ? (
        <Card padding="md">
          <h3 className="text-base font-semibold text-text-primary">An answer that scores full marks</h3>
          <StudyText
            as="div"
            text={result.modelAnswer}
            className="mt-3 whitespace-pre-wrap text-sm leading-7 text-text-secondary"
          />
        </Card>
      ) : null}

      {attempt.officialMarkScheme ? (
        <details className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4">
          <summary className="cursor-pointer text-sm font-semibold text-text-primary">
            Official mark scheme
          </summary>
          <StudyText
            as="div"
            text={attempt.officialMarkScheme}
            className="mt-3 whitespace-pre-wrap text-sm leading-6 text-text-secondary"
          />
        </details>
      ) : null}

      {onRetry || onReview || onAsk || onNext ? (
      <div className="flex flex-wrap items-center gap-2">
        {onRetry ? (
          <Button type="button" variant="secondary" onClick={onRetry}>
            Try it again
          </Button>
        ) : null}
        {onReview ? (
          <Button type="button" variant="ghost" disabled={reviewing} onClick={onReview}>
            {reviewing ? "Checking…" : "Check this mark"}
          </Button>
        ) : null}
        {onAsk ? (
          <Button type="button" variant="ghost" onClick={onAsk}>
            Ask Jami
          </Button>
        ) : null}
        {onNext ? (
          <Button type="button" className="ml-auto" onClick={onNext}>
            {nextLabel}
          </Button>
        ) : null}
      </div>
      ) : null}
    </div>
  );
}
