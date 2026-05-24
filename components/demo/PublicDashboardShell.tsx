"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import AppPage from "@/components/layout/AppPage";
import TabBar from "@/components/layout/TabBar";
import { buildTodayPlan } from "@/lib/dashboard/today-plan";
import {
  APP_THEME_OPTIONS,
  readAppThemePreference,
  saveAppThemePreference,
  type AppThemePreference,
} from "@/lib/app/theme-preference";
import {
  Button,
  Card,
  FeedbackBanner,
  MetricStrip,
  PageHero,
  ProgressBar,
  SectionHeader,
  Textarea,
} from "@/components/ui";
import {
  WALKTHROUGH_ATTEMPTS,
  WALKTHROUGH_CARDS,
  WALKTHROUGH_DECKS,
  WALKTHROUGH_INITIAL_DRAFTS,
  WALKTHROUGH_INITIAL_TUTOR_MESSAGES,
  WALKTHROUGH_QUESTIONS,
  WALKTHROUGH_SOURCES,
  WALKTHROUGH_TOPICS,
  type WalkthroughAttempt,
  type WalkthroughDraft,
  type WalkthroughQuestion,
  type WalkthroughTutorIntent,
  type WalkthroughTutorMessage,
} from "@/lib/demo/public-walkthrough";

type Feedback = { type: "success" | "error"; message: string };
type AgentTutorContextPreview = {
  questionText: string;
  answer: string;
  working: string;
  selectedText?: string;
  intent: WalkthroughTutorIntent | "none";
};
type PublicSurface =
  | "home"
  | "learn"
  | "practise"
  | "progress"
  | "decks"
  | "cards"
  | "library"
  | "goals"
  | "constellation"
  | "profile";

const TUTOR_ACTIONS: Array<{
  intent: WalkthroughTutorIntent;
  label: string;
  prompt: string;
  description: string;
  variant?: "secondary" | "danger" | "warm";
}> = [
  {
    intent: "hint",
    label: "Hint",
    prompt: "Give me one hint without revealing the answer.",
    description: "One nudge without the answer.",
  },
  {
    intent: "stuck-here",
    label: "Stuck here",
    prompt: "I'm stuck here. Use my current working and give me the next useful step only.",
    description: "Use the current step and give one next move.",
  },
  {
    intent: "check-working",
    label: "Check working",
    prompt: "Check my working and point me to the first thing to fix.",
    description: "Check whether your steps are valid.",
  },
  {
    intent: "explain-concept",
    label: "Explain",
    prompt: "Explain the concept behind this question without dumping the final answer.",
    description: "Understand the idea behind it.",
  },
  {
    intent: "show-method",
    label: "Method",
    prompt: "Show the setup or method, but leave a step for me.",
    description: "See the structure, then fill the gap.",
  },
  {
    intent: "full-solution",
    label: "Full solution",
    prompt: "Show the full solution. I understand this is less independent evidence.",
    description: "Reveal the answer deliberately.",
    variant: "danger",
  },
  {
    intent: "make-flashcard",
    label: "Make card",
    prompt: "Turn the misconception here into one flashcard draft.",
    description: "Turn a useful mistake into a draft.",
    variant: "warm",
  },
  {
    intent: "similar-question",
    label: "Similar question",
    prompt: "Give me one similar question without a solution.",
    description: "Practise the same skill again.",
  },
];

const surfaceCardClass =
  "rounded-[1.2rem] border border-white/[0.09] bg-white/[0.04] p-4 shadow-[0_10px_22px_rgba(4,8,18,0.12)]";
const interactiveCardClass =
  "rounded-[1.2rem] border border-white/[0.09] bg-white/[0.04] p-4 text-left shadow-[0_10px_22px_rgba(4,8,18,0.12)] transition duration-fast hover:-translate-y-0.5 hover:border-white/[0.16] hover:bg-white/[0.065]";
const selectedCardClass =
  "border-warm-border bg-warm-glow text-white shadow-[0_12px_24px_rgba(4,8,18,0.16)]";
const chipClass =
  "rounded-full border border-white/[0.1] bg-white/[0.055] px-2.5 py-1 text-xs font-medium text-text-secondary";

type ScratchpadPoint = { x: number; y: number };
type ScratchpadStroke = { points: ScratchpadPoint[] };

function getAccuracy(attempts: WalkthroughAttempt[]) {
  if (attempts.length === 0) return 0;
  return Math.round((attempts.filter((attempt) => attempt.isCorrect).length / attempts.length) * 100);
}

function getSupportLevel(attempts: WalkthroughAttempt[]) {
  if (attempts.length === 0) return "Low";
  const supported = attempts.filter((attempt) => attempt.tutorUsed || attempt.hintsUsed > 0).length;
  const ratio = supported / attempts.length;
  if (ratio >= 0.6) return "High";
  if (ratio >= 0.25) return "Medium";
  return "Low";
}

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes === 0) return `${remainingSeconds}s`;
  return `${minutes}m ${remainingSeconds.toString().padStart(2, "0")}s`;
}

function getQuestionAttempts(questionId: string, attempts: WalkthroughAttempt[]) {
  return attempts.filter((attempt) => attempt.questionId === questionId);
}

function topicName(topicId: string) {
  return WALKTHROUGH_TOPICS.find((topic) => topic.id === topicId)?.name ?? "Topic";
}

function deckName(deckId: string) {
  return WALKTHROUGH_DECKS.find((deck) => deck.id === deckId)?.name ?? "Deck";
}

function getSurface(pathname: string): PublicSurface {
  if (pathname === "/dashboard" || pathname === "/dashboard/") return "home";
  if (pathname.startsWith("/dashboard/study") || pathname.startsWith("/dashboard/learn")) return "learn";
  if (pathname.startsWith("/dashboard/practise")) return "practise";
  if (pathname.startsWith("/dashboard/progress") || pathname.startsWith("/dashboard/stats")) return "progress";
  if (pathname.startsWith("/dashboard/decks")) return "decks";
  if (pathname.startsWith("/dashboard/cards")) return "cards";
  if (pathname.startsWith("/dashboard/library")) return "library";
  if (pathname.startsWith("/dashboard/goals")) return "goals";
  if (pathname.startsWith("/dashboard/constellation")) return "constellation";
  if (pathname.startsWith("/dashboard/profile")) return "profile";
  return "home";
}

