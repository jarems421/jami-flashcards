"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { useUser } from "@/lib/auth/user-context";
import { featureFlags } from "@/lib/app/feature-flags";
import type { Topic } from "@/lib/practice/topics";
import type { Attempt, Question } from "@/lib/practice/questions";
import type { Source } from "@/lib/practice/sources";
import { buildTutorContextPacket } from "@/lib/practice/tutor-context";
import type { Notebook } from "@/lib/workspace/notebooks";
import type { PastPaper, PracticeSet } from "@/lib/workspace/practice-sets";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import { getActiveTopics, createTopic } from "@/services/study/topics";
import { getDecks, type Deck } from "@/services/study/decks";
import { getActiveStudyFolders } from "@/services/study/folders";
import { getActiveNotebooks } from "@/services/study/notebooks";
import { getActivePastPapers, getActivePracticeSets } from "@/services/study/practice-work";
import { getActiveSources } from "@/services/study/sources";
import {
  createAttempt,
  createQuestion,
  getAttempts,
  getActiveQuestions,
} from "@/services/study/practice";
import {
  convertFlashcardDraftToCard,
  createFlashcardDraft,
} from "@/services/study/generated-content";
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
  MetricStrip,
  PageHero,
  SectionHeader,
  Skeleton,
  Textarea,
} from "@/components/ui";

type Feedback = { type: "success" | "error"; message: string };
type TutorMessage = { role: "user" | "model"; text: string; intent?: PracticeTutorIntent };

const TUTOR_INTENTS: Array<{
  intent: PracticeTutorIntent;
  label: string;
  prompt: string;
  description: string;
}> = [
  { intent: "hint", label: "Hint", prompt: "Give me one hint without revealing the answer.", description: "One nudge without the answer." },
  { intent: "stuck-here", label: "Stuck here", prompt: "I'm stuck here. Use my current working and give me the next useful step only.", description: "Use the current step and give one next move." },
  { intent: "check-working", label: "Check working", prompt: "Check my working and point me to the first thing to fix.", description: "Check whether your steps are valid." },
  { intent: "explain-concept", label: "Explain concept", prompt: "Explain the core concept behind this question.", description: "Understand the idea behind it." },
  { intent: "show-method", label: "Show method", prompt: "Show me the setup or method, but leave a step for me.", description: "See the general method." },
  { intent: "full-solution", label: "Full solution", prompt: "Show the full solution. I know this may reduce independent evidence.", description: "Reveal the full answer deliberately." },
  { intent: "make-flashcard", label: "Make card", prompt: "Turn the misconception here into one flashcard draft.", description: "Turn this mistake into a draft." },
  { intent: "similar-question", label: "Similar question", prompt: "Give me one similar question without a solution.", description: "Practice the same skill again." },
];

const surfaceCardClass =
  "rounded-[1.2rem] border border-white/[0.09] bg-white/[0.04] p-4 shadow-[0_10px_22px_rgba(4,8,18,0.12)]";

type ScratchpadPoint = { x: number; y: number };
type ScratchpadStroke = { points: ScratchpadPoint[] };

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

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

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

function summarizeSessionNextAction(hasIncorrectAttempt: boolean, draftsCreated: number) {
  if (hasIncorrectAttempt) return "Repair the latest mistake with Tutor, then retry one similar question.";
  if (draftsCreated > 0) return "Review the flashcard draft, then add it to a deck if it is useful.";
  return "Keep the session moving: attempt another question or review Progress.";
}

