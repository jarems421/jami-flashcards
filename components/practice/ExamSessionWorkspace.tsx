"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppPage from "@/components/layout/AppPage";
import {
  Button,
  ButtonLink,
  Card,
  ConfirmDialog,
  FeedbackBanner,
  Select,
  Skeleton,
  StudyText,
  Textarea,
} from "@/components/ui";
import { useUser } from "@/components/providers/UserProvider";
import {
  deletePastPaperPracticeAnswers,
  finishPastPaperPracticeSession,
  loadPastPaperPracticeSession,
  reviewExamAnswer,
  saveExamAnswerDraft,
  saveExamAttemptToNotebook,
  submitExamAnswer,
} from "@/services/study/exam-practice";
import { EXAM_ANSWER_MAX_LENGTH, EXAM_OPERATION_LEASE_MS } from "@/lib/practice/exam-questions";
import type { PublicExamAttempt } from "@/lib/practice/exam-projections";
import { getActiveNotebooks } from "@/services/study/notebooks";
import type { Notebook } from "@/lib/workspace/notebooks";
import ExamQuestionAssets from "@/components/practice/ExamQuestionAssets";
import ExamScratchpad, { type ExamScratchpadHandle } from "@/components/practice/ExamScratchpad";
import ExamQuestionMarkReport from "@/components/practice/ExamQuestionMarkReport";
import { requireExamWorkingSnapshot } from "@/lib/practice/exam-working";
import ExamSubmittedAnswer from "@/components/practice/ExamSubmittedAnswer";
import JamiAssistantDrawer from "@/components/ai/JamiAssistantDrawer";

const DRAFT_SAVE_MS = 700;

type SessionData = Awaited<ReturnType<typeof loadPastPaperPracticeSession>>;
type SessionQuestion = SessionData["session"]["questions"][number];

function provenanceLine(question: SessionQuestion) {
  const { boardLabel, series, year, paperReference, questionNumber } = question.provenance;
  return [boardLabel, `${series} ${year}`, paperReference, `Q${questionNumber}`]
    .filter(Boolean)
    .join(" · ");
}

/** The colour a question's pill takes in the strip along the top. */
function pillTone(attempts: PublicExamAttempt[]) {
  if (attempts.some((item) => item.attemptNumber === 2 && item.status === "marked")) {
    return "bg-accent/20 text-accent";
  }
  if (attempts.some((item) => item.status === "marking_failed")) return "bg-error/15 text-error";
  if (attempts.some((item) => item.attemptNumber === 1 && item.status === "marked")) {
    return "bg-success/20 text-success";
  }
  if (attempts.some((item) => item.status === "marking")) {
    return "animate-pulse bg-warm-accent/20 text-warm-accent";
  }
  if (attempts.some((item) => item.status === "draft" && Boolean(item.answerText))) {
    return "bg-[var(--color-glass-strong)] text-text-primary";
  }
  return "bg-[var(--color-glass-subtle)] text-text-secondary hover:text-text-primary";
}

