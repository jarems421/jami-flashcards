"use client";

import { useCallback, useEffect, useEffectEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { canCancelPracticePaperJob, isPracticePaperJobBuilding } from "@/lib/practice/practice-paper-jobs";
import type { PracticePaperJob } from "@/lib/practice/practice-papers";
import {
  acknowledgePracticePaperJob,
  cancelPracticePaperJob,
  clarifyPracticePaperJob,
  confirmPracticePaperFormat,
  getPracticePaperJob,
  retryPracticePaperJob,
} from "@/services/ai/practice-papers";

const FIRST_POLL_MS = 1_000;
const POLL_MS = 2_500;
const POLL_AFTER_ERROR_MS = 5_000;
const DEFAULT_CLARIFICATION_QUESTION = "What exam format should this follow?";

type Feedback = {
  clear: () => void;
  showError: (message: string) => void;
  showThrownError: (error: unknown, fallback: string) => void;
};

/**
 * A request for Jami to build a paper, from the moment it is made until the
 * paper opens.
 *
 * A request named in the link (`?job=`) is reopened, so a student coming back
 * from Practice finds it where they left it. While Jami is building, its
 * progress is read every few seconds. Once the request needs the student --
 * an answer to a question, or a confirmed format -- polling stops until they
 * act, and their answer is never cleared under them while they type it.
 *
 * `setWorking` is the builder's busy flag: an action that hands the request
 * back to Jami leaves it set, and it is cleared when the request next stops
 * building.
 */
export function usePracticePaperJob({
  feedback,
  setWorking,
  onReopened,
}: {
  feedback: Feedback;
  setWorking: (working: boolean) => void;
  /** A request was reopened from the link. */
  onReopened: () => void;
}) {
  const { clear, showError, showThrownError } = feedback;
  const router = useRouter();
  const [job, setJob] = useState<PracticePaperJob | null>(null);
  const [clarificationAnswer, setClarificationAnswer] = useState("");

  const openPaper = useCallback(
    (paperId: string) => router.push(`/dashboard/notebooks/${encodeURIComponent(paperId)}`),
    [router]
  );
  const reopened = useEffectEvent(onReopened);

  useEffect(() => {
    const jobId = new URLSearchParams(window.location.search).get("job")?.trim();
    if (!jobId) return;
    let active = true;
    void getPracticePaperJob(jobId)
      .then((found) => {
        if (!active) return;
        setJob(found);
        reopened();
        if (found.status === "ready") openPaper(found.paperId);
      })
      .catch((error) => {
        if (active) showThrownError(error, "Could not reopen that paper request.");
      });
    return () => {
      active = false;
    };
  }, [openPaper, showThrownError]);

  const jobId = job?.id ?? "";
  const building = job ? isPracticePaperJobBuilding(job.status) : false;
  useEffect(() => {
    if (!jobId || !building) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await getPracticePaperJob(jobId);
        if (!active) return;
        setJob(next);
        if (isPracticePaperJobBuilding(next.status)) {
          timer = setTimeout(() => void poll(), POLL_MS);
          return;
        }
        // Ready, waiting on the student, failed or cancelled: the builder is free again.
        // A failure is shown by the job banner at the top, with its retry.
        setWorking(false);
        if (next.status === "ready") openPaper(next.paperId);
        if (next.status === "needs_clarification") setClarificationAnswer("");
      } catch (error) {
        if (!active) return;
        timer = setTimeout(() => void poll(), POLL_AFTER_ERROR_MS);
        console.warn("Could not refresh practice-paper progress.", error);
      }
    };
    timer = setTimeout(() => void poll(), FIRST_POLL_MS);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [building, jobId, openPaper, setWorking]);

  /** Hands a request back to Jami, keeping the builder busy until it next stops building. */
  const resume = async (request: () => Promise<PracticePaperJob>, fallback: string) => {
    setWorking(true);
    clear();
    try {
      setJob(await request());
      return true;
    } catch (error) {
      showThrownError(error, fallback);
      setWorking(false);
      return false;
    }
  };

  const answerClarification = async () => {
    if (job?.status !== "needs_clarification") return;
    const answer = clarificationAnswer.trim();
    if (!answer) {
      showError("Answer Jami's question before continuing.");
      return;
    }
    const resumed = await resume(
      () => clarifyPracticePaperJob(job.id, answer),
      "Could not resume this practice paper."
    );
    if (resumed) setClarificationAnswer("");
  };

  const decideFormat = async (action: "confirm" | "correct" | "use_custom", correction?: string) => {
    if (job?.status !== "needs_confirmation") return;
    await resume(
      () => confirmPracticePaperFormat(job.id, action, correction),
      "Could not resume this practice paper."
    );
  };

  const retry = async () => {
    if (job?.status !== "failed") return;
    await resume(() => retryPracticePaperJob(job.id), "Could not try this paper again.");
  };

  const cancel = async () => {
    if (!job || !canCancelPracticePaperJob(job.status)) return;
    try {
      setJob(await cancelPracticePaperJob(job.id));
      setWorking(false);
    } catch (error) {
      showThrownError(error, "Could not cancel this paper.");
    }
  };

  const dismiss = async () => {
    if (job?.status !== "failed") return;
    try {
      await acknowledgePracticePaperJob(job.id);
      router.push("/dashboard/practice");
    } catch (error) {
      showThrownError(error, "Could not dismiss this paper.");
    }
  };

  return {
    job,
    /** A request Jami has just accepted, which this hook follows from here. */
    setJob,
    clarificationQuestion:
      job?.status === "needs_clarification" ? job.clarificationQuestion ?? DEFAULT_CLARIFICATION_QUESTION : "",
    clarificationAnswer,
    setClarificationAnswer,
    answerClarification,
    decideFormat,
    retry,
    cancel,
    dismiss,
  };
}
