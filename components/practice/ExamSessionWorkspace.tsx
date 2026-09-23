"use client";

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import AppPage from "@/components/layout/AppPage";
import {
  Button,
  ButtonLink,
  Card,
  ConfirmDialog,
  FeedbackBanner,
  FormDisclosure,
  ProgressBar,
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
import {
  detectExamAnswerParts,
  examAnswerPartLabelsIn,
  examAnswerPartMaxLength,
  joinExamAnswerParts,
  nextExamAnswerPartLabel,
  splitExamAnswerParts,
} from "@/lib/practice/exam-answer-parts";
import { examMarkingFailureIsRetryable, examMarkingFailureMessage } from "@/lib/practice/exam-marking-failure";
import { getActiveNotebooks } from "@/services/study/notebooks";
import type { Notebook } from "@/lib/workspace/notebooks";
import ExamQuestionAssets from "@/components/practice/ExamQuestionAssets";
import { examQuestionShowsPrintedPage } from "@/lib/practice/exam-question-display";
import { examSheetPrintedPages } from "@/lib/practice/exam-question-sheet";
import ExamScratchpad, { type ExamScratchpadHandle } from "@/components/practice/ExamScratchpad";
import ExamQuestionMarkReport from "@/components/practice/ExamQuestionMarkReport";
import ExamSessionQuestionBar from "@/components/practice/ExamSessionQuestionBar";
import { requireExamWorkingSnapshot } from "@/lib/practice/exam-working";
import {
  examQuestionPartLabel,
  examSessionQuestionRuns,
  examSessionRunAt,
} from "@/lib/practice/exam-question-groups";
import ExamSubmittedAnswer from "@/components/practice/ExamSubmittedAnswer";
import JamiAssistantDrawer from "@/components/ai/JamiAssistantDrawer";
import { reportTutorialAction } from "@/lib/onboarding/tutorial";

const DRAFT_SAVE_MS = 700;

type SessionData = Awaited<ReturnType<typeof loadPastPaperPracticeSession>>;
type SessionQuestion = SessionData["session"]["questions"][number];

/**
 * The question's pages of paper, the same array for as long as it is the same
 * question.
 *
 * The session is re-read every few seconds while an answer is being marked, and
 * every read builds fresh objects all the way down -- so a plain `useMemo` on
 * `question` hands back a new array on each poll even though nothing about the
 * paper has changed. The sheet reads that as its pages having been replaced:
 * it reloads, turns back to page one, and remounts the ink editor under a hand
 * that is in the middle of a word.
 *
 * Keyed on what actually decides the pages. A re-ingest changes the content
 * version, and that is the one case where the paper really is different.
 */
function usePrintedPages(question: SessionQuestion | undefined) {
  const signature = question ? `${question.id}:${question.contentVersion}` : "";
  const read = () => ({
    signature,
    pages: question ? examSheetPrintedPages(question) : [],
  });
  const [cached, setCached] = useState(read);
  // React's own way of adjusting state when a prop changes: the re-render
  // happens before anything is committed, so no effect sees the stale array.
  if (cached.signature !== signature) setCached(read);
  return cached.pages;
}

/**
 * What a question is worth, and what else the paper offers for it.
 *
 * AQA English Literature prints "[30 marks] AO4 [4 marks]" under its Section A
 * questions: thirty for the answer, four more for technical accuracy scored
 * across the section from its own grid. Jami marks the thirty and says so,
 * rather than showing a score out of thirty and leaving a student to wonder
 * why their paper says thirty-four.
 */
function tariffNote(question: SessionQuestion) {
  if (!question.separateAwardMarks) return "";
  return `The paper awards ${question.separateAwardMarks} further marks for technical accuracy across this section. Jami marks the ${question.marks} for your answer, and does not mark spelling or punctuation.`;
}

function provenanceLine(question: SessionQuestion) {
  const { boardLabel, series, year, paperReference, questionNumber } = question.provenance;
  return [boardLabel, `${series} ${year}`, paperReference, `Q${questionNumber}`]
    .filter(Boolean)
    .join(" · ");
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
  const latestDrafts = useRef(new Map<string, string>());
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
  /**
   * Whether the sheet has been read yet, so an empty sheet is only called
   * empty once it is known to be. Ink loads after the page mounts, and a
   * question returned to already has ink on it -- treating "not reported yet"
   * as "nothing written" would grey out the mark button on the way back.
   */
  const [inkKnown, setInkKnown] = useState(false);
  /** Reported by the answer box, which holds its own text. */
  const [hasTypedText, setHasTypedText] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const answerFieldId = useId();
  const [error, setError] = useState("");
  /** Attempt whose reopened-draft refusal the student has read and closed. */
  const [dismissedFailure, setDismissedFailure] = useState("");
  /** Advanced by each poll, so a lease that runs out is noticed on screen. */
  const [now, setNow] = useState(() => Date.now());
  const scratchpad = useRef<ExamScratchpadHandle | null>(null);
  const workingSheet = useRef<HTMLDivElement | null>(null);
  /** Where focus was before the sheet covered the screen, so it can go back. */
  const focusBeforeWorking = useRef<HTMLElement | null>(null);
  const pendingDrafts = useRef(new Map<string, string>());
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushing = useRef(false);
  const flushAgain = useRef(false);
  /** Stable, so the memoised working sheet is not re-rendered for a new function. */
  const handleScratchpad = useCallback((handle: ExamScratchpadHandle | null) => {
    scratchpad.current = handle;
  }, []);
  /** Stable for the same reason, and the point at which the sheet is known. */
  const handleInkChange = useCallback((value: boolean) => {
    setHasInk(value);
    setInkKnown(true);
  }, []);

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
  /**
   * The question's own pages of paper, if ingestion rendered any.
   *
   * This is what decides which of two layouts a question is answered in. With
   * pages, the paper is the page: the question is not a picture in a column
   * beside an empty pad, it is the thing being written on, and the typed
   * answer sits underneath it the way a printed answer line does.
   *
   * Without pages -- a question Jami wrote, or one ingested before the sheet
   * existed -- nothing changes. The old layout is still correct for a question
   * that has no paper, and it is what every session already running is using.
   */
  const printedPages = usePrintedPages(question);
  const hasSheet = printedPages.length > 0;
  /**
   * The questions this session is made of, read back out of its parts.
   *
   * A student asks for two questions and the session stores fourteen parts, so
   * it used to count itself "Question 1 of 14" -- a number nobody chose. The
   * parts have not changed: each is still answered on its own and marked on
   * its own. Only the counting has, so the session says the same thing the
   * setup screen did.
   */
  const runs = useMemo(() => examSessionQuestionRuns(questions), [questions]);
  const { run, runIndex, partIndex } = examSessionRunAt(runs, index);
  /** "(b)" where the paper letters its parts, empty where the question is whole. */
  const partLabel = examQuestionPartLabel(question?.provenance?.questionNumber ?? "");
  const questionNumber = run?.number || String(runIndex + 1);
  /** "3(b)" on a question with parts, "3" on one without. */
  const questionCardLabel = `${questionNumber}${run && run.count > 1 ? partLabel : ""}`;

  const activeAttemptId = activeAttempt?.id ?? "";
  const storedAnswer = activeAttempt?.answerText ?? "";

  /*
   * Each question opens on its own evidence, not the last one's. The sheet is
   * unread until it reports, and a typed box asked for on one question is not
   * still open on the next.
   */
  useEffect(() => {
    setHasInk(false);
    setInkKnown(false);
  }, [activeAttemptId]);

  /*
   * A draft typed earlier wins over what the server last stored: a box the
   * student has just emptied has no text in it, whatever is still saved.
   */
  useEffect(() => {
    const text = latestDrafts.current.get(activeAttemptId) ?? storedAnswer;
    setHasTypedText(text.trim().length > 0);
  }, [activeAttemptId, storedAnswer]);

  /** Nothing written anywhere. Only true once the sheet has actually been read. */
  const nothingToSend = inkKnown && !hasInk && !hasTypedText;
  const questionId = question?.id ?? "";
  const assetPath = useCallback(
    (assetId: string) =>
      `/api/practice/exam-sessions/${encodeURIComponent(sessionId)}/assets/${encodeURIComponent(questionId)}/${encodeURIComponent(assetId)}`,
    [questionId, sessionId]
  );
  /**
   * Whether the working is covering the screen as its own dialog.
   *
   * Only ever for a question with no paper of its own. A sheet is the
   * question, so it is never something to open over the question.
   */
  const workingOpen = showWorking && !hasSheet;

  /*
   * Focus follows the sheet, and the page behind it is hidden from screen
   * readers while it is open -- without this a keyboard user could tab from a
   * fullscreen working sheet into the answer box underneath it.
   */
  useEffect(() => {
    // The question and the answer sit in different columns from the sheet, so
    // each is marked rather than hiding a shared parent that holds the sheet.
    const behind = Array.from(document.querySelectorAll<HTMLElement>("[data-behind-working]"));
    if (!workingOpen) {
      behind.forEach((element) => element.removeAttribute("aria-hidden"));
      focusBeforeWorking.current?.focus?.();
      focusBeforeWorking.current = null;
      return;
    }
    focusBeforeWorking.current = document.activeElement as HTMLElement | null;
    behind.forEach((element) => element.setAttribute("aria-hidden", "true"));
    const frame = window.requestAnimationFrame(() => {
      const sheet = workingSheet.current;
      if (!sheet) return;
      sheet.setAttribute("tabindex", "-1");
      sheet.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      behind.forEach((element) => element.removeAttribute("aria-hidden"));
    };
  }, [workingOpen]);
  const isLast = index === questions.length - 1;
  /*
   * A durable job does the marking, and it writes down its own failures, so an
   * attempt reading "marking" long after its last sign of life is one whose
   * job did not survive to write anything -- a redeploy mid-call, or a crash.
   * Past its lease it is not in progress, it is stranded, and the student is
   * offered the one thing that actually helps.
   *
   * The lease is generous because the job's deadline is: each completed
   * marker report touches the attempt, so a marking still working through its
   * stages keeps showing progress rather than ageing towards this.
   */
  const markingStale =
    activeAttempt?.status === "marking" &&
    now - (activeAttempt.updatedAt ?? 0) > EXAM_OPERATION_LEASE_MS;
  /** A failure the same evidence could survive. The others are a dead end. */
  const markingFailureRetryable = examMarkingFailureIsRetryable(
    activeAttempt?.markingFailure?.code ?? "marking_failed"
  );
  /** Something is being worked on server-side, so the page keeps watching. */
  const pendingStatus =
    activeAttempt && (activeAttempt.status === "marking" || activeAttempt.reviewStatus === "reviewing")
      ? `${activeAttempt.id}:${activeAttempt.status}:${activeAttempt.reviewStatus ?? ""}`
      : null;
  /*
   * A mark in progress resolves itself rather than waiting to be asked, and
   * stops being watched once the attempt reaches a settled state.
   *
   * Steady rather than backing off. The backoff reached fifteen seconds by the
   * sixth check, so a mark finished at second 19 was not shown until second 32
   * -- the wait it added fell on exactly the markings already taking longest.
   * Only a mark running well past its usual length slows down, so something
   * stranded is not polled at full speed until its lease runs out.
   */
  useEffect(() => {
    if (pendingStatus === null) return;
    let cancelled = false;
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const delay = () => (Date.now() - startedAt < 180_000 ? 2_500 : 10_000);
    const tick = async () => {
      await refresh();
      if (cancelled) return;
      setNow(Date.now());
      timer = setTimeout(() => void tick(), delay());
    };
    timer = setTimeout(() => void tick(), delay());
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

  /*
   * What was typed, reported by the answer box rather than kept in state here.
   *
   * Every keystroke used to set state on this component, so the whole session
   * re-rendered on each one -- the question card and its maths, the working
   * sheet and its toolbar, the strip of questions -- for a box that only needed
   * its own text. The box holds its own value now; this keeps the latest draft
   * per attempt, which is everything saving and submitting read.
   */
  const handleDraft = useCallback(
    (attemptId: string, text: string, storedText: string) => {
      latestDrafts.current.set(attemptId, text);
      setHasTypedText(text.trim().length > 0);
      // Typing back to what is stored still has to replace an edit already queued.
      if (text === storedText && !pendingDrafts.current.has(attemptId)) return;
      pendingDrafts.current.set(attemptId, text);
      if (draftTimer.current) clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(() => void flushDrafts(), DRAFT_SAVE_MS);
    },
    [flushDrafts]
  );

  /** A draft typed before leaving a question, for the box to open with on return. */
  const readDraft = useCallback((attemptId: string) => latestDrafts.current.get(attemptId), []);

  useEffect(() => {
    // Leaving the page is the one flush that has to outlive the document.
    const onLeave = () => void flushDrafts({ keepalive: true });
    window.addEventListener("pagehide", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      void flushDrafts();
    };
  }, [flushDrafts]);

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
        // The latest draft if one was typed, else what is stored.
        answerText: latestDrafts.current.get(activeAttempt.id) ?? activeAttempt.answerText ?? "",
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
      if (response.attempt.status === "marked") reportTutorialAction("mark-exam-answer");
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
      latestDrafts.current.set(retryId, "");
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

  const markedPartIds = new Set(
    attempts
      .filter((item) => item.attemptNumber === 1 && item.status === "marked")
      .map((item) => item.questionId)
  );
  /*
   * A question counts as marked once all of its parts are: 3(a) marked and
   * 3(b) still blank is a question still to finish, and calling it done would
   * be the same miscount the other way round.
   */
  const markedCount = runs.filter((item) =>
    questions
      .slice(item.from, item.from + item.count)
      .every((part) => markedPartIds.has(part.id))
  ).length;
  const retryTargets = (firstAttempt?.result?.criterionResults ?? []).filter(
    (item) => (item.awardedMarks ?? 0) === 0
  );
  const notebookChoices = notebooks.filter((item) => item.folderId === session.folderId);
  /*
   * The report leads with the mark and carries the question inside it, so the
   * question card above is only drawn for the states that are still about
   * answering it.
   */
  const showReport =
    Boolean(markedAttempt) && !answering && !(activeAttempt?.status === "marking" && !submitting);

  return (
    <AppPage
      title={session.subject}
      backHref="/dashboard/practice"
      backLabel="Practice"
      width="study"
    >
      <div className="space-y-4">
        {error ? <FeedbackBanner type="error" message={error} onDismiss={() => setError("")} /> : null}
        {/*
          * An answer the server refused to send, handed back for editing.
          *
          * This used to be a 413 on the submit request, which the page turned
          * into a banner. The submit request no longer knows: it returns while
          * the marking is still queued, and the refusal happens later against
          * an attempt that has been reopened as a draft. So the banner is
          * driven by the attempt instead of by a response.
          */}
        {!error &&
        activeAttempt?.status === "draft" &&
        activeAttempt.markingFailure &&
        dismissedFailure !== activeAttempt.id ? (
          <FeedbackBanner
            type="error"
            message={activeAttempt.markingFailure.message}
            onDismiss={() => setDismissedFailure(activeAttempt.id)}
          />
        ) : null}

        {session.status === "completed" ? (
          <Card tone="warm" padding="lg">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-text-secondary">
                  Session complete
                </p>
                <p className="mt-2 flex items-baseline font-semibold tabular-nums tracking-tight text-text-primary">
                  <span className="text-5xl leading-none">{session.awardedTotal}</span>
                  <span className="ml-1 text-2xl leading-none text-text-muted">/{session.maxTotal}</span>
                </p>
                <ProgressBar
                  size="sm"
                  progress={session.maxTotal ? (session.awardedTotal / session.maxTotal) * 100 : 0}
                  className="mt-4 max-w-sm"
                />
                <p className="mt-3 text-sm text-text-muted">
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

        <ExamSessionQuestionBar
          runs={runs}
          parts={questions}
          attempts={attempts}
          index={index}
          markedCount={markedCount}
          canFinish={session.status === "active"}
          finishing={finishing}
          onGoTo={goTo}
          onFinish={() => void finish()}
        />

        {/*
          * Two columns only while there is a second thing to put in one.
          * After marking the working pane is gone, and the grid kept its
          * shape -- so the report was squeezed into nine-tenths of a column
          * with an empty half of the screen beside it.
          */}
        {showReport && markedAttempt ? (
          <div className="mx-auto w-full max-w-3xl space-y-4">
            <ExamQuestionMarkReport
              attempt={markedAttempt}
              firstAttempt={firstAttempt}
              sessionId={sessionId}
              question={
                <QuestionCard sessionId={sessionId} question={question} label={questionCardLabel} collapsible />
              }
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
              <Card tone="subtle" padding="md">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-text-primary">Keep this in a notebook</h3>
                    <p className="mt-0.5 text-sm text-text-muted">
                      A marked page with the question, your work and the feedback.
                    </p>
                  </div>
                  {savedNotebook ? (
                    <p className="shrink-0 text-sm font-semibold text-[var(--color-success-text)]">
                      Saved to your notebook.
                    </p>
                  ) : (
                    <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
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
                </div>
              </Card>
            ) : null}
          </div>
        ) : (
        /*
         * The question, in full, on the left; one answer sheet on the right,
         * the paper being written on with the optional typed answer folded
         * away beneath it. Everything that gets marked is in one place beside
         * the question it answers.
         *
         * Side by side only on a wide screen held landscape, with the sheet
         * given the larger share: an even split left an iPad a page of working
         * barely wider than a phone's. Held upright -- a portrait iPad, even a
         * 13-inch one at exactly `lg` -- the two stack and the sheet takes the
         * full width.
         */
        <div
          className={`grid items-start gap-4 lg:gap-6 ${
            answering && hasSheet
              ? "mx-auto w-full max-w-5xl"
              : answering
                ? "lg:landscape:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] 2xl:landscape:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]"
                : "mx-auto w-full max-w-3xl"
          }`}
        >
          {answering && hasSheet ? null : (
            <div
              data-behind-working
              className={`min-w-0 ${
                answering
                  ? "lg:landscape:sticky lg:landscape:top-[8.5rem] lg:landscape:max-h-[calc(100dvh-10rem)] lg:landscape:overflow-y-auto lg:landscape:rounded-2xl"
                  : ""
              }`}
            >
              <QuestionCard sessionId={sessionId} question={question} label={questionCardLabel} />
            </div>
          )}

          <div className="min-w-0 space-y-4">
          <div data-behind-working className="space-y-4 empty:hidden">
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
                  <div className="flex items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        markingStale
                          ? "bg-[var(--color-warning-mark)]"
                          : "animate-pulse bg-accent"
                      }`}
                    />
                    <h3 className="text-base font-semibold text-text-primary">
                      {markingStale ? "This one is taking too long" : "Jami is marking this one"}
                    </h3>
                  </div>
                  <p className="mt-2 text-sm leading-5 text-text-muted">
                    {markingStale
                      ? "Your answer and working are saved exactly as you sent them. Marking looks like it stopped part way — running it again will not change what is marked."
                      : "Your answer is saved and is being marked now. This usually takes under a minute, it carries on if you leave this page, and this page updates on its own."}
                  </p>
                  {markingStale ? (
                    <Button
                      className="mt-4"
                      variant="primary"
                      disabled={submitting}
                      onClick={() => void submit()}
                    >
                      Mark it again
                    </Button>
                  ) : null}
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
                  {/*
                    * The reason comes from the attempt, because the request
                    * that submitted it is long gone by the time the marking
                    * fails. A question that changed under a live session and a
                    * marker that fell over are not the same news, and only one
                    * of them is worth pressing a button about.
                    */}
                  <p className="mt-2 text-sm leading-5 text-text-muted">
                    {activeAttempt.markingFailure?.message ??
                      examMarkingFailureMessage("marking_failed")}
                  </p>
                  {markingFailureRetryable ? (
                    <>
                      <p className="mt-2 text-sm leading-5 text-text-muted">
                        Nothing has been changed — this just runs the marker over them again.
                      </p>
                      <Button className="mt-4" disabled={submitting} onClick={() => void submit()}>
                        {submitting ? "Marking…" : "Retry marking"}
                      </Button>
                    </>
                  ) : null}
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
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-text-secondary">
                        Second try
                      </p>
                      <p className="text-sm font-semibold tabular-nums text-text-secondary">
                        First try {firstAttempt.result.awardedMarks}/{firstAttempt.result.maxMarks}
                      </p>
                    </div>
                    {retryTargets.length ? (
                      <>
                        <p className="mt-3 text-sm font-medium text-text-primary">Aim to cover</p>
                        <ul className="mt-2 space-y-2">
                          {retryTargets.map((item, itemIndex) => (
                            <li
                              key={`${item.criterion}-${itemIndex}`}
                              className="flex gap-2.5 text-sm leading-6 text-text-primary"
                            >
                              <span
                                aria-hidden="true"
                                className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                              />
                              <StudyText as="span" text={item.criterion} />
                            </li>
                          ))}
                        </ul>
                      </>
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

              </>
            ) : null}
          </div>

          {answering && activeAttempt ? (
            <section
              aria-label="Answer sheet"
              className={`app-panel min-w-0 ${hasSheet ? "" : "overflow-hidden"}`}
            >
              {/*
                * The panel is not clipped while there is paper in it: the
                * working sheet pins its tool pill to the top as the page
                * scrolls, and a clipped ancestor is a scrollport that never
                * scrolls, so the pill would simply sit where it started. With
                * no paper the panel opens on a filled header instead, which
                * does need the rounded corner cut.
                *
                * With a sheet, the question is not a card in another column --
                * it is the paper below. So what the column used to say about
                * it moves here: its number, what it is worth, and which paper
                * it came off.
                */}
              {hasSheet ? (
                <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-[var(--color-border)] px-4 py-3 sm:px-5">
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h2 className="text-base font-semibold tracking-tight text-text-primary">
                      Question {questionNumber}
                      {run && run.count > 1 ? (
                        <span className="text-text-secondary"> {partLabel || `part ${partIndex + 1}`}</span>
                      ) : null}
                    </h2>
                    {run && run.count > 1 ? (
                      <p className="shrink-0 text-xs text-text-muted">
                        Part {partIndex + 1} of {run.count}
                      </p>
                    ) : null}
                    <p className="truncate text-xs text-text-muted">{provenanceLine(question)}</p>
                  </div>
                  <span className="shrink-0 rounded-full border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-2.5 py-1 text-xs font-semibold tabular-nums text-text-primary">
                    {question.marks} mark{question.marks === 1 ? "" : "s"}
                  </span>
                  {tariffNote(question) ? (
                    <p className="basis-full text-xs leading-5 text-text-muted">
                      {tariffNote(question)}
                    </p>
                  ) : null}
                </header>
              ) : null}

              {/*
                * A dialog by hand, deliberately.
                *
                * The shared Dialog renders its children only while open, and the
                * pad has to stay mounted whether or not the sheet is: it holds the
                * handle submission asks for, so on a phone a student who never
                * opened working could not submit at all. So the sheet keeps its
                * one mount point and takes on the dialog's obligations instead --
                * a labelled modal role, focus moved in and restored on close,
                * Escape, and the rest of the page hidden from assistive
                * technology while it covers the screen.
                *
                * None of that applies to a question with its own paper. There the
                * sheet is the question, it is on the page at every width, and the
                * way to write on it at full size is the control the sheet already
                * carries.
                */}
              <div
                ref={workingSheet}
                {...(workingOpen
                  ? {
                      role: "dialog" as const,
                      "aria-modal": true,
                      "aria-label": "Your working",
                      onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => {
                        if (event.key !== "Escape") return;
                        event.stopPropagation();
                        setShowWorking(false);
                      },
                    }
                  : {})}
                className={
                  hasSheet
                    ? "min-w-0"
                    : `${
                        workingOpen
                          ? "fixed inset-0 z-50 overflow-y-auto bg-[var(--app-background)] p-3 pb-[env(safe-area-inset-bottom)]"
                          : "hidden md:block"
                      } md:static md:block md:overflow-visible md:bg-transparent md:p-0`
                }
              >
                <div className={workingOpen ? "app-panel" : ""}>
                  {hasSheet ? null : (
                    <div
                      className={`flex items-center justify-between gap-3 bg-[var(--color-glass-subtle)] px-4 py-2.5 sm:px-5 ${
                        activeAttempt.status === "draft" && !workingOpen
                          ? "border-t border-[var(--color-border)]"
                          : ""
                      }`}
                    >
                      <div className="flex min-w-0 items-baseline gap-2">
                        <h2 className="text-sm font-semibold text-text-primary">Working</h2>
                        <p className="truncate text-xs text-text-muted">
                          {activeAttempt.status !== "draft"
                            ? "As it was sent"
                            : hasInk
                              ? "Sent with your answer"
                              : "Optional"}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="md:hidden"
                        onClick={() => setShowWorking(false)}
                      >
                        Done
                      </Button>
                    </div>
                  )}
                  <ExamScratchpad
                    key={activeAttempt.id}
                    embedded
                    userId={user.uid}
                    attemptId={activeAttempt.id}
                    printedPages={printedPages}
                    answerSpacePages={question.answerSpacePages}
                    questionLabel={question.label}
                    assetPath={assetPath}
                    // Read-only the moment the attempt stops being a draft: the
                    // sheet is then frozen evidence, and the rules refuse writes.
                    disabled={submitting || activeAttempt.status !== "draft"}
                    onHandle={handleScratchpad}
                    onInkChange={handleInkChange}
                  />
                </div>
              </div>

              {/*
                * The typed answer, under the paper rather than over it, and
                * only if it is wanted.
                *
                * It sat above the working while the working was a pad and the
                * question was a picture somewhere else. Now that the paper is
                * the page, above the paper is above the question, and a box
                * asking for an answer before the question has been read is the
                * wrong way round.
                *
                * It is also no longer how an answer is given. A student writes
                * on the printed sheet, the way they would in the exam, and the
                * marker reads the sheet -- so on a question with paper the box
                * folds away, says what it is, and opens for anyone who wants to
                * type as well. Typing an answer out a second time to satisfy a
                * form was work the paper had already done. A question with no
                * paper has nowhere else to answer, so there the box stays the
                * answer line it was.
                *
                * Folded, not unmounted: the field keeps its text and its
                * autosave whether or not the section is open, so closing it is
                * putting the sheet down rather than losing the page.
                */}
              {activeAttempt.status === "draft" ? (
                <div
                  data-behind-working
                  className={`p-4 sm:p-5 ${
                    hasSheet ? "border-t border-[var(--color-border)]" : ""
                  }`}
                >
                  {hasSheet ? (
                    <FormDisclosure
                      key={activeAttempt.id}
                      title={retryOpen ? "Try your answer again" : "Type your answer"}
                      summary={hasTypedText ? "Answer typed" : "Optional"}
                      /*
                       * Read once, at mount. An answer already typed -- saved
                       * earlier, or drafted before leaving the question -- opens
                       * with it showing, so nobody has to go looking for it.
                       */
                      defaultOpen={Boolean(
                        (
                          latestDrafts.current.get(activeAttempt.id) ??
                          activeAttempt.answerText ??
                          ""
                        ).trim()
                      )}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <label htmlFor={answerFieldId} className="text-sm text-text-muted">
                          Marked alongside what you wrote on the paper.
                        </label>
                    <p aria-live="polite" className="flex items-center gap-2 text-xs text-text-muted">
                      <span
                        aria-hidden="true"
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          saveState === "failed"
                            ? "bg-[var(--color-error-mark)]"
                            : saveState === "saving"
                              ? "animate-pulse bg-[var(--color-warning-mark)]"
                              : saveState === "saved"
                                ? "bg-[var(--color-success-mark)]"
                                : "bg-[var(--color-border-strong)]"
                        }`}
                      />
                      {saveState === "saving"
                        ? "Saving…"
                        : saveState === "failed"
                          ? "Couldn't save just now — it will retry."
                          : saveState === "saved"
                            ? "Saved."
                            : "Saves as you write."}
                    </p>
                      </div>
                  <ExamAnswerField
                    key={activeAttempt.id}
                    id={answerFieldId}
                    prompt={question.prompt}
                    attemptId={activeAttempt.id}
                    storedText={activeAttempt.answerText ?? ""}
                    disabled={submitting}
                    readDraft={readDraft}
                    onDraft={handleDraft}
                  />
                    </FormDisclosure>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <label
                          htmlFor={answerFieldId}
                          className="text-base font-semibold tracking-tight text-text-primary"
                        >
                          {retryOpen ? "Try your answer again" : "Your answer"}
                        </label>
                    <p aria-live="polite" className="flex items-center gap-2 text-xs text-text-muted">
                      <span
                        aria-hidden="true"
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          saveState === "failed"
                            ? "bg-[var(--color-error-mark)]"
                            : saveState === "saving"
                              ? "animate-pulse bg-[var(--color-warning-mark)]"
                              : saveState === "saved"
                                ? "bg-[var(--color-success-mark)]"
                                : "bg-[var(--color-border-strong)]"
                        }`}
                      />
                      {saveState === "saving"
                        ? "Saving…"
                        : saveState === "failed"
                          ? "Couldn't save just now — it will retry."
                          : saveState === "saved"
                            ? "Saved."
                            : "Saves as you write."}
                    </p>
                      </div>
                  <ExamAnswerField
                    key={activeAttempt.id}
                    id={answerFieldId}
                    prompt={question.prompt}
                    attemptId={activeAttempt.id}
                    storedText={activeAttempt.answerText ?? ""}
                    disabled={submitting}
                    readDraft={readDraft}
                    onDraft={handleDraft}
                  />
                    </>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {hasSheet ? null : (
                      <Button
                        type="button"
                        variant="secondary"
                        className="md:hidden"
                        onClick={() => setShowWorking(true)}
                      >
                        {hasInk ? "Open working" : "Show your working"}
                      </Button>
                    )}
                    <p className={`text-xs text-text-muted ${hasSheet ? "" : "hidden md:block"}`}>
                      {nothingToSend
                        ? hasSheet
                          ? "Write on the paper above, or type an answer, then mark it."
                          : "Type an answer, or show your working, then mark it."
                        : hasSheet
                          ? hasInk && hasTypedText
                            ? "The paper and your typed answer are both sent."
                            : hasInk
                              ? "What you wrote on the paper is sent to be marked."
                              : "Your typed answer is sent to be marked."
                          : hasInk
                            ? "Your working below is sent with this answer."
                            : "Working below is optional — sent only if you use it."}
                    </p>
                    <Button
                      className="ml-auto"
                      disabled={submitting || nothingToSend}
                      onClick={() => void submit()}
                      data-tutorial-target="mark-answer"
                    >
                      {submitting
                        ? hasInk
                          ? "Reading your working…"
                          : "Marking your answer…"
                        : hasInk && hasTypedText
                          ? "Mark answer and working"
                          : hasInk
                            ? "Mark my working"
                            : "Mark answer"}
                    </Button>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}
          </div>
        </div>
        )}

        {session.status === "completed" ? (
          <div className="flex justify-center border-t border-[var(--color-border)] pt-4 sm:justify-end">
            <Button variant="ghost" size="sm" disabled={deleting} onClick={() => setConfirmDelete(true)}>
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

const PART_ACTION_CLASS =
  "rounded text-xs font-semibold text-accent underline-offset-2 transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:cursor-not-allowed disabled:opacity-50";

/** How a draft opens: in one box, or in a box for each part it was written in. */
function initialAnswerLayout(prompt: string, text: string) {
  const asked = detectExamAnswerParts(prompt);
  const labels = asked.length > 0 ? asked : examAnswerPartLabelsIn(text);
  if (labels.length === 0) return { labels, texts: [] as string[] };
  const texts = splitExamAnswerParts(text, labels);
  // A question that asks for parts opens by part even over an answer typed in
  // one box before it could; that answer goes into the first part to be moved.
  if (texts) return { labels, texts };
  return asked.length > 0
    ? { labels, texts: [text.trim(), ...labels.slice(1).map(() => "")] }
    : { labels: [] as string[], texts: [] as string[] };
}

/**
 * The typed answer, holding its own text.
 *
 * Kept apart from the session so a keystroke re-renders this box and nothing
 * else. It opens with a draft typed before the student left the question, if
 * there is one, and reports every change for saving.
 *
 * A question that asks for (a), (b) and (c) gets a box for each, rather than
 * leaving a student to label three answers inside one box, and any answer can
 * be split into parts by hand. However it is typed, it is saved and marked as
 * one labelled answer.
 */
const ExamAnswerField = memo(function ExamAnswerField({
  id,
  attemptId,
  prompt,
  storedText,
  disabled,
  readDraft,
  onDraft,
}: {
  id: string;
  attemptId: string;
  prompt: string;
  storedText: string;
  disabled: boolean;
  readDraft(attemptId: string): string | undefined;
  onDraft(attemptId: string, text: string, storedText: string): void;
}) {
  const [initial] = useState(() => {
    const text = readDraft(attemptId) ?? storedText;
    return { text, ...initialAnswerLayout(prompt, text) };
  });
  const [value, setValue] = useState(initial.text);
  const [labels, setLabels] = useState<string[]>(initial.labels);
  const [texts, setTexts] = useState<string[]>(initial.texts);
  const report = (text: string) => onDraft(attemptId, text, storedText);

  if (labels.length === 0) {
    return (
      <>
        <Textarea
          id={id}
          containerClassName="mt-3"
          className="resize-y leading-6"
          rows={3}
          symbols
          value={value}
          maxLength={EXAM_ANSWER_MAX_LENGTH}
          placeholder="Type your final answer…"
          disabled={disabled}
          onChange={(event) => {
            const text = event.target.value;
            setValue(text);
            report(text);
          }}
        />
        <button
          type="button"
          className={`mt-2 ${PART_ACTION_CLASS}`}
          disabled={disabled}
          onClick={() => {
            const nextLabels = ["(a)", "(b)"];
            const nextTexts = [value, ""];
            setLabels(nextLabels);
            setTexts(nextTexts);
            report(joinExamAnswerParts(nextLabels, nextTexts));
          }}
        >
          Answer in parts (a), (b)…
        </button>
      </>
    );
  }

  const nextLabel = nextExamAnswerPartLabel(labels);
  const lastLabel = labels[labels.length - 1];
  const partMaxLength = examAnswerPartMaxLength(labels.length);
  const changeParts = (nextLabels: string[], nextTexts: string[]) => {
    setLabels(nextLabels);
    setTexts(nextTexts);
    report(joinExamAnswerParts(nextLabels, nextTexts));
  };

  return (
    <div className="mt-3 space-y-2.5">
      {labels.map((label, index) => {
        const fieldId = index === 0 ? id : `${id}-part-${index}`;
        return (
          <div key={label} className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-2">
            <label
              htmlFor={fieldId}
              className="pt-2.5 text-center text-sm font-semibold tabular-nums text-text-secondary"
            >
              {label}
            </label>
            <Textarea
              id={fieldId}
              className="resize-y leading-6"
              rows={2}
              symbols
              value={texts[index] ?? ""}
              maxLength={partMaxLength}
              placeholder={`Answer to part ${label}`}
              disabled={disabled}
              onChange={(event) =>
                changeParts(
                  labels,
                  texts.map((current, textIndex) => (textIndex === index ? event.target.value : current))
                )
              }
            />
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-12">
        {nextLabel ? (
          <button
            type="button"
            className={PART_ACTION_CLASS}
            disabled={disabled}
            onClick={() => changeParts([...labels, nextLabel], [...texts, ""])}
          >
            Add part {nextLabel}
          </button>
        ) : null}
        {labels.length > 2 && lastLabel && !(texts[labels.length - 1] ?? "").trim() ? (
          <button
            type="button"
            className={PART_ACTION_CLASS}
            disabled={disabled}
            onClick={() => changeParts(labels.slice(0, -1), texts.slice(0, -1))}
          >
            Remove part {lastLabel}
          </button>
        ) : null}
        <button
          type="button"
          className={PART_ACTION_CLASS}
          disabled={disabled}
          onClick={() => {
            const joined = joinExamAnswerParts(labels, texts);
            setValue(joined);
            setLabels([]);
            setTexts([]);
            report(joined);
          }}
        >
          Use one box
        </button>
      </div>
    </div>
  );
});

/**
 * The question, either in full while it is being answered or folded under the
 * mark once it has been. Folded, it keeps its number and source visible so the
 * report still says which question it is about.
 *
 * Memoised: its question does not change while it is being answered, and the
 * session around it re-renders for its save indicator and working sheet.
 */
const QuestionCard = memo(function QuestionCard({
  sessionId,
  question,
  label,
  collapsible = false,
}: {
  sessionId: string;
  question: SessionQuestion;
  /**
   * What the paper calls it -- "3", or "3(b)" for one part of it.
   *
   * It was this part's position in the session, so the fourth part of question
   * 3 was headed "Question 4". A student checking their working against the
   * paper in front of them was reading two different numbering systems.
   */
  label: string;
  collapsible?: boolean;
}) {
  const marks = `${question.marks} mark${question.marks === 1 ? "" : "s"}`;
  const chips = (
    <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
      <span className="rounded-full bg-[var(--color-glass-subtle)] px-2.5 py-1 capitalize text-text-secondary">
        {question.difficulty}
      </span>
      {question.origin === "jami_generated" ? (
        <span className="rounded-full bg-warm-accent/15 px-2.5 py-1 text-warm-accent">Jami-created</span>
      ) : null}
    </div>
  );
  // The printed page is the question; its transcription is kept for screen readers.
  const printed = examQuestionShowsPrintedPage(question);
  const body = (
    <>
      <StudyText
        as="div"
        text={question.prompt}
        className={
          printed
            ? "sr-only"
            : "mt-5 whitespace-pre-wrap text-base leading-8 text-text-primary sm:text-lg"
        }
      />
      <ExamQuestionAssets sessionId={sessionId} questionId={question.id} assets={question.assets} />
    </>
  );

  if (collapsible) {
    return (
      <details className="app-panel group w-full min-w-0 overflow-hidden rounded-xl sm:rounded-2xl">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 sm:px-6 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-text-primary">
              Question {label}
              <span className="font-normal text-text-muted"> · {marks}</span>
            </span>
            <span className="mt-0.5 block truncate text-xs text-text-muted">{provenanceLine(question)}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-text-secondary">
            <span className="group-open:hidden">Show question</span>
            <span className="hidden group-open:inline">Hide</span>
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              fill="none"
              className="h-4 w-4 transition-transform duration-fast group-open:rotate-180"
            >
              <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </summary>
        <div className="border-t border-[var(--color-border)] px-4 pb-5 pt-4 sm:px-6">
          {chips}
          {body}
        </div>
      </details>
    );
  }

  return (
    <Card padding="md">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-lg font-semibold tracking-tight text-text-primary">Question {label}</h2>
          {chips}
        </div>
        <span className="shrink-0 rounded-full border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-3 py-1 text-xs font-semibold tabular-nums text-text-primary">
          {marks}
        </span>
      </div>
      <p className="mt-1 text-xs text-text-muted">{provenanceLine(question)}</p>
      {tariffNote(question) ? (
        <p className="mt-1.5 text-xs leading-5 text-text-muted">{tariffNote(question)}</p>
      ) : null}
      {body}
    </Card>
  );
});
