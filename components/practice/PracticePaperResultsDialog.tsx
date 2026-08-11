"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Button,
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
  Input,
  ProgressBar,
  SectionHeader,
  StudyText,
} from "@/components/ui";
import { ScoreMeter, scoreBand } from "./ScoreBand";
import type {
  PracticePaper,
  PracticePaperAttempt,
  PracticePaperQuestionResult,
  PracticePaperResult,
} from "@/lib/practice/practice-papers";
import {
  correctPracticePaperMark,
  getPracticePaperAttempts,
} from "@/services/study/practice-papers";
import { remarkPracticePaperQuestion } from "@/services/ai/practice-papers";

export default function PracticePaperResultsDialog({
  open,
  userId,
  paper,
  onClose,
  onChange,
}: {
  open: boolean;
  userId: string;
  paper: PracticePaper;
  onClose: () => void;
  onChange: (paper: PracticePaper) => void;
}) {
  const [attempts, setAttempts] = useState<PracticePaperAttempt[]>([]);
  const [tab, setTab] = useState<"report" | "history">("report");
  const [editingQuestionId, setEditingQuestionId] = useState("");
  const [revealedAnswers, setRevealedAnswers] = useState<Set<string>>(new Set());
  const [mark, setMark] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setTab("report");
    setRevealedAnswers(new Set());
    void getPracticePaperAttempts(userId, paper.id)
      .then(setAttempts)
      .catch(() => setAttempts([]));
  }, [open, paper.id, userId]);

  const correct = async () => {
    if (!editingQuestionId) return;
    setSaving(true);
    setError("");
    try {
      const updated = await correctPracticePaperMark({
        userId,
        paper,
        questionId: editingQuestionId,
        awardedMarks: Number(mark),
        reason,
      });
      onChange(updated);
      setEditingQuestionId("");
      setReason("");
      setMark("");
      setAttempts(await getPracticePaperAttempts(userId, paper.id));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not correct this mark."
      );
    } finally {
      setSaving(false);
    }
  };

  const recheck = async () => {
    if (!editingQuestionId || reason.trim().length < 3) return;
    setRechecking(true);
    setError("");
    try {
      const updated = await remarkPracticePaperQuestion({
        notebookId: paper.notebookId,
        questionId: editingQuestionId,
        reason,
      });
      onChange(updated);
      setEditingQuestionId("");
      setReason("");
      setMark("");
      setAttempts(await getPracticePaperAttempts(userId, paper.id));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not recheck this question."
      );
    } finally {
      setRechecking(false);
    }
  };

  const result = paper.result;
  const showOvertimeComparison = Boolean(
    result && paper.withinTimeResult && paper.overtimeStartedAt
  );
  const audit = paper.markingAudit;

  return (
    <Dialog open={open} onDismiss={onClose}>
      <DialogBackdrop />
      <DialogPanel className="max-h-[92vh] max-w-5xl overflow-y-auto p-0">
        {/*
          * The header carries what this attempt *was* -- which attempt, sat
          * under which conditions, marked against which scheme -- and then gets
          * out of the way. It used to also explain how to read the page below
          * it ("See the result first, then open any question…"), which is a
          * caption on something the reader can already see, sitting between
          * them and the score they opened the dialog for.
          */}
        <div className="border-b border-[var(--color-border)] px-5 pb-0 pt-5 sm:px-7 sm:pt-7">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <DialogTitle>Your paper, marked</DialogTitle>
              <p className="mt-1.5 truncate text-sm text-text-muted">
                {paper.title}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill>Attempt {paper.attemptCount}</StatusPill>
              <StatusPill>
                {paper.tutorEnabled
                  ? paper.tutorUsed
                    ? "Tutor-assisted · used"
                    : "Tutor-assisted · unused"
                  : "Exam conditions"}
              </StatusPill>
              <StatusPill>{paper.markScheme.label}</StatusPill>
            </div>
          </div>
          <div className="mt-5 flex gap-6" role="tablist" aria-label="Result view">
            {(
              [
                ["report", "This attempt"],
                ["history", "All attempts"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={`border-b-2 px-0.5 pb-3 text-sm font-semibold transition duration-fast ${
                  tab === value
                    ? "border-accent text-text-primary"
                    : "border-transparent text-text-muted hover:text-text-secondary"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="px-5 py-5 sm:px-7 sm:py-7">
          {error ? (
            <p className="mb-5 rounded-xl bg-error/10 p-3 text-sm text-error">
              {error}
            </p>
          ) : null}

          {tab === "report" && result ? (
            <div className="space-y-6">
              {showOvertimeComparison && paper.withinTimeResult ? (
                <div className="grid overflow-hidden rounded-2xl border border-accent/25 bg-accent/8 sm:grid-cols-[1.25fr_1fr]">
                  <ScorePanel
                    eyebrow="Within-time result"
                    result={paper.withinTimeResult}
                    primary
                  />
                  <div className="border-t border-accent/20 bg-[var(--color-glass-subtle)] p-5 sm:border-l sm:border-t-0 sm:p-6">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
                      Complete work
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-text-primary">
                      {result.awardedMarks}/{result.totalMarks}
                      <span className="ml-2 text-base text-text-secondary">
                        {result.percentage}%
                      </span>
                    </p>
                    <p className="mt-3 text-sm leading-6 text-text-secondary">
                      Overtime added {paper.overtimeMarksGained ?? 0} mark
                      {(paper.overtimeMarksGained ?? 0) === 1 ? "" : "s"}. The
                      within-time score stays your headline result.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-accent/25 bg-accent/8 p-5 sm:p-6">
                  <ScorePanel eyebrow="Overall result" result={result} primary />
                </div>
              )}

              {paper.gradeGuidance.kind !== "none" ? (
                <GradeContext paper={paper} />
              ) : null}

              <div className="grid gap-3 md:grid-cols-2">
                <ResultList title="What worked" items={result.strengths} />
                <ResultList title="Focus next" items={result.priorities.slice(0, 3)} />
              </div>

              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4 sm:flex sm:items-start sm:justify-between sm:gap-5">
                <div>
                  <p className="text-sm font-semibold text-text-primary">
                    AI-assisted marking — check important decisions
                  </p>
                  <p className="mt-1 max-w-2xl text-xs leading-5 text-text-muted">
                    Jami used an independent second marker and adjudicated any
                    disagreements. You can correct a reading or mark on every
                    question; the original audit remains attached to this attempt.
                  </p>
                </div>
                {audit ? (
                  <div className="mt-3 shrink-0 text-xs text-text-muted sm:mt-0 sm:text-right">
                    <p>{audit.disputedQuestionIds.length} reviewed dispute{audit.disputedQuestionIds.length === 1 ? "" : "s"}</p>
                    <p>{audit.thirdViewQuestionIds.length} visual third view{audit.thirdViewQuestionIds.length === 1 ? "" : "s"}</p>
                  </div>
                ) : null}
              </div>

              <div className="space-y-3">
                <SectionHeader
                  eyebrow="Question review"
                  title="Where each mark came from"
                  action={<BandSummary questions={result.questionResults} />}
                />
                {result.questionResults.map((question) => (
                  <QuestionResultCard
                    key={question.questionId}
                    question={question}
                    editing={editingQuestionId === question.questionId}
                    mark={mark}
                    reason={reason}
                    saving={saving}
                    rechecking={rechecking}
                    modelAnswerRevealed={revealedAnswers.has(question.questionId)}
                    onMarkChange={setMark}
                    onReasonChange={setReason}
                    onReveal={() =>
                      setRevealedAnswers((current) => {
                        const next = new Set(current);
                        next.add(question.questionId);
                        return next;
                      })
                    }
                    onBeginCorrection={() => {
                      setEditingQuestionId(question.questionId);
                      setMark(String(question.awardedMarks));
                      setReason(question.manualReason ?? "");
                    }}
                    onCancelCorrection={() => {
                      setEditingQuestionId("");
                      setMark("");
                      setReason("");
                    }}
                    onCorrect={() => void correct()}
                    onRecheck={() => void recheck()}
                  />
                ))}
              </div>
            </div>
          ) : tab === "history" ? (
            <AttemptHistory attempts={attempts} />
          ) : null}

          <div className="mt-7 flex flex-wrap justify-end gap-2 border-t border-[var(--color-border)] pt-5">
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                window.open(
                  `/dashboard/practice/papers/${encodeURIComponent(paper.notebookId)}/print?report=1`,
                  "_blank",
                  "noopener,noreferrer"
                )
              }
            >
              Print report
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </DialogPanel>
    </Dialog>
  );
}

/**
 * The headline score.
 *
 * Deliberately *not* banded red/amber/green, unlike the question list. The
 * bands exist so twenty questions can be sorted at a glance; there is only one
 * headline, so there is nothing to sort, and colouring a whole result red stops
 * being navigation and becomes a verdict on the person reading it. The bands
 * earn their place below, where the reader is choosing what to work on next.
 */
function ScorePanel({
  eyebrow,
  result,
  primary = false,
}: {
  eyebrow: string;
  result: PracticePaperResult;
  primary?: boolean;
}) {
  return (
    <div className={primary ? "p-5 sm:p-6" : ""}>
      <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-accent">
        {eyebrow}
      </p>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p className="text-4xl font-semibold tracking-tight tabular-nums text-text-primary">
          {result.awardedMarks}
          <span className="text-xl font-medium text-text-muted">
            /{result.totalMarks}
          </span>
        </p>
        <p className="text-xl font-semibold tabular-nums text-text-secondary">
          {result.percentage}%
        </p>
        {result.gradeLabel ? (
          <span className="rounded-full border border-accent/35 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
            {result.gradeLabel}
          </span>
        ) : null}
      </div>
      <ProgressBar progress={result.percentage} className="mt-4" />
      <StudyText
        text={result.summary}
        as="p"
        className="mt-4 text-sm leading-6 text-text-secondary"
      />
    </div>
  );
}

/**
 * The shape of the paper as three counts, before any of it is scrolled.
 *
 * This is the one place the band colours belong at paper level: it is a
 * navigation aid ("three questions scored nothing, go there first"), not a
 * verdict on the total.
 */
function BandSummary({ questions }: { questions: PracticePaperQuestionResult[] }) {
  const counted = questions.filter((question) => question.counted);
  if (counted.length === 0) return null;

  const bands = (["full", "part", "none"] as const).map((band) => ({
    band,
    tone: scoreBand(
      band === "full"
        ? { awardedMarks: 1, maxMarks: 1 }
        : band === "part"
          ? { awardedMarks: 1, maxMarks: 2 }
          : { awardedMarks: 0, maxMarks: 1 }
    ),
    label:
      band === "full"
        ? "Full marks"
        : band === "part"
          ? "Part marks"
          : "No marks",
    count: counted.filter(
      (question) => scoreBand(question).band === band
    ).length,
  }));

  return (
    <div className="flex flex-wrap gap-2">
      {bands.map((entry) => (
        <span
          key={entry.band}
          className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-glass-subtle)] py-1.5 pl-2.5 pr-3.5 text-xs font-medium text-text-secondary"
        >
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${entry.tone.mark} ${
              entry.count === 0 ? "opacity-30" : ""
            }`}
          />
          <span className="tabular-nums font-semibold text-text-primary">
            {entry.count}
          </span>
          {entry.label}
        </span>
      ))}
    </div>
  );
}

