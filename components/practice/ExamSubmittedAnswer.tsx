"use client";

import { Card, StudyText } from "@/components/ui";
import ExamPrivateImage from "@/components/practice/ExamPrivateImage";
import type { PublicExamAttempt } from "@/lib/practice/exam-projections";

/**
 * What the student actually sent, shown back to them and not editable.
 *
 * The mark report showed the working image and never the typed answer, so a
 * mark could only be read against a memory of what was written -- and after a
 * retry the first attempt's words were gone from the screen entirely. The same
 * block covers a failed marking, where the answer is frozen and the student is
 * deciding whether to run the marker over it again.
 *
 * Read-only on purpose. This is the evidence a mark was given for, and an
 * editable box over frozen evidence is the contradiction it used to be.
 */
export default function ExamSubmittedAnswer({
  attempt,
  sessionId,
  title = "Your answer",
  note,
}: {
  attempt: PublicExamAttempt;
  sessionId: string;
  title?: string;
  note?: string;
}) {
  const answer = attempt.answerText?.trim() ?? "";
  if (!answer && !attempt.workingIncluded) return null;
  return (
    <Card padding="md">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-base font-semibold tracking-tight text-text-primary">{title}</h3>
        {note ? <p className="text-xs font-medium text-text-muted">{note}</p> : null}
      </div>

      <div className="mt-4 space-y-4">
        <div>
          <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-text-muted">
            Typed answer
          </p>
          {answer ? (
            <StudyText
              as="div"
              text={answer}
              // An even border all round: a single left stripe on a rounded box
              // curves away from the text and reads as a gap down the left side.
              className="mt-2 whitespace-pre-wrap rounded-xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-4 py-3 text-sm leading-7 text-text-primary"
            />
          ) : (
            <p className="mt-2 rounded-xl bg-[var(--color-glass-subtle)] px-4 py-3 text-sm text-text-muted">
              No typed answer — only handwritten working was sent.
            </p>
          )}
        </div>

        {attempt.workingIncluded ? (
          <div>
            <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-text-muted">
              Working
            </p>
            <ExamPrivateImage
              key={attempt.id}
              alt="Your frozen working for this question"
              className="mt-2 overflow-hidden rounded-xl border border-[var(--color-border)] bg-white"
              path={`/api/practice/exam-sessions/${encodeURIComponent(sessionId)}/working/${encodeURIComponent(attempt.id)}`}
            />
          </div>
        ) : null}
      </div>
    </Card>
  );
}
