"use client";

import { Button, Card, StudyText } from "@/components/ui";
import type { PublicExamAttempt } from "@/lib/practice/exam-projections";
import ExamPrivateImage from "@/components/practice/ExamPrivateImage";

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
  onNext(): void;
  nextLabel: string;
  reviewing?: boolean;
}) {
  const result = attempt.result;
  if (!result) return null;
  const criteria = result.criterionResults ?? [];
  const earned = criteria.filter((item) => (item.awardedMarks ?? 0) > 0);
  const missed = criteria.filter((item) => (item.awardedMarks ?? 0) === 0);
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
        <p className="mt-4 text-sm leading-6 text-text-secondary">{result.feedback}</p>
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
                <p className="text-sm font-medium text-text-primary">{item.criterion}</p>
                {item.evidence ? (
                  <p className="mt-1 text-sm leading-5 text-text-muted">{item.evidence}</p>
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
                <p className="text-sm font-medium text-text-primary">{item.criterion}</p>
                {item.schemeValue ? (
                  <p className="mt-1 text-sm leading-5 text-text-muted">
                    The scheme wanted: {item.schemeValue}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-text-muted">Nothing essential was missing.</p>
        )}
        {result.nextStep ? (
          <p className="mt-4 rounded-2xl bg-[var(--color-glass-subtle)] p-3 text-sm font-medium leading-5 text-text-secondary">
            Next: {result.nextStep}
          </p>
        ) : null}
      </Card>

      {attempt.workingIncluded ? (
        <Card padding="md">
          <h3 className="text-base font-semibold text-text-primary">The working Jami read</h3>
          <p className="mt-1 text-sm text-text-muted">
            This sheet was sent with your answer and marked alongside it.
          </p>
          <ExamPrivateImage
            key={attempt.id}
            alt="Your frozen working for this question"
            className="mt-3 border border-[var(--color-border)] bg-white"
            path={`/api/practice/exam-sessions/${encodeURIComponent(sessionId)}/working/${encodeURIComponent(attempt.id)}`}
          />
        </Card>
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
        <Button type="button" className="ml-auto" onClick={onNext}>
          {nextLabel}
        </Button>
      </div>
    </div>
  );
}
