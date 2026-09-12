"use client";

import { Button, Card, StudyText } from "@/components/ui";
import type { PublicExamAttempt } from "@/lib/practice/exam-projections";
import { examReviewFailureMessage } from "@/lib/practice/exam-marking-failure";
import { breakdownExamMarkReport } from "@/lib/practice/exam-mark-report";
import ExamSubmittedAnswer from "@/components/practice/ExamSubmittedAnswer";

/**
 * What the mark was, and -- the part that is actually worth reading -- what to
 * do differently.
 *
 * Shaped by what is known about feedback rather than by what is easy to render:
 *
 * Hattie and Timperley (2007) separate feedback into where am I going, how am I
 * going, and where to next, and find the last of those carries most of the
 * effect. They also rank its levels: comment on the task and on the process
 * helps, comment on the person does not. So "what to fix" now comes before
 * "what earned marks", and nothing here says anything about the student.
 *
 * Butler (1988), and Black and Wiliam after her, found a prominent grade
 * crowds out the comment beside it -- students given both engaged with neither.
 * This showed the mark three times over: a huge numeral, a percentage, and a
 * progress bar. It is now shown once, plainly, and the space goes to the part
 * that can be acted on.
 *
 * Shute (2008) on what makes formative feedback work: specific, manageable, and
 * elaborated rather than verification-only. A missed criterion used to say what
 * the scheme wanted and stop there, which tells a student the answer and not
 * what was wrong with theirs. It now sets what they wrote against what was
 * needed, which is the whole lesson in one line.
 *
 * The worked answer stays last, behind a disclosure: it is the thing that ends
 * thinking, so it comes after they have read why their own fell short.
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
  /*
   * A check in flight, as the server sees it. `reviewing` is this page's own
   * click and survives nothing; this survives a refresh, a new tab, and the
   * student walking away -- which a durable check now outlives.
   */
  const checking = attempt.reviewStatus === "reviewing";
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
        {/*
          * Once, not three times. A percentage and a progress bar on a
          * three-mark question restate the same number in two less precise
          * ways, and the more prominent the grade the less the comment beside
          * it is read.
          */}
        <div className="mt-2 flex flex-wrap items-end gap-x-2">
          <span className="text-3xl font-semibold tracking-tight text-text-primary">
            {result.awardedMarks}
          </span>
          <span className="pb-0.5 text-lg text-text-muted">/ {result.maxMarks}</span>
        </div>
        <div
          hidden
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
          * Both of these read the attempt rather than a click. Checking used to
          * be local state only, so a student who refreshed mid-check was shown
          * the button again and got a conflict for pressing it, and a check
          * that failed said nothing at all -- it simply looked unused.
          */}
        {attempt.reviewStatus === "reviewing" ? (
          <p className="mt-3 text-sm font-medium text-text-secondary">
            Jami is checking this mark. It carries on if you leave this page.
          </p>
        ) : null}
        {attempt.reviewStatus === "failed" ? (
          <p className="mt-3 text-sm leading-5 text-text-muted">
            {attempt.reviewFailure?.message ?? examReviewFailureMessage("marking_failed")}
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

      {/*
        * Where to next, first. It carries most of the effect of feedback and
        * used to sit third, under the mark and under a list of what already
        * went right -- which a student who scored well never scrolled to.
        */}
      <Card padding="md">
        <h3 className="text-base font-semibold text-text-primary">
          {missed.length > 0 || unexplainedShortfall ? "What to fix" : "Nothing was missing"}
        </h3>
        {result.nextStep ? (
          <p className="mt-3 rounded-2xl border border-accent/30 bg-accent/10 p-3 text-sm font-medium leading-5 text-text-primary">
            {result.nextStep}
          </p>
        ) : null}
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
                {/*
                  * What they wrote, against what was needed.
                  *
                  * This showed only the scheme's side, which tells a student
                  * the answer without telling them what was wrong with theirs
                  * -- and both halves were already on the criterion and already
                  * projected to the client. A student who wrote the right value
                  * under the wrong label learns nothing from "the scheme wanted
                  * -1" and everything from seeing it beside their own.
                  */}
                {item.schemeValue || item.candidateValue ? (
                  <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                    <div className="rounded-xl bg-[var(--color-glass-strong)] px-3 py-2">
                      <p className="text-2xs font-semibold uppercase tracking-wide text-text-muted">
                        You wrote
                      </p>
                      <StudyText
                        as="p"
                        text={item.candidateValue?.trim() || "nothing here"}
                        className="mt-0.5 text-sm leading-5 text-text-primary"
                      />
                    </div>
                    <div className="rounded-xl bg-success/10 px-3 py-2">
                      <p className="text-2xs font-semibold uppercase tracking-wide text-text-muted">
                        Needed
                      </p>
                      <StudyText
                        as="p"
                        text={item.schemeValue?.trim() || item.criterion}
                        className="mt-0.5 text-sm leading-5 text-text-primary"
                      />
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : unexplainedShortfall ? (
          guidance.length > 0 ? (
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
              {result.maxMarks - result.awardedMarks === 1 ? " was" : "s were"} not awarded, and
              Jami did not say which. Ask for a second opinion below.
            </p>
          )
        ) : !result.nextStep ? (
          <p className="mt-2 text-sm text-text-muted">
            Every mark on this question was awarded.
          </p>
        ) : null}
      </Card>

      {/*
        * What went right, second and quieter. Worth showing -- a student should
        * be able to see the mark was evidenced rather than asserted -- but it
        * is the part they already know, so it does not lead and it does not
        * need a card of its own shouting about it.
        */}
      {earned.length > 0 ? (
        <details className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4">
          <summary className="cursor-pointer text-sm font-semibold text-text-primary">
            What earned marks · {earned.length}
          </summary>
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
        </details>
      ) : null}

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
          <Button
            type="button"
            variant="ghost"
            disabled={reviewing || checking}
            onClick={onReview}
          >
            {reviewing || checking
              ? "Checking…"
              : attempt.reviewStatus === "failed"
                ? "Try checking again"
                : "Check this mark"}
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