function PractiseFlowHeader() {
  const steps = ["Choose question", "Attempt", "Mark", "Repair"];

  return (
    <div className="rounded-[1.35rem] border border-white/[0.09] bg-white/[0.035] px-3 py-3 shadow-[0_12px_22px_rgba(4,8,18,0.12)]">
      <div className="flex flex-wrap items-center gap-2">
        {steps.map((step, index) => (
          <div key={step} className="flex items-center gap-2">
            <span className="flex min-h-[2.2rem] items-center gap-2 rounded-full border border-warm-border bg-warm-glow px-3 text-xs font-semibold text-warm-accent">
              <span className="h-2 w-2 rounded-full bg-warm-accent" />
              {step}
            </span>
            {index < steps.length - 1 ? (
              <span className="hidden h-px w-5 bg-white/[0.14] sm:block" />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PractisePage() {
  const { user, demoMode } = useUser();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [folders, setFolders] = useState<StudyFolder[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [practiceSets, setPracticeSets] = useState<PracticeSet[]>([]);
  const [pastPapers, setPastPapers] = useState<PastPaper[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [creatingQuestion, setCreatingQuestion] = useState(false);
  const [savingAttempt, setSavingAttempt] = useState(false);
  const [showAddQuestion, setShowAddQuestion] = useState(false);
  const [showTopicCreator, setShowTopicCreator] = useState(false);
  const [showTutorPanel, setShowTutorPanel] = useState(false);
  const [showAttemptHistory, setShowAttemptHistory] = useState(false);
  const [newTopicName, setNewTopicName] = useState("");
  const [newTopicSubject, setNewTopicSubject] = useState("");
  const [questionText, setQuestionText] = useState("");
  const [answerText, setAnswerText] = useState("");
  const [solutionText, setSolutionText] = useState("");
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
  const [userAnswer, setUserAnswer] = useState("");
  const [workingText, setWorkingText] = useState("");
  const [selectedWorkingText, setSelectedWorkingText] = useState("");
  const [selectedTextNotice, setSelectedTextNotice] = useState("");
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
  const [confirmFullSolution, setConfirmFullSolution] = useState(false);
  const [lastSuggestedFlashcard, setLastSuggestedFlashcard] = useState<{
    front: string;
    back: string;
  } | null>(null);
  const [draftFront, setDraftFront] = useState("");
  const [draftBack, setDraftBack] = useState("");
  const [draftDeckId, setDraftDeckId] = useState("");
  const [savedDraftId, setSavedDraftId] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [addingDraftToDeck, setAddingDraftToDeck] = useState(false);
  const [lastSavedAttemptSnapshot, setLastSavedAttemptSnapshot] = useState<string | null>(null);
  const [lastSavedAttemptResult, setLastSavedAttemptResult] = useState<"correct" | "incorrect" | null>(null);
  const [sessionStartedAt] = useState(Date.now());
  const [sessionAttemptIds, setSessionAttemptIds] = useState<string[]>([]);
  const [sessionTutorUses, setSessionTutorUses] = useState(0);
  const [sessionDraftsCreated, setSessionDraftsCreated] = useState(0);
  const [scratchpadStrokes, setScratchpadStrokes] = useState<ScratchpadStroke[]>([]);
  const [scratchpadNote, setScratchpadNote] = useState("");
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mistakeLabelsInputRef = useRef<HTMLInputElement>(null);
  const workingTextareaRef = useRef<HTMLTextAreaElement>(null);
  const scratchpadCanvasRef = useRef<HTMLCanvasElement>(null);
  const scratchpadDraftStrokeRef = useRef<ScratchpadPoint[] | null>(null);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const selectedQuestion = useMemo(
    () => questions.find((question) => question.id === selectedQuestionId) ?? questions[0] ?? null,
    [questions, selectedQuestionId]
  );

  const topicsById = useMemo(() => new Map(topics.map((topic) => [topic.id, topic])), [topics]);
  const sourcesById = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources]);
  const selectedQuestionTopics = useMemo(
    () => selectedQuestion?.topicIds.map((topicId) => topicsById.get(topicId)).filter((topic): topic is Topic => Boolean(topic)) ?? [],
    [selectedQuestion?.topicIds, topicsById]
  );
  const selectedQuestionSources = useMemo(
    () => selectedQuestion?.sourceIds?.map((sourceId) => sourcesById.get(sourceId)).filter((source): source is Source => Boolean(source)) ?? [],
    [selectedQuestion?.sourceIds, sourcesById]
  );
  const selectedQuestionAttempts = useMemo(
    () => (selectedQuestion ? getQuestionAttempts(selectedQuestion.id, attempts) : []),
    [attempts, selectedQuestion]
  );
  const sessionAttempts = useMemo(
    () => attempts.filter((attempt) => sessionAttemptIds.includes(attempt.id)),
    [attempts, sessionAttemptIds]
  );
  const sessionCorrectAttempts = useMemo(
    () => sessionAttempts.filter((attempt) => attempt.isCorrect).length,
    [sessionAttempts]
  );
  const sessionWeakestTopic = useMemo(() => {
    const topicCounts = new Map<string, number>();
    sessionAttempts
      .filter((attempt) => !attempt.isCorrect)
      .forEach((attempt) => {
        const question = questions.find((item) => item.id === attempt.questionId);
        question?.topicIds.forEach((topicId) => {
          topicCounts.set(topicId, (topicCounts.get(topicId) ?? 0) + 1);
        });
      });
    const weakestTopicId = [...topicCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return weakestTopicId ? topicsById.get(weakestTopicId)?.name : undefined;
  }, [questions, sessionAttempts, topicsById]);
  const hasSessionActivity =
    sessionAttempts.length > 0 || sessionTutorUses > 0 || sessionDraftsCreated > 0;
  const sessionNextAction = summarizeSessionNextAction(
    sessionAttempts.some((attempt) => !attempt.isCorrect),
    sessionDraftsCreated
  );
  const totalAccuracy = useMemo(() => getAccuracy(attempts), [attempts]);
  const folderSummaries = useMemo(
    () =>
      folders.slice(0, 4).map((folder) => {
        const questionCount = questions.filter(
          (question) =>
            question.folderIds.includes(folder.id) ||
            question.topicIds.some((topicId) => folder.topicIds.includes(topicId))
        ).length;
        const deckCount = decks.filter((deck) => deck.folderIds.includes(folder.id)).length;
        const notebookCount = notebooks.filter((notebook) => notebook.folderId === folder.id).length;
        const practiceSetCount = practiceSets.filter(
          (practiceSet) => practiceSet.folderId === folder.id
        ).length;
        const pastPaperCount = pastPapers.filter((paper) => paper.folderId === folder.id).length;
        return { folder, questionCount, deckCount, notebookCount, practiceSetCount, pastPaperCount };
      }),
    [decks, folders, notebooks, pastPapers, practiceSets, questions]
  );
  const recentNotebooks = useMemo(
    () => [...notebooks].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 3),
    [notebooks]
  );
  const supportAttempts = useMemo(
    () => attempts.filter((attempt) => attempt.tutorUsed || (attempt.hintsUsed ?? 0) > 0).length,
    [attempts]
  );
  const currentAttemptSnapshot = useMemo(
    () =>
      JSON.stringify({
        userAnswer: userAnswer.trim(),
        workingText: workingText.trim(),
        isCorrect,
        confidence,
        mistakeLabelsInput: mistakeLabelsInput.trim(),
      }),
    [confidence, isCorrect, mistakeLabelsInput, userAnswer, workingText]
  );
  const hasAttemptContent =
    userAnswer.trim().length > 0 ||
    workingText.trim().length > 0 ||
    isCorrect !== null ||
    confidence !== 3 ||
    mistakeLabelsInput.trim().length > 0;
  const hasUnsavedAttemptDraft =
    hasAttemptContent && currentAttemptSnapshot !== lastSavedAttemptSnapshot;

  const loadAll = useCallback(async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const [
        nextTopics,
        nextDecks,
        nextQuestions,
        nextAttempts,
        nextSources,
        nextFolders,
        nextNotebooks,
        nextPracticeSets,
        nextPastPapers,
      ] = await Promise.all([
        getActiveTopics(user.uid),
        getDecks(user.uid),
        getActiveQuestions(user.uid),
        getAttempts(user.uid),
        getActiveSources(user.uid).catch(() => [] as Source[]),
        getActiveStudyFolders(user.uid).catch(() => [] as StudyFolder[]),
        getActiveNotebooks(user.uid).catch(() => [] as Notebook[]),
        getActivePracticeSets(user.uid).catch(() => [] as PracticeSet[]),
        getActivePastPapers(user.uid).catch(() => [] as PastPaper[]),
      ]);
      setTopics(nextTopics);
      setDecks(nextDecks);
      setQuestions(nextQuestions);
      setAttempts(nextAttempts);
      setSources(nextSources);
      setFolders(nextFolders);
      setNotebooks(nextNotebooks);
      setPracticeSets(nextPracticeSets);
      setPastPapers(nextPastPapers);
      const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
      const targetQuestionId = params?.get("question")?.trim() ?? "";
      const targetTopicId = params?.get("topic")?.trim() ?? "";
      const queryQuestion = targetQuestionId
        ? nextQuestions.find((question) => question.id === targetQuestionId)
        : undefined;
      const queryTopicQuestion =
        !queryQuestion && targetTopicId
          ? nextQuestions.find((question) => question.topicIds.includes(targetTopicId))
          : undefined;
      const validTargetTopic = targetTopicId && nextTopics.some((topic) => topic.id === targetTopicId);
      setSelectedQuestionId((current) =>
        queryQuestion?.id ??
        queryTopicQuestion?.id ??
        (current && nextQuestions.some((question) => question.id === current)
          ? current
          : nextQuestions[0]?.id ?? null)
      );
      if (validTargetTopic) {
        setSelectedTopicIds([targetTopicId]);
      }
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: "Failed to load Practice." });
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
    setSelectedWorkingText("");
    setSelectedTextNotice("");
    setIsCorrect(null);
    setConfidence(3);
    setMistakeLabelsInput("");
    setHintsUsed(0);
    setTutorUsed(false);
    setTutorMessages([]);
    setTutorThreadId(undefined);
    setConfirmFullSolution(false);
    setLastSuggestedFlashcard(null);
    setDraftFront("");
    setDraftBack("");
    setSavedDraftId(null);
    setLastSavedAttemptSnapshot(null);
    setLastSavedAttemptResult(null);
    setShowTutorPanel(false);
    setShowAttemptHistory(false);
    setScratchpadStrokes([]);
    setScratchpadNote("");
    setVoiceTranscript("");
    setVoiceError("");
  }, [selectedQuestionId]);

  useEffect(() => {
    if (!draftDeckId && decks[0]?.id) {
      setDraftDeckId(decks[0].id);
    }
  }, [decks, draftDeckId]);

  useEffect(() => {
    if (isCorrect === false) {
      mistakeLabelsInputRef.current?.focus();
    }
  }, [isCorrect]);

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

  const handleSelectQuestion = (questionId: string) => {
    if (questionId === selectedQuestionId) return;
    if (
      hasUnsavedAttemptDraft &&
      !window.confirm("Switch questions? Your unsaved attempt will be cleared.")
    ) {
      return;
    }
    setSelectedQuestionId(questionId);
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
      setShowAddQuestion(false);
      setFeedback({
        type: "success",
        message: "Question created. Attempt it below to start building Progress evidence.",
      });
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
    const savedSnapshot = currentAttemptSnapshot;
    const savedResult = isCorrect ? "correct" : "incorrect";
    try {
      const attemptId = await createAttempt(user.uid, selectedQuestion, {
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
      setSessionAttemptIds((current) => (current.includes(attemptId) ? current : [...current, attemptId]));
      await loadAll();
      setLastSavedAttemptSnapshot(savedSnapshot);
      setLastSavedAttemptResult(savedResult);
      setShowAttemptHistory(true);
      setFeedback({
        type: "success",
        message: "Attempt saved. Progress updated. Tutor now has this attempt as context.",
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not save attempt.",
      });
    } finally {
      setSavingAttempt(false);
    }
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

  const handleAskAboutSelectedText = () => {
    const selected = selectedWorkingText.trim();
    if (!selected) {
      setSelectedTextNotice("Highlight text in the Working box first, then ask about selected text.");
      return;
    }
    setSelectedTextNotice(`Tutor will focus on selected text: "${selected}"`);
    void handleTutorIntent(
      "stuck-here",
      `Ask about the selected working text: "${selected}". Explain the next step only.`,
      { selectedWorkingText: selected }
    );
  };

  const redrawScratchpad = useCallback(() => {
    const canvas = scratchpadCanvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
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
    setVoiceSupported(Boolean(getSpeechRecognitionConstructor()));
    return () => {
      speechRecognitionRef.current?.stop();
    };
  }, []);

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

  const handleStartVoiceMessage = () => {
    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) {
      setVoiceError("Voice input is not supported in this browser. Type the message instead.");
      return;
    }

    setVoiceError("");
    setVoiceTranscript("");
    const recognition = new Recognition();
    recognition.lang = "en-GB";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .trim();
      setVoiceTranscript(transcript);
    };
    recognition.onerror = (event) => {
      setVoiceError(event.error ? `Voice input stopped: ${event.error}` : "Voice input stopped.");
      setVoiceListening(false);
    };
    recognition.onend = () => setVoiceListening(false);
    speechRecognitionRef.current = recognition;
    setVoiceListening(true);
    recognition.start();
  };

  const handleStopVoiceMessage = () => {
    speechRecognitionRef.current?.stop();
    setVoiceListening(false);
  };

  const handleTutorIntent = async (
    intent: PracticeTutorIntent,
    prompt: string,
    options?: { selectedWorkingText?: string; scratchpadNote?: string; voiceTranscript?: string }
  ) => {
    if (!selectedQuestion) return;

    const scratchpadContextNote = options?.scratchpadNote ?? scratchpadNote;
    const displayedPrompt = options?.selectedWorkingText
      ? `${options.voiceTranscript ?? prompt}\n\nYou selected: "${options.selectedWorkingText}"`
      : options?.voiceTranscript ?? prompt;
    const packet = buildTutorContextPacket({
      question: selectedQuestion,
      topics,
      sources,
      attempts,
      tutorMessages,
      intent,
      typedAnswer: userAnswer,
      typedWorking: workingText,
      selectedWorkingText: options?.selectedWorkingText,
      scratchpad: {
        hasDrawing: scratchpadStrokes.length > 0,
        strokeCount: scratchpadStrokes.length,
        note: scratchpadContextNote,
      },
      confidence,
      mistakeLabels: mistakeLabelsInput,
    });

    setShowTutorPanel(true);
    setTutorBusyIntent(intent);
    setTutorUsed(true);
    setSessionTutorUses((current) => current + 1);
    if (intent === "hint" || intent === "show-method" || intent === "check-working" || intent === "stuck-here") {
      setHintsUsed((current) => current + 1);
    }
    setTutorMessages((current) => [...current, { role: "user", text: displayedPrompt, intent }]);

    try {
      const response = await sendPracticeTutorMessage({
        intent,
        message: displayedPrompt,
        threadId: tutorThreadId,
        contextPacket: packet,
      });
      setTutorThreadId(response.threadId);
      setTutorMessages((current) => [...current, { role: "model", text: response.reply, intent }]);
      setLastSuggestedFlashcard(response.suggestedFlashcard);
      if (response.suggestedFlashcard) {
        setDraftFront(response.suggestedFlashcard.front);
        setDraftBack(response.suggestedFlashcard.back);
        setSavedDraftId(null);
        setDraftDeckId((current) => current || (decks[0]?.id ?? ""));
      }
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

  const handleTutorShortcut = (intent: PracticeTutorIntent) => {
    const tutorAction = TUTOR_INTENTS.find((item) => item.intent === intent);
    if (!tutorAction) return;
    setShowTutorPanel(true);
    if (intent === "full-solution" && !confirmFullSolution) {
      setConfirmFullSolution(true);
      return;
    }
    setConfirmFullSolution(false);
    void handleTutorIntent(tutorAction.intent, tutorAction.prompt);
  };

  const handleSaveFlashcardDraft = async () => {
    if (!selectedQuestion || !lastSuggestedFlashcard) return;

    setSavingDraft(true);
    try {
      const draftId = await createFlashcardDraft(user.uid, {
        front: draftFront,
        back: draftBack,
        topicIds: selectedQuestion.topicIds,
        sourceType: "question",
        sourceId: selectedQuestion.id,
      });
      if (!savedDraftId) {
        setSessionDraftsCreated((current) => current + 1);
      }
      setSavedDraftId(draftId);
      setFeedback({
        type: "success",
        message: "Draft saved. Review it in Progress -> Flashcard Drafts.",
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not save flashcard draft.",
      });
    } finally {
      setSavingDraft(false);
    }
  };

  const handleAddFlashcardDraftToDeck = async () => {
    if (!selectedQuestion || !lastSuggestedFlashcard) return;
    if (!draftDeckId) {
      setFeedback({ type: "error", message: "Choose a destination deck first." });
      return;
    }

    setAddingDraftToDeck(true);
    try {
      let draftId = savedDraftId;
      if (!draftId) {
        draftId = await createFlashcardDraft(user.uid, {
          front: draftFront,
          back: draftBack,
          topicIds: selectedQuestion.topicIds,
          sourceType: "question",
          sourceId: selectedQuestion.id,
        });
        setSessionDraftsCreated((current) => current + 1);
      }
      await convertFlashcardDraftToCard(user.uid, {
        draftId,
        deckId: draftDeckId,
      });
      const deckName = decks.find((deck) => deck.id === draftDeckId)?.name ?? "your deck";
      setLastSuggestedFlashcard(null);
      setDraftFront("");
      setDraftBack("");
      setSavedDraftId(null);
      setFeedback({
        type: "success",
        message: `Card added to ${deckName}. You can review it in Learn.`,
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not add draft to deck.",
      });
    } finally {
      setAddingDraftToDeck(false);
    }
  };

  if (!featureFlags.enablePractise) {
    return (
      <AppPage title="Practice" backHref="/dashboard" backLabel="Today">
        <EmptyState
          emoji="Practice"
          eyebrow="Not enabled"
          title="Practice is behind a feature flag."
          description="Enable the Practice flag when you are ready to test the manual question loop."
        />
      </AppPage>
    );
  }

  const tutorPanelOpen =
    showTutorPanel ||
    tutorMessages.length > 0 ||
    lastSuggestedFlashcard !== null ||
    confirmFullSolution ||
    tutorBusyIntent !== null;

  return (
    <AppPage
      title="Practice"
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
        eyebrow="Practice"
        title="Start from a study space, then work naturally."
        description="Folders and notebooks are becoming the main workspace. The question bank remains here while the notebook flow becomes stable."
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
          <MetricStrip
            items={[
              { label: "Topics", value: topics.length },
              {
                label: "Support level",
                value: supportAttempts > attempts.length / 2 && attempts.length > 0 ? "High" : supportAttempts > 0 ? "Medium" : "Low",
                tone: "warm",
              },
              {
                label: "Hint-to-correct",
                value: `${getAccuracy(attempts.filter((attempt) => (attempt.hintsUsed ?? 0) > 0 || attempt.tutorUsed))}%`,
                tone: "good",
              },
              { label: "Timer", value: formatElapsed(elapsedSeconds) },
            ]}
          />
          <PractiseFlowHeader />
          <Card padding="lg">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <SectionHeader
                eyebrow="Practice workspace"
                title="Open a folder or continue a notebook."
                description="The new direction is folder-first: decks, sources, notebooks and practice work sit together inside a study space. The question bank below stays as a supporting tool while notebooks mature."
              />
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/dashboard/folders"
                  className="inline-flex min-h-[2.75rem] items-center justify-center rounded-full border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-4 py-2 text-sm font-medium text-[var(--button-secondary-text)] shadow-[var(--button-secondary-shadow)] transition hover:-translate-y-[1px]"
                >
                  Open folders
                </Link>
                <Button type="button" variant="secondary" onClick={() => setShowAddQuestion(true)}>
                  Add question
                </Button>
              </div>
            </div>

            <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
              <div>
                <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
                  Study folders
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {folderSummaries.length > 0 ? (
                    folderSummaries.map(
                      ({ folder, questionCount, deckCount, notebookCount, practiceSetCount, pastPaperCount }) => (
                      <Link
                        key={folder.id}
                        href={`/dashboard/folders/${folder.id}`}
                        className="rounded-[1.15rem] border border-white/[0.09] bg-white/[0.04] p-4 transition duration-fast hover:-translate-y-0.5 hover:border-warm-border hover:bg-white/[0.065]"
                      >
                        <div className="text-sm font-semibold text-white">{folder.name}</div>
                        <p className="mt-1 line-clamp-2 text-sm leading-6 text-text-secondary">
                          {folder.description ?? "Open the study space for related work."}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className="rounded-full border border-white/[0.1] bg-white/[0.05] px-2.5 py-1 text-[0.68rem] text-text-muted">
                            {notebookCount} notebook{notebookCount === 1 ? "" : "s"}
                          </span>
                          <span className="rounded-full border border-white/[0.1] bg-white/[0.05] px-2.5 py-1 text-[0.68rem] text-text-muted">
                            {questionCount} question{questionCount === 1 ? "" : "s"}
                          </span>
                          <span className="rounded-full border border-white/[0.1] bg-white/[0.05] px-2.5 py-1 text-[0.68rem] text-text-muted">
                            {deckCount} deck{deckCount === 1 ? "" : "s"}
                          </span>
                          <span className="rounded-full border border-white/[0.1] bg-white/[0.05] px-2.5 py-1 text-[0.68rem] text-text-muted">
                            {practiceSetCount + pastPaperCount} set{practiceSetCount + pastPaperCount === 1 ? "" : "s"}
                          </span>
                        </div>
                      </Link>
                    ))
                  ) : (
                    <div className="rounded-[1.15rem] border border-white/[0.09] bg-white/[0.035] p-4 text-sm leading-6 text-text-secondary md:col-span-2">
                      No folders yet. Create a study folder such as Linear Algebra, then keep
                      notebooks, decks, sources and practice work together there.
                    </div>
                  )}
                </div>
              </div>

              <div>
                <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
                  Continue notebooks
                </div>
                <div className="space-y-3">
                  {recentNotebooks.length > 0 ? (
                    recentNotebooks.map((notebook) => (
                      <Link
                        key={notebook.id}
                        href={`/dashboard/notebooks/${notebook.id}`}
                        className="block rounded-[1.15rem] border border-white/[0.09] bg-white/[0.04] p-4 transition duration-fast hover:-translate-y-0.5 hover:border-warm-border hover:bg-white/[0.065]"
                      >
                        <div className="text-sm font-semibold text-white">{notebook.title}</div>
                        <div className="mt-1 text-xs text-text-muted">
                          {notebook.type.replace("_", " ")}
                        </div>
                      </Link>
                    ))
                  ) : (
                    <div className="rounded-[1.15rem] border border-white/[0.09] bg-white/[0.035] p-4 text-sm leading-6 text-text-secondary">
                      Notebooks appear here once you create them inside a folder.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Card>
          {hasSessionActivity ? (
            <Card padding="md" className="border-warm-border bg-warm-glow">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
                    Practice session summary
                  </div>
                  <div className="mt-1 text-lg font-semibold text-white">
                    {sessionAttempts.length} attempted / {sessionCorrectAttempts} correct / {sessionTutorUses} Tutor use{sessionTutorUses === 1 ? "" : "s"} / {sessionDraftsCreated} draft{sessionDraftsCreated === 1 ? "" : "s"}
                  </div>
                  <p className="mt-1 text-sm leading-6 text-text-secondary">
                    Jami keeps the current session visible once you have attempted, used Tutor, or made a draft.
                  </p>
                </div>
                <span className="rounded-full border border-white/[0.12] bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-text-secondary">
                  Started {formatElapsed(Math.max(0, Math.round((Date.now() - sessionStartedAt) / 1000)))} ago
                </span>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                  <div className="rounded-[1rem] border border-white/[0.1] bg-white/[0.05] p-3">
                    <div className="text-xs text-text-muted">Attempts</div>
                    <div className="mt-1 text-xl font-semibold text-white">{sessionAttempts.length}</div>
                  </div>
                  <div className="rounded-[1rem] border border-white/[0.1] bg-white/[0.05] p-3">
                    <div className="text-xs text-text-muted">Correct</div>
                    <div className="mt-1 text-xl font-semibold text-white">{sessionCorrectAttempts}</div>
                  </div>
                  <div className="rounded-[1rem] border border-white/[0.1] bg-white/[0.05] p-3">
                    <div className="text-xs text-text-muted">Tutor uses</div>
                    <div className="mt-1 text-xl font-semibold text-white">{sessionTutorUses}</div>
                  </div>
                  <div className="rounded-[1rem] border border-white/[0.1] bg-white/[0.05] p-3">
                    <div className="text-xs text-text-muted">Drafts made</div>
                    <div className="mt-1 text-xl font-semibold text-white">{sessionDraftsCreated}</div>
                  </div>
                  <div className="rounded-[1rem] border border-white/[0.1] bg-white/[0.05] p-3">
                    <div className="text-xs text-text-muted">Weakest topic</div>
                    <div className="mt-1 text-sm font-semibold text-white">{sessionWeakestTopic ?? "None yet"}</div>
                  </div>
                  <div className="rounded-[1rem] border border-white/[0.1] bg-white/[0.05] p-3 md:col-span-3 xl:col-span-1">
                    <div className="text-xs text-text-muted">Next action</div>
                    <div className="mt-1 text-sm font-semibold text-white">{sessionNextAction}</div>
                  </div>
                </div>
            </Card>
          ) : null}
          {showAddQuestion ? (
            <div className="fixed inset-0 z-50 flex items-end justify-center px-4 py-5 sm:items-center">
              <button
                type="button"
                aria-label="Close add question"
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={() => setShowAddQuestion(false)}
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="add-practice-question-title"
                className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[1.6rem] border border-white/[0.12] bg-surface-panel-strong p-5 shadow-[0_24px_70px_rgba(0,0,0,0.42)]"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
                      Add question
                    </div>
                    <h2 id="add-practice-question-title" className="mt-2 text-xl font-semibold text-white">
                      Add one practice question.
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-text-secondary">
                      Add the question, optional checkpoint, method notes, and any topic links. Then
                      you&apos;ll return to the Practice workspace.
                    </p>
                  </div>
                  <Button type="button" variant="secondary" onClick={() => setShowAddQuestion(false)}>
                    Close
                  </Button>
                </div>

                <div className="mt-5 rounded-[1.1rem] border border-white/[0.08] bg-white/[0.035] p-3 text-sm leading-6 text-text-secondary">
                  <span className="font-semibold text-white">Example:</span> Question: Solve x^2 -
                  5x + 6 = 0. Expected answer: x = 2 or x = 3. Solution notes: Factorise into
                  (x - 2)(x - 3).
                </div>

                <div className="mt-5 space-y-3">
                  <Textarea
                    label="Question"
                    value={questionText}
                    onChange={(event) => setQuestionText(event.target.value)}
                    placeholder="Write the question you want to practice."
                  />
                  <Textarea
                    label="Expected answer / checkpoint"
                    rows={3}
                    value={answerText}
                    onChange={(event) => setAnswerText(event.target.value)}
                    placeholder="Optional. Add the answer or mark-scheme idea."
                  />
                  <Textarea
                    label="Solution notes"
                    rows={3}
                    value={solutionText}
                    onChange={(event) => setSolutionText(event.target.value)}
                    placeholder="Optional. Add method notes for yourself or Tutor."
                  />

                  <div>
                    <div className="mb-2 text-sm font-medium text-text-secondary">Topic</div>
                    <div className="flex flex-wrap gap-2">
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
                        <span className="text-sm text-text-muted">
                          No topics yet. You can add one from the question bank.
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 pt-2 sm:flex-row">
                    <Button
                      type="button"
                      disabled={creatingQuestion || !questionText.trim()}
                      onClick={() => void handleCreateQuestion()}
                    >
                      {creatingQuestion ? "Creating..." : "Create question"}
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => setShowAddQuestion(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 2xl:grid-cols-[minmax(280px,0.72fr)_minmax(0,1.25fr)_minmax(280px,0.78fr)]">
            <Card padding="lg" className="2xl:sticky 2xl:top-4 2xl:self-start">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between 2xl:flex-col">
                <SectionHeader
                  title="Question bank"
                  description="Choose one question, attempt it, then repair what happened."
                />
                <Button
                  type="button"
                  variant={showAddQuestion ? "warm" : "secondary"}
                  onClick={() => setShowAddQuestion(true)}
                >
                  + Add question
                </Button>
              </div>

              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => setShowTopicCreator((value) => !value)}
                  className="text-xs font-semibold text-text-muted transition hover:text-white"
                  aria-expanded={showTopicCreator}
                >
                  {showTopicCreator ? "Hide topic creator" : "+ Add topic"}
                </button>
                {showTopicCreator ? (
                  <div className="mt-3 grid gap-3 rounded-[1.1rem] border border-white/[0.08] bg-white/[0.035] p-3">
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
                ) : null}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {topics.length > 0 ? (
                  topics.map((topic) => (
                    <span
                      key={topic.id}
                      className="rounded-full border border-white/[0.10] bg-white/[0.05] px-3 py-1.5 text-xs font-medium text-text-secondary"
                    >
                      {topic.name}
                    </span>
                  ))
                ) : (
                  <p className="text-sm leading-6 text-text-secondary">
                    Add topics when you want practice and cards to share a learning concept.
                  </p>
                )}
              </div>

              <div className="mt-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-white">Questions</div>
                  <span className="text-xs text-text-muted">{questions.length} total</span>
                </div>
                <div className="max-h-[34rem] space-y-2 overflow-y-auto pr-1">
                  {questions.length > 0 ? (
                    questions.map((question) => {
                      const questionAttempts = getQuestionAttempts(question.id, attempts);
                      const source = question.sourceIds?.[0] ? sourcesById.get(question.sourceIds[0]) : undefined;
                      return (
                        <button
                          key={question.id}
                          type="button"
                          onClick={() => handleSelectQuestion(question.id)}
                          className={`w-full min-w-0 rounded-[1.2rem] border p-3 text-left shadow-[0_10px_22px_rgba(4,8,18,0.12)] transition ${
                            selectedQuestion?.id === question.id
                              ? "border-warm-border bg-warm-glow"
                              : "border-white/[0.09] bg-white/[0.04] hover:border-white/[0.18] hover:bg-white/[0.065]"
                          }`}
                        >
                          <div className="line-clamp-2 text-sm font-semibold text-white">
                            {question.questionText}
                          </div>
                          <div className="mt-2 text-xs text-text-muted">
                            {questionAttempts.length} attempt{questionAttempts.length === 1 ? "" : "s"} - {getAccuracy(questionAttempts)}% correct
                          </div>
                          {source ? (
                            <div className="mt-2 rounded-full border border-white/[0.1] bg-white/[0.05] px-2.5 py-1 text-[0.68rem] text-text-secondary">
                              Source: {source.title}
                            </div>
                          ) : null}
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
              </div>
            </Card>

            <div className="min-w-0 space-y-4">
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
                        {selectedQuestionSources.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {selectedQuestionSources.map((source) => (
                              <Link
                                key={source.id}
                                href="/dashboard/library"
                                className="rounded-full border border-warm-border bg-warm-glow px-3 py-1.5 text-xs font-semibold text-warm-accent transition hover:bg-white/[0.08]"
                              >
                                Source: {source.title}
                              </Link>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <div className="rounded-[1.2rem] border border-white/[0.10] bg-white/[0.04] px-4 py-3 text-sm text-text-secondary">
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
                        ref={workingTextareaRef}
                        value={workingText}
                        onChange={(event) => {
                          setWorkingText(event.target.value);
                          setSelectedWorkingText("");
                          setSelectedTextNotice("");
                        }}
                        onSelect={updateSelectedWorkingText}
                        onKeyUp={updateSelectedWorkingText}
                        onMouseUp={updateSelectedWorkingText}
                        placeholder="Show the steps you tried."
                      />
                      <div className="rounded-[1.2rem] border border-warm-border bg-warm-glow p-3">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                          <div>
                            <div className="text-sm font-semibold text-white">
                              Tutor uses this question and working when you ask.
                            </div>
                            <p className="mt-1 text-xs leading-5 text-text-secondary">
                              Nothing is sent until you click a Tutor action. Unsaved working is used for the reply, not saved as an attempt.
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={tutorBusyIntent !== null}
                              onClick={() =>
                                void handleTutorIntent(
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
                              disabled={tutorBusyIntent !== null || !workingText.trim()}
                              onClick={() =>
                                void handleTutorIntent(
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
                              disabled={tutorBusyIntent !== null}
                              title={selectedWorkingText ? selectedWorkingText : "Highlight text in Working first"}
                              onClick={handleAskAboutSelectedText}
                            >
                              Ask about selected text
                            </Button>
                          </div>
                        </div>
                        {selectedTextNotice ? (
                          <p className="mt-3 rounded-[1rem] border border-white/[0.1] bg-white/[0.05] px-3 py-2 text-xs leading-5 text-text-secondary">
                            {selectedTextNotice}
                          </p>
                        ) : null}
                      </div>
                      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.8fr)]">
                        <div className="rounded-[1.25rem] border border-white/[0.09] bg-white/[0.035] p-3">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <div className="text-sm font-semibold text-white">Scratchpad</div>
                              <p className="mt-1 text-xs leading-5 text-text-secondary">
                                Draw locally while you work. Tutor only gets a text note about this pad when you ask.
                              </p>
                            </div>
                            <span className="rounded-full border border-white/[0.10] bg-white/[0.05] px-2.5 py-1 text-xs text-text-muted">
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
                              disabled={tutorBusyIntent !== null || (scratchpadStrokes.length === 0 && !scratchpadNote.trim())}
                              onClick={() =>
                                void handleTutorIntent(
                                  "stuck-here",
                                  "Ask about my scratchpad and current working. Use the typed scratchpad note if the drawing itself is not available.",
                                  { scratchpadNote }
                                )
                              }
                            >
                              Ask about scratchpad
                            </Button>
                          </div>
                        </div>

                        <div className="rounded-[1.25rem] border border-white/[0.09] bg-white/[0.035] p-3">
                          <div className="text-sm font-semibold text-white">Voice message</div>
                          <p className="mt-1 text-xs leading-5 text-text-secondary">
                            Push-to-talk sends the transcript with this question and working. It is not always listening.
                          </p>
                          <Textarea
                            label="Scratchpad note / voice transcript"
                            rows={4}
                            value={voiceTranscript || scratchpadNote}
                            onChange={(event) => {
                              setScratchpadNote(event.target.value);
                              setVoiceTranscript("");
                            }}
                            placeholder="Optional: explain the part of the drawing or step you want Tutor to use."
                            containerClassName="mt-3"
                          />
                          {voiceError ? (
                            <p className="mt-2 text-xs leading-5 text-rose-100">{voiceError}</p>
                          ) : null}
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              type="button"
                              variant={voiceListening ? "danger" : "secondary"}
                              disabled={!voiceSupported}
                              onClick={voiceListening ? handleStopVoiceMessage : handleStartVoiceMessage}
                            >
                              {voiceListening ? "Stop recording" : "Record voice"}
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={tutorBusyIntent !== null || !(voiceTranscript.trim() || scratchpadNote.trim())}
                              onClick={() => {
                                const transcript = (voiceTranscript || scratchpadNote).trim();
                                if (!transcript) return;
                                void handleTutorIntent("stuck-here", transcript, {
                                  selectedWorkingText,
                                  scratchpadNote,
                                  voiceTranscript: transcript,
                                });
                              }}
                            >
                              Send to Tutor
                            </Button>
                          </div>
                          {!voiceSupported ? (
                            <p className="mt-2 text-xs leading-5 text-text-muted">
                              Voice input depends on browser support. You can type the same message here.
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <div className="rounded-[1.25rem] border border-white/[0.09] bg-white/[0.04] p-3">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="text-sm font-semibold text-white">How did your attempt go?</div>
                            <div className="mt-0.5 text-xs text-text-muted">
                              Mark the outcome, then add confidence and repair labels.
                            </div>
                          </div>
                          <div className="rounded-full border border-white/[0.1] bg-white/[0.055] px-2.5 py-1 text-xs font-medium text-text-secondary">
                            {formatElapsed(elapsedSeconds)}
                          </div>
                        </div>
                        <div className="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                          <div>
                            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">Self-mark</div>
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
                          label="How confident were you? 1 = guessed, 5 = fully confident"
                          type="number"
                          min={1}
                          max={5}
                          value={confidence}
                          onChange={(event) => setConfidence(Number(event.target.value))}
                        />
                      </div>
                      </div>
                      <Input
                        ref={mistakeLabelsInputRef}
                        label="What went wrong?"
                        value={mistakeLabelsInput}
                        onChange={(event) => setMistakeLabelsInput(event.target.value)}
                        placeholder="sign error, forgot formula, misunderstood question"
                      />
                      {isCorrect === false ? (
                        <p className="rounded-[1rem] border border-warm-border bg-warm-glow px-3 py-2 text-sm text-warm-accent">
                          Add a short mistake label so Jami knows what to repair.
                        </p>
                      ) : null}
                      <MetricStrip
                        items={[
                          { label: "Hints used", value: hintsUsed, tone: hintsUsed > 0 ? "warm" : "default" },
                          { label: "Tutor used", value: tutorUsed ? "Yes" : "No", tone: tutorUsed ? "warm" : "default" },
                          { label: "Evidence", value: isCorrect === null ? "Pending" : isCorrect ? "Correct" : "Repair", tone: isCorrect === true ? "good" : isCorrect === false ? "danger" : "default" },
                        ]}
                      />
                      <Button
                        type="button"
                        size="lg"
                        disabled={savingAttempt}
                        onClick={() => void handleSaveAttempt()}
                      >
                        {savingAttempt ? "Saving..." : "Save attempt"}
                      </Button>
                      {lastSavedAttemptResult ? (
                        <div className="rounded-[1.2rem] border border-warm-border bg-warm-glow p-4">
                          <div className="text-sm font-semibold text-white">
                            Attempt saved.
                          </div>
                          <p className="mt-1 text-sm leading-6 text-text-secondary">
                            {lastSavedAttemptResult === "incorrect"
                              ? "Repair it while it is fresh, then turn the useful bit into a flashcard if needed."
                              : "Good evidence. You can still review history or ask for a method check."}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button type="button" variant="secondary" onClick={() => setShowTutorPanel(true)}>
                              Ask Tutor
                            </Button>
                            {lastSavedAttemptResult === "incorrect" ? (
                              <>
                                <Button
                                  type="button"
                                  variant="secondary"
                                  onClick={() => handleTutorShortcut("make-flashcard")}
                                >
                                  Make flashcard
                                </Button>
                                <Button
                                  type="button"
                                  variant="secondary"
                                  onClick={() => handleTutorShortcut("similar-question")}
                                >
                                  Try similar question
                                </Button>
                              </>
                            ) : null}
                            <Button type="button" variant="secondary" onClick={() => setShowAttemptHistory(true)}>
                              View history
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2 rounded-[1.1rem] border border-white/[0.08] bg-white/[0.03] px-3 py-2">
                          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
                            Need help?
                          </span>
                          <Button type="button" variant="secondary" onClick={() => setShowTutorPanel(true)}>
                            Ask Tutor
                          </Button>
                          <Button type="button" variant="secondary" onClick={() => setShowAttemptHistory(true)}>
                            View history
                          </Button>
                        </div>
                      )}
                    </div>
                  </Card>

                </>
              ) : (
                <EmptyState
                  emoji="Practice"
                  title="Create a practice question"
                  description="Practice starts manual and topical, but you can browse the page first. Add a question when you are ready."
                  action={
                    <Button type="button" onClick={() => setShowAddQuestion(true)}>
                      + Add practice question
                    </Button>
                  }
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

            <div className="space-y-4 2xl:sticky 2xl:top-4 2xl:self-start">
              {selectedQuestion && featureFlags.enableTutorInPractice ? (
                <Card padding="lg">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between 2xl:flex-col">
                    <SectionHeader
                      title="Contextual tutor"
                      description="Open Tutor when you want hint-first help beside this question."
                    />
                    <Button
                      type="button"
                      variant={tutorPanelOpen ? "secondary" : "warm"}
                      onClick={() => setShowTutorPanel((value) => !value)}
                      aria-expanded={tutorPanelOpen}
                    >
                      {tutorPanelOpen ? "Hide Tutor" : "Ask Tutor"}
                    </Button>
                  </div>

                  {!tutorPanelOpen ? (
                    <div className="mt-4 rounded-[1.2rem] border border-white/[0.08] bg-white/[0.035] p-4 text-sm leading-6 text-text-secondary">
                      Stuck on the current step? Open Tutor for a nudge, a working check, or a
                      deliberate full solution.
                    </div>
                  ) : (
                    <>
                      <div className="mt-4 flex gap-2 overflow-x-auto rounded-[1.25rem] border border-white/[0.09] bg-white/[0.035] p-2">
                        {TUTOR_INTENTS.map((item) => (
                          <Button
                            key={item.intent}
                            type="button"
                            variant={item.intent === "full-solution" ? "danger" : "secondary"}
                            disabled={tutorBusyIntent !== null}
                            className="min-h-[2.45rem] shrink-0 rounded-full px-3 text-xs"
                            title={item.description}
                            onClick={() => {
                              if (item.intent === "full-solution" && !confirmFullSolution) {
                                setConfirmFullSolution(true);
                                return;
                              }
                              setConfirmFullSolution(false);
                              void handleTutorIntent(item.intent, item.prompt);
                            }}
                          >
                            {tutorBusyIntent === item.intent ? "Thinking..." : item.label}
                          </Button>
                        ))}
                      </div>
                      <div className="mt-3 space-y-2">
                        {TUTOR_INTENTS.slice(0, 5).map((item) => (
                          <p key={item.intent} className="text-xs leading-5 text-text-muted">
                            <span className="font-semibold text-text-secondary">{item.label}:</span> {item.description}
                          </p>
                        ))}
                      </div>
                      {confirmFullSolution ? (
                        <div className="mt-4 rounded-[1.25rem] border border-error-muted bg-error-muted p-4 text-sm leading-6 text-rose-100">
                          <div className="font-semibold text-white">Full solution gives the answer.</div>
                          <p className="mt-1">
                            It may count as lower independent evidence. Use it when you are ready to
                            reveal the full method.
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              type="button"
                              variant="danger"
                              onClick={() => {
                                const fullSolution = TUTOR_INTENTS.find((item) => item.intent === "full-solution");
                                if (fullSolution) void handleTutorIntent(fullSolution.intent, fullSolution.prompt);
                                setConfirmFullSolution(false);
                              }}
                            >
                              Show full solution
                            </Button>
                            <Button type="button" variant="secondary" onClick={() => setConfirmFullSolution(false)}>
                              Keep trying
                            </Button>
                          </div>
                        </div>
                      ) : null}
                      <div className="mt-5 space-y-3">
                        {tutorMessages.length > 0 ? (
                          tutorMessages.map((message, index) => (
                            <div
                              key={`${message.role}-${index}`}
                              className={`rounded-[1.15rem] border p-4 text-sm leading-6 ${
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
                            Ask for a hint when you are stuck. Tutor should move you one step, not
                            replace your attempt.
                          </p>
                        )}
                      </div>
                      {lastSuggestedFlashcard ? (
                        <div className={`mt-5 ${surfaceCardClass}`}>
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
                                Flashcard draft
                              </div>
                              <h3 className="mt-2 text-lg font-semibold text-white">
                                Draft - not added to your deck yet
                              </h3>
                              <p className="mt-1 text-sm leading-6 text-text-secondary">
                                Edit it first, save it for review, or add it straight to a destination deck.
                              </p>
                            </div>
                            <span className="rounded-full border border-warm-border bg-warm-glow px-3 py-1 text-xs font-semibold text-warm-accent">
                              {savedDraftId ? "Saved draft" : "Unsaved draft"}
                            </span>
                          </div>
                          <div className="mt-4 grid gap-3">
                            <Textarea
                              label="Front"
                              rows={3}
                              value={draftFront}
                              onChange={(event) => {
                                setDraftFront(event.target.value);
                                setSavedDraftId(null);
                              }}
                            />
                            <Textarea
                              label="Back"
                              rows={4}
                              value={draftBack}
                              onChange={(event) => {
                                setDraftBack(event.target.value);
                                setSavedDraftId(null);
                              }}
                            />
                          </div>
                          <div className="mt-4 grid gap-3">
                            <div>
                              <div className="mb-2 text-sm font-medium text-text-secondary">Suggested topic</div>
                              <div className="flex flex-wrap gap-2">
                                {selectedQuestionTopics.length > 0 ? (
                                  selectedQuestionTopics.map((topic) => (
                                    <span
                                      key={topic.id}
                                      className="rounded-full border border-white/[0.12] bg-white/[0.07] px-3 py-1.5 text-xs font-medium text-text-secondary"
                                    >
                                      {topic.name}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-sm text-text-muted">No topic linked yet.</span>
                                )}
                              </div>
                            </div>
                            <label className="block">
                              <span className="mb-2 block text-sm font-medium text-text-secondary">
                                Destination deck
                              </span>
                              <select
                                value={draftDeckId}
                                onChange={(event) => setDraftDeckId(event.target.value)}
                                className="w-full rounded-[1.4rem] border border-white/[0.12] bg-surface-panel-strong px-4 py-3 text-sm text-white outline-none focus:border-warm-accent"
                              >
                                <option value="">Choose a deck</option>
                                {decks.map((deck) => (
                                  <option key={deck.id} value={deck.id}>
                                    {deck.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={savingDraft || !draftFront.trim() || !draftBack.trim()}
                              onClick={() => void handleSaveFlashcardDraft()}
                            >
                              {savingDraft ? "Saving..." : savedDraftId ? "Save changes as draft" : "Save as draft"}
                            </Button>
                            <Button
                              type="button"
                              disabled={addingDraftToDeck || !draftFront.trim() || !draftBack.trim() || !draftDeckId}
                              onClick={() => void handleAddFlashcardDraftToDeck()}
                            >
                              {addingDraftToDeck ? "Adding..." : "Add to deck"}
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </>
                  )}
                </Card>
              ) : null}

              <Card padding="lg">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between 2xl:flex-col">
                  <SectionHeader
                    title="Attempt history"
                    description={`${selectedQuestionAttempts.length} attempt${selectedQuestionAttempts.length === 1 ? "" : "s"} on this question.`}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setShowAttemptHistory((value) => !value)}
                    aria-expanded={showAttemptHistory}
                  >
                    {showAttemptHistory ? "Hide history" : "Expand"}
                  </Button>
                </div>
                {!showAttemptHistory ? (
                  <p className="mt-4 rounded-[1.15rem] border border-white/[0.09] bg-white/[0.035] p-4 text-sm leading-6 text-text-secondary">
                    History stays tucked away so the current question and attempt stay in focus.
                  </p>
                ) : (
                  <div className="mt-4 space-y-2">
                    {selectedQuestionAttempts.length > 0 ? (
                      selectedQuestionAttempts.map((attempt) => (
                        <div key={attempt.id} className={surfaceCardClass}>
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
                )}
              </Card>
            </div>
          </div>
        </>
      )}
    </AppPage>
  );
}
