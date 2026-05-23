import { getCustomStudyHref } from "@/lib/app/routes";
import { buildTopicProgress, type TopicProgressSummary } from "@/lib/practice/progress";
import type { Attempt, Question } from "@/lib/practice/questions";
import type { MasteryEvent } from "@/lib/practice/mastery";
import type { Topic } from "@/lib/practice/topics";
import type { Goal } from "@/lib/study/goals";
import type { Card } from "@/lib/study/cards";
import { getMemoryRiskInfo } from "@/lib/study/memory-risk";

export type TodayNextActionType =
  | "create_first_deck"
  | "add_first_cards"
  | "review_due_cards"
  | "repair_mistake"
  | "review_drafts"
  | "practice_weak_topic"
  | "continue_goal"
  | "create_first_question"
  | "focused_review";

export type TodayNextAction = {
  type: TodayNextActionType;
  title: string;
  description: string;
  href: string;
  label: string;
  priority: number;
  secondaryHref?: string;
  secondaryLabel?: string;
};

export type TodayDueCardsSummary = {
  count: number;
  weakCount: number;
  primaryDeckId?: string;
  primaryDeckName?: string;
};

export type TodayWeakTopic = {
  topicId: string;
  name: string;
  subject: string;
  accuracy: number;
  reason: string;
  href: string;
};

export type TodayRecentMistake = {
  attemptId: string;
  questionId: string;
  questionText: string;
  confidence: number;
  tutorUsed: boolean;
  mistakeLabels: string[];
  href: string;
};

export type TodayDraft = {
  id: string;
  front: string;
  back: string;
  suggestedTopic?: string;
  href: string;
};

export type TodayGoalSummary = {
  goalId: string;
  title: string;
  detail: string;
  progressPercent: number;
  href: string;
};

export type TodayChecklist = {
  createDeck: boolean;
  addCards: boolean;
  reviewCards: boolean;
  createQuestion: boolean;
  askTutor: boolean;
  checkProgress: boolean;
};

export type TodayPlan = {
  nextAction: TodayNextAction;
  dueCards: TodayDueCardsSummary;
  weakTopics: TodayWeakTopic[];
  recentMistakes: TodayRecentMistake[];
  drafts: TodayDraft[];
  goalSummary?: TodayGoalSummary;
  checklist: TodayChecklist;
  topicProgress: TopicProgressSummary[];
};

type TodayDeckInput = {
  id: string;
  name: string;
};

type TodayDraftInput = {
  id: string;
  kind: string;
  contentStatus: string;
  front?: string;
  back?: string;
  topicIds?: string[];
};

export type BuildTodayPlanInput = {
  decks: TodayDeckInput[];
  cards: Card[];
  dueCards?: Card[];
  topics: Topic[];
  questions: Question[];
  attempts: Attempt[];
  masteryEvents: MasteryEvent[];
  drafts: TodayDraftInput[];
  activeGoals?: Goal[];
  reviewedToday?: number;
  progressVisited?: boolean;
  now?: number;
};

