"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, ConfirmDialog, FeedbackBanner } from "@/components/ui";
import PracticePaperDetailsDialog from "@/components/practice/PracticePaperDetailsDialog";
import PracticePaperResultsDialog from "@/components/practice/PracticePaperResultsDialog";
import { useFeedback } from "@/hooks/useFeedback";
import type { PracticePaper, PracticePaperStatus } from "@/lib/practice/practice-papers";
import { markPracticePaper, prepareUploadedPracticePaper } from "@/services/ai/practice-papers";
import {
  getPracticePaperByNotebookId,
  startPracticePaperAttempt,
  submitPracticePaperAttempt,
} from "@/services/study/practice-papers";

function formatRemaining(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function PracticePaperAttemptBar({
  userId,
  notebookId,
  onStatusChange,
  onBeforeSubmit,
  onRetake,
}: {
  userId: string;
  notebookId: string;
  onStatusChange: (status: PracticePaperStatus | null) => void;
  onBeforeSubmit: () => Promise<boolean>;
  onRetake: () => void;
}) {
  const [paper, setPaper] = useState<PracticePaper | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"prepare" | "start" | "mark" | "retake" | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [confirmRetake, setConfirmRetake] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const { feedback, showThrownError, showError, clear } = useFeedback();

  useEffect(() => {
    let active = true;
    setLoading(true);
    void getPracticePaperByNotebookId(userId, notebookId)
      .then((next) => {
        if (!active) return;
        setPaper(next);
        onStatusChange(next?.status ?? null);
      })
      .catch((error) => {
        if (active) showThrownError(error, "Could not load this paper's attempt state.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [notebookId, onStatusChange, showThrownError, userId]);

  useEffect(() => {
    if (!paper?.timerEnabled || paper.status !== "in_progress") return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [paper?.status, paper?.timerEnabled]);

  const remaining = useMemo(() => {
    if (!paper?.startedAt || !paper.durationMinutes) return null;
    return paper.startedAt + paper.durationMinutes * 60_000 - clock;
  }, [clock, paper?.durationMinutes, paper?.startedAt]);

  const replacePaper = (next: PracticePaper) => {
    setPaper(next);
    onStatusChange(next.status);
  };

  const start = async () => {
    if (!paper) return;
    setBusy(paper.origin === "uploaded" && paper.questions.length === 0 ? "prepare" : "start");
    clear();
    try {
      if (paper.origin === "uploaded" && paper.questions.length === 0) {
        const prepared = await prepareUploadedPracticePaper(notebookId);
        replacePaper(prepared);
        setDetailsOpen(true);
        return;
      }
      const started = await startPracticePaperAttempt(userId, paper);
      replacePaper(started);
      setClock(started.startedAt ?? Date.now());
    } catch (error) {
      showThrownError(error, "Could not start this attempt.");
    } finally {
      setBusy(null);
    }
  };

  const submitAndMark = async () => {
    if (!paper) return;
    setBusy("mark");
    clear();
    try {
      const saved = await onBeforeSubmit();
      if (!saved) {
        showError("Save the current page before submitting the paper.");
        return;
      }
      let submitted = paper;
      if (paper.status !== "submitted") {
        const submittedAt = await submitPracticePaperAttempt(userId, paper);
        submitted = { ...paper, status: "submitted", submittedAt };
        replacePaper(submitted);
      }
      setConfirmSubmit(false);
      const marked = await markPracticePaper(notebookId);
      replacePaper(marked);
      setReportOpen(true);
    } catch (error) {
      showThrownError(error, "Jami could not mark this paper.");
    } finally {
      setBusy(null);
    }
  };

  const retake = async () => {
    if (!paper) return;
    setBusy("retake");
    clear();
    try {
      const started = await startPracticePaperAttempt(userId, paper, { clearPreviousWork: true });
      onRetake();
      replacePaper(started);
      setClock(started.startedAt ?? Date.now());
      setConfirmRetake(false);
      setReportOpen(false);
    } catch (error) {
      showThrownError(error, "Could not start a new attempt.");
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="mt-2 h-10 animate-pulse rounded-xl bg-[var(--color-glass-subtle)]" />;
  if (!paper) return null;
  const result = paper.result;

  return (
    <>
      <div className="mt-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-3 py-2">
        <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-text-primary">
              {paper.status === "ready"
                ? `${paper.totalMarks || "Practice"} ${paper.totalMarks ? "marks" : "paper"} · marking guide ready`
                : paper.status === "in_progress"
                  ? `Attempt ${paper.attemptCount} in progress · Jami Tutor is hidden`
                  : paper.status === "submitted"
                    ? "Attempt submitted · ready to mark"
                    : paper.status === "marked" && result
                      ? `${result.awardedMarks}/${result.totalMarks} · ${result.percentage}%${result.gradeLabel ? ` · ${result.gradeLabel}` : ""}`
                      : "Practice paper setup"}
            </p>
            {paper.status === "in_progress" && paper.timerEnabled && remaining !== null ? (
              <p className={`mt-0.5 text-xs font-medium tabular-nums ${remaining <= 0 ? "text-error" : "text-text-muted"}`}>
                {remaining <= 0 ? "Suggested time reached" : `${formatRemaining(remaining)} remaining`}
              </p>
            ) : <p className="mt-0.5 truncate text-2xs text-text-muted">{paper.markScheme.notice}</p>}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {paper.questions.length > 0 && paper.status !== "in_progress" ? <Button type="button" size="sm" variant="secondary" onClick={() => setDetailsOpen(true)}>Paper details</Button> : null}
            {paper.status === "ready" ? (
              <Button type="button" size="sm" disabled={busy !== null} onClick={() => void start()}>
                {busy === "prepare" ? "Preparing..." : busy === "start" ? "Starting..." : paper.origin === "uploaded" && paper.questions.length === 0 ? "Prepare paper" : "Start attempt"}
              </Button>
            ) : null}
            {paper.status === "in_progress" ? <Button type="button" size="sm" variant="warm" disabled={busy !== null} onClick={() => setConfirmSubmit(true)}>Submit paper</Button> : null}
            {paper.status === "submitted" ? <Button type="button" size="sm" disabled={busy !== null} onClick={() => void submitAndMark()}>{busy === "mark" ? "Marking..." : "Mark paper"}</Button> : null}
            {paper.status === "marked" && result ? (
              <>
                <Button type="button" size="sm" variant="secondary" onClick={() => setReportOpen(true)}>View results</Button>
                <Button type="button" size="sm" onClick={() => setConfirmRetake(true)}>Retake</Button>
              </>
            ) : null}
          </div>
        </div>
        {feedback ? <div className="mt-2"><FeedbackBanner type={feedback.type} message={feedback.message} onDismiss={clear} /></div> : null}
      </div>

      <ConfirmDialog open={confirmSubmit} title="Submit this paper for marking?" description="Your current page will be saved first. Jami Tutor stays unavailable until marking finishes." confirmLabel="Submit and mark" busy={busy === "mark"} onConfirm={() => void submitAndMark()} onClose={() => setConfirmSubmit(false)} />
      <ConfirmDialog open={confirmRetake} title="Start a new attempt?" description="Your previous result remains in attempt history. The notebook answer pages will be cleared for the new attempt." confirmLabel="Clear pages and retake" busy={busy === "retake"} onConfirm={() => void retake()} onClose={() => setConfirmRetake(false)} />
      <PracticePaperDetailsDialog open={detailsOpen} userId={userId} paper={paper} onClose={() => setDetailsOpen(false)} onChange={replacePaper} />
      <PracticePaperResultsDialog open={reportOpen} userId={userId} paper={paper} onClose={() => setReportOpen(false)} onChange={replacePaper} />
    </>
  );
}
