"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import AppPage from "@/components/layout/AppPage";
import TabBar from "@/components/layout/TabBar";
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
  WALKTHROUGH_TOPICS,
  type WalkthroughAttempt,
  type WalkthroughDraft,
  type WalkthroughQuestion,
  type WalkthroughTutorIntent,
  type WalkthroughTutorMessage,
} from "@/lib/demo/public-walkthrough";

type Feedback = { type: "success" | "error"; message: string };
type PublicSurface =
  | "home"
  | "learn"
  | "practise"
  | "progress"
  | "decks"
  | "cards"
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
  if (pathname.startsWith("/dashboard/goals")) return "goals";
  if (pathname.startsWith("/dashboard/constellation")) return "constellation";
  if (pathname.startsWith("/dashboard/profile")) return "profile";
  return "home";
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

function TopicChip({ topicId }: { topicId: string }) {
  return (
    <span className="rounded-full border border-white/[0.11] bg-white/[0.055] px-3 py-1.5 text-xs font-medium text-text-secondary">
      {topicName(topicId)}
    </span>
  );
}

export default function PublicDashboardShell() {
  const pathname = usePathname();
  const surface = getSurface(pathname);
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

  const selectedQuestion = useMemo(
    () =>
      WALKTHROUGH_QUESTIONS.find((question) => question.id === selectedQuestionId) ??
      WALKTHROUGH_QUESTIONS[0],
    [selectedQuestionId]
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
        const topicQuestions = WALKTHROUGH_QUESTIONS.filter((question) =>
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
    [attempts]
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
    setFeedback({
      type: "success",
      message: "Local walkthrough attempt saved. Progress updates in this public session only.",
    });
  };

  const handleTutorIntent = async (intent: WalkthroughTutorIntent, prompt: string) => {
    setBusyIntent(intent);
    setFeedback(null);
    setConfirmFullSolution(false);
    setTutorMessages((current) => [...current, { role: "user", text: prompt }]);

    try {
      const response = await fetch("/api/demo/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent,
          message: prompt,
          context: {
            questionId: selectedQuestion.id,
            userAnswer,
            workingText,
          },
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
      setTutorMessages((current) => [...current, { role: "model", text: reply }]);

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
        setFeedback({
          type: "success",
          message:
            "Flashcard draft created locally. Edit it, save it as a draft, or simulate adding it to a deck.",
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

  return (
    <>
      <div className="pb-32 md:pb-0 md:pl-[6.75rem] lg:pl-80">
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
          {surface === "home" ? <HomePanel /> : null}
          {surface === "learn" ? <LearnPanel /> : null}
          {surface === "practise" ? (
            <PractisePanel
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
              confirmFullSolution={confirmFullSolution}
              onConfirmFullSolutionChange={setConfirmFullSolution}
            />
          ) : null}
          {surface === "progress" ? (
            <ProgressPanel
              topicSummaries={topicSummaries}
              recentMistakes={recentMistakes}
              questions={WALKTHROUGH_QUESTIONS}
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

function HomePanel() {
  return (
    <>
      <PageHero
        eyebrow="Public dashboard"
        title="Jami is a learning loop, not a feature pile."
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
      <Card padding="lg">
        <SectionHeader
          eyebrow="How Jami works"
          title="Learn, practise, repair, save, and track."
          description="A first-time student should be able to follow the whole learning loop from this public dashboard."
        />
        <div className="mt-6 space-y-3">
          {[
            ["1. Learn", "Review flashcards.", "/dashboard/study"],
            ["2. Practise", "Try questions.", "/dashboard/practise"],
            ["3. Tutor", "Get help when stuck.", "/dashboard/practise"],
            ["4. Save", "Turn mistakes into card drafts.", "/dashboard/cards"],
            ["5. Progress", "See weak topics.", "/dashboard/progress"],
          ].map(([title, text, href], index, steps) => (
            <Link
              key={title}
              href={href}
              className={`${interactiveCardClass} flex items-center justify-between gap-4`}
            >
              <span className="min-w-0">
                <span className="block text-base font-semibold text-white">{title}</span>
                <span className="mt-1 block text-sm leading-6 text-text-secondary">{text}</span>
              </span>
              {index < steps.length - 1 ? (
                <span className="hidden h-px w-14 shrink-0 bg-white/[0.12] sm:block" />
              ) : null}
            </Link>
          ))}
        </div>
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
  confirmFullSolution,
  onConfirmFullSolutionChange,
}: {
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
  onTutorIntent: (intent: WalkthroughTutorIntent, prompt: string) => void;
  confirmFullSolution: boolean;
  onConfirmFullSolutionChange: (value: boolean) => void;
}) {
  return (
    <div className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(460px,0.9fr)_minmax(0,1.1fr)]">
      <Card padding="lg">
        <SectionHeader
          eyebrow="Practise"
          title="Topical questions"
          description="This public version uses seeded questions and local attempt state."
        />
        <div className="mt-5 space-y-3">
          {WALKTHROUGH_QUESTIONS.map((question) => {
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
            title="Attempt the selected question"
            description="Saving here updates only this public session. No Firestore writes happen."
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
              value={workingText}
              onChange={(event) => onWorkingTextChange(event.target.value)}
              rows={5}
            />
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
          </div>
        </Card>
        <TutorPanel
          selectedQuestion={selectedQuestion}
          userAnswer={userAnswer}
          workingText={workingText}
          messages={tutorMessages}
          busyIntent={busyIntent}
          onTutorIntent={onTutorIntent}
          confirmFullSolution={confirmFullSolution}
          onConfirmFullSolutionChange={onConfirmFullSolutionChange}
        />
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

function TutorPanel({
  selectedQuestion,
  userAnswer,
  workingText,
  messages,
  busyIntent,
  onTutorIntent,
  confirmFullSolution,
  onConfirmFullSolutionChange,
}: {
  selectedQuestion: WalkthroughQuestion;
  userAnswer: string;
  workingText: string;
  messages: WalkthroughTutorMessage[];
  busyIntent: WalkthroughTutorIntent | null;
  onTutorIntent: (intent: WalkthroughTutorIntent, prompt: string) => void;
  confirmFullSolution: boolean;
  onConfirmFullSolutionChange: (value: boolean) => void;
}) {
  return (
    <Card padding="lg">
      <SectionHeader
        eyebrow="Contextual tutor"
        title="Hint-first help beside the question."
        description="This public tutor can make limited real AI calls, but writes nothing to user data."
      />
      <div className="mt-5 flex flex-wrap gap-2 rounded-[1.25rem] border border-white/[0.09] bg-white/[0.035] p-2">
        {TUTOR_ACTIONS.map((action) => (
          <Button
            key={action.intent}
            type="button"
            variant={action.variant ?? "secondary"}
            disabled={busyIntent !== null}
            title={action.description}
            className="min-h-[2.55rem] flex-1 rounded-full px-3 text-xs sm:flex-none"
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
      <div className="mt-4 grid gap-2 md:grid-cols-2">
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

function DraftReviewCard({
  draft,
  readonly = false,
  onUpdateDraft,
  onSaveDraft,
  onAddDraftToDeck,
}: {
  draft: WalkthroughDraft;
  readonly?: boolean;
  onUpdateDraft?: (draftId: string, field: "front" | "back", value: string) => void;
  onSaveDraft: (draftId: string) => void;
  onAddDraftToDeck: (draftId: string, deckId: string) => void;
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
  return (
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