function pluralize(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function getDeckName(decks: TodayDeckInput[], deckId: string | undefined) {
  if (!deckId) return undefined;
  return decks.find((deck) => deck.id === deckId)?.name;
}

function getPrimaryDeckId(cards: Card[]) {
  const counts = new Map<string, number>();
  for (const card of cards) {
    counts.set(card.deckId, (counts.get(card.deckId) ?? 0) + 1);
  }

  return Array.from(counts.entries()).sort((left, right) => right[1] - left[1])[0]?.[0];
}

function getQuestionHref(questionId: string) {
  return `/dashboard/practise?question=${encodeURIComponent(questionId)}`;
}

function getTopicHref(topicId: string) {
  return `/dashboard/practise?topic=${encodeURIComponent(topicId)}`;
}

function buildDueSummary(input: BuildTodayPlanInput, now: number): TodayDueCardsSummary {
  const dueCards =
    input.dueCards ??
    input.cards.filter((card) => typeof card.dueDate === "number" && card.dueDate <= now);
  const weakCards = input.cards.filter((card) => getMemoryRiskInfo(card, now).tier === "high");
  const primaryDeckId = getPrimaryDeckId(dueCards);

  return {
    count: dueCards.length,
    weakCount: weakCards.length,
    primaryDeckId,
    primaryDeckName: getDeckName(input.decks, primaryDeckId),
  };
}

function buildRecentMistakes(input: BuildTodayPlanInput): TodayRecentMistake[] {
  const questionsById = new Map(input.questions.map((question) => [question.id, question]));

  return input.attempts
    .filter((attempt) => !attempt.isCorrect)
    .sort((left, right) => right.createdAt - left.createdAt)
    .map((attempt) => {
      const question = questionsById.get(attempt.questionId);
      return {
        attemptId: attempt.id,
        questionId: attempt.questionId,
        questionText: question?.questionText ?? "Practice question",
        confidence: attempt.confidence,
        tutorUsed: attempt.tutorUsed,
        mistakeLabels: attempt.mistakeLabels,
        href: getQuestionHref(attempt.questionId),
      };
    })
    .slice(0, 4);
}

function buildDrafts(input: BuildTodayPlanInput): TodayDraft[] {
  const topicsById = new Map(input.topics.map((topic) => [topic.id, topic]));

  return input.drafts
    .filter((draft) => draft.kind === "flashcard" && draft.contentStatus === "draft")
    .map((draft) => ({
      id: draft.id,
      front: draft.front?.trim() || "Untitled flashcard draft",
      back: draft.back?.trim() || "No answer yet",
      suggestedTopic: draft.topicIds?.map((topicId) => topicsById.get(topicId)?.name).find(Boolean),
      href: "/dashboard/progress",
    }))
    .slice(0, 4);
}

function buildWeakTopics(input: BuildTodayPlanInput, now: number) {
  const topicProgress = buildTopicProgress({
    topics: input.topics,
    cards: input.cards,
    questions: input.questions,
    attempts: input.attempts,
    masteryEvents: input.masteryEvents,
    now,
  });

  const weakTopics = topicProgress
    .filter(
      (summary) =>
        summary.attemptCount > 0 ||
        summary.weakCardCount > 0 ||
        summary.dueCardCount > 0 ||
        summary.masteryScore < 0
    )
    .map((summary) => {
      let reason = "Review linked cards, then retry 1 practice question.";
      if (summary.attemptCount > 0) {
        reason = `${summary.accuracy}% practice accuracy from ${pluralize(summary.attemptCount, "attempt")}.`;
      } else if (summary.weakCardCount > 0) {
        reason = `${pluralize(summary.weakCardCount, "weak card")} linked to this topic.`;
      } else if (summary.dueCardCount > 0) {
        reason = `${pluralize(summary.dueCardCount, "due card")} linked to this topic.`;
      }

      return {
        topicId: summary.topic.id,
        name: summary.topic.name,
        subject: summary.topic.subject,
        accuracy: summary.accuracy,
        reason,
        href: getTopicHref(summary.topic.id),
      };
    })
    .slice(0, 3);

  return { topicProgress, weakTopics };
}

function buildGoalSummary(input: BuildTodayPlanInput, now: number): TodayGoalSummary | undefined {
  const goal = (input.activeGoals ?? [])
    .filter((item) => item.status === "active" && item.deadline > now)
    .sort((left, right) => left.deadline - right.deadline)[0];

  if (!goal) return undefined;

  const progressPercent =
    goal.targetCards > 0
      ? Math.min(100, Math.round((goal.progress.cardsCompleted / goal.targetCards) * 100))
      : 0;

  return {
    goalId: goal.id,
    title: `Review ${pluralize(goal.targetCards, "card")} for this goal.`,
    detail: `${goal.progress.cardsCompleted} / ${goal.targetCards} cards complete.`,
    progressPercent,
    href: "/dashboard/goals",
  };
}

function buildChecklist(input: BuildTodayPlanInput): TodayChecklist {
  return {
    createDeck: input.decks.length > 0,
    addCards: input.cards.length >= 5,
    reviewCards: (input.reviewedToday ?? 0) > 0,
    createQuestion: input.questions.length > 0,
    askTutor:
      input.attempts.some((attempt) => attempt.tutorUsed || (attempt.hintsUsed ?? 0) > 0) ||
      input.drafts.some((draft) => draft.kind === "flashcard"),
    checkProgress: input.progressVisited === true,
  };
}

function buildNextAction(input: {
  decks: TodayDeckInput[];
  cards: Card[];
  dueCards: TodayDueCardsSummary;
  recentMistakes: TodayRecentMistake[];
  drafts: TodayDraft[];
  weakTopics: TodayWeakTopic[];
  goalSummary?: TodayGoalSummary;
  questions: Question[];
}): TodayNextAction {
  if (input.decks.length === 0) {
    return {
      type: "create_first_deck",
      title: "Create your first deck.",
      description: "Start with one subject, module, or exam. Decks are where flashcards live.",
      href: "/dashboard/decks",
      label: "Create deck",
      priority: 1,
    };
  }

  if (input.cards.length === 0) {
    return {
      type: "add_first_cards",
      title: "Add your first flashcards.",
      description: "Your deck is ready. Add a few cards so Jami can schedule reviews.",
      href: "/dashboard/cards",
      label: "Add cards",
      priority: 2,
      secondaryHref: "/dashboard/decks",
      secondaryLabel: "Open decks",
    };
  }

  if (input.dueCards.count > 0) {
    const deckText = input.dueCards.primaryDeckName ? ` in ${input.dueCards.primaryDeckName}` : "";
    return {
      type: "review_due_cards",
      title: `Review ${pluralize(input.dueCards.count, "due flashcard")}${deckText}.`,
      description: "Due cards are the most time-sensitive thing today. Start with memory, then repair weak topics.",
      href: getCustomStudyHref({ mode: "daily" }),
      label: "Start Daily Review",
      priority: 3,
      secondaryHref: getCustomStudyHref({ mode: "custom" }),
      secondaryLabel: "Focused Review",
    };
  }

  if (input.recentMistakes.length > 0) {
    const mistake = input.recentMistakes[0];
    return {
      type: "repair_mistake",
      title: "Repair your most recent mistake.",
      description: mistake.questionText,
      href: mistake.href,
      label: "Retry in Practise",
      priority: 4,
      secondaryHref: "/dashboard/progress",
      secondaryLabel: "See Progress",
    };
  }

  if (input.drafts.length > 0) {
    return {
      type: "review_drafts",
      title: `Review ${pluralize(input.drafts.length, "flashcard draft")}.`,
      description: "Tutor-made drafts are not real cards until you approve or add them to a deck.",
      href: "/dashboard/progress",
      label: "Review drafts",
      priority: 5,
    };
  }

  if (input.weakTopics.length > 0) {
    const topic = input.weakTopics[0];
    return {
      type: "practice_weak_topic",
      title: `Practise ${topic.name}.`,
      description: topic.reason,
      href: topic.href,
      label: "Practise topic",
      priority: 6,
      secondaryHref: "/dashboard/study",
      secondaryLabel: "Review linked cards",
    };
  }

  if (input.goalSummary) {
    return {
      type: "continue_goal",
      title: "Keep your current goal moving.",
      description: input.goalSummary.detail,
      href: input.goalSummary.href,
      label: "Open goals",
      priority: 7,
    };
  }

  if (input.questions.length === 0) {
    return {
      type: "create_first_question",
      title: "Create your first practice question.",
      description: "Practise turns memorised ideas into application.",
      href: "/dashboard/practise",
      label: "Create question",
      priority: 8,
    };
  }

  return {
    type: "focused_review",
    title: "Choose a focused study session.",
    description: "Daily Review is clear. Pick flashcards or a practice question to keep momentum moving.",
    href: getCustomStudyHref({ mode: "custom" }),
    label: "Focused Review",
    priority: 9,
    secondaryHref: "/dashboard/practise",
    secondaryLabel: "Open Practise",
  };
}

export function buildTodayPlan(input: BuildTodayPlanInput): TodayPlan {
  const now = input.now ?? Date.now();
  const dueCards = buildDueSummary(input, now);
  const recentMistakes = buildRecentMistakes(input);
  const drafts = buildDrafts(input);
  const { topicProgress, weakTopics } = buildWeakTopics(input, now);
  const goalSummary = buildGoalSummary(input, now);
  const checklist = buildChecklist(input);
  const nextAction = buildNextAction({
    decks: input.decks,
    cards: input.cards,
    dueCards,
    recentMistakes,
    drafts,
    weakTopics,
    goalSummary,
    questions: input.questions,
  });

  return {
    nextAction,
    dueCards,
    weakTopics,
    recentMistakes,
    drafts,
    goalSummary,
    checklist,
    topicProgress,
  };
}
