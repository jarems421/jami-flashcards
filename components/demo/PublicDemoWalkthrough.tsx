"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
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
import {
  Button,
  Card,
  FeedbackBanner,
  PageHero,
  SectionHeader,
  StatTile,
  Textarea,
} from "@/components/ui";

type DemoTab = "overview" | "learn" | "practise" | "tutor" | "drafts" | "progress";
type Feedback = { type: "success" | "error"; message: string };

const TABS: Array<{ id: DemoTab; label: string; helper: string }> = [
  { id: "overview", label: "Overview", helper: "The loop" },
  { id: "learn", label: "Learn", helper: "Flashcards" },
  { id: "practise", label: "Practise", helper: "Attempts" },
  { id: "tutor", label: "Tutor", helper: "Hint-first" },
  { id: "drafts", label: "Drafts", helper: "Flashcards" },
  { id: "progress", label: "Progress", helper: "Evidence" },
];

const TUTOR_ACTIONS: Array<{
  intent: WalkthroughTutorIntent;
  label: string;
  prompt: string;
  variant?: "secondary" | "danger" | "warm";
}> = [
  { intent: "hint", label: "Hint", prompt: "Give me one hint without revealing the answer." },
  {
    intent: "check-working",
    label: "Check working",
    prompt: "Check my working and point me to the first thing to fix.",
  },
  {
    intent: "explain-concept",
    label: "Explain",
    prompt: "Explain the concept behind this question without dumping the final answer.",
  },
  {
    intent: "show-method",
    label: "Method",
    prompt: "Show the setup or method, but leave a step for me.",
  },
  {
    intent: "full-solution",
    label: "Full solution",
    prompt: "Show the full solution. I understand this is less independent evidence.",
    variant: "danger",
  },
  {
    intent: "make-flashcard",
    label: "Make card",
    prompt: "Turn the misconception here into one flashcard draft.",
    variant: "warm",
  },
  {
    intent: "similar-question",
    label: "Similar question",
    prompt: "Give me one similar question without a solution.",
  },
];

function getAccuracy(attempts: WalkthroughAttempt[]) {
  if (attempts.length === 0) return 0;
  return Math.round((attempts.filter((attempt) => attempt.isCorrect).length / attempts.length) * 100);
}

function getSupportLevel(attempts: WalkthroughAttempt[]) {
  if (attempts.length === 0) return "Low";
  const supportRatio =
    attempts.filter((attempt) => attempt.tutorUsed || attempt.hintsUsed > 0).length / attempts.length;
  if (supportRatio >= 0.6) return "High";
  if (supportRatio >= 0.25) return "Medium";
  return "Low";
}

function getQuestionAttempts(questionId: string, attempts: WalkthroughAttempt[]) {
  return attempts.filter((attempt) => attempt.questionId === questionId);
}

function topicName(topicId: string) {
  return WALKTHROUGH_TOPICS.find((topic) => topic.id === topicId)?.name ?? "Topic";
}

