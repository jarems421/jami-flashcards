import ExamQuestionMarkReport from "@/components/practice/ExamQuestionMarkReport";
import { Card, StudyText } from "@/components/ui";
import type { PublicExamAttempt, PublicExamQuestionResult } from "@/lib/practice/exam-projections";

/**
 * What a second try is for: the first mark, and the points it scored nothing on.
 *
 * Opening the retry used to take the first mark off the screen entirely -- the
 * feedback, the worked answer and the scheme all went with it, which are the
 * things a second attempt is supposed to be guided by. Folded away rather than
 * removed, so consulting them costs a click and not the draft.
 */
export default function ExamRetryBrief({
  firstAttempt,
  result,
  sessionId,
  onAsk,
}: {
  firstAttempt: PublicExamAttempt;
  result: PublicExamQuestionResult;
  sessionId: string;
  onAsk: () => void;
}) {
  const targets = (result.criterionResults ?? []).filter((item) => (item.awardedMarks ?? 0) === 0);

  return (
    <Card padding="md" tone="warm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-text-secondary">Second try</p>
        <p className="text-sm font-semibold tabular-nums text-text-secondary">
          First try {result.awardedMarks}/{result.maxMarks}
        </p>
      </div>
      {targets.length ? (
        <>
          <p className="mt-3 text-sm font-medium text-text-primary">Aim to cover</p>
          <ul className="mt-2 space-y-2">
            {targets.map((item, itemIndex) => (
              <li key={`${item.criterion}-${itemIndex}`} className="flex gap-2.5 text-sm leading-6 text-text-primary">
                <span aria-hidden="true" className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <StudyText as="span" text={item.criterion} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <details className="mt-4 border-t border-[var(--color-border)] pt-3">
        <summary className="cursor-pointer text-sm font-semibold text-text-primary">First try feedback</summary>
        <div className="mt-3">
          <ExamQuestionMarkReport attempt={firstAttempt} sessionId={sessionId} onAsk={onAsk} />
        </div>
      </details>
    </Card>
  );
}
