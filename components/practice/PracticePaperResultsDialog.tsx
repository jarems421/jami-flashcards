"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Button,
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogPanel,
  DialogTitle,
  Input,
  ProgressBar,
  StudyText,
} from "@/components/ui";
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
        <div className="border-b border-[var(--color-border)] px-5 pb-0 pt-5 sm:px-7 sm:pt-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
                Attempt {paper.attemptCount}
              </p>
              <DialogTitle className="mt-1">Your paper, marked</DialogTitle>
              <DialogDescription className="mt-2 max-w-2xl">
                See the result first, then open any question for the evidence,
                correction and next step.
              </DialogDescription>
            </div>
            <div className="flex flex-wrap gap-2">
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
            {(["report", "history"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={`border-b-2 px-0.5 pb-3 text-sm font-semibold capitalize transition ${
                  tab === value
                    ? "border-accent text-text-primary"
                    : "border-transparent text-text-muted hover:text-text-secondary"
                }`}
              >
                {value}
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
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
                      Question review
                    </p>
                    <h3 className="mt-1 text-lg font-semibold text-text-primary">
                      Where each mark came from
                    </h3>
                  </div>
                  <p className="text-xs text-text-muted">Open a question to review</p>
                </div>
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
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
            {eyebrow}
          </p>
          <p className="mt-1 text-4xl font-semibold tracking-tight text-text-primary">
            {result.awardedMarks}
            <span className="text-xl text-text-muted">/{result.totalMarks}</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold text-text-primary">
            {result.percentage}%
          </p>
          {result.gradeLabel ? (
            <p className="text-sm font-semibold text-accent">{result.gradeLabel}</p>
          ) : null}
        </div>
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
  return (
    <details
      className={`group overflow-hidden rounded-2xl border bg-[var(--color-surface)] ${
        question.counted
          ? "border-[var(--color-border)]"
          : "border-dashed border-[var(--color-border)] opacity-75"
      }`}
    >
      <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 px-4 sm:px-5 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-text-primary">
            {question.label}
          </span>
          <span className="mt-1 block text-xs text-text-muted">
            {!question.counted
              ? "Optional answer — not counted"
              : question.confidence === "low"
                ? "Low-confidence reading — worth checking"
                : `${question.awardedMarks === question.maxMarks ? "Full marks" : "Review feedback"}`}
          </span>
        </span>
        <span className="shrink-0 rounded-full bg-accent/10 px-3 py-1.5 text-sm font-semibold text-accent">
          {question.awardedMarks}/{question.maxMarks}
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
            <h4 className="text-xs font-semibold uppercase tracking-[0.13em] text-text-muted">
              Marking criteria
            </h4>
            <div className="mt-2 space-y-2">
              {criteria.map((criterion, index) => (
                <div
                  key={`${criterion.criterion}-${index}`}
                  className="flex gap-3 rounded-xl bg-[var(--color-glass-subtle)] p-3"
                >
                  <span
                    className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs font-bold ${
                      criterion.awarded
                        ? "bg-success/15 text-success"
                        : "bg-[var(--color-glass-medium)] text-text-muted"
                    }`}
                    aria-label={criterion.awarded ? "Awarded" : "Not awarded"}
                  >
                    {criterion.awarded ? "✓" : "–"}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-text-primary">
                      {criterion.criterion}
                    </p>
                    {criterion.evidence ? (
                      <p className="mt-1 text-xs leading-5 text-text-muted">
                        {criterion.evidence}
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
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

function AttemptHistory({ attempts }: { attempts: PracticePaperAttempt[] }) {
  if (attempts.length === 0) {
    return (
      <p className="rounded-2xl bg-[var(--color-glass-subtle)] p-5 text-sm text-text-muted">
        No completed attempts yet.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {attempts.map((attempt) => (
        <div
          key={attempt.id}
          className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[var(--color-border)] p-4"
        >
          <div>
            <p className="text-sm font-semibold text-text-primary">
              Attempt {attempt.attemptNumber}
            </p>
            <p className="mt-1 text-xs text-text-muted">
              {new Date(attempt.startedAt).toLocaleDateString()} · {attempt.status.replace("_", " ")} · {attempt.assisted ? "Tutor-assisted" : "Exam conditions"}
            </p>
          </div>
          {attempt.result ? (
            <div className="text-right">
              <p className="text-lg font-semibold text-text-primary">
                {attempt.withinTimeResult && attempt.overtimeStartedAt
                  ? `${attempt.withinTimeResult.percentage}% in time`
                  : `${attempt.result.percentage}%`}
              </p>
              <p className="text-xs text-text-muted">
                {attempt.result.awardedMarks}/{attempt.result.totalMarks}
                {attempt.result.gradeLabel ? ` · ${attempt.result.gradeLabel}` : ""}
              </p>
            </div>
          ) : null}
        </div>
      ))}
    </div>
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
