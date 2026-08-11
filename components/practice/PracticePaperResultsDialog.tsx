"use client";

import { useEffect, useState } from "react";
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
import type { PracticePaper, PracticePaperAttempt } from "@/lib/practice/practice-papers";
import {
  correctPracticePaperMark,
  getPracticePaperAttempts,
} from "@/services/study/practice-papers";

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
  const [mark, setMark] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setTab("report");
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
      setError(caught instanceof Error ? caught.message : "Could not correct this mark.");
    } finally {
      setSaving(false);
    }
  };

  const result = paper.result;
  return (
    <Dialog open={open} onDismiss={onClose}>
      <DialogBackdrop />
      <DialogPanel className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogTitle>Paper results</DialogTitle>
        <DialogDescription>
          Review Jami’s marking, correct a misread answer, or compare previous attempts.
        </DialogDescription>
        <div className="mt-4 flex gap-1 rounded-xl bg-[var(--color-glass-subtle)] p-1">
          {(["report", "history"] as const).map((value) => (
            <button key={value} type="button" aria-pressed={tab === value} onClick={() => setTab(value)} className={`min-h-10 flex-1 rounded-lg px-3 text-sm font-semibold capitalize ${tab === value ? "app-selected" : "text-text-muted"}`}>
              {value}
            </button>
          ))}
        </div>
        {error ? <p className="mt-4 rounded-xl bg-error/10 p-3 text-sm text-error">{error}</p> : null}

        {tab === "report" && result ? (
          <div className="mt-5 space-y-5">
            <div className="rounded-xl border border-accent/25 bg-accent/8 p-5">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Overall result</p>
                  <p className="mt-1 text-3xl font-semibold text-text-primary">{result.awardedMarks}/{result.totalMarks}</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-semibold text-text-primary">{result.percentage}%</p>
                  {result.gradeLabel ? <p className="text-sm font-semibold text-accent">{result.gradeLabel}</p> : null}
                </div>
              </div>
              <ProgressBar progress={result.percentage} className="mt-4" />
              <StudyText text={result.summary} as="p" className="mt-4 text-sm leading-6 text-text-secondary" />
              {paper.gradeGuidance.kind !== "none" ? <p className="mt-3 text-xs text-text-muted">{paper.gradeGuidance.notice}</p> : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ResultList title="What went well" items={result.strengths} />
              <ResultList title="Priorities" items={result.priorities} />
            </div>
            <div className="space-y-3">
              {result.questionResults.map((question) => (
                <details key={question.questionId} className={`group rounded-xl border ${question.counted ? "border-[var(--color-border)]" : "border-dashed border-[var(--color-border)] opacity-70"}`}>
                  <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 [&::-webkit-details-marker]:hidden">
                    <span>
                      <span className="text-sm font-semibold text-text-primary">{question.label}</span>
                      {!question.counted ? <span className="ml-2 text-xs text-text-muted">Optional · not counted</span> : null}
                    </span>
                    <span className="text-sm font-semibold text-accent">{question.awardedMarks}/{question.maxMarks}</span>
                  </summary>
                  <div className="space-y-3 border-t border-[var(--color-border)] p-4 text-sm leading-6 text-text-secondary">
                    <StudyText text={question.feedback} />
                    {question.transcriptionNote ? <p className="rounded-lg bg-warm-glow/50 p-3 text-xs text-warm-accent">{question.transcriptionNote}</p> : null}
                    {question.manualReason ? <p className="rounded-lg bg-accent/8 p-3 text-xs text-accent">Manual correction: {question.manualReason}</p> : null}
                    {question.improvements.length > 0 ? <ul className="space-y-1">{question.improvements.map((item) => <li key={item}>· {item}</li>)}</ul> : null}
                    {editingQuestionId === question.questionId ? (
                      <div className="grid gap-3 rounded-xl bg-[var(--color-glass-subtle)] p-3 sm:grid-cols-[7rem_1fr_auto] sm:items-end">
                        <Input label="Correct mark" type="number" min={0} max={question.maxMarks} value={mark} onChange={(event) => setMark(event.target.value)} />
                        <Input label="Reason" value={reason} placeholder="For example: handwriting was misread" onChange={(event) => setReason(event.target.value)} />
                        <Button type="button" size="sm" disabled={saving || mark === ""} onClick={() => void correct()}>{saving ? "Saving..." : "Apply"}</Button>
                      </div>
                    ) : (
                      <Button type="button" size="sm" variant="secondary" onClick={() => { setEditingQuestionId(question.questionId); setMark(String(question.awardedMarks)); setReason(question.manualReason ?? ""); }}>
                        Correct mark
                      </Button>
                    )}
                  </div>
                </details>
              ))}
            </div>
          </div>
        ) : tab === "history" ? (
          <div className="mt-5 space-y-3">
            {attempts.length > 0 ? attempts.map((attempt) => (
              <div key={attempt.id} className="flex items-center justify-between gap-4 rounded-xl border border-[var(--color-border)] p-4">
                <div>
                  <p className="text-sm font-semibold text-text-primary">Attempt {attempt.attemptNumber}</p>
                  <p className="mt-1 text-xs text-text-muted">{new Date(attempt.startedAt).toLocaleDateString()} · {attempt.status.replace("_", " ")}</p>
                </div>
                {attempt.result ? <div className="text-right"><p className="text-lg font-semibold text-text-primary">{attempt.result.percentage}%</p><p className="text-xs text-text-muted">{attempt.result.awardedMarks}/{attempt.result.totalMarks}{attempt.result.gradeLabel ? ` · ${attempt.result.gradeLabel}` : ""}</p></div> : null}
              </div>
            )) : <p className="rounded-xl bg-[var(--color-glass-subtle)] p-5 text-sm text-text-muted">No completed attempts yet.</p>}
          </div>
        ) : null}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => window.open(`/dashboard/practice/papers/${encodeURIComponent(paper.notebookId)}/print?report=1`, "_blank", "noopener,noreferrer")}>Print report</Button>
          <Button type="button" variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </DialogPanel>
    </Dialog>
  );
}

function ResultList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] p-4">
      <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      {items.length > 0 ? <ul className="mt-2 space-y-1.5 text-sm text-text-secondary">{items.map((item) => <li key={item}>· {item}</li>)}</ul> : <p className="mt-2 text-xs text-text-muted">Nothing recorded yet.</p>}
    </div>
  );
}
