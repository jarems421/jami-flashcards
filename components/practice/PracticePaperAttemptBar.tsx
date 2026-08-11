"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, ConfirmDialog, FeedbackBanner } from "@/components/ui";
import {
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/Dialog";
import PracticePaperDetailsDialog from "@/components/practice/PracticePaperDetailsDialog";
import PracticePaperResultsDialog from "@/components/practice/PracticePaperResultsDialog";
import { useFeedback } from "@/hooks/useFeedback";
import type { PracticePaper, PracticePaperStatus } from "@/lib/practice/practice-papers";
import { markPracticePaper, prepareUploadedPracticePaper } from "@/services/ai/practice-papers";
import {
  capturePracticePaperDeadlineSnapshot,
  continuePracticePaperInOvertime,
  getPracticePaperByNotebookId,
  pausePracticePaperAttempt,
  resumePracticePaperAttempt,
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
  onEditingLockChange,
  onTutorLockChange,
}: {
  userId: string;
  notebookId: string;
  onStatusChange: (status: PracticePaperStatus | null) => void;
  onBeforeSubmit: () => Promise<boolean>;
  onRetake: () => void;
  onEditingLockChange: (locked: boolean) => void;
  onTutorLockChange: (locked: boolean) => void;
}) {
  const [paper, setPaper] = useState<PracticePaper | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"prepare" | "start" | "mark" | "retake" | "pause" | "resume" | "snapshot" | "overtime" | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [confirmRetake, setConfirmRetake] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const captureVersionRef = useRef<string | null>(null);
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
    if (
      paper?.timingMode !== "timed" ||
      paper.status !== "in_progress" ||
      (paper.timingState !== "running" && paper.timingState !== "overtime")
    ) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [paper?.status, paper?.timingMode, paper?.timingState]);

  useEffect(() => {
    const editingLocked = Boolean(
      paper &&
      (paper.status === "submitted" ||
        paper.status === "marked" ||
        (paper.status === "in_progress" &&
          (paper.timingState === "paused" ||
            paper.timingState === "awaiting_overtime")))
    );
    const tutorLocked = Boolean(
      paper?.status === "submitted" ||
      (paper?.status === "in_progress" &&
        (!paper.tutorEnabled ||
          paper.timingState === "paused" ||
          paper.timingState === "awaiting_overtime"))
    );
    onEditingLockChange(editingLocked);
    onTutorLockChange(tutorLocked);
  }, [onEditingLockChange, onTutorLockChange, paper]);

  const remaining = useMemo(() => {
    if (!paper?.deadlineAt || paper.timingMode !== "timed") return null;
    return paper.deadlineAt - clock;
  }, [clock, paper?.deadlineAt, paper?.timingMode]);

  const overtime = useMemo(() => {
    if (!paper?.overtimeStartedAt || paper.timingState !== "overtime") return null;
    return Math.max(0, clock - paper.overtimeStartedAt);
  }, [clock, paper?.overtimeStartedAt, paper?.timingState]);

  const replacePaper = useCallback((next: PracticePaper) => {
    setPaper(next);
    onStatusChange(next.status);
  }, [onStatusChange]);

  useEffect(() => {
    if (
      !paper ||
      paper.status !== "in_progress" ||
      paper.timingState !== "running" ||
      remaining === null ||
      remaining > 0 ||
      busy !== null
    ) return;
    const captureKey = `${paper.activeAttemptId}:${paper.deadlineVersion}`;
    if (captureVersionRef.current === captureKey) return;
    captureVersionRef.current = captureKey;
    setBusy("snapshot");
    void onBeforeSubmit()
      .then(async (saved) => {
        if (!saved) throw new Error("Save the current page before time is recorded.");
        replacePaper(await capturePracticePaperDeadlineSnapshot(userId, paper));
      })
      .catch((error) => {
        captureVersionRef.current = null;
        showThrownError(error, "Jami could not record the deadline snapshot.");
      })
      .finally(() => setBusy(null));
  }, [busy, onBeforeSubmit, paper, remaining, replacePaper, showThrownError, userId]);

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

  const pause = async () => {
    if (!paper) return;
    setBusy("pause");
    clear();
    try {
      const saved = await onBeforeSubmit();
      if (!saved) throw new Error("Save the current page before pausing.");
      replacePaper(await pausePracticePaperAttempt(userId, paper));
    } catch (error) {
      showThrownError(error, "Could not pause this attempt.");
    } finally {
      setBusy(null);
    }
  };

  const resume = async () => {
    if (!paper) return;
    setBusy("resume");
    clear();
    try {
      replacePaper(await resumePracticePaperAttempt(userId, paper));
      setClock(Date.now());
    } catch (error) {
      showThrownError(error, "Could not resume this attempt.");
    } finally {
      setBusy(null);
    }
  };

  const continueOvertime = async () => {
    if (!paper) return;
    setBusy("overtime");
    clear();
    try {
      replacePaper(await continuePracticePaperInOvertime(userId, paper));
      setClock(Date.now());
    } catch (error) {
      showThrownError(error, "Could not continue in overtime.");
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
                  ? `Attempt ${paper.attemptCount} in progress${paper.tutorEnabled ? " · Tutor assisted" : " · Exam conditions"}`
                  : paper.status === "submitted"
                    ? "Attempt submitted · ready to mark"
                    : paper.status === "marked" && result
                      ? `${paper.withinTimeResult ? `${paper.withinTimeResult.awardedMarks}/${paper.withinTimeResult.totalMarks} in time · ` : ""}${result.awardedMarks}/${result.totalMarks} complete · ${result.percentage}%${result.gradeLabel ? ` · ${result.gradeLabel}` : ""}`
                      : "Practice paper setup"}
            </p>
            {paper.status === "in_progress" && paper.timingMode === "timed" ? (
              <p className={`mt-0.5 text-xs font-medium tabular-nums ${paper.timingState === "overtime" ? "text-warm" : "text-text-muted"}`}>
                {paper.timingState === "paused"
                  ? "Paused — writing and Tutor locked"
                  : paper.timingState === "awaiting_overtime"
                    ? "Time reached — choose submit or overtime"
                    : overtime !== null
                      ? `Overtime +${formatRemaining(overtime)}`
                      : remaining !== null
                        ? `${formatRemaining(remaining)} remaining`
                        : "Timed attempt"}
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
            {paper.status === "in_progress" && paper.timingState === "running" ? (
              <Button type="button" size="sm" variant="secondary" disabled={busy !== null} onClick={() => void pause()}>
                {busy === "pause" ? "Pausing..." : "Pause"}
              </Button>
            ) : null}
            {paper.status === "in_progress" && paper.timingState === "paused" ? (
              <Button type="button" size="sm" disabled={busy !== null} onClick={() => void resume()}>
                {busy === "resume" ? "Resuming..." : "Resume"}
              </Button>
            ) : null}
            {paper.status === "in_progress" ? <Button type="button" size="sm" variant="warm" disabled={busy !== null || paper.timingState === "awaiting_overtime"} onClick={() => setConfirmSubmit(true)}>Submit paper</Button> : null}
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
      <Dialog
        open={paper.timingState === "awaiting_overtime"}
        dismissible={false}
        className="fixed inset-0 flex items-end justify-center p-4 sm:items-center"
        onDismiss={() => undefined}
      >
        <DialogBackdrop className="absolute inset-0 bg-black/65 backdrop-blur-sm" />
        <DialogPanel role="alertdialog" className="app-panel relative w-full max-w-md rounded-2xl p-6 shadow-e3">
          <DialogTitle className="text-xl font-semibold text-text-primary">Time reached</DialogTitle>
          <DialogDescription className="mt-3 text-sm leading-6 text-text-secondary">
            Your within-time work is saved. Submit it now, or keep writing in clearly logged overtime.
          </DialogDescription>
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => void submitAndMark()}>
              {busy === "mark" ? "Submitting..." : "Submit now"}
            </Button>
            <Button type="button" disabled={busy !== null} onClick={() => void continueOvertime()}>
              {busy === "overtime" ? "Starting..." : "Continue in overtime"}
            </Button>
          </div>
        </DialogPanel>
      </Dialog>
      <PracticePaperDetailsDialog open={detailsOpen} userId={userId} paper={paper} onClose={() => setDetailsOpen(false)} onChange={replacePaper} />
      <PracticePaperResultsDialog open={reportOpen} userId={userId} paper={paper} onClose={() => setReportOpen(false)} onChange={replacePaper} />
    </>
  );
}
