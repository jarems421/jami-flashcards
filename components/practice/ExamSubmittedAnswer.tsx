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
      <h3 className="text-base font-semibold text-text-primary">{title}</h3>
      {note ? <p className="mt-1 text-sm text-text-muted">{note}</p> : null}
      {answer ? (
        <StudyText
          as="div"
          text={answer}
          className="mt-3 whitespace-pre-wrap rounded-2xl bg-[var(--color-glass-subtle)] p-3 text-sm leading-6 text-text-primary"
        />
      ) : (
        <p className="mt-3 text-sm text-text-muted">
          You submitted handwritten working without a typed answer.
        </p>
      )}
      {attempt.workingIncluded ? (
        <ExamPrivateImage
          key={attempt.id}
          alt="Your frozen working for this question"
          className="mt-3 border border-[var(--color-border)] bg-white"
          path={`/api/practice/exam-sessions/${encodeURIComponent(sessionId)}/working/${encodeURIComponent(attempt.id)}`}
        />
      ) : null}
    </Card>
  );
}
