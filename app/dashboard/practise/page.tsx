"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useUser } from "@/lib/auth/user-context";
import { featureFlags } from "@/lib/app/feature-flags";
import type { Topic } from "@/lib/practice/topics";
import type { Attempt, Question } from "@/lib/practice/questions";
import { getActiveTopics, createTopic } from "@/services/study/topics";
import {
  createAttempt,
  createQuestion,
  getAttempts,
  getActiveQuestions,
} from "@/services/study/practice";
import { createFlashcardDraft } from "@/services/study/generated-content";
import {
  sendPracticeTutorMessage,
  type PracticeTutorIntent,
} from "@/services/ai/practice-tutor";
import AppPage from "@/components/layout/AppPage";
import {
  Button,
  Card,
  EmptyState,
  FeedbackBanner,
  Input,
  PageHero,
  SectionHeader,
  Skeleton,
  StatTile,
  Textarea,
} from "@/components/ui";

type Feedback = { type: "success" | "error"; message: string };
type TutorMessage = { role: "user" | "model"; text: string };

const TUTOR_INTENTS: Array<{ intent: PracticeTutorIntent; label: string; prompt: string }> = [
  { intent: "hint", label: "Hint", prompt: "Give me one hint without revealing the answer." },
  { intent: "check-working", label: "Check working", prompt: "Check my working and point me to the first thing to fix." },
  { intent: "explain-concept", label: "Explain concept", prompt: "Explain the core concept behind this question." },
  { intent: "show-method", label: "Show method", prompt: "Show me the setup or method, but leave a step for me." },
  { intent: "full-solution", label: "Full solution", prompt: "Show the full solution. I know this may reduce independent evidence." },
  { intent: "make-flashcard", label: "Make card", prompt: "Turn the misconception here into one flashcard draft." },
  { intent: "similar-question", label: "Similar question", prompt: "Give me one similar question without a solution." },
];

function getQuestionAttempts(questionId: string, attempts: Attempt[]) {
  return attempts.filter((attempt) => attempt.questionId === questionId);
}

function getAccuracy(attempts: Attempt[]) {
  if (attempts.length === 0) return 0;
  return Math.round((attempts.filter((attempt) => attempt.isCorrect).length / attempts.length) * 100);
}

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes === 0) return `${remainingSeconds}s`;
  return `${minutes}m ${remainingSeconds.toString().padStart(2, "0")}s`;
}

