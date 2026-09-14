"use client";

import { useState, type ElementType, type ReactNode } from "react";
import { Button, Card, StudyText } from "@/components/ui";
import JamiTutorIcon from "@/components/ui/JamiTutorIcon";
import { wrapBareLatex } from "@/lib/study/math-text";
import type { PublicExamAttempt } from "@/lib/practice/exam-projections";
import { examReviewFailureMessage } from "@/lib/practice/exam-marking-failure";
import { breakdownExamMarkReport, examCriterionMarks } from "@/lib/practice/exam-mark-report";
import type { PracticePaperCriterionResult } from "@/lib/practice/practice-papers";
import ExamPrivateImage from "@/components/practice/ExamPrivateImage";
import ExamSubmittedAnswer from "@/components/practice/ExamSubmittedAnswer";
import { ScoreMeter, scoreBand, type ScoreBandName } from "@/components/practice/ScoreBand";

/**
 * A marked question, read top to bottom in the order a student asks about it.
 *
 * 1. The mark, once, with how far it is from full marks.
 * 2. The question, folded away -- it has already been read.
 * 3. What was sent: the typed answer and the frozen working.
 * 4. The marking report: every scheme point, what it earned, and why -- with
 *    what they wrote set against what was needed wherever a mark was lost.
 * 5. The official scheme and a full-mark answer, behind an explicit reveal,
 *    because they end thinking and belong after the student's own answer.
 *
 * The earlier layout scattered this across six cards in an order that put the
 * student's own answer below the worked solution, so a mark could not be read
 * against the evidence it was given for without scrolling back and forth.
 */