function QuestionResultCard({
  question,
  editing,
  mark,
  reason,
  saving,
  rechecking,
  modelAnswerRevealed,
  onMarkChange,
  onReasonChange,
  onReveal,
  onBeginCorrection,
  onCancelCorrection,
  onCorrect,
  onRecheck,
}: {
  question: PracticePaperQuestionResult;
  editing: boolean;
  mark: string;
  reason: string;
  saving: boolean;
  rechecking: boolean;
  modelAnswerRevealed: boolean;
  onMarkChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onReveal: () => void;
  onBeginCorrection: () => void;
  onCancelCorrection: () => void;
  onCorrect: () => void;
  onRecheck: () => void;
}) {
  const criteria = question.criterionResults ?? [];
  const evidence = question.evidence ?? [];
  const scoreTone = scoreBand(question);
  return (
    <details
      className={`group overflow-hidden rounded-2xl border bg-[var(--color-surface-raised)] ${
        question.counted
          ? "border-[var(--color-border)]"
          : "border-dashed border-[var(--color-border)] opacity-75"
      }`}
    >
      <summary className="flex min-h-16 cursor-pointer list-none items-center gap-4 px-4 sm:px-5 [&::-webkit-details-marker]:hidden">
        {/*
          * A stripe carrying how the question went, before anything is read.
          *
          * The score badge used to be accent-coloured whatever it said, so a
          * zero and full marks looked identical until you read the numbers --
          * on the one page whose entire job is letting somebody find the
          * questions that went badly. Colour and a filled proportion do that
          * at a glance; the numbers are still there for the exact answer.
          */}
        <span
          aria-hidden="true"
          className={`h-9 w-1 shrink-0 rounded-full ${scoreTone.mark}`}
        />
        <span className="min-w-0 flex-1">
          {/*
            * Two lines on phones, one on wider screens. The label is how a
            * question is identified, and at 390px a single truncated line was
            * cutting "1 (b) Find the stationary point…" off before the part
            * that says which question it is.
            */}
          <span className="line-clamp-2 text-sm font-semibold text-text-primary sm:block sm:truncate">
            {question.label}
          </span>
          <span className="mt-1 block truncate text-xs text-text-muted">
            {!question.counted
              ? "Optional answer — not counted"
              : question.confidence === "low"
                ? "Low-confidence reading — worth checking"
                : scoreTone.caption}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <ScoreMeter
            awardedMarks={question.awardedMarks}
            maxMarks={question.maxMarks}
            tone={scoreTone}
            className="hidden w-16 sm:block"
          />
          <span
            className={`rounded-full px-3 py-1.5 text-sm font-semibold tabular-nums ${scoreTone.badge}`}
          >
            {question.awardedMarks}/{question.maxMarks}
          </span>
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            fill="none"
            className="h-4 w-4 shrink-0 text-text-muted transition-transform duration-fast group-open:rotate-180"
          >
            <path
              d="m4 6 4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </summary>
      <div className="space-y-5 border-t border-[var(--color-border)] p-4 sm:p-5">
        <StudyText
          text={question.feedback}
          as="p"
          className="text-sm leading-6 text-text-secondary"
        />

        {question.transcriptionNote ? (
          <div className="rounded-xl border border-warm-accent/20 bg-warm-glow/40 p-3">
            <p className="text-xs font-semibold text-warm-accent">Reading to check</p>
            <p className="mt-1 text-xs leading-5 text-text-secondary">
              {question.transcriptionNote}
            </p>
          </div>
        ) : null}
        {question.manualReason ? (
          <p className="rounded-xl bg-accent/8 p-3 text-xs text-accent">
            Corrected after review: {question.manualReason}
          </p>
        ) : null}

        {criteria.length > 0 ? (
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <h4 className="text-2xs font-semibold uppercase tracking-[0.16em] text-text-secondary">
                Marking criteria
              </h4>
              <p className="text-xs tabular-nums text-text-muted">
                {criteria.filter((criterion) => criterion.awarded).length} of{" "}
                {criteria.length} met
              </p>
            </div>
            {/*
              * A checklist, so the misses are found by shape rather than by
              * reading every row. The two states used to be a tick and an
              * en-dash in near-identical grey circles, which put the whole
              * distinction inside a glyph a few pixels wide -- and the awarded
              * tick used the bare `success` token, invisible in the light
              * themes. Colour, weight and a rule now separate them.
              */}
            <ul className="mt-2.5 space-y-1.5">
              {criteria.map((criterion, index) => (
                <li
                  key={`${criterion.criterion}-${index}`}
                  /*
                    * The fill sits on the criteria that were *missed*. Filling
                    * the awarded rows instead -- which is the reflex -- puts
                    * the visual weight on the marks already banked, on a page
                    * whose entire purpose is finding the ones that were not.
                    */
                  className={`flex gap-3 rounded-xl border-l-2 py-2.5 pl-3 pr-3.5 ${
                    criterion.awarded
                      ? "border-l-[var(--color-success-text)] bg-transparent"
                      : "border-l-[var(--color-border-strong)] bg-[var(--color-glass-subtle)]"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    /*
                      * The tick is drawn in the mark colour on a tinted disc
                      * rather than knocked out of a solid one. Knocking it out
                      * needs to know the colour behind the row, and the token
                      * that was reached for -- `--color-surface` -- does not
                      * exist, so the tick was being drawn in whatever colour it
                      * inherited: white on white, an empty circle.
                      */
                    className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full ${
                      criterion.awarded
                        ? "bg-[var(--color-success-muted)] text-[var(--color-success-mark)]"
                        : "border border-[var(--color-border-strong)]"
                    }`}
                  >
                    {criterion.awarded ? (
                      <svg viewBox="0 0 12 12" fill="none" className="h-3 w-3">
                        <path
                          d="m2.5 6.2 2.4 2.4 4.6-5"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : null}
                  </span>
                  <span className="min-w-0">
                    <span className="sr-only">
                      {criterion.awarded ? "Awarded: " : "Not awarded: "}
                    </span>
                    <span
                      className={`block text-sm leading-6 ${
                        criterion.awarded
                          ? "text-text-secondary"
                          : "font-medium text-text-primary"
                      }`}
                    >
                      {criterion.criterion}
                    </span>
                    {criterion.evidence ? (
                      <span className="mt-0.5 block text-xs leading-5 text-text-muted">
                        {criterion.evidence}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {evidence.length > 0 ? (
          <ReviewBlock title="Evidence from your work" items={evidence} />
        ) : null}
        {question.correction ? (
          <ReviewBlock title="Corrected approach" text={question.correction} />
        ) : null}
        {question.nextStep ? (
          <ReviewBlock title="Next step" text={question.nextStep} accent />
        ) : null}

        {question.modelAnswer ? (
          <div className="rounded-xl border border-[var(--color-border)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-text-primary">Model answer</p>
                <p className="mt-0.5 text-xs text-text-muted">
                  Reveal this after reviewing your own correction.
                </p>
              </div>
              {!modelAnswerRevealed ? (
                <Button type="button" size="sm" variant="secondary" onClick={onReveal}>
                  Reveal answer
                </Button>
              ) : null}
            </div>
            {modelAnswerRevealed ? (
              <StudyText
                text={question.modelAnswer}
                as="div"
                className="mt-4 border-t border-[var(--color-border)] pt-4 text-sm leading-6 text-text-secondary"
              />
            ) : null}
          </div>
        ) : null}

        {editing ? (
          <div className="rounded-xl border border-accent/20 bg-accent/8 p-4">
            <p className="mb-3 text-sm font-semibold text-text-primary">
              Correct Jami’s reading or mark
            </p>
            <div className="grid gap-3 sm:grid-cols-[7rem_1fr]">
              <Input
                label="Correct mark"
                type="number"
                min={0}
                max={question.maxMarks}
                value={mark}
                onChange={(event) => onMarkChange(event.target.value)}
              />
              <Input
                label="What should change?"
                value={reason}
                placeholder="For example: the final digit was misread"
                onChange={(event) => onReasonChange(event.target.value)}
              />
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button type="button" size="sm" variant="ghost" disabled={saving || rechecking} onClick={onCancelCorrection}>
                  Cancel
                </Button>
              <Button type="button" size="sm" variant="secondary" disabled={saving || rechecking || reason.trim().length < 3} onClick={onRecheck}>
                {rechecking ? "Rechecking…" : "Recheck with AI"}
              </Button>
              <Button type="button" size="sm" disabled={saving || rechecking || mark === "" || !reason.trim()} onClick={onCorrect}>
                {saving ? "Saving…" : "Apply correction"}
              </Button>
            </div>
          </div>
        ) : (
          <Button type="button" size="sm" variant="secondary" onClick={onBeginCorrection}>
            Challenge or correct this mark
          </Button>
        )}
      </div>
    </details>
  );
}

function ReviewBlock({
  title,
  text,
  items,
  accent = false,
}: {
  title: string;
  text?: string;
  items?: string[];
  accent?: boolean;
}) {
  return (
    <div className={`rounded-xl p-4 ${accent ? "bg-accent/8" : "bg-[var(--color-glass-subtle)]"}`}>
      <h4 className={`text-xs font-semibold uppercase tracking-[0.13em] ${accent ? "text-accent" : "text-text-muted"}`}>
        {title}
      </h4>
      {text ? <StudyText text={text} as="p" className="mt-2 text-sm leading-6 text-text-secondary" /> : null}
      {items?.length ? (
        <ul className="mt-2 space-y-1.5 text-sm leading-6 text-text-secondary">
          {items.map((item) => <li key={item}>• {item}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

function ResultList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] p-4 sm:p-5">
      <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      {items.length > 0 ? (
        <ul className="mt-3 space-y-2 text-sm leading-6 text-text-secondary">
          {items.map((item) => <li key={item}>• {item}</li>)}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-text-muted">Nothing recorded yet.</p>
      )}
    </div>
  );
}

function StatusPill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-3 py-1.5 text-xs font-medium text-text-secondary">
      {children}
    </span>
  );
}

/**
 * Every attempt at this paper, oldest at the bottom.
 *
 * Sequence is the whole reason this view exists -- a single attempt is already
 * on the other tab -- so the list is built as a timeline with a spine running
 * through it, and each row says how it moved against the attempt before. The
 * flat rows this replaced showed four attempts as four unrelated facts, and
 * left the reader subtracting percentages in their head to find the trend they
 * came here for.
 */
function AttemptHistory({ attempts }: { attempts: PracticePaperAttempt[] }) {
  if (attempts.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--color-border)] p-8 text-center">
        <p className="text-sm font-medium text-text-secondary">
          No completed attempts yet
        </p>
        <p className="mx-auto mt-1.5 max-w-sm text-xs leading-5 text-text-muted">
          Once you sit and submit this paper, every attempt lands here so you can
          see how it moved.
        </p>
      </div>
    );
  }

  const headline = (attempt: PracticePaperAttempt) =>
    attempt.withinTimeResult && attempt.overtimeStartedAt
      ? attempt.withinTimeResult.percentage
      : (attempt.result?.percentage ?? null);

  return (
    // The spine is centred on the dots: they are 16px wide and the first item
    // in each row, so their centre sits 8px in from the list's edge.
    <ol className="relative space-y-2 before:absolute before:bottom-6 before:left-2 before:top-6 before:w-px before:bg-[var(--color-border)]">
      {attempts.map((attempt, index) => {
        const result = attempt.result;
        const current = headline(attempt);
        // Attempts arrive newest first, so the one to compare against is the
        // next in the array, not the previous.
        const earlier = attempts[index + 1];
        const previous = earlier ? headline(earlier) : null;
        const change =
          current !== null && previous !== null
            ? Math.round((current - previous) * 10) / 10
            : null;
        const tone = result
          ? scoreBand({
              awardedMarks: result.awardedMarks,
              maxMarks: result.totalMarks,
            })
          : null;

        return (
          <li key={attempt.id} className="relative flex gap-4">
            <span
              aria-hidden="true"
              className={`z-10 mt-3.5 grid h-4 w-4 shrink-0 place-items-center rounded-full ring-4 ring-[var(--color-surface-raised)] ${
                tone ? tone.mark : "bg-[var(--color-border-strong)]"
              }`}
            />
            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text-primary">
                  Attempt {attempt.attemptNumber}
                  {index === 0 ? (
                    <span className="ml-2 rounded-full bg-accent/10 px-2 py-0.5 text-2xs font-semibold uppercase tracking-[0.1em] text-accent">
                      Latest
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-xs leading-5 text-text-muted">
                  {new Date(attempt.startedAt).toLocaleDateString()} ·{" "}
                  {attempt.status.replace("_", " ")} ·{" "}
                  {attempt.assisted ? "Tutor-assisted" : "Exam conditions"}
                </p>
              </div>
              {result ? (
                <div className="flex items-center gap-4">
                  {change !== null ? <ChangeChip change={change} /> : null}
                  <div className="text-right">
                    <p className="text-lg font-semibold tabular-nums text-text-primary">
                      {current}%
                      {attempt.withinTimeResult && attempt.overtimeStartedAt ? (
                        <span className="ml-1 text-xs font-medium text-text-muted">
                          in time
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs tabular-nums text-text-muted">
                      {result.awardedMarks}/{result.totalMarks}
                      {result.gradeLabel ? ` · ${result.gradeLabel}` : ""}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** How this attempt moved against the one before it. */
function ChangeChip({ change }: { change: number }) {
  if (change === 0) {
    return (
      <span className="rounded-full border border-[var(--color-border)] px-2.5 py-1 text-2xs font-semibold text-text-muted">
        Level
      </span>
    );
  }
  const up = change > 0;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-2xs font-semibold tabular-nums ${
        up ? "app-success" : "app-warning"
      }`}
    >
      <svg
        viewBox="0 0 12 12"
        fill="none"
        aria-hidden="true"
        className={`h-2.5 w-2.5 ${up ? "" : "rotate-180"}`}
      >
        <path
          d="M6 9.5V2.5m0 0L3 5.5M6 2.5l3 3"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {up ? "+" : ""}
      {change}
      <span className="sr-only">
        {up ? " percent up on" : " percent down on"} the previous attempt
      </span>
    </span>
  );
}

function GradeContext({ paper }: { paper: PracticePaper }) {
  const guidance = paper.gradeGuidance;
  return (
    <div className="rounded-2xl border border-[var(--color-border)] p-4 sm:p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
        Grade context
      </p>
      <p className="mt-2 text-sm font-semibold text-text-primary">
        {guidance.label}
      </p>
      {guidance.notice ? (
        <p className="mt-1 text-xs leading-5 text-text-muted">{guidance.notice}</p>
      ) : null}
      {guidance.latestComparable || guidance.historicalMedian ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {guidance.latestComparable ? (
            <p className="rounded-xl bg-[var(--color-glass-subtle)] p-3 text-xs leading-5 text-text-secondary">
              <span className="font-semibold text-text-primary">Latest comparable</span>
              <br />
              {guidance.latestComparable.label}
              {guidance.latestComparable.year ? ` · ${guidance.latestComparable.year}` : ""}
            </p>
          ) : null}
          {guidance.historicalMedian ? (
            <p className="rounded-xl bg-[var(--color-glass-subtle)] p-3 text-xs leading-5 text-text-secondary">
              <span className="font-semibold text-text-primary">Historical median</span>
              <br />
              {guidance.historicalMedian.label}
              {guidance.historicalMedian.years ? ` · ${guidance.historicalMedian.years}` : ""}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