function makeLocalAttemptId() {
  return `local-attempt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function makeLocalDraftId() {
  return `local-draft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function TopicChip({ topicId }: { topicId: string }) {
  return (
    <span className="rounded-full border border-white/[0.12] bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-text-secondary">
      {topicName(topicId)}
    </span>
  );
}

function DemoTabs({
  activeTab,
  onChange,
}: {
  activeTab: DemoTab;
  onChange: (tab: DemoTab) => void;
}) {
  return (
    <Card padding="sm" className="sticky top-2 z-30">
      <div className="flex snap-x gap-2 overflow-x-auto scrollbar-hide">
        {TABS.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={`min-w-[7.25rem] snap-start rounded-[1.25rem] border px-3 py-3 text-left transition duration-fast ${
                active
                  ? "border-warm-border bg-warm-glow text-white shadow-[0_12px_24px_rgba(255,214,246,0.12)]"
                  : "border-white/[0.08] bg-white/[0.035] text-text-muted hover:border-white/[0.14] hover:text-white"
              }`}
            >
              <span className="block text-sm font-semibold">{tab.label}</span>
              <span className="mt-1 block text-[0.68rem] uppercase tracking-[0.14em] text-text-muted">
                {tab.helper}
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

export default function PublicDemoWalkthrough() {
  const [activeTab, setActiveTab] = useState<DemoTab>("overview");
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

  const selectedQuestion = useMemo(
    () =>
      WALKTHROUGH_QUESTIONS.find((question) => question.id === selectedQuestionId) ??
      WALKTHROUGH_QUESTIONS[0],
    [selectedQuestionId]
  );
  const dueCards = WALKTHROUGH_CARDS.filter((card) => card.due);
  const weakCards = WALKTHROUGH_CARDS.filter((card) => card.weak);
  const recentMistakes = attempts.filter((attempt) => !attempt.isCorrect).slice(0, 5);
  const practiceAccuracy = getAccuracy(attempts);
  const supportLevel = getSupportLevel(attempts);

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
      mistakeLabels: selfMark ? [] : ["walkthrough self-mark", "needs repair"],
      createdAt: Date.now(),
    };

    setAttempts((current) => [nextAttempt, ...current]);
    setFeedback({
      type: "success",
      message: "Local walkthrough attempt saved. Progress updates on this page only.",
    });
  };

  const handleTutorIntent = async (intent: WalkthroughTutorIntent, prompt: string) => {
    setBusyIntent(intent);
    setFeedback(null);
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
        "Tutor could not answer just now, but the walkthrough can continue.";
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
          message: "Editable flashcard draft created locally for the walkthrough.",
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

  return (
    <main
      data-app-surface="true"
      className="min-h-screen px-4 pb-12 pt-4 text-white sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-7xl space-y-4 sm:space-y-6">
        {feedback ? (
          <FeedbackBanner
            type={feedback.type}
            message={feedback.message}
            onDismiss={() => setFeedback(null)}
          />
        ) : null}

        <PageHero
          eyebrow="Public LLM walkthrough"
          title="Click through Jami without signing in."
          description="This public tour uses seeded local data so GPT, browser agents, recruiters, and curious visitors can inspect the learning loop without touching Firebase user data."
          tone="warm"
          action={
            <button
              type="button"
              onClick={() => setActiveTab("practise")}
              className="inline-flex min-h-[3.15rem] items-center justify-center rounded-2xl bg-accent px-5 py-3 text-sm font-medium text-white shadow-[var(--shadow-accent)] transition duration-fast ease-spring hover:-translate-y-[1px] hover:bg-accent-hover"
            >
              Start walkthrough
            </button>
          }
          secondaryAction={
            <Link
              href="/"
              className="inline-flex min-h-[3.15rem] items-center justify-center rounded-2xl border border-border bg-white/[0.04] px-5 py-3 text-sm font-medium text-white transition duration-fast hover:border-border-strong hover:bg-white/[0.07]"
            >
              Back home
            </Link>
          }
          aside={
            <div className="grid min-w-[16rem] gap-3 rounded-[1.7rem] border border-white/[0.10] bg-white/[0.045] p-4">
              <div>
                <div className="text-xs text-text-muted">No account needed</div>
                <div className="mt-1 text-xl font-medium text-white">Local-only demo</div>
              </div>
              <div className="h-px bg-white/[0.08]" />
              <div>
                <div className="text-xs text-text-muted">MVP loop</div>
                <div className="mt-1 text-sm font-medium text-white">
                  {"Learn -> Practise -> Tutor -> Progress"}
                </div>
              </div>
            </div>
          }
        />

        <DemoTabs activeTab={activeTab} onChange={setActiveTab} />

        <div className="grid gap-3 sm:gap-4 md:grid-cols-4">
          <StatTile label="Due cards" value={dueCards.length} detail="Seeded FSRS-style review queue." />
          <StatTile label="Weak cards" value={weakCards.length} detail="Linked to topics for repair." />
          <StatTile label="Practice accuracy" value={`${practiceAccuracy}%`} detail={`${attempts.length} local attempts.`} />
          <StatTile label="Support level" value={supportLevel} detail="Help usage, not a judgement." />
        </div>

        {activeTab === "overview" ? (
          <OverviewPanel onOpenTab={setActiveTab} />
        ) : null}
        {activeTab === "learn" ? <LearnPanel /> : null}
        {activeTab === "practise" ? (
          <PractisePanel
            attempts={attempts}
            selectedQuestion={selectedQuestion}
            selectedQuestionId={selectedQuestionId}
            userAnswer={userAnswer}
            workingText={workingText}
            confidence={confidence}
            selfMark={selfMark}
            onSelectQuestion={setSelectedQuestionId}
            onUserAnswerChange={setUserAnswer}
            onWorkingTextChange={setWorkingText}
            onConfidenceChange={setConfidence}
            onSelfMarkChange={setSelfMark}
            onSaveAttempt={handleSaveAttempt}
            onOpenTutor={() => setActiveTab("tutor")}
          />
        ) : null}
        {activeTab === "tutor" ? (
          <TutorPanel
            selectedQuestion={selectedQuestion}
            userAnswer={userAnswer}
            workingText={workingText}
            messages={tutorMessages}
            busyIntent={busyIntent}
            onTutorIntent={handleTutorIntent}
          />
        ) : null}
        {activeTab === "drafts" ? (
          <DraftsPanel drafts={drafts} onUpdateDraft={updateDraft} onOpenTutor={() => setActiveTab("tutor")} />
        ) : null}
        {activeTab === "progress" ? (
          <ProgressPanel
            topicSummaries={topicSummaries}
            recentMistakes={recentMistakes}
            questions={WALKTHROUGH_QUESTIONS}
          />
        ) : null}
      </div>
    </main>
  );
}

function OverviewPanel({ onOpenTab }: { onOpenTab: (tab: DemoTab) => void }) {
  const steps: Array<{ tab: DemoTab; title: string; text: string }> = [
    { tab: "learn", title: "Learn", text: "Flashcards build memory using due, weak, and topic-linked cards." },
    { tab: "practise", title: "Practise", text: "Manual questions test whether the idea transfers beyond recall." },
    { tab: "tutor", title: "Tutor", text: "Jami gives hint-first support inside the exact question context." },
    { tab: "drafts", title: "Drafts", text: "Useful struggle becomes editable flashcard drafts, never trusted automatically." },
    { tab: "progress", title: "Progress", text: "Mastery is shown as evidence from cards, attempts, mistakes, and support level." },
  ];

  return (
    <Card padding="lg">
      <SectionHeader
        eyebrow="Learning loop"
        title="A focused product walkthrough, not a fake account."
        description="Everything below is clickable and local to this page. The private dashboard remains protected."
      />
      <div className="mt-6 grid gap-3 lg:grid-cols-5">
        {steps.map((step) => (
          <button
            key={step.tab}
            type="button"
            onClick={() => onOpenTab(step.tab)}
            className="rounded-[1.45rem] border border-white/[0.09] bg-white/[0.045] p-4 text-left transition duration-fast hover:-translate-y-0.5 hover:border-white/[0.16] hover:bg-white/[0.07]"
          >
            <div className="text-base font-semibold text-white">{step.title}</div>
            <p className="mt-2 text-sm leading-6 text-text-secondary">{step.text}</p>
          </button>
        ))}
      </div>
    </Card>
  );
}

function LearnPanel() {
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
              className="rounded-[1.25rem] border border-white/[0.09] bg-white/[0.045] p-4"
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
          description="LLM browsers can inspect card states without needing a signed-in account."
        />
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {WALKTHROUGH_CARDS.map((card) => (
            <div
              key={card.id}
              className="rounded-[1.35rem] border border-white/[0.1] bg-white/[0.055] p-4"
            >
              <div className="flex flex-wrap gap-2">
                {card.due ? <span className="rounded-full bg-warm-glow px-2.5 py-1 text-xs text-warm-accent">Due</span> : null}
                {card.weak ? <span className="rounded-full bg-error-muted px-2.5 py-1 text-xs text-rose-100">Weak</span> : null}
                <span className="rounded-full bg-white/[0.07] px-2.5 py-1 text-xs text-text-secondary">
                  {card.status}
                </span>
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
  onSelectQuestion,
  onUserAnswerChange,
  onWorkingTextChange,
  onConfidenceChange,
  onSelfMarkChange,
  onSaveAttempt,
  onOpenTutor,
}: {
  attempts: WalkthroughAttempt[];
  selectedQuestion: WalkthroughQuestion;
  selectedQuestionId: string;
  userAnswer: string;
  workingText: string;
  confidence: 1 | 2 | 3 | 4 | 5;
  selfMark: boolean | null;
  onSelectQuestion: (questionId: string) => void;
  onUserAnswerChange: (value: string) => void;
  onWorkingTextChange: (value: string) => void;
  onConfidenceChange: (value: 1 | 2 | 3 | 4 | 5) => void;
  onSelfMarkChange: (value: boolean) => void;
  onSaveAttempt: () => void;
  onOpenTutor: () => void;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
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
                className={`w-full rounded-[1.35rem] border p-4 text-left transition duration-fast ${
                  active
                    ? "border-warm-border bg-warm-glow text-white"
                    : "border-white/[0.09] bg-white/[0.045] text-text-secondary hover:border-white/[0.16]"
                }`}
              >
                <div className="text-sm font-semibold text-white">{question.questionText}</div>
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

      <Card tone="warm" padding="lg">
        <SectionHeader
          title="Attempt the selected question"
          description="Saving here updates only this public page. No Firestore writes happen."
          action={
            <Button type="button" variant="secondary" onClick={onOpenTutor}>
              Open tutor
            </Button>
          }
        />
        <div className="mt-5 rounded-[1.35rem] border border-white/[0.1] bg-white/[0.055] p-4">
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
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <div className="mb-2 text-sm font-medium text-text-secondary">Self-mark</div>
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
            <div>
              <div className="mb-2 text-sm font-medium text-text-secondary">Confidence</div>
              <div className="grid grid-cols-5 gap-1.5">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => onConfidenceChange(value as 1 | 2 | 3 | 4 | 5)}
                    className={`min-h-[2.75rem] rounded-[1rem] border text-sm font-semibold transition ${
                      confidence === value
                        ? "border-warm-border bg-warm-glow text-warm-accent"
                        : "border-white/[0.1] bg-white/[0.045] text-text-secondary"
                    }`}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <Button type="button" size="lg" onClick={onSaveAttempt}>
            Save local attempt
          </Button>
        </div>
      </Card>
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
}: {
  selectedQuestion: WalkthroughQuestion;
  userAnswer: string;
  workingText: string;
  messages: WalkthroughTutorMessage[];
  busyIntent: WalkthroughTutorIntent | null;
  onTutorIntent: (intent: WalkthroughTutorIntent, prompt: string) => void;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
      <Card padding="lg">
        <SectionHeader
          eyebrow="Contextual tutor"
          title="Attached to the current practice question."
          description="The public tutor can make limited real AI calls, but writes nothing to user data."
        />
        <div className="mt-5 rounded-[1.35rem] border border-white/[0.09] bg-white/[0.045] p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
            Current question
          </div>
          <p className="mt-3 text-sm leading-6 text-white">{selectedQuestion.questionText}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {selectedQuestion.topicIds.map((topicId) => (
              <TopicChip key={topicId} topicId={topicId} />
            ))}
          </div>
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {TUTOR_ACTIONS.map((action) => (
            <Button
              key={action.intent}
              type="button"
              variant={action.variant ?? "secondary"}
              disabled={busyIntent !== null}
              onClick={() => onTutorIntent(action.intent, action.prompt)}
            >
              {busyIntent === action.intent ? "Thinking..." : action.label}
            </Button>
          ))}
        </div>
      </Card>

      <Card tone="warm" padding="lg">
        <SectionHeader
          title="Tutor thread"
          description="Hint-first by default. Full solution requires an explicit click."
        />
        <div className="mt-5 space-y-3">
          {messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={`rounded-[1.25rem] border p-4 ${
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
        <div className="mt-5 rounded-[1.25rem] border border-white/[0.1] bg-white/[0.045] p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
            Current student context
          </div>
          <p className="mt-3 text-sm leading-6 text-text-secondary">
            Answer: {userAnswer || "Not supplied"}
          </p>
          <p className="mt-2 text-sm leading-6 text-text-secondary">
            Working: {workingText || "Not supplied"}
          </p>
        </div>
      </Card>
    </div>
  );
}

function DraftsPanel({
  drafts,
  onUpdateDraft,
  onOpenTutor,
}: {
  drafts: WalkthroughDraft[];
  onUpdateDraft: (draftId: string, field: "front" | "back", value: string) => void;
  onOpenTutor: () => void;
}) {
  return (
    <Card padding="lg">
      <SectionHeader
        eyebrow="Flashcard drafts"
        title="AI-assisted content stays draft until reviewed."
        description="These drafts are editable and local to the public walkthrough."
        action={
          <Button type="button" variant="secondary" onClick={onOpenTutor}>
            Ask tutor to make one
          </Button>
        }
      />
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {drafts.map((draft) => (
          <div
            key={draft.id}
            className="rounded-[1.45rem] border border-white/[0.1] bg-white/[0.05] p-4"
          >
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-warm-border bg-warm-glow px-3 py-1 text-xs font-semibold text-warm-accent">
                Draft
              </span>
              <span className="rounded-full border border-white/[0.1] bg-white/[0.05] px-3 py-1 text-xs text-text-secondary">
                Local-only
              </span>
            </div>
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
            <div className="mt-3 flex flex-wrap gap-2">
              {draft.topicIds.map((topicId) => (
                <TopicChip key={topicId} topicId={topicId} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ProgressPanel({
  topicSummaries,
  recentMistakes,
  questions,
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
}) {
  const questionsById = new Map(questions.map((question) => [question.id, question]));

  return (
    <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
      <Card padding="lg">
        <SectionHeader
          eyebrow="Progress"
          title="Constructive mastery evidence."
          description="This stays narrow: weak topics, weak cards, practice accuracy, recent mistakes, and support level."
        />
        <div className="mt-5 space-y-3">
          {topicSummaries.map((summary) => (
            <div
              key={summary.topic.id}
              className="rounded-[1.35rem] border border-white/[0.09] bg-white/[0.045] p-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-base font-semibold text-white">{summary.topic.name}</div>
                  <div className="mt-1 text-sm text-text-muted">{summary.topic.subject}</div>
                </div>
                <div className="rounded-full border border-warm-border bg-warm-glow px-3 py-1 text-xs font-semibold text-warm-accent">
                  Support level: {summary.supportLevel}
                </div>
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
            </div>
          ))}
        </div>
      </Card>

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
                className="rounded-[1.2rem] border border-white/[0.09] bg-white/[0.05] p-3"
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
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[1rem] border border-white/[0.08] bg-white/[0.045] px-3 py-3">
      <div className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-text-muted">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-white">{value}</div>
    </div>
  );
}