export default function ExamSessionWorkspace({ sessionId }: { sessionId: string }) {
  const { user } = useUser();
  const [data, setData] = useState<SessionData | null>(null);
  const [index, setIndex] = useState(0);
  /*
   * One draft per attempt, never one unqualified answer string.
   *
   * With a single `answer` the autosave effect could observe the new attempt's
   * id beside the previous question's text -- normally the next render fixed
   * it, but a page hide inside that window wrote one question's answer onto
   * another, and it survived a reload. Keyed by attempt there is no pairing to
   * get wrong, and coming back to a question still shows what was typed.
   */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [submitting, setSubmitting] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [notebookId, setNotebookId] = useState("");
  const [savingNotebook, setSavingNotebook] = useState(false);
  const [savedNotebook, setSavedNotebook] = useState("");
  const [showWorking, setShowWorking] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [error, setError] = useState("");
  /** Advanced by each poll, so a lease that runs out is noticed on screen. */
  const [now, setNow] = useState(() => Date.now());
  const scratchpad = useRef<ExamScratchpadHandle | null>(null);
  const pendingDrafts = useRef(new Map<string, string>());
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushing = useRef(false);
  const flushAgain = useRef(false);

  const refresh = useCallback(async () => {
    try {
      setData(await loadPastPaperPracticeSession(sessionId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This session could not be loaded.");
    }
  }, [sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!user?.uid) return;
    void getActiveNotebooks(user.uid)
      .then(setNotebooks)
      .catch(() => undefined);
  }, [user?.uid]);

  /*
   * A session started from a notebook goes back to that notebook by default.
   * Making the student find it again in a list broke the loop the feature is
   * built around -- notebook to practice and back -- and picking the wrong one
   * is a page in the wrong book.
   */
  useEffect(() => {
    const origin = data?.session.originNotebookId;
    if (!origin || notebookId) return;
    if (notebooks.some((item) => item.id === origin && item.folderId === data?.session.folderId)) {
      setNotebookId(origin);
    }
  }, [data?.session.folderId, data?.session.originNotebookId, notebookId, notebooks]);

  const session = data?.session;
  const questions = useMemo(() => session?.questions ?? [], [session]);
  const question = questions[index];
  const attempts = useMemo(() => data?.attempts ?? [], [data]);

  const firstAttempt = question ? attempts.find((item) => item.id === question.attemptId) : undefined;
  const retryId = question?.attemptId.replace(/_1$/, "_2");
  const retryAttempt = retryId ? attempts.find((item) => item.id === retryId) : undefined;
  const retryOpen = Boolean(retryAttempt && retryAttempt.status !== "marked");
  const activeAttempt = retryOpen ? retryAttempt : firstAttempt;
  const markedAttempt =
    retryAttempt?.status === "marked"
      ? retryAttempt
      : firstAttempt?.status === "marked"
        ? firstAttempt
        : undefined;
  const answering = session?.status === "active" && (!markedAttempt || retryOpen);
  const isLast = index === questions.length - 1;
  /*
   * Marking happens inside the request that started it, so a request killed
   * mid-flight leaves the attempt reading "marking" with nothing left to
   * finish it. Past its lease it is not in progress, it is stranded, and the
   * student is offered the one thing that actually helps.
   */
  const markingStale =
    activeAttempt?.status === "marking" &&
    now - (activeAttempt.updatedAt ?? 0) > EXAM_OPERATION_LEASE_MS;
  /** Something is being worked on server-side, so the page keeps watching. */
  const pendingStatus =
    activeAttempt && (activeAttempt.status === "marking" || activeAttempt.reviewStatus === "reviewing")
      ? `${activeAttempt.id}:${activeAttempt.status}:${activeAttempt.reviewStatus ?? ""}`
      : null;
  /*
   * A mark in progress resolves itself rather than waiting to be asked. The
   * only recovery used to be a "Check again" button, so a student who looked
   * away, or refreshed, sat in front of a spinner that would never move on its
   * own. Backs off so a long mark is not a tight loop, and stops once the
   * attempt reaches a settled state.
   */
  useEffect(() => {
    if (pendingStatus === null) return;
    let cancelled = false;
    let delay = 2_000;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      await refresh();
      if (cancelled) return;
      setNow(Date.now());
      delay = Math.min(Math.round(delay * 1.6), 15_000);
      timer = setTimeout(() => void tick(), delay);
    };
    timer = setTimeout(() => void tick(), delay);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [pendingStatus, refresh]);

  /*
   * Drafts are flushed, not cancelled, and a failed one is kept to try again.
   *
   * A debounce that clears itself on cleanup loses whatever was typed in the
   * last three-quarters of a second every time the student changes question or
   * closes the tab -- which is exactly when they have just finished a
   * sentence. Pending text lives in a ref that outlives the render, so leaving
   * sends it. Only one flush runs at a time so a slow save cannot land after a
   * newer one and put back older text.
   */
  const flushDrafts = useCallback(async (options?: { keepalive?: boolean }) => {
    if (draftTimer.current) {
      clearTimeout(draftTimer.current);
      draftTimer.current = null;
    }
    if (flushing.current) {
      flushAgain.current = true;
      return;
    }
    const entries = [...pendingDrafts.current.entries()];
    pendingDrafts.current.clear();
    if (entries.length === 0) return;
    flushing.current = true;
    setSaveState("saving");
    const outcomes = await Promise.all(
      entries.map(([attemptId, text]) =>
        saveExamAnswerDraft(sessionId, attemptId, text, options)
          .then(() => true)
          .catch(() => {
            // Keep it queued rather than dropping it on the floor.
            if (!pendingDrafts.current.has(attemptId)) pendingDrafts.current.set(attemptId, text);
            return false;
          })
      )
    );
    flushing.current = false;
    setSaveState(outcomes.every(Boolean) ? "saved" : "failed");
    if (flushAgain.current) {
      flushAgain.current = false;
      void flushDrafts(options);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!activeAttempt || activeAttempt.status !== "draft") return;
    const attemptId = activeAttempt.id;
    const text = drafts[attemptId];
    if (text === undefined || text === (activeAttempt.answerText ?? "")) return;
    pendingDrafts.current.set(attemptId, text);
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => void flushDrafts(), DRAFT_SAVE_MS);
  }, [activeAttempt, drafts, flushDrafts]);

  useEffect(() => {
    // Leaving the page is the one flush that has to outlive the document.
    const onLeave = () => void flushDrafts({ keepalive: true });
    window.addEventListener("pagehide", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      void flushDrafts();
    };
  }, [flushDrafts]);

  // What the box shows: the local draft if there is one, else what is stored.
  const answer =
    !activeAttempt || activeAttempt.status === "marked"
      ? ""
      : drafts[activeAttempt.id] ?? activeAttempt.answerText ?? "";

  const goTo = useCallback(
    (next: number) => {
      void flushDrafts();
      setShowWorking(false);
      setHasInk(false);
      setSavedNotebook("");
      setError("");
      setIndex(next);
    },
    [flushDrafts]
  );

  const submit = async () => {
    if (!question || !activeAttempt) return;
    await flushDrafts();
    setSubmitting(true);
    setError("");
    try {
      const working = await requireExamWorkingSnapshot(activeAttempt, scratchpad.current);
      const response = await submitExamAnswer({
        sessionId,
        questionId: question.id,
        attemptNumber: activeAttempt.attemptNumber,
        answerText: answer,
        workingSnapshot: working?.png,
      });
      setData((current) =>
        current
          ? {
              ...current,
              attempts: [response.attempt, ...current.attempts.filter((item) => item.id !== response.attempt.id)],
            }
          : current
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Jami couldn't mark this one — your answer is saved.");
      await refresh();
    } finally {
      setSubmitting(false);
    }
  };

  const review = async () => {
    if (!question) return;
    setReviewing(true);
    setError("");
    try {
      await reviewExamAnswer(sessionId, question.id);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Jami couldn't check this mark just now.");
    } finally {
      setReviewing(false);
    }
  };

  const beginRetry = async () => {
    if (!retryId) return;
    setError("");
    try {
      await saveExamAnswerDraft(sessionId, retryId, "");
      setDrafts((current) => ({ ...current, [retryId]: "" }));
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The retry could not be opened.");
    }
  };

  const finish = async () => {
    void flushDrafts();
    setFinishing(true);
    setError("");
    try {
      await finishPastPaperPracticeSession(sessionId);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This session could not be finished.");
    } finally {
      setFinishing(false);
    }
  };

  const removeAnswers = async () => {
    setDeleting(true);
    setError("");
    try {
      await deletePastPaperPracticeAnswers(sessionId);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your stored answers could not be deleted.");
    } finally {
      setDeleting(false);
    }
  };

  const saveToNotebook = async () => {
    if (!markedAttempt || !notebookId) return;
    setSavingNotebook(true);
    setError("");
    try {
      const saved = await saveExamAttemptToNotebook({
        sessionId,
        attemptId: markedAttempt.id,
        notebookId,
      });
      setSavedNotebook(saved.notebookId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This work could not be saved to your notebook.");
    } finally {
      setSavingNotebook(false);
    }
  };

  if (!data || !session || !question) {
    return (
      <AppPage title="Past Paper Practice" backHref="/dashboard/practice" backLabel="Practice" width="study">
        {error ? (
          <FeedbackBanner type="error" message={error} onDismiss={() => setError("")} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-[34rem]" />
            <Skeleton className="h-[34rem]" />
          </div>
        )}
      </AppPage>
    );
  }

  const markedCount = attempts.filter(
    (item) => item.attemptNumber === 1 && item.status === "marked"
  ).length;
  const retryTargets = (firstAttempt?.result?.criterionResults ?? []).filter(
    (item) => (item.awardedMarks ?? 0) === 0
  );
  const notebookChoices = notebooks.filter((item) => item.folderId === session.folderId);

  return (
    <AppPage
      title={session.subject}
      backHref="/dashboard/practice"
      backLabel="Practice"
      width="study"
    >
      <div className="space-y-4">
        {error ? <FeedbackBanner type="error" message={error} onDismiss={() => setError("")} /> : null}

        {session.status === "completed" ? (
          <Card tone="warm" padding="lg">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary">
                  Session complete
                </p>
                <p className="mt-3 text-4xl font-semibold tracking-tight text-text-primary">
                  {session.awardedTotal}
                  <span className="text-lg font-normal text-text-muted"> / {session.maxTotal}</span>
                </p>
                <p className="mt-2 text-sm text-text-secondary">
                  First-attempt score · {session.requestedMix.easy} easy · {session.requestedMix.medium} medium ·{" "}
                  {session.requestedMix.hard} hard
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ButtonLink href="/dashboard/practice/history" variant="secondary">
                  History
                </ButtonLink>
                <ButtonLink
                  href={`/dashboard/practice/questions/new?folderId=${encodeURIComponent(session.folderId)}`}
                >
                  Another session
                </ButtonLink>
              </div>
            </div>
          </Card>
        ) : null}

        <div className="sticky top-[4.5rem] z-30 flex items-center gap-2 overflow-x-auto rounded-full border border-[var(--color-border)] bg-[var(--app-background)]/90 p-2 shadow-shell backdrop-blur-xl">
          {questions.map((item, itemIndex) => {
            const itemAttempts = attempts.filter((attempt) => attempt.questionId === item.id);
            return (
              <button
                key={item.id}
                type="button"
                aria-current={itemIndex === index ? "step" : undefined}
                aria-label={`Question ${itemIndex + 1} of ${questions.length}`}
                onClick={() => goTo(itemIndex)}
                className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-semibold transition ${
                  itemIndex === index
                    ? "bg-accent text-[var(--color-text-inverse)] shadow-accent"
                    : pillTone(itemAttempts)
                }`}
              >
                {itemIndex + 1}
              </button>
            );
          })}
          <span className="ml-auto shrink-0 px-2 text-xs font-medium text-text-muted">
            {markedCount} of {questions.length}
          </span>
          {session.status === "active" ? (
            <Button size="sm" variant="ghost" disabled={finishing} onClick={() => void finish()}>
              {finishing ? "Finishing…" : "Finish"}
            </Button>
          ) : null}
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(26rem,1.1fr)]">
          <div className="space-y-4 lg:sticky lg:top-32">
            <Card padding="lg">
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-text-muted">
                <span className="rounded-full bg-[var(--color-glass-subtle)] px-2.5 py-1 capitalize">
                  {question.difficulty}
                </span>
                {question.origin === "jami_generated" ? (
                  <span className="rounded-full bg-warm-accent/15 px-2.5 py-1 text-warm-accent">
                    Jami-created
                  </span>
                ) : null}
                <span>
                  {question.marks} mark{question.marks === 1 ? "" : "s"}
                </span>
              </div>
              <p className="mt-4 text-xs text-text-muted">{provenanceLine(question)}</p>
              <StudyText
                as="div"
                text={question.prompt}
                className="mt-5 whitespace-pre-wrap text-base leading-8 text-text-primary sm:text-lg"
              />
              <ExamQuestionAssets
                sessionId={sessionId}
                questionId={question.id}
                assets={question.assets}
              />
            </Card>

            {session.status === "completed" && !markedAttempt ? (
              <Card padding="md">
                <h3 className="text-base font-semibold text-text-primary">Not answered</h3>
                <p className="mt-2 text-sm text-text-muted">
                  This question counted as zero when the session was finished.
                </p>
              </Card>
            ) : activeAttempt?.status === "marking" && !submitting ? (
              <>
                <Card padding="md">
                  <h3 className="text-base font-semibold text-text-primary">
                    {markingStale ? "This one is taking too long" : "Jami is marking this one"}
                  </h3>
                  <p className="mt-2 text-sm leading-5 text-text-muted">
                    {markingStale
                      ? "Your answer and working are saved exactly as you sent them. Marking looks like it stopped part way — running it again will not change what is marked."
                      : "Your answer is saved. This usually takes a few seconds, and this page updates on its own."}
                  </p>
                  <Button
                    className="mt-4"
                    variant={markingStale ? "primary" : "secondary"}
                    disabled={submitting}
                    onClick={() => (markingStale ? void submit() : void refresh())}
                  >
                    {markingStale ? "Mark it again" : "Check again"}
                  </Button>
                </Card>
                {markingStale ? (
                  <ExamSubmittedAnswer
                    attempt={activeAttempt}
                    sessionId={sessionId}
                    title="What was submitted"
                  />
                ) : null}
              </>
            ) :answering && activeAttempt?.status === "marking_failed" ? (
              /*
               * A failed marking used to render nothing at all -- the retry
               * card was written inside the branch below, which this condition
               * skipped, so a student whose marking failed saw the question and
               * then empty space with no way forward.
               *
               * The answer is frozen here, on the server and in the rules, so
               * it is shown rather than offered for editing: the wording, the
               * tools, the saved draft and what gets resubmitted all say the
               * same thing.
               */
              <>
                <Card padding="md" className="border-error/30">
                  <h3 className="text-base font-semibold text-text-primary">
                    Jami couldn&apos;t mark this one
                  </h3>
                  <p className="mt-2 text-sm leading-5 text-text-muted">
                    Your answer and working were submitted and are safe. Nothing has been changed —
                    this just runs the marker over them again.
                  </p>
                  <Button className="mt-4" disabled={submitting} onClick={() => void submit()}>
                    {submitting ? "Marking…" : "Retry marking"}
                  </Button>
                </Card>
                <ExamSubmittedAnswer
                  attempt={activeAttempt}
                  sessionId={sessionId}
                  title="What was submitted"
                />
              </>
            ) : answering ? (
              <>
                {retryOpen && firstAttempt?.result ? (
                  <Card padding="md" tone="warm">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary">
                      Second try
                    </p>
                    <p className="mt-2 text-sm text-text-secondary">
                      You scored {firstAttempt.result.awardedMarks}/{firstAttempt.result.maxMarks} first
                      time.
                      {retryTargets.length ? " Aim to cover:" : ""}
                    </p>
                    {retryTargets.length ? (
                      <ul className="mt-3 space-y-1.5">
                        {retryTargets.map((item, itemIndex) => (
                          <li
                            key={`${item.criterion}-${itemIndex}`}
                            className="text-sm leading-5 text-text-primary"
                          >
                            · {item.criterion}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {/*
                      * Opening the retry used to take the first mark off the
                      * screen entirely -- the feedback, the worked answer and
                      * the scheme all went with it, which are the things a
                      * second attempt is supposed to be guided by. Folded away
                      * rather than removed, so consulting them costs a click
                      * and not the draft.
                      */}
                    <details className="mt-4 border-t border-[var(--color-border)] pt-3">
                      <summary className="cursor-pointer text-sm font-semibold text-text-primary">
                        First try feedback
                      </summary>
                      <div className="mt-3">
                        <ExamQuestionMarkReport
                          attempt={firstAttempt}
                          sessionId={sessionId}
                          onAsk={() => setAssistantOpen(true)}
                        />
                      </div>
                    </details>
                  </Card>
                ) : null}

                <Card padding="md">
                  <Textarea
                    label={retryOpen ? "Try your answer again" : "Your answer"}
                    value={answer}
                    rows={8}
                    maxLength={EXAM_ANSWER_MAX_LENGTH}
                    placeholder="Write your final answer here…"
                    disabled={submitting}
                    onChange={(event) => {
                      const id = activeAttempt?.id;
                      if (!id) return;
                      const text = event.target.value;
                      setDrafts((current) => ({ ...current, [id]: text }));
                    }}
                  />
                  <div className="mt-3 lg:hidden">
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full"
                      onClick={() => setShowWorking(true)}
                    >
                      {hasInk ? "Open working" : "Show your working"}
                    </Button>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-text-muted">
                      {saveState === "saving"
                        ? "Saving…"
                        : saveState === "failed"
                          ? "Couldn't save just now — your answer is still here and will retry."
                          : saveState === "saved"
                            ? "Saved."
                            : "Your answer saves as you write."}
                    </p>
                    <Button disabled={submitting} onClick={() => void submit()}>
                      {submitting
                        ? hasInk
                          ? "Reading your working…"
                          : "Marking your answer…"
                        : hasInk
                          ? "Mark answer and working"
                          : "Mark answer"}
                    </Button>
                  </div>
                </Card>
              </>
            ) : markedAttempt ? (
              <>
                <ExamQuestionMarkReport
                  attempt={markedAttempt}
                  firstAttempt={firstAttempt}
                  sessionId={sessionId}
                  reviewing={reviewing}
                  nextLabel={isLast ? "Finish session" : "Next question"}
                  onNext={() => (isLast ? void finish() : goTo(index + 1))}
                  onRetry={
                    session.status === "active" && markedAttempt.attemptNumber === 1 && !retryAttempt
                      ? () => void beginRetry()
                      : undefined
                  }
                  /*
                   * The independent check is of the official first-attempt
                   * mark, and the route reads that attempt whichever one is on
                   * screen. Tying the button to the displayed attempt meant a
                   * retry silently consumed an unused check.
                   */
                  onReview={
                    firstAttempt?.status === "marked" && !firstAttempt.reviewUsed
                      ? () => void review()
                      : undefined
                  }
                  onAsk={() => setAssistantOpen(true)}
                />
                {notebookChoices.length > 0 ? (
                  <Card padding="md">
                    <h3 className="text-base font-semibold text-text-primary">Keep this in a notebook</h3>
                    <p className="mt-1 text-sm text-text-muted">
                      Makes a separate marked page with the question, your work and the feedback.
                    </p>
                    {savedNotebook ? (
                      <p className="mt-4 text-sm font-medium text-success">Saved to your notebook.</p>
                    ) : (
                      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                        <Select
                          aria-label="Notebook"
                          value={notebookId}
                          className="sm:min-w-64"
                          onChange={(event) => setNotebookId(event.target.value)}
                        >
                          <option value="">Choose notebook</option>
                          {notebookChoices.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.title}
                            </option>
                          ))}
                        </Select>
                        <Button
                          variant="secondary"
                          disabled={!notebookId || savingNotebook}
                          onClick={() => void saveToNotebook()}
                        >
                          {savingNotebook ? "Saving…" : "Save to notebook"}
                        </Button>
                      </div>
                    )}
                  </Card>
                ) : null}
              </>
            ) : null}
          </div>

          {answering && activeAttempt ? (
            <div
              className={`${
                showWorking
                  ? "fixed inset-0 z-50 overflow-y-auto bg-[var(--app-background)] p-3"
                  : "hidden"
              } lg:static lg:block lg:overflow-visible lg:bg-transparent lg:p-0`}
            >
              <div className="mb-2 flex items-center justify-between gap-3 px-1">
                <div>
                  <h2 className="text-sm font-semibold text-text-primary">Working</h2>
                  <p className="text-xs text-text-muted">
                    {hasInk ? "This sheet is sent with your answer" : "Optional — sent only if you use it"}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="lg:hidden"
                  onClick={() => setShowWorking(false)}
                >
                  Done
                </Button>
              </div>
              <ExamScratchpad
                key={activeAttempt.id}
                userId={user.uid}
                attemptId={activeAttempt.id}
                // Read-only the moment the attempt stops being a draft: the
                // sheet is then frozen evidence, and the rules refuse writes.
                disabled={submitting || activeAttempt.status !== "draft"}
                onHandle={(handle) => {
                  scratchpad.current = handle;
                }}
                onInkChange={setHasInk}
              />
            </div>
          ) : null}
        </div>

        {session.status === "completed" ? (
          <div className="flex justify-end">
            <Button variant="ghost" disabled={deleting} onClick={() => setConfirmDelete(true)}>
              Delete my answers
            </Button>
          </div>
        ) : null}

        <ConfirmDialog
          open={confirmDelete}
          title="Delete answers and working?"
          description="This removes the typed answers and frozen working from this Practice session. Marks stay in your history, and notebook copies are unchanged."
          confirmLabel="Delete my answers"
          busy={deleting}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => void removeAnswers().finally(() => setConfirmDelete(false))}
        />

        {markedAttempt ? (
          <JamiAssistantDrawer
            userId={user.uid}
            open={assistantOpen}
            onOpenChange={setAssistantOpen}
            resetKey={`practice:${session.id}:${markedAttempt.id}`}
            contextKey={`practice:${session.id}:${markedAttempt.id}`}
            contextLabel="Marked practice answer"
            historyContextLabel={`${session.subject} · ${question.label}`}
            getContext={() => ({
              surface: "practice" as const,
              sessionId: session.id,
              attemptId: markedAttempt.id,
            })}
            quickActions={[
              {
                label: "Explain my feedback",
                prompt: "Explain this feedback simply and show me the best next step.",
              },
              {
                label: "Teach the missing idea",
                prompt: "Teach me the idea I was missing, then give me one small check question.",
              },
            ]}
            emptyStateNote="Jami can discuss this question only after it has been marked."
            settingsFolderIds={[session.folderId]}
          />
        ) : null}
      </div>
    </AppPage>
  );
}