export default function ExamQuestionMarkReport({
  attempt,
  firstAttempt,
  sessionId,
  question,
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
  /** The question, placed between the mark and the answer it was given for. */
  question?: ReactNode;
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

  const { unexplainedShortfall } = breakdownExamMarkReport(result);
  const criteria = result.criterionResults ?? [];
  const guidance = (result.improvements ?? []).filter(Boolean);
  const earlier = firstAttempt && firstAttempt.id !== attempt.id ? firstAttempt : undefined;
  const lost = result.maxMarks - result.awardedMarks;
  /*
   * Advice, never an empty box on a perfect answer. Reports marked before the
   * marker was asked for advice can have no line at all, and full marks with
   * nothing to say should still tell the student they are done.
   */
  const fullMarks = result.maxMarks > 0 && result.awardedMarks >= result.maxMarks;
  const advice = result.nextStep?.trim() || (fullMarks ? "Full marks — move on." : "");

  return (
    <div className="space-y-4 sm:space-y-5">
      <MarkSummary attempt={attempt} firstAttempt={earlier} />

      {question}

      <ExamSubmittedAnswer attempt={attempt} sessionId={sessionId} title="Your answer and working" />
      {earlier ? (
        <ExamSubmittedAnswer
          attempt={earlier}
          sessionId={sessionId}
          title="Your first attempt"
          note={`Marked ${earlier.result?.awardedMarks ?? 0}/${earlier.result?.maxMarks ?? 0}`}
        />
      ) : null}

      <Card padding="md">
        <ReportHeading
          eyebrow="Marking report"
          title="How your marks were awarded"
          aside={
            <span className="text-sm font-semibold tabular-nums text-text-secondary">
              {result.awardedMarks} of {result.maxMarks} mark{result.maxMarks === 1 ? "" : "s"}
            </span>
          }
        />

        {/*
          * A mark that could not be reconciled against its own criteria is
          * shown as what it is. It has already been through a second marker,
          * so presenting it as a settled score would be the quiet part of the
          * problem: the number rests on reasons that could not be checked.
          */}
        {result.markConsistency?.status === "unverifiable" ? (
          <Notice tone="warning" className="mt-4">
            Jami could not check this mark against the scheme point by point, so treat it as a guide
            rather than a settled score. Asking for a second opinion is worthwhile here.
          </Notice>
        ) : null}

        {result.feedback ? (
          <ReportText
            as="p"
            text={result.feedback}
            className="mt-4 text-sm leading-7 text-text-secondary"
          />
        ) : null}

        {advice ? (
          <div className="mt-4 rounded-xl border border-accent/25 bg-accent/10 px-4 py-3">
            <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-accent">Advice</p>
            <ReportText
              as="p"
              text={advice}
              className="mt-1 text-sm font-medium leading-6 text-text-primary"
            />
          </div>
        ) : null}

        {criteria.length > 0 ? (
          <ol className="mt-5 divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
            {criteria.map((item, index) => (
              <CriterionRow key={`${item.criterion}-${index}`} item={item} />
            ))}
          </ol>
        ) : null}

        {unexplainedShortfall ? (
          guidance.length > 0 ? (
            <div className="mt-5 border-t border-[var(--color-border)] pt-4">
              <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-text-muted">
                Where the other {lost} mark{lost === 1 ? " went" : "s went"}
              </p>
              <ul className="mt-2 space-y-2">
                {guidance.map((item, index) => (
                  <li key={`${item}-${index}`} className="flex gap-2.5 text-sm leading-6 text-text-primary">
                    <span aria-hidden="true" className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-warning-mark)]" />
                    <ReportText as="span" text={item} />
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <Notice tone="neutral" className="mt-5">
              {lost} mark{lost === 1 ? " was" : "s were"} not awarded, and Jami did not say which.
              Ask for a second opinion to find out.
            </Notice>
          )
        ) : criteria.length === 0 ? (
          <p className="mt-4 text-sm text-text-muted">Every mark on this question was awarded.</p>
        ) : null}

        {result.transcriptionNote ? (
          <Notice tone="neutral" className="mt-5" title="How your working was read">
            {result.transcriptionNote}
          </Notice>
        ) : null}
      </Card>

      {attempt.officialMarkScheme || result.modelAnswer ? (
        <Card padding="md">
          <ReportHeading
            eyebrow="Mark scheme"
            title="What the scheme awards"
            description="Open these after reading your report, and compare them with your own answer."
          />
          <div className="mt-4 space-y-2">
            {attempt.officialMarkScheme ? (
              <Reveal label="Official mark scheme" hint="The exam board's published page">
                {/*
                  * The page itself, as the board printed it. A retelling of a
                  * scheme loses its layout, its abbreviations and its guidance
                  * notes, which are the parts a student learns examining from.
                  * The text stays as the fallback for a page that cannot load.
                  */}
                <ExamPrivateImage
                  key={attempt.id}
                  alt="The published mark scheme page for this question"
                  className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-white"
                  path={`/api/practice/exam-sessions/${encodeURIComponent(sessionId)}/scheme/${encodeURIComponent(attempt.id)}`}
                  fallback={
                    <ReportText
                      as="div"
                      text={attempt.officialMarkScheme}
                      className="whitespace-pre-wrap text-sm leading-7 text-text-secondary"
                    />
                  }
                />
              </Reveal>
            ) : null}
            {result.modelAnswer ? (
              <Reveal label="A full-mark answer" hint="Written by Jami against the scheme">
                <ReportText
                  as="div"
                  text={result.modelAnswer}
                  className="whitespace-pre-wrap text-sm leading-7 text-text-secondary"
                />
              </Reveal>
            ) : null}
          </div>
        </Card>
      ) : null}

      {onRetry || onReview || onAsk || onNext ? (
        <div className="flex flex-col-reverse gap-3 border-t border-[var(--color-border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
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
                <span className="inline-flex items-center gap-1.5">
                  <JamiTutorIcon className="h-4 w-4 text-accent" />
                  Ask Jami
                </span>
              </Button>
            ) : null}
          </div>
          {onNext ? (
            <Button type="button" size="lg" className="w-full sm:w-auto" onClick={onNext}>
              {nextLabel}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The mark, once, and what has happened to it since it was given. */
function MarkSummary({
  attempt,
  firstAttempt,
}: {
  attempt: PublicExamAttempt;
  firstAttempt?: PublicExamAttempt;
}) {
  const result = attempt.result;
  if (!result) return null;
  const tone = scoreBand(result);
  const first = attempt.attemptNumber === 2 ? firstAttempt?.result : undefined;
  const improved = first ? result.awardedMarks - first.awardedMarks : null;

  return (
    <Card tone="warm" padding="lg">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-text-secondary">
            Your mark{attempt.attemptNumber === 2 ? " · second try" : ""}
          </p>
          <p className="mt-2 flex items-baseline font-semibold tabular-nums tracking-tight text-text-primary">
            <span className="text-5xl leading-none sm:text-6xl">{result.awardedMarks}</span>
            <span className="ml-1 text-2xl leading-none text-text-muted sm:text-3xl">/{result.maxMarks}</span>
          </p>
        </div>
        <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${tone.badge}`}>
          {tone.caption}
        </span>
      </div>

      <ScoreMeter
        awardedMarks={result.awardedMarks}
        maxMarks={result.maxMarks}
        tone={tone}
        className="mt-5"
      />

      <div className="mt-4 space-y-1.5 empty:hidden">
        {first && improved !== null ? (
          <StatusLine>
            First try {first.awardedMarks}/{first.maxMarks}
            {improved > 0 ? ` · ${improved} mark${improved === 1 ? "" : "s"} better` : ""}
            {improved === 0 ? " · the same mark this time" : ""}
          </StatusLine>
        ) : null}
        {/*
          * A checked mark says it was checked, and what the check did. Without
          * this the button disappeared and the number sometimes moved, and a
          * correction could not be told from a misremembered score.
          */}
        {attempt.reviewUsed ? (
          <StatusLine>
            {typeof attempt.reviewOriginalScore === "number" &&
            attempt.reviewOriginalScore !== result.awardedMarks
              ? `Checked: ${attempt.reviewOriginalScore}/${result.maxMarks} → ${result.awardedMarks}/${result.maxMarks}`
              : "Checked — your mark stayed the same."}
          </StatusLine>
        ) : null}
        {/*
          * Both read the attempt rather than a click, so a refresh mid-check
          * still says a check is running, and a failed one says so.
          */}
        {attempt.reviewStatus === "reviewing" ? (
          <StatusLine pulse>Jami is checking this mark. It carries on if you leave this page.</StatusLine>
        ) : null}
        {attempt.reviewStatus === "failed" ? (
          <StatusLine>
            {attempt.reviewFailure?.message ?? examReviewFailureMessage("marking_failed")}
          </StatusLine>
        ) : null}
      </div>
    </Card>
  );
}

const CRITERION_STATE: Record<
  Exclude<ScoreBandName, "uncounted">,
  { label: string; icon: string; disc: string }
> = {
  full: {
    label: "Awarded",
    icon: "m4.5 8.2 2.4 2.4 4.6-5",
    disc: "bg-[var(--color-success-muted)] text-[var(--color-success-mark)]",
  },
  part: {
    label: "Partly awarded",
    icon: "M4.5 8h7",
    disc: "bg-warning-muted text-[var(--color-warning-mark)]",
  },
  none: {
    label: "Not awarded",
    icon: "m5.5 5.5 5 5m0-5-5 5",
    disc: "border border-[var(--color-border-strong)] text-[var(--color-error-mark)]",
  },
};

/**
 * One scheme point: what it earned, and why.
 *
 * Where a mark was lost this sets what the student wrote against what was
 * needed. The scheme's side alone tells a student the answer without telling
 * them what was wrong with theirs.
 */
function CriterionRow({ item }: { item: PracticePaperCriterionResult }) {
  const { awarded, available } = examCriterionMarks(item);
  const tone = scoreBand({ awardedMarks: awarded, maxMarks: available });
  const state = CRITERION_STATE[tone.band === "uncounted" ? "none" : tone.band];
  const full = tone.band === "full";
  const compare = !full && Boolean(item.schemeValue?.trim() || item.candidateValue?.trim());

  return (
    <li className="flex gap-3 py-4 last:pb-0">
      <span
        aria-hidden="true"
        className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${state.disc}`}
      >
        <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
          <path d={state.icon} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 text-sm font-medium leading-6 text-text-primary">
            <span className="sr-only">{state.label}: </span>
            <ReportText as="span" text={item.criterion} />
          </p>
          <span
            className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums ${tone.badge}`}
          >
            {awarded}/{available}
          </span>
        </div>

        {/*
          * Only a mark that was earned quotes the line that earned it. Where a
          * mark was lost the note quoted the student's own answer back at them
          * -- which they wrote, can see, and which the comparison beneath says
          * again -- so it is gone rather than repeated.
          */}
        {item.evidence && full ? (
          <p className="mt-1 text-sm leading-6 text-text-muted">
            <span className="font-medium text-text-secondary">Why: </span>
            <ReportText as="span" text={item.evidence} />
          </p>
        ) : null}

        {compare ? (
          <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl bg-[var(--color-glass-strong)] px-3 py-2">
              <p className="text-2xs font-semibold uppercase tracking-wide text-text-muted">You wrote</p>
              <ReportText
                as="p"
                text={item.candidateValue?.trim() || "nothing here"}
                className="mt-0.5 text-sm leading-6 text-text-primary"
              />
            </div>
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-success-muted)] px-3 py-2">
              <p className="text-2xs font-semibold uppercase tracking-wide text-text-muted">Needed</p>
              <ReportText
                as="p"
                text={item.schemeValue?.trim() || item.criterion}
                className="mt-0.5 text-sm leading-6 text-text-primary"
              />
            </div>
          </div>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Report text, with any LaTeX the scheme or marker wrote bare wrapped so it
 * renders: a column vector rather than `\begin{pmatrix} 4 \\ -3 \end{pmatrix}`.
 */
function ReportText({ text, as, className }: { text: string; as?: ElementType; className?: string }) {
  return <StudyText as={as} text={wrapBareLatex(text)} className={className} />;
}

function ReportHeading({
  eyebrow,
  title,
  description,
  aside,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
      <div className="min-w-0">
        <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-text-muted">{eyebrow}</p>
        <h3 className="mt-1 text-lg font-semibold tracking-tight text-text-primary">{title}</h3>
        {description ? <p className="mt-1 text-sm leading-6 text-text-muted">{description}</p> : null}
      </div>
      {aside}
    </div>
  );
}

/** Material held back until the student asks for it. */
function Reveal({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition duration-fast hover:bg-[var(--color-glass-medium)]"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-text-primary">{label}</span>
          <span className="block text-xs text-text-muted">{hint}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-text-secondary">
          {open ? "Hide" : "Show"}
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            fill="none"
            className={`h-4 w-4 transition-transform duration-fast ${open ? "rotate-180" : ""}`}
          >
            <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {open ? <div className="border-t border-[var(--color-border)] px-4 py-4">{children}</div> : null}
    </div>
  );
}

function Notice({
  tone,
  title,
  className = "",
  children,
}: {
  tone: "warning" | "neutral";
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 text-sm leading-6 ${
        tone === "warning"
          ? "border-warning/30 bg-warning-muted text-text-secondary"
          : "border-[var(--color-border)] bg-[var(--color-glass-subtle)] text-text-muted"
      } ${className}`}
    >
      {title ? <p className="text-xs font-semibold text-text-secondary">{title}</p> : null}
      {children}
    </div>
  );
}

function StatusLine({ pulse = false, children }: { pulse?: boolean; children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-sm leading-6 text-text-secondary">
      <span
        aria-hidden="true"
        className={`mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent ${pulse ? "animate-pulse" : ""}`}
      />
      <span>{children}</span>
    </p>
  );
}