export default function PractisePage() {
  const { user, demoMode } = useUser();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [creatingQuestion, setCreatingQuestion] = useState(false);
  const [savingAttempt, setSavingAttempt] = useState(false);
  const [newTopicName, setNewTopicName] = useState("");
  const [newTopicSubject, setNewTopicSubject] = useState("");
  const [questionText, setQuestionText] = useState("");
  const [answerText, setAnswerText] = useState("");
  const [solutionText, setSolutionText] = useState("");
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
  const [userAnswer, setUserAnswer] = useState("");
  const [workingText, setWorkingText] = useState("");
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [confidence, setConfidence] = useState(3);
  const [mistakeLabelsInput, setMistakeLabelsInput] = useState("");
  const [hintsUsed, setHintsUsed] = useState(0);
  const [tutorUsed, setTutorUsed] = useState(false);
  const [startedAt, setStartedAt] = useState(Date.now());
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [tutorMessages, setTutorMessages] = useState<TutorMessage[]>([]);
  const [tutorThreadId, setTutorThreadId] = useState<string | undefined>();
  const [tutorBusyIntent, setTutorBusyIntent] = useState<PracticeTutorIntent | null>(null);
  const [lastSuggestedFlashcard, setLastSuggestedFlashcard] = useState<{
    front: string;
    back: string;
  } | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedQuestion = useMemo(
    () => questions.find((question) => question.id === selectedQuestionId) ?? questions[0] ?? null,
    [questions, selectedQuestionId]
  );

  const topicsById = useMemo(() => new Map(topics.map((topic) => [topic.id, topic])), [topics]);
  const selectedQuestionTopics = useMemo(
    () => selectedQuestion?.topicIds.map((topicId) => topicsById.get(topicId)).filter((topic): topic is Topic => Boolean(topic)) ?? [],
    [selectedQuestion?.topicIds, topicsById]
  );
  const selectedQuestionAttempts = useMemo(
    () => (selectedQuestion ? getQuestionAttempts(selectedQuestion.id, attempts) : []),
    [attempts, selectedQuestion]
  );
  const totalAccuracy = useMemo(() => getAccuracy(attempts), [attempts]);
  const supportAttempts = useMemo(
    () => attempts.filter((attempt) => attempt.tutorUsed || (attempt.hintsUsed ?? 0) > 0).length,
    [attempts]
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const [nextTopics, nextQuestions, nextAttempts] = await Promise.all([
        getActiveTopics(user.uid),
        getActiveQuestions(user.uid),
        getAttempts(user.uid),
      ]);
      setTopics(nextTopics);
      setQuestions(nextQuestions);
      setAttempts(nextAttempts);
      setSelectedQuestionId((current) =>
        current && nextQuestions.some((question) => question.id === current)
          ? current
          : nextQuestions[0]?.id ?? null
      );
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: "Failed to load Practise." });
    } finally {
      setLoading(false);
    }
  }, [user.uid]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    setStartedAt(Date.now());
    setElapsedSeconds(0);
    setUserAnswer("");
    setWorkingText("");
    setIsCorrect(null);
    setConfidence(3);
    setMistakeLabelsInput("");
    setHintsUsed(0);
    setTutorUsed(false);
    setTutorMessages([]);
    setTutorThreadId(undefined);
    setLastSuggestedFlashcard(null);
  }, [selectedQuestionId]);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.round((Date.now() - startedAt) / 1000)));
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [startedAt]);

  const handleCreateTopic = async () => {
    if (demoMode === "demo-test") {
      setFeedback({ type: "error", message: "Demo mode cannot create topics." });
      return;
    }

    try {
      const topic = await createTopic(user.uid, {
        name: newTopicName,
        subject: newTopicSubject,
      });
      setTopics((current) => [topic, ...current]);
      setSelectedTopicIds((current) => [...current, topic.id]);
      setNewTopicName("");
      setNewTopicSubject("");
      setFeedback({ type: "success", message: "Topic created." });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not create topic.",
      });
    }
  };

  const handleCreateQuestion = async () => {
    if (demoMode === "demo-test") {
      setFeedback({ type: "error", message: "Demo mode cannot create practice questions." });
      return;
    }

    setCreatingQuestion(true);
    try {
      const questionId = await createQuestion(user.uid, {
        questionText,
        answerText,
        solutionText,
        topicIds: selectedTopicIds,
      });
      setQuestionText("");
      setAnswerText("");
      setSolutionText("");
      setSelectedTopicIds([]);
      await loadAll();
      setSelectedQuestionId(questionId);
      setFeedback({ type: "success", message: "Practice question created." });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not create question.",
      });
    } finally {
      setCreatingQuestion(false);
    }
  };

  const handleSaveAttempt = async () => {
    if (!selectedQuestion || isCorrect === null) {
      setFeedback({ type: "error", message: "Choose correct or incorrect before saving." });
      return;
    }

    if (demoMode === "demo-test") {
      setFeedback({ type: "error", message: "Demo mode cannot save practice attempts." });
      return;
    }

    setSavingAttempt(true);
    try {
      await createAttempt(user.uid, selectedQuestion, {
        userAnswer,
        workingText,
        isCorrect,
        confidence,
        timeSpentSeconds: elapsedSeconds,
        hintsUsed,
        tutorUsed,
        mistakeLabels: mistakeLabelsInput
          .split(",")
          .map((label) => label.trim())
          .filter(Boolean),
      });
      await loadAll();
      setFeedback({ type: "success", message: "Attempt saved and mastery evidence recorded." });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not save attempt.",
      });
    } finally {
      setSavingAttempt(false);
    }
  };

  const handleTutorIntent = async (intent: PracticeTutorIntent, prompt: string) => {
    if (!selectedQuestion) return;

    setTutorBusyIntent(intent);
    setTutorUsed(true);
    if (intent === "hint" || intent === "show-method" || intent === "check-working") {
      setHintsUsed((current) => current + 1);
    }
    setTutorMessages((current) => [...current, { role: "user", text: prompt }]);

    try {
      const response = await sendPracticeTutorMessage({
        intent,
        message: prompt,
        threadId: tutorThreadId,
        context: {
          questionId: selectedQuestion.id,
          questionText: selectedQuestion.questionText,
          answerText: selectedQuestion.answerText,
          solutionText: selectedQuestion.solutionText,
          topicNames: selectedQuestionTopics.map((topic) => topic.name),
          userAnswer,
          workingText,
        },
      });
      setTutorThreadId(response.threadId);
      setTutorMessages((current) => [...current, { role: "model", text: response.reply }]);
      setLastSuggestedFlashcard(response.suggestedFlashcard);
    } catch (error) {
      setTutorMessages((current) => [
        ...current,
        {
          role: "model",
          text: error instanceof Error ? error.message : "Tutor could not answer just now.",
        },
      ]);
    } finally {
      setTutorBusyIntent(null);
    }
  };

  const handleSaveFlashcardDraft = async () => {
    if (!selectedQuestion || !lastSuggestedFlashcard) return;

    setSavingDraft(true);
    try {
      await createFlashcardDraft(user.uid, {
        ...lastSuggestedFlashcard,
        topicIds: selectedQuestion.topicIds,
        sourceType: "question",
        sourceId: selectedQuestion.id,
      });
      setLastSuggestedFlashcard(null);
      setFeedback({ type: "success", message: "Flashcard draft saved for review." });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not save flashcard draft.",
      });
    } finally {
      setSavingDraft(false);
    }
  };

  if (!featureFlags.enablePractise) {
    return (
      <AppPage title="Practise" backHref="/dashboard" backLabel="Today">
        <EmptyState
          emoji="Practice"
          eyebrow="Not enabled"
          title="Practise is behind a feature flag."
          description="Enable the Practise flag when you are ready to test the manual question loop."
        />
      </AppPage>
    );
  }

  return (
    <AppPage
      title="Practise"
      backHref="/dashboard"
      backLabel="Today"
      width="3xl"
      contentClassName="space-y-4 sm:space-y-6"
    >
      {feedback ? (
        <FeedbackBanner
          type={feedback.type}
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
        />
      ) : null}

      <PageHero
        eyebrow="Practice tests application"
        title="Manual questions first. Tutor only when there is context."
        description="Create topical questions, attempt them, self-mark honestly, and let Jami turn useful struggle into mastery evidence."
        tone="warm"
        aside={
          <div className="grid min-w-[18rem] grid-cols-3 gap-2 text-center">
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.045] px-3 py-3">
              <div className="text-lg font-medium tabular-nums text-white">{questions.length}</div>
              <div className="mt-1 text-[0.68rem] font-medium uppercase tracking-[0.12em] text-text-muted">Questions</div>
            </div>
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.045] px-3 py-3">
              <div className="text-lg font-medium tabular-nums text-white">{attempts.length}</div>
              <div className="mt-1 text-[0.68rem] font-medium uppercase tracking-[0.12em] text-text-muted">Attempts</div>
            </div>
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.045] px-3 py-3">
              <div className="text-lg font-medium tabular-nums text-white">{totalAccuracy}%</div>
              <div className="mt-1 text-[0.68rem] font-medium uppercase tracking-[0.12em] text-text-muted">Accuracy</div>
            </div>
          </div>
        }
      />

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <StatTile label="Topics" value={topics.length} detail="Structured concepts for mastery." />
            <StatTile label="Support level" value={supportAttempts > attempts.length / 2 && attempts.length > 0 ? "High" : supportAttempts > 0 ? "Medium" : "Low"} detail="Hints and tutor usage, not a judgement." />
            <StatTile label="Hint-to-correct" value={`${getAccuracy(attempts.filter((attempt) => (attempt.hintsUsed ?? 0) > 0 || attempt.tutorUsed))}%`} detail="Correct after support." />
            <StatTile label="Selected timer" value={formatElapsed(elapsedSeconds)} detail="Used as lightweight evidence." />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.2fr)]">
            <div className="space-y-4">
              <Card padding="lg">
                <SectionHeader
                  title="Topics"
                  description="Tags organise content. Topics measure learning."
                />
                <div className="mt-4 grid gap-3">
                  <Input
                    label="New topic"
                    value={newTopicName}
                    onChange={(event) => setNewTopicName(event.target.value)}
                    placeholder="Eigenvalues"
                  />
                  <Input
                    label="Subject"
                    value={newTopicSubject}
                    onChange={(event) => setNewTopicSubject(event.target.value)}
                    placeholder="Linear Algebra"
                  />
                  <Button type="button" variant="secondary" onClick={() => void handleCreateTopic()}>
                    Add topic
                  </Button>
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                  {topics.length > 0 ? (
                    topics.map((topic) => (
                      <button
                        key={topic.id}
                        type="button"
                        onClick={() =>
                          setSelectedTopicIds((current) =>
                            current.includes(topic.id)
                              ? current.filter((topicId) => topicId !== topic.id)
                              : [...current, topic.id]
                          )
                        }
                        className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                          selectedTopicIds.includes(topic.id)
                            ? "border-warm-accent bg-warm-glow text-warm-accent"
                            : "border-white/[0.10] bg-white/[0.05] text-text-secondary hover:border-white/[0.18]"
                        }`}
                      >
                        {topic.name}
                      </button>
                    ))
                  ) : (
                    <p className="text-sm leading-6 text-text-secondary">
                      Create one topic to start building structured practice.
                    </p>
                  )}
                </div>
              </Card>

              <Card padding="lg">
                <SectionHeader
                  title="Create a question"
                  description="Keep this manual for MVP. OCR, mark schemes, and paper extraction come later."
                />
                <div className="mt-4 space-y-3">
                  <Textarea
                    label="Question"
                    value={questionText}
                    onChange={(event) => setQuestionText(event.target.value)}
                    placeholder="Prove that..."
                  />
                  <Textarea
                    label="Answer or checkpoint"
                    rows={3}
                    value={answerText}
                    onChange={(event) => setAnswerText(event.target.value)}
                    placeholder="Optional expected answer."
                  />
                  <Textarea
                    label="Solution notes"
                    rows={3}
                    value={solutionText}
                    onChange={(event) => setSolutionText(event.target.value)}
                    placeholder="Optional method or mark notes."
                  />
                  <Button
                    type="button"
                    disabled={creatingQuestion}
                    onClick={() => void handleCreateQuestion()}
                  >
                    {creatingQuestion ? "Creating..." : "Create question"}
                  </Button>
                </div>
              </Card>

              <Card padding="lg">
                <SectionHeader title="Question bank" description="Topical drill starts here." />
                <div className="mt-4 space-y-2">
                  {questions.length > 0 ? (
                    questions.map((question) => {
                      const questionAttempts = getQuestionAttempts(question.id, attempts);
                      return (
                        <button
                          key={question.id}
                          type="button"
                          onClick={() => setSelectedQuestionId(question.id)}
                          className={`w-full rounded-[1.2rem] border p-3 text-left transition ${
                            selectedQuestion?.id === question.id
                              ? "border-warm-accent bg-warm-glow"
                              : "border-white/[0.09] bg-white/[0.045] hover:border-white/[0.18]"
                          }`}
                        >
                          <div className="line-clamp-2 text-sm font-semibold text-white">
                            {question.questionText}
                          </div>
                          <div className="mt-2 text-xs text-text-muted">
                            {questionAttempts.length} attempt{questionAttempts.length === 1 ? "" : "s"} - {getAccuracy(questionAttempts)}% correct
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <EmptyState
                      variant="plain"
                      emoji="Practice"
                      title="No practice questions yet"
                      description="Create one manual topical question to start the loop."
                    />
                  )}
                </div>
              </Card>
            </div>

            <div className="space-y-4">
              {selectedQuestion ? (
                <>
                  <Card tone="warm" padding="lg">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-text-muted">
                          Topical drill
                        </div>
                        <h2 className="mt-3 whitespace-pre-wrap text-xl font-medium leading-snug text-white sm:text-2xl">
                          {selectedQuestion.questionText}
                        </h2>
                        {selectedQuestionTopics.length > 0 ? (
                          <div className="mt-4 flex flex-wrap gap-2">
                            {selectedQuestionTopics.map((topic) => (
                              <span
                                key={topic.id}
                                className="rounded-full border border-white/[0.12] bg-white/[0.07] px-3 py-1.5 text-xs font-medium text-text-secondary"
                              >
                                {topic.name}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <div className="rounded-[1.2rem] border border-white/[0.10] bg-white/[0.06] px-4 py-3 text-sm text-text-secondary">
                        <span className="font-semibold text-white">{selectedQuestionAttempts.length}</span> attempts
                      </div>
                    </div>
                  </Card>

                  <Card padding="lg">
                    <SectionHeader
                      title="Your attempt"
                      description="Self-marking is enough for MVP. Strong evidence comes from honest attempts, not AI explanations."
                    />
                    <div className="mt-4 space-y-3">
                      <Textarea
                        label="Answer"
                        value={userAnswer}
                        onChange={(event) => setUserAnswer(event.target.value)}
                        placeholder="Write your final answer."
                      />
                      <Textarea
                        label="Working"
                        rows={5}
                        value={workingText}
                        onChange={(event) => setWorkingText(event.target.value)}
                        placeholder="Show the steps you tried."
                      />
                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <div className="mb-2 text-sm font-medium text-text-secondary">Self-mark</div>
                          <div className="grid grid-cols-2 gap-2">
                            <Button
                              type="button"
                              variant={isCorrect === true ? "warm" : "secondary"}
                              onClick={() => setIsCorrect(true)}
                            >
                              Correct
                            </Button>
                            <Button
                              type="button"
                              variant={isCorrect === false ? "danger" : "secondary"}
                              onClick={() => setIsCorrect(false)}
                            >
                              Incorrect
                            </Button>
                          </div>
                        </div>
                        <Input
                          label="Confidence 1-5"
                          type="number"
                          min={1}
                          max={5}
                          value={confidence}
                          onChange={(event) => setConfidence(Number(event.target.value))}
                        />
                      </div>
                      <Input
                        label="Mistake labels"
                        value={mistakeLabelsInput}
                        onChange={(event) => setMistakeLabelsInput(event.target.value)}
                        placeholder="conceptual mix-up, sign error, full solution needed"
                      />
                      <div className="grid gap-3 md:grid-cols-3">
                        <StatTile label="Time" value={formatElapsed(elapsedSeconds)} detail="Current attempt." />
                        <StatTile label="Hints used" value={hintsUsed} detail="Tutor/help steps." />
                        <StatTile label="Tutor used" value={tutorUsed ? "Yes" : "No"} detail="Support level signal." />
                      </div>
                      <Button
                        type="button"
                        size="lg"
                        disabled={savingAttempt}
                        onClick={() => void handleSaveAttempt()}
                      >
                        {savingAttempt ? "Saving..." : "Save attempt"}
                      </Button>
                    </div>
                  </Card>

                  {featureFlags.enableTutorInPractice ? (
                    <Card padding="lg">
                      <SectionHeader
                        title="Contextual tutor"
                        description="Hint-first help attached to this exact question. Full solution is explicit."
                      />
                      <div className="mt-4 flex flex-wrap gap-2">
                        {TUTOR_INTENTS.map((item) => (
                          <Button
                            key={item.intent}
                            type="button"
                            variant={item.intent === "full-solution" ? "danger" : "secondary"}
                            disabled={tutorBusyIntent !== null}
                            onClick={() => void handleTutorIntent(item.intent, item.prompt)}
                          >
                            {tutorBusyIntent === item.intent ? "Thinking..." : item.label}
                          </Button>
                        ))}
                      </div>
                      <div className="mt-5 space-y-3">
                        {tutorMessages.length > 0 ? (
                          tutorMessages.map((message, index) => (
                            <div
                              key={`${message.role}-${index}`}
                              className={`rounded-[1.2rem] border p-4 text-sm leading-6 ${
                                message.role === "user"
                                  ? "border-white/[0.09] bg-white/[0.045] text-text-secondary"
                                  : "border-warm-border bg-warm-glow text-white"
                              }`}
                            >
                              <div className="mb-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-text-muted">
                                {message.role === "user" ? "You" : "Jami Tutor"}
                              </div>
                              <div className="whitespace-pre-wrap">{message.text}</div>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm leading-6 text-text-secondary">
                            Ask for a hint when you are stuck. The tutor will try to move you one step,
                            not replace your attempt.
                          </p>
                        )}
                      </div>
                      {lastSuggestedFlashcard ? (
                        <div className="mt-5 rounded-[1.3rem] border border-white/[0.12] bg-white/[0.06] p-4">
                          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
                            Flashcard draft
                          </div>
                          <div className="mt-3 text-sm text-white">
                            <strong>Front:</strong> {lastSuggestedFlashcard.front}
                          </div>
                          <div className="mt-2 text-sm text-text-secondary">
                            <strong>Back:</strong> {lastSuggestedFlashcard.back}
                          </div>
                          <Button
                            type="button"
                            className="mt-4"
                            disabled={savingDraft}
                            onClick={() => void handleSaveFlashcardDraft()}
                          >
                            {savingDraft ? "Saving..." : "Save editable draft"}
                          </Button>
                        </div>
                      ) : null}
                    </Card>
                  ) : null}

                  <Card padding="lg">
                    <SectionHeader title="Attempt history" description="Recent evidence for this question." />
                    <div className="mt-4 space-y-2">
                      {selectedQuestionAttempts.length > 0 ? (
                        selectedQuestionAttempts.map((attempt) => (
                          <div
                            key={attempt.id}
                            className="rounded-[1.2rem] border border-white/[0.09] bg-white/[0.045] p-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className={attempt.isCorrect ? "text-emerald-100" : "text-rose-100"}>
                                {attempt.isCorrect ? "Correct" : "Incorrect"}
                              </span>
                              <span className="text-xs text-text-muted">
                                Confidence {attempt.confidence} - {attempt.timeSpentSeconds ? formatElapsed(attempt.timeSpentSeconds) : "No timer"}
                              </span>
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
                        ))
                      ) : (
                        <p className="text-sm leading-6 text-text-secondary">
                          Save an attempt to start building evidence.
                        </p>
                      )}
                    </div>
                  </Card>
                </>
              ) : (
                <EmptyState
                  emoji="Practice"
                  title="Create a practice question"
                  description="Practise starts manual and topical so the learning loop can prove itself before documents and OCR arrive."
                  secondaryAction={
                    <Link
                      href="/dashboard/study"
                      className="inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl border border-border bg-white/[0.04] px-4 py-2 text-sm font-medium text-white transition duration-fast hover:border-border-strong hover:bg-white/[0.07]"
                    >
                      Back to Learn
                    </Link>
                  }
                />
              )}
            </div>
          </div>
        </>
      )}
    </AppPage>
  );
}
