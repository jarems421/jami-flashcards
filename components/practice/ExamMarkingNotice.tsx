import ExamSubmittedAnswer from "@/components/practice/ExamSubmittedAnswer";
import { Button, Card } from "@/components/ui";
import type { PublicExamAttempt } from "@/lib/practice/exam-projections";
import { examMarkingFailureIsRetryable, examMarkingFailureMessage } from "@/lib/practice/exam-marking-failure";

/**
 * An answer being marked, or one whose marking stopped part way.
 *
 * A durable job does the marking, and it writes down its own failures, so an
 * attempt reading "marking" long after its last sign of life is one whose job
 * did not survive to write anything -- a redeploy mid-call, or a crash. Past
 * its lease it is not in progress, it is stranded, and the student is offered
 * the one thing that actually helps.
 */
export function ExamMarkingInProgress({
  attempt,
  sessionId,
  stale,
  submitting,
  onMarkAgain,
}: {
  attempt: PublicExamAttempt;
  sessionId: string;
  /** Past its lease with no sign of life. */
  stale: boolean;
  submitting: boolean;
  onMarkAgain: () => void;
}) {
  return (
    <>
      <Card padding="md">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className={`h-2 w-2 shrink-0 rounded-full ${
              stale ? "bg-[var(--color-warning-mark)]" : "animate-pulse bg-accent"
            }`}
          />
          <h3 className="text-base font-semibold text-text-primary">
            {stale ? "This one is taking too long" : "Jami is marking this one"}
          </h3>
        </div>
        <p className="mt-2 text-sm leading-5 text-text-muted">
          {stale
            ? "Your answer and working are saved exactly as you sent them. Marking looks like it stopped part way — running it again will not change what is marked."
            : "Your answer is saved and is being marked now. This usually takes under a minute, it carries on if you leave this page, and this page updates on its own."}
        </p>
        {stale ? (
          <Button className="mt-4" variant="primary" disabled={submitting} onClick={onMarkAgain}>
            Mark it again
          </Button>
        ) : null}
      </Card>
      {stale ? <ExamSubmittedAnswer attempt={attempt} sessionId={sessionId} title="What was submitted" /> : null}
    </>
  );
}

/**
 * A marking that failed.
 *
 * It used to render nothing at all, so a student whose marking failed saw the
 * question and then empty space with no way forward. The answer is frozen
 * here, on the server and in the rules, so it is shown rather than offered for
 * editing: the wording, the tools, the saved draft and what gets resubmitted
 * all say the same thing.
 */
export function ExamMarkingFailed({
  attempt,
  sessionId,
  submitting,
  onRetry,
}: {
  attempt: PublicExamAttempt;
  sessionId: string;
  submitting: boolean;
  onRetry: () => void;
}) {
  /*
   * The reason comes from the attempt, because the request that submitted it
   * is long gone by the time the marking fails. A question that changed under
   * a live session and a marker that fell over are not the same news, and
   * only one of them is worth pressing a button about.
   */
  const retryable = examMarkingFailureIsRetryable(attempt.markingFailure?.code ?? "marking_failed");
  return (
    <>
      <Card padding="md" className="border-error/30">
        <h3 className="text-base font-semibold text-text-primary">Jami couldn&apos;t mark this one</h3>
        <p className="mt-2 text-sm leading-5 text-text-muted">
          {attempt.markingFailure?.message ?? examMarkingFailureMessage("marking_failed")}
        </p>
        {retryable ? (
          <>
            <p className="mt-2 text-sm leading-5 text-text-muted">
              Nothing has been changed — this just runs the marker over them again.
            </p>
            <Button className="mt-4" disabled={submitting} onClick={onRetry}>
              {submitting ? "Marking…" : "Retry marking"}
            </Button>
          </>
        ) : null}
      </Card>
      <ExamSubmittedAnswer attempt={attempt} sessionId={sessionId} title="What was submitted" />
    </>
  );
}