function getPreselectedWalkthroughQuestionId() {
  if (typeof window === "undefined") {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  const targetQuestionId = params.get("question")?.trim() ?? "";
  const targetTopicId = params.get("topic")?.trim() ?? "";
  const targetQuestion = targetQuestionId
    ? WALKTHROUGH_QUESTIONS.find((question) => question.id === targetQuestionId)
    : undefined;
  const topicQuestion =
    !targetQuestion && targetTopicId
      ? WALKTHROUGH_QUESTIONS.find((question) => question.topicIds.includes(targetTopicId))
      : undefined;

  return targetQuestion?.id ?? topicQuestion?.id ?? null;
}

function getSurfaceTitle(surface: PublicSurface) {
  switch (surface) {
    case "learn":
      return "Learn";
    case "practise":
      return "Practise";
    case "progress":
      return "Progress";
    case "decks":
      return "Decks";
    case "cards":
      return "Cards";
    case "library":
      return "Library";
    case "goals":
      return "Goals";
    case "constellation":
      return "Stars";
    case "profile":
      return "Account";
    case "home":
    default:
      return "Home";
  }
}

function makeLocalAttemptId() {
  return `public-attempt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function makeLocalDraftId() {
  return `public-draft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function makeLocalQuestionId() {
  return `public-question-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function TopicChip({ topicId }: { topicId: string }) {
  return (
    <span className="rounded-full border border-white/[0.11] bg-white/[0.055] px-3 py-1.5 text-xs font-medium text-text-secondary">
      {topicName(topicId)}
    </span>
  );
}

function PublicPractiseFlowHeader() {
  return (
    <div className="rounded-[1.35rem] border border-white/[0.09] bg-white/[0.035] px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {["Choose question", "Attempt", "Mark", "Repair"].map((step, index) => (
          <div key={step} className="flex items-center gap-2">
            <span className="flex min-h-[2.2rem] items-center gap-2 rounded-full border border-warm-border bg-warm-glow px-3 text-xs font-semibold text-warm-accent">
              <span className="h-2 w-2 rounded-full bg-warm-accent" />
              {step}
            </span>
            {index < 3 ? <span className="hidden h-px w-5 bg-white/[0.14] sm:block" /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentTutorContextPreviewCard({
  preview,
  forceTutorFallback,
}: {
  preview: AgentTutorContextPreview;
  forceTutorFallback: boolean;
}) {
  return (
    <div
      className="rounded-[1.15rem] border border-amber-200/25 bg-amber-400/[0.08] p-3"
      data-agent-tutor-context-preview="true"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-100">
            Agent-only context preview
          </div>
          <p className="mt-1 text-xs leading-5 text-text-secondary">
            This appears only in agent mode so QA can see exactly what Tutor will receive.
          </p>
        </div>
        {forceTutorFallback ? (
          <span className="rounded-full border border-amber-100/30 bg-amber-100/10 px-3 py-1 text-xs font-semibold text-amber-100">
            Forced fallback on
          </span>
        ) : null}
      </div>
      <div className="mt-3 grid gap-2 text-xs leading-5 text-text-secondary">
        <div>
          <span className="font-semibold text-white">Intent:</span> {preview.intent}
        </div>
        <div>
          <span className="font-semibold text-white">Current question:</span> {preview.questionText}
        </div>
        <div>
          <span className="font-semibold text-white">Unsaved answer:</span>{" "}
          {preview.answer || "Not supplied"}
        </div>
        <div>
          <span className="font-semibold text-white">Unsaved working:</span>{" "}
          {preview.working || "Not supplied"}
        </div>
        <div>
          <span className="font-semibold text-white">Selected text:</span>{" "}
          {preview.selectedText || "None selected"}
        </div>
      </div>
    </div>
  );
}

export default function PublicDashboardShell() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const surface = getSurface(pathname);
  const agentMode = searchParams.get("agent") === "1";
  const forceTutorFallback = searchParams.get("forceTutorFallback") === "1";
  const [questions, setQuestions] = useState<WalkthroughQuestion[]>(WALKTHROUGH_QUESTIONS);
  const [selectedQuestionId, setSelectedQuestionId] = useState(WALKTHROUGH_QUESTIONS[0].id);
  const [attempts, setAttempts] = useState<WalkthroughAttempt[]>(WALKTHROUGH_ATTEMPTS);
  const [drafts, setDrafts] = useState<WalkthroughDraft[]>(WALKTHROUGH_INITIAL_DRAFTS);
  const [tutorMessages, setTutorMessages] = useState<WalkthroughTutorMessage[]>(
    WALKTHROUGH_INITIAL_TUTOR_MESSAGES
  );
  const [userAnswer, setUserAnswer] = useState("I think it is diagonalizable because the eigenvalue repeats three times.");
  const [workingText, setWorkingText] = useState("Characteristic polynomial has one eigenvalue, lambda = 2. I am unsure whether the repeated root gives three eigenvectors.");
  const [confidence, setConfidence] = useState<1 | 2 | 3 | 4 | 5>(2);
  const [selfMark, setSelfMark] = useState<boolean | null>(false);
  const [busyIntent, setBusyIntent] = useState<WalkthroughTutorIntent | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [confirmFullSolution, setConfirmFullSolution] = useState(false);
  const [sessionStartedAt] = useState(Date.now());
  const [sessionAttemptIds, setSessionAttemptIds] = useState<string[]>([]);
  const [sessionQuestionIds, setSessionQuestionIds] = useState<string[]>([]);
  const [sessionTutorUses, setSessionTutorUses] = useState(0);
  const [sessionDraftIds, setSessionDraftIds] = useState<string[]>([]);
  const [lastPractiseDraftId, setLastPractiseDraftId] = useState<string | null>(null);

  useEffect(() => {
    if (surface !== "practise") {
      return;
    }

    const preselectedQuestionId = getPreselectedWalkthroughQuestionId();
    if (preselectedQuestionId) {
      setSelectedQuestionId(preselectedQuestionId);
    }
  }, [pathname, surface]);

  const selectedQuestion = useMemo(
    () =>
      questions.find((question) => question.id === selectedQuestionId) ??
      questions[0] ??
      WALKTHROUGH_QUESTIONS[0],
    [questions, selectedQuestionId]
  );
  const dueCards = WALKTHROUGH_CARDS.filter((card) => card.due);
  const weakCards = WALKTHROUGH_CARDS.filter((card) => card.weak);
  const practiceAccuracy = getAccuracy(attempts);
  const supportLevel = getSupportLevel(attempts);
  const recentMistakes = attempts.filter((attempt) => !attempt.isCorrect).slice(0, 5);
  const topicSummaries = useMemo(
    () =>
      WALKTHROUGH_TOPICS.map((topic) => {
        const topicCards = WALKTHROUGH_CARDS.filter((card) => card.topicIds.includes(topic.id));
        const topicQuestions = questions.filter((question) =>
          question.topicIds.includes(topic.id)
        );
        const topicAttempts = attempts.filter((attempt) =>
          topicQuestions.some((question) => question.id === attempt.questionId)
        );
        return {
          topic,
          weakCards: topicCards.filter((card) => card.weak).length,
          dueCards: topicCards.filter((card) => card.due).length,
          accuracy: getAccuracy(topicAttempts),
          supportLevel: getSupportLevel(topicAttempts),
          mistakes: topicAttempts.flatMap((attempt) => attempt.mistakeLabels).slice(0, 3),
        };
      }).sort((left, right) => left.accuracy - right.accuracy || right.weakCards - left.weakCards),
    [attempts, questions]
  );

  const handleSaveAttempt = () => {
    if (selfMark === null) {
      setFeedback({ type: "error", message: "Choose correct or incorrect before saving." });
      return;
    }

    const nextAttempt: WalkthroughAttempt = {
      id: makeLocalAttemptId(),
      questionId: selectedQuestion.id,
      isCorrect: selfMark,
      confidence,
      hintsUsed: tutorMessages.filter((message) => message.role === "model").length,
      tutorUsed: tutorMessages.length > 0,
      mistakeLabels: selfMark ? [] : ["public walkthrough self-mark", "needs repair"],
      createdAt: Date.now(),
    };

    setAttempts((current) => [nextAttempt, ...current]);
    setSessionAttemptIds((current) => [nextAttempt.id, ...current]);
    setSessionQuestionIds((current) =>
      current.includes(selectedQuestion.id) ? current : [...current, selectedQuestion.id]
    );
    setFeedback({
      type: "success",
      message: "Local walkthrough attempt saved. Progress updates in this public session only.",
    });
  };

  const handleTutorIntent = async (
    intent: WalkthroughTutorIntent,
    prompt: string,
    options?: { selectedWorkingText?: string; scratchpadNote?: string; scratchpadStrokeCount?: number; voiceTranscript?: string }
  ) => {
    setBusyIntent(intent);
    setFeedback(null);
    setConfirmFullSolution(false);
    setSessionTutorUses((current) => current + 1);
    const displayedPrompt = options?.selectedWorkingText
      ? `${options.voiceTranscript ?? prompt}\n\nYou selected: "${options.selectedWorkingText}"`
      : options?.voiceTranscript ?? prompt;
    setTutorMessages((current) => [...current, { role: "user", text: displayedPrompt, intent }]);

    try {
      const selectedQuestionAttempts = getQuestionAttempts(selectedQuestion.id, attempts)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 5);
      const contextPacket = {
        question: {
          id: selectedQuestion.id,
          text: selectedQuestion.questionText,
          expectedAnswer: selectedQuestion.answerText,
          solutionNotes: selectedQuestion.solutionText,
          topicIds: selectedQuestion.topicIds,
          topicNames: selectedQuestion.topicIds.map(topicName),
          sourceIds: [],
          sourceTitles: [],
        },
        studentState: {
          typedAnswer: userAnswer,
          typedWorking: workingText,
          selectedWorkingText: options?.selectedWorkingText,
          scratchpad:
            options?.scratchpadNote || options?.scratchpadStrokeCount
              ? {
                  hasDrawing: Boolean(options?.scratchpadStrokeCount),
                  strokeCount: options?.scratchpadStrokeCount ?? 0,
                  note: options?.scratchpadNote,
                  imageAttached: false,
                }
              : undefined,
          confidence,
          mistakeLabels: selfMark === false ? ["public walkthrough self-mark", "needs repair"] : [],
        },
        attemptHistory: selectedQuestionAttempts.map((attempt) => ({
          correct: attempt.isCorrect,
          confidence: attempt.confidence,
          mistakeLabels: attempt.mistakeLabels,
          createdAt: attempt.createdAt,
        })),
        tutorHistory: tutorMessages.slice(-6),
        intent,
        privacy: {
          sendsUnsavedWorking: Boolean(
            userAnswer.trim() ||
              workingText.trim() ||
              options?.selectedWorkingText ||
              options?.scratchpadNote ||
              options?.scratchpadStrokeCount ||
              options?.voiceTranscript
          ),
          persistsUnsavedWorking: false,
        },
      };
      const response = await fetch("/api/demo/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent,
          message: displayedPrompt,
          forceFallback: forceTutorFallback,
          context: {
            questionId: selectedQuestion.id,
            userAnswer,
            workingText,
          },
          contextPacket,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            reply?: string;
            fallback?: boolean;
            suggestedFlashcard?: { front: string; back: string } | null;
            error?: string;
          }
        | null;

      const reply =
        payload?.reply ??
        payload?.error ??
        "Tutor could not answer just now, but the public walkthrough can continue.";
      setTutorMessages((current) => [...current, { role: "model", text: reply, intent }]);

      if (intent === "make-flashcard" && payload?.suggestedFlashcard) {
        const nextDraft: WalkthroughDraft = {
          id: makeLocalDraftId(),
          front: payload.suggestedFlashcard.front,
          back: payload.suggestedFlashcard.back,
          topicIds: selectedQuestion.topicIds,
          sourceQuestionId: selectedQuestion.id,
          contentStatus: "draft",
        };
        setDrafts((current) => [nextDraft, ...current]);
        setSessionDraftIds((current) => [nextDraft.id, ...current]);
        setLastPractiseDraftId(nextDraft.id);
        setFeedback({
          type: "success",
          message:
            "Flashcard draft created locally. Edit it, save it as a draft, or simulate adding it to a deck.",
        });
      } else if (intent === "similar-question") {
        const nextQuestion: WalkthroughQuestion = {
          id: makeLocalQuestionId(),
          questionText: reply.replace(/^similar question:\s*/i, "").trim().slice(0, 1_000),
          answerText:
            "Compare the relevant definitions or criteria, then justify the conclusion in one or two sentences.",
          solutionText:
            "Use the same topic method as the selected question. Identify the key data, compare it with the criterion, then state the conclusion.",
          topicIds: selectedQuestion.topicIds,
          difficulty: selectedQuestion.difficulty,
        };
        setQuestions((current) => [nextQuestion, ...current]);
        setSelectedQuestionId(nextQuestion.id);
        setSessionQuestionIds((current) =>
          current.includes(nextQuestion.id) ? current : [...current, nextQuestion.id]
        );
        setFeedback({
          type: "success",
          message: "Similar question added locally to the public question bank.",
        });
      } else if (payload?.fallback) {
        setFeedback({
          type: "success",
          message: "Tutor returned a safe fallback, so the walkthrough can keep moving.",
        });
      }
    } catch (error) {
      console.error(error);
      setTutorMessages((current) => [
        ...current,
        {
          role: "model",
          text: "Tutor is unavailable right now. Try naming the relevant topic, then attempt one next step before asking for another hint.",
        },
      ]);
      setFeedback({ type: "error", message: "Tutor call failed, but the walkthrough stayed local." });
    } finally {
      setBusyIntent(null);
    }
  };

  const updateDraft = (draftId: string, field: "front" | "back", value: string) => {
    setDrafts((current) =>
      current.map((draft) => (draft.id === draftId ? { ...draft, [field]: value } : draft))
    );
  };

  const saveLocalDraft = (draftId: string) => {
    const draft = drafts.find((item) => item.id === draftId);
    setFeedback({
      type: "success",
      message: draft
        ? "Draft saved locally. Review it in Progress -> Flashcard Drafts."
        : "Draft saved locally.",
    });
  };

  const addLocalDraftToDeck = (draftId: string, deckId: string) => {
    const deck = WALKTHROUGH_DECKS.find((item) => item.id === deckId);
    setDrafts((current) =>
      current.map((draft) =>
        draft.id === draftId ? { ...draft, contentStatus: "approved", addedDeckId: deckId } : draft
      )
    );
    setFeedback({
      type: "success",
      message: `Card added to ${deck?.name ?? "the selected deck"} in this local walkthrough. Nothing was written to Firebase.`,
    });
  };

  const rejectLocalDraft = (draftId: string) => {
    setDrafts((current) => current.filter((draft) => draft.id !== draftId));
    setSessionDraftIds((current) => current.filter((id) => id !== draftId));
    setLastPractiseDraftId((current) => (current === draftId ? null : current));
    setFeedback({ type: "success", message: "Draft rejected locally. Nothing was written to Firebase." });
  };

  const sessionAttempts = attempts.filter((attempt) => sessionAttemptIds.includes(attempt.id));
  const sessionWeakestTopic = (() => {
    const counts = new Map<string, number>();
    sessionAttempts
      .filter((attempt) => !attempt.isCorrect)
      .forEach((attempt) => {
        const question = questions.find((item) => item.id === attempt.questionId);
        question?.topicIds.forEach((topicId) => counts.set(topicId, (counts.get(topicId) ?? 0) + 1));
      });
    const topicId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return topicId ? topicName(topicId) : undefined;
  })();
  const sessionSummary = {
    startedAt: sessionStartedAt,
    attempts: sessionAttempts.length,
    correct: sessionAttempts.filter((attempt) => attempt.isCorrect).length,
    tutorUses: sessionTutorUses,
    draftsMade: sessionDraftIds.length,
    questionsTouched: sessionQuestionIds.length,
    weakestTopic: sessionWeakestTopic,
    nextAction: sessionAttempts.some((attempt) => !attempt.isCorrect)
      ? "Repair the latest mistake with Tutor, then retry one similar question."
      : sessionDraftIds.length > 0
        ? "Review the local flashcard draft, then simulate adding it to a deck."
        : "Attempt another question or check Progress.",
  };
  const lastPractiseDraft = drafts.find((draft) => draft.id === lastPractiseDraftId) ?? null;

  return (
    <>
      <div className="min-w-0 pb-32 md:pb-0 md:pl-[6.75rem] lg:pl-80">
        <AppPage
          title={getSurfaceTitle(surface)}
          width="3xl"
          contentClassName="space-y-4 sm:space-y-6"
          action={
            <Link
              href="/auth"
              className="inline-flex min-h-[2.45rem] items-center justify-center rounded-full border border-white/14 bg-white/[0.045] px-3 py-2 text-xs font-semibold text-text-secondary transition duration-fast hover:border-white/22 hover:bg-white/[0.08] hover:text-white sm:text-sm"
            >
              Sign in
            </Link>
          }
        >
          <PublicModeNotice />
          {agentMode ? <AgentModeNotice /> : null}
          {feedback ? (
            <FeedbackBanner
              type={feedback.type}
              message={feedback.message}
              onDismiss={() => setFeedback(null)}
            />
          ) : null}
          <PublicStats
            compact={surface !== "home"}
            dueCards={dueCards.length}
            weakCards={weakCards.length}
            practiceAccuracy={practiceAccuracy}
            supportLevel={supportLevel}
            attempts={attempts.length}
          />
          {surface === "home" ? <HomePanel attempts={attempts} drafts={drafts} /> : null}
          {surface === "learn" ? <LearnPanel /> : null}
          {surface === "practise" ? (
            <PractisePanel
              questions={questions}
              attempts={attempts}
              selectedQuestion={selectedQuestion}
              selectedQuestionId={selectedQuestionId}
              userAnswer={userAnswer}
              workingText={workingText}
              confidence={confidence}
              selfMark={selfMark}
              tutorMessages={tutorMessages}
              busyIntent={busyIntent}
              onSelectQuestion={setSelectedQuestionId}
              onUserAnswerChange={setUserAnswer}
              onWorkingTextChange={setWorkingText}
              onConfidenceChange={setConfidence}
              onSelfMarkChange={setSelfMark}
              onSaveAttempt={handleSaveAttempt}
              onTutorIntent={handleTutorIntent}
              drafts={drafts}
              latestDraft={lastPractiseDraft}
              sessionSummary={sessionSummary}
              agentMode={agentMode}
              forceTutorFallback={forceTutorFallback}
              onUpdateDraft={updateDraft}
              onSaveDraft={saveLocalDraft}
              onAddDraftToDeck={addLocalDraftToDeck}
              onRejectDraft={rejectLocalDraft}
              confirmFullSolution={confirmFullSolution}
              onConfirmFullSolutionChange={setConfirmFullSolution}
            />
          ) : null}
          {surface === "progress" ? (
            <ProgressPanel
              topicSummaries={topicSummaries}
              recentMistakes={recentMistakes}
              questions={questions}
              drafts={drafts}
              onSaveDraft={saveLocalDraft}
              onAddDraftToDeck={addLocalDraftToDeck}
            />
          ) : null}
          {surface === "decks" ? <DecksPanel /> : null}
          {surface === "cards" ? (
            <CardsPanel
              drafts={drafts}
              onUpdateDraft={updateDraft}
              onSaveDraft={saveLocalDraft}
              onAddDraftToDeck={addLocalDraftToDeck}
            />
          ) : null}
          {surface === "library" ? (
            <LibraryPanel
              drafts={drafts}
              onSaveDraft={saveLocalDraft}
              onAddDraftToDeck={addLocalDraftToDeck}
              onCreateDraft={(draft) => setDrafts((current) => [draft, ...current])}
            />
          ) : null}
          {surface === "goals" ? <GoalsPanel /> : null}
          {surface === "constellation" ? <ConstellationPanel /> : null}
          {surface === "profile" ? <ProfilePanel /> : null}
        </AppPage>
      </div>
      <TabBar />
    </>
  );
}

function PublicModeNotice() {
  return (
    <div className="rounded-[1.45rem] border border-warm-border bg-warm-glow px-4 py-3 text-sm leading-6 text-text-secondary">
      <span className="font-semibold text-warm-accent">Public walkthrough mode.</span>{" "}
      You are clicking the real dashboard routes with seeded local data. Actions update this session only; private Firebase data stays protected.
    </div>
  );
}

function AgentModeNotice() {
  const routes = [
    ["/dashboard?agent=1", "Today"],
    ["/dashboard/study?agent=1", "Learn"],
    ["/dashboard/practise?agent=1", "Practise"],
    ["/dashboard/progress?agent=1", "Progress"],
    ["/dashboard/library?agent=1", "Library"],
    ["/dashboard/cards?agent=1", "Cards"],
    ["/dashboard/decks?agent=1", "Decks"],
    ["/dashboard/goals?agent=1", "Goals"],
    ["/dashboard/constellation?agent=1", "Stars"],
    ["/dashboard/profile?agent=1", "Account"],
  ];

  return (
    <div
      data-agent-panel="dashboard-route-map"
      className="rounded-[1.45rem] border border-white/[0.10] bg-white/[0.045] p-4"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
            Agent test mode
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-text-secondary">
            Use these links to inspect every public walkthrough surface. Mutations are local-only
            unless you sign in with a real account.
          </p>
        </div>
        <Link
          href="/agent"
          className="inline-flex min-h-[2.45rem] items-center justify-center rounded-full border border-white/14 bg-white/[0.045] px-3 py-2 text-xs font-semibold text-text-secondary transition duration-fast hover:border-white/22 hover:bg-white/[0.08] hover:text-white"
        >
          Full guide
        </Link>
      </div>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {routes.map(([href, label]) => (
          <Link
            key={href}
            href={href}
            data-agent-route={href}
            className="shrink-0 rounded-full border border-white/[0.10] bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-text-secondary transition hover:border-warm-border hover:text-warm-accent"
          >
            {label}
          </Link>
        ))}
      </div>
    </div>
  );
}

function PublicStats({
  compact = false,
  dueCards,
  weakCards,
  practiceAccuracy,
  supportLevel,
  attempts,
}: {
  compact?: boolean;
  dueCards: number;
  weakCards: number;
  practiceAccuracy: number;
  supportLevel: string;
  attempts: number;
}) {
  const items = [
    { label: "Due cards", value: dueCards, detail: "Seeded FSRS-style review queue." },
    { label: "Weak cards", value: weakCards, detail: "Linked to topics for repair.", tone: "danger" as const },
    { label: "Practice accuracy", value: `${practiceAccuracy}%`, detail: `${attempts} local attempts.`, tone: "good" as const },
    { label: "Support level", value: supportLevel, detail: "Help usage, not a judgement.", tone: "warm" as const },
  ];

  return (
    <MetricStrip items={items} variant={compact ? "compact" : "full"} />
  );
}

function HomePanel({
  attempts,
  drafts,
}: {
  attempts: WalkthroughAttempt[];
  drafts: WalkthroughDraft[];
}) {
  const [showHowJamiWorks, setShowHowJamiWorks] = useState(false);
  const publicCards = WALKTHROUGH_CARDS.map((card) => ({
    id: card.id,
    deckId: card.deckId,
    userId: "public-walkthrough",
    front: card.front,
    back: card.back,
    tags: card.tags,
    topicIds: card.topicIds,
    createdAt: 1,
    dueDate: card.due ? 1 : undefined,
    difficulty: card.weak ? 8 : 3,
    reps: card.status === "learning" ? 0 : 2,
  }));
  const publicQuestions = WALKTHROUGH_QUESTIONS.map((question) => ({
    ...question,
    sourceType: "manual" as const,
    origin: "user-authored" as const,
    contentStatus: "approved" as const,
    createdAt: 1,
    updatedAt: 1,
  }));
  const publicAttempts = attempts.map((attempt) => ({
    ...attempt,
    userAnswer: "",
  }));
  const publicTopics = WALKTHROUGH_TOPICS.map((topic) => ({
    ...topic,
    slug: topic.name.toLowerCase().replace(/\s+/g, "-"),
    status: "active" as const,
    createdBy: "system" as const,
    createdAt: 1,
    updatedAt: 1,
  }));
  const plan = buildTodayPlan({
    decks: WALKTHROUGH_DECKS,
    cards: publicCards,
    dueCards: publicCards.filter((card) => typeof card.dueDate === "number"),
    topics: publicTopics,
    questions: publicQuestions,
    attempts: publicAttempts,
    masteryEvents: [],
    drafts: drafts.map((draft) => ({
      ...draft,
      kind: "flashcard",
      sourceId: draft.sourceQuestionId,
      sourceType: draft.sourceQuestionId?.startsWith("source-") ? "source" : "question",
    })),
    sources: WALKTHROUGH_SOURCES.map((source) => ({
      id: source.id,
      title: source.title,
      type: source.type,
      subject: source.subject,
      topicIds: source.topicIds,
      contentText: source.contentText,
      externalUrl: source.externalUrl,
      fileName: source.fileName,
      fileType: source.fileType,
      status: "active" as const,
      createdBy: "public-walkthrough",
      createdAt: 1,
      updatedAt: 1,
    })),
    reviewedToday: 2,
    progressVisited: true,
    now: 10,
  });

  return (
    <>
      <PageHero
        eyebrow="Public dashboard"
        title="Today answers what to do next."
        description="LLM browsers can now land directly on the main dashboard, follow the nav, inspect each feature, and try local-only interactions without needing an account."
        tone="warm"
        action={
          <Link
            href="/dashboard/practise"
            className="inline-flex min-h-[3.15rem] items-center justify-center rounded-2xl bg-accent px-5 py-3 text-sm font-medium text-white shadow-[var(--shadow-accent)] transition duration-fast ease-spring hover:-translate-y-[1px] hover:bg-accent-hover"
          >
            Try Practise
          </Link>
        }
        secondaryAction={
          <Link
            href="/dashboard/study"
            className="inline-flex min-h-[3.15rem] items-center justify-center rounded-2xl border border-border bg-white/[0.04] px-5 py-3 text-sm font-medium text-white transition duration-fast hover:border-border-strong hover:bg-white/[0.07]"
          >
            Open Learn
          </Link>
        }
      />
      <Card tone="warm" padding="lg">
        <SectionHeader
          eyebrow="Recommended next action"
          title={plan.nextAction.title}
          description={plan.nextAction.description}
        />
        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            href={plan.nextAction.href}
            className="inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl bg-accent px-4 py-2 text-sm font-medium text-white shadow-[var(--shadow-accent)] transition duration-fast hover:bg-accent-hover"
          >
            {plan.nextAction.label}
          </Link>
          {plan.nextAction.secondaryHref && plan.nextAction.secondaryLabel ? (
            <Link
              href={plan.nextAction.secondaryHref}
              className="inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl border border-border bg-white/[0.04] px-4 py-2 text-sm font-medium text-white transition duration-fast hover:border-border-strong hover:bg-white/[0.07]"
            >
              {plan.nextAction.secondaryLabel}
            </Link>
          ) : null}
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card padding="md">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">Today&apos;s review</div>
          <div className="mt-2 text-xl font-semibold text-white">{plan.dueCards.count} due cards</div>
          <p className="mt-2 text-sm leading-6 text-text-secondary">
            {plan.dueCards.primaryDeckName ?? "Seeded review queue"} is ready for review.
          </p>
        </Card>
        <Card padding="md">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">Repair queue</div>
          <div className="mt-2 text-xl font-semibold text-white">{plan.recentMistakes.length} mistakes</div>
          <p className="mt-2 text-sm leading-6 text-text-secondary">
            Retry, ask Tutor, or turn a useful mistake into a card.
          </p>
        </Card>
        <Card padding="md">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">Drafts</div>
          <div className="mt-2 text-xl font-semibold text-white">{plan.drafts.length} waiting</div>
          <p className="mt-2 text-sm leading-6 text-text-secondary">
            Public drafts stay local until the walkthrough simulates adding them.
          </p>
        </Card>
      </div>
      <Card padding="lg">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SectionHeader
            eyebrow="How Jami works"
            title="Learn, practise, repair, save, and track."
            description="A first-time student should be able to follow the whole learning loop from this public dashboard."
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => setShowHowJamiWorks((value) => !value)}
            aria-expanded={showHowJamiWorks}
          >
            {showHowJamiWorks ? "Hide" : "Show"}
          </Button>
        </div>
        {showHowJamiWorks ? (
          <div className="mt-6 space-y-3">
            {[
              ["1. Learn", "Review flashcards.", "/dashboard/study"],
              ["2. Practise", "Try questions.", "/dashboard/practise"],
              ["3. Tutor", "Get help when stuck.", "/dashboard/practise"],
              ["4. Save", "Turn mistakes into card drafts.", "/dashboard/cards"],
              ["5. Progress", "See weak topics.", "/dashboard/progress"],
            ].map(([title, text, href]) => (
              <Link
                key={title}
                href={href}
                className={`${interactiveCardClass} flex items-center justify-between gap-4`}
              >
                <span className="min-w-0">
                  <span className="block text-base font-semibold text-white">{title}</span>
                  <span className="mt-1 block text-sm leading-6 text-text-secondary">{text}</span>
                </span>
              </Link>
            ))}
          </div>
        ) : null}
      </Card>
    </>
  );
}

function LearnPanel() {
  const [flippedCardId, setFlippedCardId] = useState<string | null>(null);

  return (
    <div className="grid gap-4 xl:grid-cols-[0.75fr_1.25fr]">
      <Card padding="lg">
        <SectionHeader
          eyebrow="Learn"
          title="Decks stay familiar, topics add meaning."
          description="Tags organise content. Topics measure learning."
        />
        <div className="mt-5 space-y-3">
          {WALKTHROUGH_DECKS.map((deck) => (
            <div
              key={deck.id}
              className={surfaceCardClass}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-white">{deck.name}</div>
                  <div className="mt-1 text-sm text-text-muted">{deck.subject}</div>
                </div>
                <div className="rounded-full border border-warm-border bg-warm-glow px-3 py-1 text-xs font-semibold text-warm-accent">
                  {deck.weakCount} weak
                </div>
              </div>
              <div className="mt-3 text-sm text-text-secondary">{deck.cardCount} seeded cards</div>
            </div>
          ))}
        </div>
      </Card>

      <Card tone="warm" padding="lg">
        <SectionHeader
          title="Review queue"
          description="Click any card to flip it. This mirrors the study surface without writing review history."
        />
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {WALKTHROUGH_CARDS.map((card) => {
            const flipped = flippedCardId === card.id;
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => setFlippedCardId(flipped ? null : card.id)}
                className={interactiveCardClass}
              >
                <div className="flex flex-wrap gap-2">
                  {card.due ? <span className="rounded-full bg-warm-glow px-2.5 py-1 text-xs text-warm-accent">Due</span> : null}
                  {card.weak ? <span className="rounded-full bg-error-muted px-2.5 py-1 text-xs text-rose-100">Weak</span> : null}
                  <span className={chipClass}>
                    {deckName(card.deckId)}
                  </span>
                </div>
                <div className="mt-4 text-sm font-semibold text-white">
                  {flipped ? card.back : card.front}
                </div>
                <p className="mt-2 text-xs text-text-muted">
                  {flipped ? "Back of card" : "Front of card"} - click to flip.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {card.topicIds.map((topicId) => (
                    <TopicChip key={topicId} topicId={topicId} />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function PractisePanel({
  questions,
  attempts,
  selectedQuestion,
  selectedQuestionId,
  userAnswer,
  workingText,
  confidence,
  selfMark,
  tutorMessages,
  busyIntent,
  onSelectQuestion,
  onUserAnswerChange,
  onWorkingTextChange,
  onConfidenceChange,
  onSelfMarkChange,
  onSaveAttempt,
  onTutorIntent,
  latestDraft,
  sessionSummary,
  agentMode,
  forceTutorFallback,
  onUpdateDraft,
  onSaveDraft,
  onAddDraftToDeck,
  onRejectDraft,
  confirmFullSolution,
  onConfirmFullSolutionChange,
}: {
  questions: WalkthroughQuestion[];
  attempts: WalkthroughAttempt[];
  selectedQuestion: WalkthroughQuestion;
  selectedQuestionId: string;
  userAnswer: string;
  workingText: string;
  confidence: 1 | 2 | 3 | 4 | 5;
  selfMark: boolean | null;
  tutorMessages: WalkthroughTutorMessage[];
  busyIntent: WalkthroughTutorIntent | null;
  onSelectQuestion: (questionId: string) => void;
  onUserAnswerChange: (value: string) => void;
  onWorkingTextChange: (value: string) => void;
  onConfidenceChange: (value: 1 | 2 | 3 | 4 | 5) => void;
  onSelfMarkChange: (value: boolean) => void;
  onSaveAttempt: () => void;
  onTutorIntent: (
    intent: WalkthroughTutorIntent,
    prompt: string,
    options?: { selectedWorkingText?: string; scratchpadNote?: string; scratchpadStrokeCount?: number; voiceTranscript?: string }
  ) => void;
  drafts: WalkthroughDraft[];
  latestDraft: WalkthroughDraft | null;
  sessionSummary: {
    startedAt: number;
    attempts: number;
    correct: number;
    tutorUses: number;
    draftsMade: number;
    questionsTouched: number;
    weakestTopic?: string;
    nextAction: string;
  };
  agentMode: boolean;
  forceTutorFallback: boolean;
  onUpdateDraft: (draftId: string, field: "front" | "back", value: string) => void;
  onSaveDraft: (draftId: string) => void;
  onAddDraftToDeck: (draftId: string, deckId: string) => void;
  onRejectDraft: (draftId: string) => void;
  confirmFullSolution: boolean;
  onConfirmFullSolutionChange: (value: boolean) => void;
}) {
  const [showTutor, setShowTutor] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showWorkingTools, setShowWorkingTools] = useState(false);
  const [selectedWorkingText, setSelectedWorkingText] = useState("");
  const [selectedTextNotice, setSelectedTextNotice] = useState("");
  const [previewIntent, setPreviewIntent] = useState<WalkthroughTutorIntent | "none">("none");
  const [scratchpadStrokes, setScratchpadStrokes] = useState<ScratchpadStroke[]>([]);
  const [scratchpadNote, setScratchpadNote] = useState("");
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceNotice, setVoiceNotice] = useState("");
  const [sessionNow, setSessionNow] = useState(() => Date.now());
  const workingTextareaRef = useRef<HTMLTextAreaElement>(null);
  const scratchpadCanvasRef = useRef<HTMLCanvasElement>(null);
  const scratchpadDraftStrokeRef = useRef<ScratchpadPoint[] | null>(null);
  const selectedQuestionAttempts = getQuestionAttempts(selectedQuestion.id, attempts);
  const tutorOpen =
    showTutor || tutorMessages.length > 0 || busyIntent !== null || confirmFullSolution;
  const hasSessionActivity =
    sessionSummary.attempts > 0 || sessionSummary.tutorUses > 0 || sessionSummary.draftsMade > 0;
  const agentContextPreview: AgentTutorContextPreview = {
    questionText: selectedQuestion.questionText,
    answer: userAnswer,
    working: workingText,
    selectedText: selectedWorkingText || undefined,
    intent: previewIntent,
  };
  const sendTutorIntent = (
    intent: WalkthroughTutorIntent,
    prompt: string,
    options?: { selectedWorkingText?: string; scratchpadNote?: string; scratchpadStrokeCount?: number; voiceTranscript?: string }
  ) => {
    setPreviewIntent(intent);
    if (options?.selectedWorkingText) {
      setSelectedTextNotice(`Tutor will focus on selected text: "${options.selectedWorkingText}"`);
    }
    onTutorIntent(intent, prompt, options);
  };
  const askAboutSelectedText = (
    options?: { scratchpadNote?: string; scratchpadStrokeCount?: number; voiceTranscript?: string }
  ) => {
    const selected = selectedWorkingText.trim();
    if (!selected) {
      setSelectedTextNotice("Highlight text in the Working box first, then ask about selected text.");
      return;
    }
    sendTutorIntent(
      "stuck-here",
      `Ask about the selected working text: "${selected}". Explain the next step only.`,
      { ...options, selectedWorkingText: selected }
    );
  };
  const updateSelectedWorkingText = () => {
    const textarea = workingTextareaRef.current;
    if (!textarea) return;
    const selected = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd).trim();
    setSelectedWorkingText(selected);
    if (selected) {
      setSelectedTextNotice(`Selected text ready for Tutor: "${selected}"`);
    }
  };
  const redrawScratchpad = useCallback(() => {
    const canvas = scratchpadCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 3;
    context.strokeStyle = "rgba(255, 232, 247, 0.92)";
    scratchpadStrokes.forEach((stroke) => {
      if (stroke.points.length === 0) return;
      context.beginPath();
      context.moveTo(stroke.points[0].x, stroke.points[0].y);
      stroke.points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
      context.stroke();
    });
  }, [scratchpadStrokes]);

  useEffect(() => {
    redrawScratchpad();
  }, [redrawScratchpad]);

  useEffect(() => {
    if (!hasSessionActivity) return;
    const timer = window.setInterval(() => setSessionNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [hasSessionActivity]);

  const getScratchpadPoint = (event: ReactPointerEvent<HTMLCanvasElement>): ScratchpadPoint | null => {
    const canvas = scratchpadCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const drawScratchpadSegment = (from: ScratchpadPoint, to: ScratchpadPoint) => {
    const canvas = scratchpadCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 3;
    context.strokeStyle = "rgba(255, 232, 247, 0.92)";
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  };

  const handleScratchpadPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = getScratchpadPoint(event);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    scratchpadDraftStrokeRef.current = [point];
  };

  const handleScratchpadPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const draftStroke = scratchpadDraftStrokeRef.current;
    const point = getScratchpadPoint(event);
    if (!draftStroke || !point) return;
    event.preventDefault();
    const previousPoint = draftStroke[draftStroke.length - 1];
    draftStroke.push(point);
    drawScratchpadSegment(previousPoint, point);
  };

  const handleScratchpadPointerEnd = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const draftStroke = scratchpadDraftStrokeRef.current;
    if (!draftStroke) return;
    event.preventDefault();
    scratchpadDraftStrokeRef.current = null;
    if (draftStroke.length > 1) {
      setScratchpadStrokes((current) => [...current, { points: [...draftStroke] }]);
    }
  };

  return (
    <div className="space-y-4">
    <PublicPractiseFlowHeader />
    {hasSessionActivity ? (
      <Card padding="md" className="border-warm-border bg-warm-glow">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
              Practice session summary
            </div>
            <div className="mt-1 text-lg font-semibold text-white">
              {sessionSummary.attempts} attempted / {sessionSummary.correct} correct / {sessionSummary.tutorUses} Tutor use{sessionSummary.tutorUses === 1 ? "" : "s"} / {sessionSummary.draftsMade} draft{sessionSummary.draftsMade === 1 ? "" : "s"}
            </div>
            <p className="mt-1 text-sm leading-6 text-text-secondary">
              Session evidence is local-only in this public walkthrough.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-white/[0.12] bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-text-secondary">
              Started {formatElapsed(Math.max(0, Math.round((sessionNow - sessionSummary.startedAt) / 1000)))} ago
            </span>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <MiniMetric label="Attempts" value={sessionSummary.attempts} />
          <MiniMetric label="Correct" value={sessionSummary.correct} />
          <MiniMetric label="Tutor uses" value={sessionSummary.tutorUses} />
          <MiniMetric label="Drafts made" value={sessionSummary.draftsMade} />
          <MiniMetric label="Weakest topic" value={sessionSummary.weakestTopic ?? "None yet"} />
          <div className="rounded-[1rem] border border-white/[0.1] bg-white/[0.05] p-3 md:col-span-3 xl:col-span-1">
            <div className="text-xs text-text-muted">Next action</div>
            <div className="mt-1 text-sm font-semibold text-white">{sessionSummary.nextAction}</div>
          </div>
        </div>
      </Card>
    ) : null}
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(240px,0.72fr)_minmax(0,1.25fr)_minmax(260px,0.78fr)]">
      <Card padding="lg" className="xl:sticky xl:top-4 xl:self-start">
        <SectionHeader
          eyebrow="Practise"
          title="Question bank"
          description="Choose one seeded question, attempt it, then repair what happened."
        />
        <div className="mt-5 space-y-3">
          {questions.map((question) => {
            const active = question.id === selectedQuestionId;
            const questionAttempts = getQuestionAttempts(question.id, attempts);
            return (
              <button
                key={question.id}
                type="button"
                onClick={() => onSelectQuestion(question.id)}
                className={`w-full min-w-0 rounded-[1.2rem] border p-4 text-left shadow-[0_10px_22px_rgba(4,8,18,0.12)] transition duration-fast ${
                  active
                    ? selectedCardClass
                    : "border-white/[0.09] bg-white/[0.04] text-text-secondary hover:border-white/[0.16] hover:bg-white/[0.065]"
                }`}
              >
                <div className="line-clamp-3 text-sm font-semibold leading-6 text-white">{question.questionText}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {question.topicIds.map((topicId) => (
                    <TopicChip key={topicId} topicId={topicId} />
                  ))}
                </div>
                <div className="mt-3 text-xs text-text-muted">
                  {questionAttempts.length} attempt{questionAttempts.length === 1 ? "" : "s"} - {getAccuracy(questionAttempts)}% correct
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      <div className="min-w-0 space-y-4">
        <Card tone="warm" padding="lg">
          <SectionHeader
            title="Active question"
            description="The selected question stays at the centre. Saving updates this public session only."
          />
          <div className={`${surfaceCardClass} mt-5`}>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
              Question
            </div>
            <div className="mt-3 whitespace-pre-wrap text-lg font-semibold leading-snug text-white">
              {selectedQuestion.questionText}
            </div>
          </div>
          <div className="mt-5 space-y-3">
            <Textarea
              label="Your answer"
              value={userAnswer}
              onChange={(event) => onUserAnswerChange(event.target.value)}
              rows={4}
            />
            <Textarea
              label="Working"
              ref={workingTextareaRef}
              value={workingText}
              onChange={(event) => {
                onWorkingTextChange(event.target.value);
                setSelectedWorkingText("");
                setSelectedTextNotice("");
              }}
              onSelect={updateSelectedWorkingText}
              onKeyUp={updateSelectedWorkingText}
              onMouseUp={updateSelectedWorkingText}
              rows={5}
            />
            <div className="rounded-[1.2rem] border border-warm-border bg-warm-glow p-3">
              <div className="text-sm font-semibold text-white">
                Tutor uses this public question and working when you ask.
              </div>
              <p className="mt-1 text-xs leading-5 text-text-secondary">
                Walkthrough actions are local-only. Context is sent only after a Tutor click.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busyIntent !== null}
                  onClick={() =>
                    sendTutorIntent(
                      "stuck-here",
                      "I'm stuck here. Use my current working and give me the next useful step only."
                    )
                  }
                >
                  I&apos;m stuck here
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busyIntent !== null || !workingText.trim()}
                  onClick={() =>
                    sendTutorIntent(
                      "check-working",
                      "Ask about my working. Check the steps I have written and point me to the first thing to fix."
                    )
                  }
                >
                  Ask about my working
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busyIntent !== null}
                  title={selectedWorkingText ? selectedWorkingText : "Highlight text in Working first"}
                  onClick={() => askAboutSelectedText()}
                >
                  Ask about selected text
                </Button>
              </div>
              {selectedTextNotice ? (
                <p className="mt-3 rounded-[1rem] border border-white/[0.1] bg-white/[0.05] px-3 py-2 text-xs leading-5 text-text-secondary">
                  {selectedTextNotice}
                </p>
              ) : null}
            </div>
            {agentMode ? (
              <AgentTutorContextPreviewCard
                preview={agentContextPreview}
                forceTutorFallback={forceTutorFallback}
              />
            ) : null}
            <div className="rounded-[1.2rem] border border-white/[0.09] bg-white/[0.035] p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-semibold text-white">Working tools</div>
                  <p className="mt-1 text-xs leading-5 text-text-secondary">
                    Scratchpad and voice transcript are local-only testing tools in this public walkthrough.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setShowWorkingTools((value) => !value)}
                  aria-expanded={showWorkingTools}
                >
                  {showWorkingTools ? "Hide tools" : "Open tools"}
                </Button>
              </div>
              {showWorkingTools ? (
                <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.8fr)]">
                  <div className="rounded-[1.1rem] border border-white/[0.09] bg-white/[0.035] p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-white">Scratchpad</div>
                        <p className="mt-1 text-xs leading-5 text-text-secondary">
                          Draw locally. Tutor receives only your typed note and stroke count, not OCR.
                        </p>
                      </div>
                      <span className={chipClass}>
                        {scratchpadStrokes.length} stroke{scratchpadStrokes.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <canvas
                      ref={scratchpadCanvasRef}
                      width={900}
                      height={260}
                      className="mt-3 h-52 w-full touch-none rounded-[1rem] border border-white/[0.10] bg-[#0d1019]"
                      onPointerDown={handleScratchpadPointerDown}
                      onPointerMove={handleScratchpadPointerMove}
                      onPointerUp={handleScratchpadPointerEnd}
                      onPointerCancel={handleScratchpadPointerEnd}
                      aria-label="Local practice scratchpad"
                    />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={scratchpadStrokes.length === 0}
                        onClick={() => setScratchpadStrokes((current) => current.slice(0, -1))}
                      >
                        Undo
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={scratchpadStrokes.length === 0 && !scratchpadNote.trim()}
                        onClick={() => {
                          setScratchpadStrokes([]);
                          setScratchpadNote("");
                        }}
                      >
                        Clear
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={busyIntent !== null || (scratchpadStrokes.length === 0 && !scratchpadNote.trim())}
                        onClick={() =>
                          sendTutorIntent(
                            "stuck-here",
                            "Ask about my scratchpad and current working. Use the typed scratchpad note if the drawing itself is not available.",
                            { scratchpadNote, scratchpadStrokeCount: scratchpadStrokes.length }
                          )
                        }
                      >
                        Ask about scratchpad
                      </Button>
                    </div>
                  </div>

                  <div className="rounded-[1.1rem] border border-white/[0.09] bg-white/[0.035] p-3">
                    <div className="text-sm font-semibold text-white">Voice transcript fallback</div>
                    <p className="mt-1 text-xs leading-5 text-text-secondary">
                      Browser agents often cannot use a microphone, so type the transcript here.
                    </p>
                    <Textarea
                      label="Scratchpad note / voice transcript"
                      rows={4}
                      value={voiceTranscript || scratchpadNote}
                      onChange={(event) => {
                        setScratchpadNote(event.target.value);
                        setVoiceTranscript("");
                      }}
                      placeholder="I'm stuck on the line where..."
                      containerClassName="mt-3"
                    />
                    {voiceNotice ? (
                      <p className="mt-2 text-xs leading-5 text-text-muted">{voiceNotice}</p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          setVoiceNotice("Microphone capture is not enabled in the public walkthrough. Type the transcript and send it instead.");
                        }}
                      >
                        Record voice
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={busyIntent !== null || !(voiceTranscript.trim() || scratchpadNote.trim())}
                        onClick={() => {
                          const transcript = (voiceTranscript || scratchpadNote).trim();
                          if (!transcript) return;
                          sendTutorIntent("stuck-here", transcript, {
                            selectedWorkingText: selectedWorkingText || undefined,
                            scratchpadNote,
                            scratchpadStrokeCount: scratchpadStrokes.length,
                            voiceTranscript: transcript,
                          });
                        }}
                      >
                        Send to Tutor
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="rounded-[1.25rem] border border-white/[0.09] bg-white/[0.04] p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-white">How did your attempt go?</div>
                  <div className="mt-0.5 text-xs text-text-muted">
                    Confidence: 1 = guessed, 5 = fully confident.
                  </div>
                </div>
                <span className={chipClass}>Local-only</span>
              </div>
              <div className="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">Self-mark</div>
                  <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant={selfMark === true ? "warm" : "secondary"}
                    onClick={() => onSelfMarkChange(true)}
                  >
                    Correct
                  </Button>
                  <Button
                    type="button"
                    variant={selfMark === false ? "danger" : "secondary"}
                    onClick={() => onSelfMarkChange(false)}
                  >
                    Incorrect
                  </Button>
                </div>
              </div>
              <ConfidencePicker value={confidence} onChange={onConfidenceChange} />
            </div>
            {selfMark === false ? (
              <div className="mt-3 rounded-[1rem] border border-rose-300/20 bg-rose-500/[0.07] p-3 text-xs leading-5 text-rose-100">
                Add a short mistake label in the private app so Jami knows what to repair.
                Example: sign error, forgot formula, misunderstood question.
              </div>
            ) : null}
            </div>
            <Button type="button" size="lg" onClick={onSaveAttempt}>
              Save local attempt
            </Button>
            <div className="flex flex-wrap items-center gap-2 rounded-[1.1rem] border border-white/[0.08] bg-white/[0.03] px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
                Next
              </span>
              <Button type="button" variant="secondary" onClick={() => setShowTutor(true)}>
                Ask Tutor
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowHistory(true)}>
                View history
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
        <TutorPanel
          selectedQuestion={selectedQuestion}
          userAnswer={userAnswer}
          workingText={workingText}
          messages={tutorMessages}
          busyIntent={busyIntent}
          onTutorIntent={sendTutorIntent}
          confirmFullSolution={confirmFullSolution}
          onConfirmFullSolutionChange={onConfirmFullSolutionChange}
          open={tutorOpen}
          onOpenChange={setShowTutor}
        />
        {latestDraft ? (
          <PractiseDraftPanel
            draft={latestDraft}
            onUpdateDraft={onUpdateDraft}
            onSaveDraft={onSaveDraft}
            onAddDraftToDeck={onAddDraftToDeck}
            onRejectDraft={onRejectDraft}
          />
        ) : null}
        <Card padding="lg">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between xl:flex-col">
            <SectionHeader
              title="Attempt history"
              description={`${selectedQuestionAttempts.length} attempt${selectedQuestionAttempts.length === 1 ? "" : "s"} on this public question.`}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowHistory((value) => !value)}
              aria-expanded={showHistory}
            >
              {showHistory ? "Hide history" : "Expand"}
            </Button>
          </div>
          {!showHistory ? (
            <p className="mt-4 rounded-[1.15rem] border border-white/[0.09] bg-white/[0.035] p-4 text-sm leading-6 text-text-secondary">
              History stays tucked away so the current attempt stays in focus.
            </p>
          ) : (
            <div className="mt-4 space-y-2">
              {selectedQuestionAttempts.map((attempt) => (
                <div key={attempt.id} className={surfaceCardClass}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={attempt.isCorrect ? "text-emerald-100" : "text-rose-100"}>
                      {attempt.isCorrect ? "Correct" : "Incorrect"}
                    </span>
                    <span className="text-xs text-text-muted">Confidence {attempt.confidence}</span>
                  </div>
                  {attempt.mistakeLabels.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {attempt.mistakeLabels.map((label) => (
                        <span
                          key={label}
                          className="rounded-full border border-white/[0.10] bg-white/[0.05] px-2.5 py-1 text-[0.68rem] text-text-secondary"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
    </div>
  );
}

function ConfidencePicker({
  value,
  onChange,
}: {
  value: 1 | 2 | 3 | 4 | 5;
  onChange: (value: 1 | 2 | 3 | 4 | 5) => void;
}) {
  return (
    <div>
      <div className="mb-2 text-sm font-medium text-text-secondary">Confidence</div>
      <div className="grid grid-cols-5 gap-1.5">
        {[1, 2, 3, 4, 5].map((nextValue) => (
          <button
            key={nextValue}
            type="button"
            onClick={() => onChange(nextValue as 1 | 2 | 3 | 4 | 5)}
            className={`min-h-[2.75rem] rounded-[1rem] border text-sm font-semibold transition ${
              value === nextValue
                ? "border-warm-border bg-warm-glow text-warm-accent"
                : "border-white/[0.1] bg-white/[0.045] text-text-secondary"
            }`}
          >
            {nextValue}
          </button>
        ))}
      </div>
    </div>
  );
}

function PractiseDraftPanel({
  draft,
  onUpdateDraft,
  onSaveDraft,
  onAddDraftToDeck,
  onRejectDraft,
}: {
  draft: WalkthroughDraft;
  onUpdateDraft: (draftId: string, field: "front" | "back", value: string) => void;
  onSaveDraft: (draftId: string) => void;
  onAddDraftToDeck: (draftId: string, deckId: string) => void;
  onRejectDraft: (draftId: string) => void;
}) {
  return (
    <Card tone="warm" padding="lg" data-agent-flashcard-draft="practise">
      <SectionHeader
        eyebrow="Tutor -> flashcard"
        title="Flashcard draft"
        description="Status: Draft / local-only in public walkthrough. It is not a real card until you add it to a deck."
      />
      <div className="mt-5">
        <DraftReviewCard
          draft={draft}
          onUpdateDraft={onUpdateDraft}
          onSaveDraft={onSaveDraft}
          onAddDraftToDeck={onAddDraftToDeck}
          onRejectDraft={onRejectDraft}
        />
      </div>
    </Card>
  );
}

function TutorPanel({
  selectedQuestion,
  userAnswer,
  workingText,
  messages,
  busyIntent,
  onTutorIntent,
  confirmFullSolution,
  onConfirmFullSolutionChange,
  open,
  onOpenChange,
}: {
  selectedQuestion: WalkthroughQuestion;
  userAnswer: string;
  workingText: string;
  messages: WalkthroughTutorMessage[];
  busyIntent: WalkthroughTutorIntent | null;
  onTutorIntent: (
    intent: WalkthroughTutorIntent,
    prompt: string,
    options?: {
      selectedWorkingText?: string;
      scratchpadNote?: string;
      scratchpadStrokeCount?: number;
      voiceTranscript?: string;
    }
  ) => void;
  confirmFullSolution: boolean;
  onConfirmFullSolutionChange: (value: boolean) => void;
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  const [showModeGuide, setShowModeGuide] = useState(false);

  return (
    <Card padding="lg">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between 2xl:flex-col">
        <SectionHeader
          eyebrow="Contextual tutor"
          title="Hint-first help beside the question."
          description="This public tutor can make limited real AI calls, but writes nothing to user data."
        />
        <Button
          type="button"
          variant={open ? "secondary" : "warm"}
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
        >
          {open ? "Hide Tutor" : "Ask Tutor"}
        </Button>
      </div>
      {!open ? (
        <p className="mt-4 rounded-[1.15rem] border border-white/[0.09] bg-white/[0.035] p-4 text-sm leading-6 text-text-secondary">
          Tutor is tucked away until the student asks for help.
        </p>
      ) : (
      <>
      <div className="mt-5 flex gap-2 overflow-x-auto rounded-[1.25rem] border border-white/[0.09] bg-white/[0.035] p-2">
        {TUTOR_ACTIONS.map((action) => (
          <Button
            key={action.intent}
            type="button"
            variant={action.variant ?? "secondary"}
            disabled={busyIntent !== null}
            title={action.description}
            className="min-h-[2.55rem] shrink-0 rounded-full px-3 text-xs"
            onClick={() => {
              if (action.intent === "full-solution" && !confirmFullSolution) {
                onConfirmFullSolutionChange(true);
                return;
              }
              onTutorIntent(action.intent, action.prompt);
            }}
          >
            {busyIntent === action.intent ? "Thinking..." : action.label}
          </Button>
        ))}
      </div>
      {confirmFullSolution ? (
        <div className="mt-3 rounded-[1.25rem] border border-rose-300/25 bg-rose-500/[0.08] p-4">
          <div className="text-sm font-semibold text-rose-100">Show full solution?</div>
          <p className="mt-1 text-sm leading-6 text-text-secondary">
            Full solution gives the answer and may count as lower independent evidence. Try one
            more step first if you can.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="danger"
              onClick={() =>
                onTutorIntent(
                  "full-solution",
                  TUTOR_ACTIONS.find((action) => action.intent === "full-solution")?.prompt ??
                    "Show the full solution."
                )
              }
            >
              Show full solution
            </Button>
            <Button type="button" variant="secondary" onClick={() => onConfirmFullSolutionChange(false)}>
              Keep trying
            </Button>
          </div>
        </div>
      ) : null}
      <div className="mt-4 flex flex-col gap-2 rounded-[1rem] border border-white/[0.08] bg-white/[0.035] p-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-text-secondary">
          Use the quick actions first. Open the mode guide if you need the full button meanings.
        </p>
        <Button
          type="button"
          variant="secondary"
          className="min-h-[2.35rem] rounded-full px-3 text-xs"
          onClick={() => setShowModeGuide((value) => !value)}
          aria-expanded={showModeGuide}
        >
          {showModeGuide ? "Hide mode guide" : "Mode guide"}
        </Button>
      </div>
      {showModeGuide ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {TUTOR_ACTIONS.map((action) => (
            <div
              key={`${action.intent}-description`}
              className="rounded-[1rem] border border-white/[0.08] bg-white/[0.035] px-3 py-2"
            >
              <div className="text-xs font-semibold text-white">{action.label}</div>
              <div className="mt-0.5 text-xs leading-5 text-text-muted">{action.description}</div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-5 space-y-3">
        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={`rounded-[1.15rem] border p-4 ${
              message.role === "model"
                ? "border-warm-border bg-warm-glow text-white"
                : "border-white/[0.09] bg-white/[0.055] text-text-secondary"
            }`}
          >
            <div className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-text-muted">
              {message.role === "model" ? "Jami Tutor" : "You"}
            </div>
            <div className="whitespace-pre-wrap text-sm leading-6">{message.text}</div>
          </div>
        ))}
      </div>
      <div className={`${surfaceCardClass} mt-5`}>
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
          Current context
        </div>
        <p className="mt-3 text-sm leading-6 text-text-secondary">
          Question: {selectedQuestion.questionText}
        </p>
        <p className="mt-2 text-sm leading-6 text-text-secondary">
          Answer: {userAnswer || "Not supplied"}
        </p>
        <p className="mt-2 text-sm leading-6 text-text-secondary">
          Working: {workingText || "Not supplied"}
        </p>
      </div>
      </>
      )}
    </Card>
  );
}

function ProgressPanel({
  topicSummaries,
  recentMistakes,
  questions,
  drafts,
  onSaveDraft,
  onAddDraftToDeck,
}: {
  topicSummaries: Array<{
    topic: { id: string; name: string; subject: string };
    weakCards: number;
    dueCards: number;
    accuracy: number;
    supportLevel: string;
    mistakes: string[];
  }>;
  recentMistakes: WalkthroughAttempt[];
  questions: WalkthroughQuestion[];
  drafts: WalkthroughDraft[];
  onSaveDraft: (draftId: string) => void;
  onAddDraftToDeck: (draftId: string, deckId: string) => void;
}) {
  const questionsById = new Map(questions.map((question) => [question.id, question]));
  const recommendedTopic = topicSummaries[0];

  return (
    <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
      <Card padding="lg">
        <SectionHeader
          eyebrow="Progress"
          title="Constructive mastery evidence."
          description="Weak topics, weak cards, practice accuracy, recent mistakes, drafts, and support level."
        />
        <div className={`${surfaceCardClass} mt-5 border-warm-border bg-warm-glow`}>
          <div className="text-sm font-semibold text-white">Recommended next step</div>
          <p className="mt-2 text-sm leading-6 text-text-secondary">
            {recommendedTopic
              ? `Review linked cards, then retry 1 practice question on ${recommendedTopic.topic.name}.`
              : "Review due cards, then attempt one topical question."}
          </p>
          <p className="mt-2 text-xs leading-5 text-text-muted">
            Support level shows how much Tutor help you used recently. It is not a judgement; it helps
            Jami choose the right next task.
          </p>
        </div>
        <div className="mt-5 space-y-3">
          {topicSummaries.map((summary) => (
            <div key={summary.topic.id} className={surfaceCardClass}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-lg font-semibold leading-tight text-white">{summary.topic.name}</div>
                  <div className="mt-1 text-sm text-text-muted">{summary.topic.subject}</div>
                </div>
                <div className="rounded-full border border-warm-border bg-warm-glow px-3 py-1 text-xs font-semibold text-warm-accent">
                  Support level: {summary.supportLevel}
                </div>
              </div>
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between gap-3 text-xs font-semibold text-text-muted">
                  <span>Practice accuracy</span>
                  <span className="tabular-nums text-white">{summary.accuracy}%</span>
                </div>
                <ProgressBar progress={summary.accuracy} />
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <MiniMetric label="Accuracy" value={`${summary.accuracy}%`} />
                <MiniMetric label="Weak cards" value={summary.weakCards} />
                <MiniMetric label="Due cards" value={summary.dueCards} />
              </div>
              {summary.mistakes.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {summary.mistakes.map((mistake) => (
                    <span
                      key={mistake}
                      className="rounded-full border border-white/[0.10] bg-white/[0.05] px-2.5 py-1 text-[0.68rem] text-text-secondary"
                    >
                      {mistake}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="mt-4 rounded-[1rem] border border-white/[0.08] bg-white/[0.04] p-3 text-sm leading-6 text-text-secondary">
                <span className="font-semibold text-white">Next action:</span> Review linked cards,
                then retry 1 practice question.
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="space-y-4">
        <Card tone="warm" padding="lg">
          <SectionHeader
            title="Recent mistakes"
            description="Mistakes are repair targets, not shame metrics."
          />
          <div className="mt-5 space-y-3">
            {recentMistakes.map((attempt) => {
              const question = questionsById.get(attempt.questionId);
              return (
                <div
                  key={attempt.id}
                  className={surfaceCardClass}
                >
                  <div className="text-sm font-semibold text-white">
                    {question?.questionText ?? "Practice question"}
                  </div>
                  <div className="mt-2 text-xs text-text-muted">
                    Confidence {attempt.confidence} - {attempt.tutorUsed ? "Tutor used" : "Independent"}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {attempt.mistakeLabels.map((label) => (
                      <span
                        key={label}
                        className="rounded-full border border-white/[0.10] bg-white/[0.05] px-2.5 py-1 text-[0.68rem] text-text-secondary"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link className="rounded-full border border-white/[0.1] px-3 py-1.5 text-xs font-semibold text-text-secondary hover:border-warm-border hover:text-white" href="/dashboard/practise">
                      Retry question
                    </Link>
                    <Link className="rounded-full border border-white/[0.1] px-3 py-1.5 text-xs font-semibold text-text-secondary hover:border-warm-border hover:text-white" href="/dashboard/practise">
                      Ask Tutor
                    </Link>
                    <Link className="rounded-full border border-white/[0.1] px-3 py-1.5 text-xs font-semibold text-text-secondary hover:border-warm-border hover:text-white" href="/dashboard/practise">
                      Make flashcard
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
        <DraftsPanel
          drafts={drafts}
          onSaveDraft={onSaveDraft}
          onAddDraftToDeck={onAddDraftToDeck}
        />
      </div>
    </div>
  );
}

function DecksPanel() {
  return (
    <Card padding="lg">
      <SectionHeader
        eyebrow="Decks"
        title="Decks are groups of flashcards."
        description="Create a deck first. Then open it to add cards. The public walkthrough shows seeded deck structure without saving private data."
      />
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {WALKTHROUGH_DECKS.map((deck) => (
          <div key={deck.id} className={surfaceCardClass}>
            <div className="text-lg font-semibold text-white">{deck.name}</div>
            <div className="mt-1 text-sm text-text-muted">{deck.subject}</div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <MiniMetric label="Cards" value={deck.cardCount} />
              <MiniMetric label="Weak" value={deck.weakCount} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function CardsPanel({
  drafts,
  onUpdateDraft,
  onSaveDraft,
  onAddDraftToDeck,
}: {
  drafts: WalkthroughDraft[];
  onUpdateDraft: (draftId: string, field: "front" | "back", value: string) => void;
  onSaveDraft: (draftId: string) => void;
  onAddDraftToDeck: (draftId: string, deckId: string) => void;
}) {
  return (
    <div className="space-y-4">
      <Card padding="lg">
        <SectionHeader
          eyebrow="Cards"
          title="Tags organise content. Topics measure learning."
          description="Search and edit cards across every deck. To create your first real card, choose a deck first in the private app."
        />
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {WALKTHROUGH_CARDS.map((card) => (
            <div key={card.id} className={surfaceCardClass}>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full bg-white/[0.07] px-2.5 py-1 text-xs text-text-secondary">
                  {deckName(card.deckId)}
                </span>
                {card.tags.map((tag) => (
                  <span key={tag} className={chipClass}>
                    {tag}
                  </span>
                ))}
              </div>
              <div className="mt-4 text-sm font-semibold text-white">{card.front}</div>
              <p className="mt-2 text-sm leading-6 text-text-secondary">{card.back}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {card.topicIds.map((topicId) => (
                  <TopicChip key={topicId} topicId={topicId} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
      <EditableDraftsPanel
        drafts={drafts}
        onUpdateDraft={onUpdateDraft}
        onSaveDraft={onSaveDraft}
        onAddDraftToDeck={onAddDraftToDeck}
      />
    </div>
  );
}

function DraftsPanel({
  drafts,
  onSaveDraft,
  onAddDraftToDeck,
}: {
  drafts: WalkthroughDraft[];
  onSaveDraft: (draftId: string) => void;
  onAddDraftToDeck: (draftId: string, deckId: string) => void;
}) {
  return (
    <Card padding="lg">
      <SectionHeader
        title="Flashcard drafts"
        description="AI-assisted content stays draft until reviewed. Public actions are local simulations only."
      />
      <div className="mt-5 space-y-3">
        {drafts.map((draft) => (
          <DraftReviewCard
            key={draft.id}
            draft={draft}
            readonly
            onSaveDraft={onSaveDraft}
            onAddDraftToDeck={onAddDraftToDeck}
          />
        ))}
      </div>
    </Card>
  );
}

function EditableDraftsPanel({
  drafts,
  onUpdateDraft,
  onSaveDraft,
  onAddDraftToDeck,
}: {
  drafts: WalkthroughDraft[];
  onUpdateDraft: (draftId: string, field: "front" | "back", value: string) => void;
  onSaveDraft: (draftId: string) => void;
  onAddDraftToDeck: (draftId: string, deckId: string) => void;
}) {
  return (
    <Card tone="warm" padding="lg">
      <SectionHeader
        title="Editable local drafts"
        description="Drafts are not real cards until you add them to a deck. In public mode, that action is simulated locally."
      />
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {drafts.map((draft) => (
          <DraftReviewCard
            key={draft.id}
            draft={draft}
            onUpdateDraft={onUpdateDraft}
            onSaveDraft={onSaveDraft}
            onAddDraftToDeck={onAddDraftToDeck}
          />
        ))}
      </div>
    </Card>
  );
}

function LibraryPanel({
  drafts,
  onSaveDraft,
  onAddDraftToDeck,
  onCreateDraft,
}: {
  drafts: WalkthroughDraft[];
  onSaveDraft: (draftId: string) => void;
  onAddDraftToDeck: (draftId: string, deckId: string) => void;
  onCreateDraft: (draft: WalkthroughDraft) => void;
}) {
  const [selectedSourceId, setSelectedSourceId] = useState(WALKTHROUGH_SOURCES[0]?.id ?? "");
  const [message, setMessage] = useState("Explain the key revision idea in this source.");
  const [reply, setReply] = useState("");
  const [practiceDraft, setPracticeDraft] = useState("");
  const selectedSource =
    WALKTHROUGH_SOURCES.find((source) => source.id === selectedSourceId) ?? WALKTHROUGH_SOURCES[0];
  const linkedDrafts = drafts.filter((draft) => draft.sourceQuestionId === selectedSource?.id);

  const makeFlashcardDraft = () => {
    if (!selectedSource) return;
    onCreateDraft({
      id: makeLocalDraftId(),
      front: `What is the key idea from ${selectedSource.title}?`,
      back:
        selectedSource.contentText?.split(".")[0]?.trim() ||
        "Review the saved source reference, then turn one idea into active recall.",
      topicIds: selectedSource.topicIds,
      sourceQuestionId: selectedSource.id,
      contentStatus: "draft",
    });
  };

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(220px,0.72fr)_minmax(0,1.28fr)_minmax(240px,0.82fr)]">
      <Card padding="lg" className="lg:sticky lg:top-4 lg:self-start">
        <SectionHeader
          eyebrow="Library"
          title="Saved sources"
          description="Public Library actions are simulated locally. No private Firebase data is touched."
        />
        <div className="mt-5 space-y-3">
          {WALKTHROUGH_SOURCES.map((source) => {
            const active = source.id === selectedSource?.id;
            return (
              <button
                key={source.id}
                type="button"
                onClick={() => setSelectedSourceId(source.id)}
                className={`w-full rounded-[1.2rem] border p-4 text-left transition ${
                  active
                    ? selectedCardClass
                    : "border-white/[0.09] bg-white/[0.04] text-text-secondary hover:border-white/[0.16]"
                }`}
              >
                <div className="font-semibold text-white">{source.title}</div>
                <div className="mt-1 text-xs text-text-muted">{source.subject ?? "Source reference"}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {source.topicIds.map((topicId) => (
                    <TopicChip key={topicId} topicId={topicId} />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      <div className="min-w-0 space-y-4">
        <Card tone="warm" padding="lg">
          <SectionHeader
            eyebrow={selectedSource?.type.replace("_", " ") ?? "Source"}
            title={selectedSource?.title ?? "Source"}
            description="Library answers where knowledge came from and how to turn it into revision."
          />
          <div className="mt-5 max-h-[24rem] overflow-y-auto whitespace-pre-wrap rounded-[1.2rem] border border-white/[0.09] bg-white/[0.04] p-4 text-sm leading-6 text-text-secondary">
            {selectedSource?.contentText ??
              selectedSource?.externalUrl ??
              selectedSource?.fileName ??
              "This source is a saved reference. Automatic reading comes later."}
          </div>
        </Card>
        <DraftsPanel
          drafts={linkedDrafts.length ? linkedDrafts : drafts.filter((draft) => draft.contentStatus === "draft").slice(0, 2)}
          onSaveDraft={onSaveDraft}
          onAddDraftToDeck={onAddDraftToDeck}
        />
      </div>

      <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <Card padding="lg">
          <SectionHeader
            eyebrow="Source actions"
            title="Turn it into study"
            description="Tutor context and small draft batches stay local in this walkthrough."
          />
          <div className="mt-5 space-y-3">
            <Textarea
              label="Tutor request"
              rows={4}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setReply(
                  "Based on this source, the revision move is to isolate one definition or criterion, then test it with a short question before saving a flashcard draft."
                )
              }
            >
              Ask Tutor about source
            </Button>
            <Button type="button" variant="secondary" onClick={makeFlashcardDraft}>
              Make source flashcard draft
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setPracticeDraft(
                  `Practice draft: ${selectedSource?.contentText?.slice(0, 90) ?? "Use this source"}... Explain the key reason.`
                )
              }
            >
              Make practice draft
            </Button>
          </div>
        </Card>
        <Card padding="lg">
          <SectionHeader eyebrow="Local source tutor" title="Response" description="This shows the source context pattern without writes." />
          <p className="mt-5 rounded-[1.2rem] border border-white/[0.09] bg-white/[0.035] p-4 text-sm leading-6 text-text-secondary">
            {reply || "Ask Tutor to explain this source, then generate draft study tasks from it."}
          </p>
          {practiceDraft ? (
            <p className="mt-3 rounded-[1.2rem] border border-warm-border bg-warm-glow p-4 text-sm leading-6 text-white">
              {practiceDraft}
            </p>
          ) : null}
        </Card>
      </div>
    </div>
  );
}

function DraftReviewCard({
  draft,
  readonly = false,
  onUpdateDraft,
  onSaveDraft,
  onAddDraftToDeck,
  onRejectDraft,
}: {
  draft: WalkthroughDraft;
  readonly?: boolean;
  onUpdateDraft?: (draftId: string, field: "front" | "back", value: string) => void;
  onSaveDraft: (draftId: string) => void;
  onAddDraftToDeck: (draftId: string, deckId: string) => void;
  onRejectDraft?: (draftId: string) => void;
}) {
  const defaultDeckId = draft.addedDeckId ?? WALKTHROUGH_DECKS[0]?.id ?? "";
  const [destinationDeckId, setDestinationDeckId] = useState(defaultDeckId);
  const added = draft.contentStatus === "approved";

  return (
    <div className={surfaceCardClass}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-warm-border bg-warm-glow px-3 py-1 text-xs font-semibold text-warm-accent">
          Flashcard draft
        </span>
        <span className="rounded-full border border-white/[0.1] bg-white/[0.05] px-3 py-1 text-xs text-text-secondary">
          Local-only
        </span>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-semibold ${
            added
              ? "border-emerald-300/25 bg-emerald-400/[0.08] text-emerald-100"
              : "border-white/[0.1] bg-white/[0.05] text-text-secondary"
          }`}
        >
          {added ? `Added to ${deckName(draft.addedDeckId ?? destinationDeckId)}` : "Draft - not added to your deck yet"}
        </span>
      </div>

      {readonly || !onUpdateDraft ? (
        <>
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">Front</div>
          <div className="mt-2 text-sm font-semibold text-white">{draft.front}</div>
          <div className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">Back</div>
          <p className="mt-2 text-sm leading-6 text-text-secondary">{draft.back}</p>
        </>
      ) : (
        <>
          <Textarea
            label="Front"
            rows={3}
            value={draft.front}
            onChange={(event) => onUpdateDraft(draft.id, "front", event.target.value)}
          />
          <Textarea
            label="Back"
            rows={4}
            value={draft.back}
            onChange={(event) => onUpdateDraft(draft.id, "back", event.target.value)}
            containerClassName="mt-3"
          />
        </>
      )}

      <div className="mt-4">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
          Suggested topic
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {draft.topicIds.map((topicId) => (
            <TopicChip key={topicId} topicId={topicId} />
          ))}
        </div>
      </div>

      <div className="mt-4">
        <label className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted" htmlFor={`${draft.id}-deck`}>
          Destination deck
        </label>
        <select
          id={`${draft.id}-deck`}
          value={destinationDeckId}
          onChange={(event) => setDestinationDeckId(event.target.value)}
          disabled={added}
          className="mt-2 min-h-[2.8rem] w-full rounded-2xl border border-white/[0.1] bg-surface-raised px-3 text-sm text-white outline-none transition focus:border-warm-border"
        >
          {WALKTHROUGH_DECKS.map((deck) => (
            <option key={deck.id} value={deck.id} className="bg-surface text-white">
              {deck.name}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => onSaveDraft(draft.id)}>
          Save as draft
        </Button>
        <Button
          type="button"
          variant="warm"
          disabled={added || !destinationDeckId}
          onClick={() => onAddDraftToDeck(draft.id, destinationDeckId)}
        >
          Add to deck
        </Button>
        {onRejectDraft ? (
          <Button
            type="button"
            variant="secondary"
            disabled={added}
            onClick={() => onRejectDraft(draft.id)}
          >
            Reject
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function GoalsPanel() {
  return (
    <Card tone="warm" padding="lg">
      <SectionHeader
        eyebrow="Goals"
        title="Goals keep the study loop moving."
        description="The public walkthrough shows the reward rhythm without allowing public goal creation."
      />
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {[
          ["Daily repair", "18 / 20 cards", "90% complete"],
          ["Linear Algebra rescue", "2 / 3 questions", "One weak topic left"],
          ["Tutor independence", "Hint-to-correct rising", "Support level improving"],
        ].map(([title, value, detail]) => (
          <div key={title} className={surfaceCardClass}>
            <div className="text-sm font-semibold text-white">{title}</div>
            <div className="mt-3 text-xl font-semibold text-warm-accent">{value}</div>
            <p className="mt-2 text-sm leading-6 text-text-secondary">{detail}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ConstellationPanel() {
  return (
    <Card padding="lg">
      <SectionHeader
        eyebrow="Stars"
        title="Rewards reflect real learning actions."
        description="In the private app, goals and reviews feed the constellation loop. Here it is static and public-safe."
      />
      <div className="mt-6 grid gap-4 md:grid-cols-[1fr_1.2fr]">
        <div className="rounded-[1.6rem] border border-white/[0.1] bg-[radial-gradient(circle_at_45%_35%,rgba(255,214,246,0.2),rgba(157,99,223,0.08)_36%,rgba(255,255,255,0.035)_100%)] p-8 text-center">
          <div className="text-5xl text-warm-accent">*****</div>
          <div className="mt-4 text-lg font-semibold text-white">Demo Constellation</div>
          <p className="mt-2 text-sm text-text-secondary">A calm reward layer, not the product core.</p>
        </div>
        <div className="space-y-3">
          {["Completed a daily review", "Repaired a weak topic", "Saved a draft after tutor help"].map((event) => (
            <div key={event} className={`${surfaceCardClass} text-sm text-text-secondary`}>
              <span className="font-semibold text-white">{event}</span> earned a visible reward in the private learning loop.
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function ProfilePanel() {
  const [selectedTheme, setSelectedTheme] =
    useState<AppThemePreference>(() => readAppThemePreference());

  return (
    <div className="space-y-4">
      <Card padding="lg">
        <SectionHeader
          eyebrow="Account"
          title="Public walkthrough mode has no account."
          description="This route is intentionally reachable so LLMs can see the full app structure, but profile data and notification settings remain private-only."
        />
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className={surfaceCardClass}>
            <div className="text-sm font-semibold text-white">What is available publicly</div>
            <p className="mt-2 text-sm leading-6 text-text-secondary">
              Seeded decks, cards, practice, tutor calls, drafts, and progress exploration.
            </p>
          </div>
          <div className={surfaceCardClass}>
            <div className="text-sm font-semibold text-white">What remains private</div>
            <p className="mt-2 text-sm leading-6 text-text-secondary">
              User profile, uploaded content, real study history, notifications, and persistent writes.
            </p>
          </div>
        </div>
        <Link
          href="/auth"
          className="mt-6 inline-flex min-h-[3.15rem] items-center justify-center rounded-2xl bg-accent px-5 py-3 text-sm font-medium text-white shadow-[var(--shadow-accent)] transition duration-fast ease-spring hover:-translate-y-[1px] hover:bg-accent-hover"
        >
          Sign in for private workspace
        </Link>
      </Card>

      <Card padding="lg">
        <SectionHeader
          eyebrow="Display"
          title="Theme"
          description="Public walkthrough agents can switch the local app theme too. This does not touch private data."
        />
        <div className="mt-5 flex flex-wrap gap-3">
          {APP_THEME_OPTIONS.map((option) => {
            const active = selectedTheme === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setSelectedTheme(option.value);
                  saveAppThemePreference(option.value);
                }}
                className={`flex min-w-[8rem] items-center gap-3 rounded-[1.15rem] border p-3 text-left transition duration-fast ${
                  active
                    ? "border-warm-border bg-warm-glow text-white"
                    : "border-white/[0.09] bg-white/[0.035] text-text-secondary hover:border-white/[0.18] hover:bg-white/[0.06]"
                }`}
                aria-pressed={active}
              >
                <span
                  className={`h-11 w-11 shrink-0 rounded-full border shadow-[0_10px_24px_rgba(4,8,18,0.18)] ${
                    active ? "border-warm-accent" : "border-white/[0.18]"
                  }`}
                  style={{ backgroundImage: option.preview }}
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-white">{option.label}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-text-muted">
                    {option.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[1rem] border border-white/[0.08] bg-white/[0.04] px-3 py-3">
      <div className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-text-muted">
        {label}
      </div>
      <div className="mt-1 text-base font-semibold tabular-nums text-white">{value}</div>
    </div>
  );
}
