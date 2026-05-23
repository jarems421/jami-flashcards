import { describe, expect, it } from "vitest";
import { buildTodayPlan } from "@/lib/dashboard/today-plan";
import type { Card } from "@/lib/study/cards";
import type { Goal } from "@/lib/study/goals";
import type { Attempt, Question } from "@/lib/practice/questions";
import type { Topic } from "@/lib/practice/topics";

const NOW = 1_000_000;

function card(input: Partial<Card> & Pick<Card, "id" | "deckId" | "front" | "back">): Card {
  return {
    userId: "user-1",
    tags: [],
    createdAt: 1,
    ...input,
  };
}

const decks = [
  { id: "deck-a", name: "Algebra" },
  { id: "deck-b", name: "Analysis" },
];

const topic: Topic = {
  id: "topic-eigenvalues",
  name: "Eigenvalues",
  slug: "eigenvalues",
  subject: "Linear Algebra",
  status: "active",
  createdBy: "user",
  createdAt: 1,
  updatedAt: 1,
};

const question: Question = {
  id: "question-1",
  questionText: "Is the matrix diagonalizable?",
  topicIds: [topic.id],
  sourceType: "manual",
  origin: "user-authored",
  contentStatus: "approved",
  createdAt: 1,
  updatedAt: 1,
};

const wrongAttempt: Attempt = {
  id: "attempt-1",
  questionId: question.id,
  userAnswer: "yes",
  isCorrect: false,
  confidence: 2,
  tutorUsed: false,
  hintsUsed: 0,
  mistakeLabels: ["mixed up multiplicity"],
  createdAt: 2,
};

function basePlanInput() {
  return {
    decks,
    cards: [
      card({
        id: "card-1",
        deckId: "deck-a",
        front: "Define eigenvalue",
        back: "A scalar where Av = lambda v.",
      }),
    ],
    dueCards: [],
    topics: [topic],
    questions: [question],
    attempts: [],
    masteryEvents: [],
    drafts: [],
    activeGoals: [],
    reviewedToday: 0,
    progressVisited: false,
    now: NOW,
  };
}

describe("today plan", () => {
  it("starts new users by creating a deck", () => {
    const plan = buildTodayPlan({ ...basePlanInput(), decks: [], cards: [], questions: [] });

    expect(plan.nextAction.type).toBe("create_first_deck");
  });

  it("sends users with a deck but no cards to add cards", () => {
    const plan = buildTodayPlan({ ...basePlanInput(), cards: [], questions: [] });

    expect(plan.nextAction.type).toBe("add_first_cards");
  });

  it("prioritizes due cards and selects the primary due deck", () => {
    const dueCards = [
      card({ id: "due-1", deckId: "deck-b", front: "A", back: "B", dueDate: NOW - 1 }),
      card({ id: "due-2", deckId: "deck-b", front: "C", back: "D", dueDate: NOW - 1 }),
      card({ id: "due-3", deckId: "deck-a", front: "E", back: "F", dueDate: NOW - 1 }),
    ];
    const plan = buildTodayPlan({
      ...basePlanInput(),
      cards: dueCards,
      dueCards,
      attempts: [wrongAttempt],
    });

    expect(plan.nextAction.type).toBe("review_due_cards");
    expect(plan.dueCards.primaryDeckName).toBe("Analysis");
  });

  it("repairs recent mistakes when there are no due cards", () => {
    const plan = buildTodayPlan({ ...basePlanInput(), attempts: [wrongAttempt] });

    expect(plan.nextAction.type).toBe("repair_mistake");
    expect(plan.recentMistakes[0]).toMatchObject({
      questionId: question.id,
      questionText: question.questionText,
    });
  });

  it("surfaces only flashcard drafts that are still drafts", () => {
    const plan = buildTodayPlan({
      ...basePlanInput(),
      questions: [question],
      drafts: [
        {
          id: "draft-1",
          kind: "flashcard",
          contentStatus: "draft",
          front: "What is geometric multiplicity?",
          back: "The eigenspace dimension.",
          topicIds: [topic.id],
        },
        {
          id: "draft-2",
          kind: "flashcard",
          contentStatus: "approved",
          front: "Approved",
          back: "Done",
          topicIds: [topic.id],
        },
        {
          id: "draft-3",
          kind: "practice-question",
          contentStatus: "draft",
          front: "Question",
          back: "Answer",
          topicIds: [topic.id],
        },
      ],
    });

    expect(plan.nextAction.type).toBe("review_drafts");
    expect(plan.drafts).toHaveLength(1);
    expect(plan.drafts[0].suggestedTopic).toBe("Eigenvalues");
  });

  it("uses weak topic summaries after drafts and mistakes", () => {
    const plan = buildTodayPlan({
      ...basePlanInput(),
      attempts: [{ ...wrongAttempt, isCorrect: true, tutorUsed: true, hintsUsed: 1 }],
      masteryEvents: [
        {
          id: "event-1",
          topicId: topic.id,
          sourceType: "question",
          sourceId: wrongAttempt.id,
          weight: "negative",
          scoreDelta: -2,
          reason: "Incorrect practice attempt.",
          algorithmVersion: "test",
          createdAt: 2,
        },
      ],
    });

    expect(plan.nextAction.type).toBe("practice_weak_topic");
    expect(plan.weakTopics[0]).toMatchObject({ topicId: topic.id, name: "Eigenvalues" });
  });

  it("continues an active goal before creating the first question", () => {
    const goal: Goal = {
      id: "goal-1",
      targetCards: 10,
      targetAccuracy: 0.8,
      deadline: NOW + 1000,
      progress: { cardsCompleted: 3, correctAnswers: 3, totalAnswers: 4 },
      status: "active",
      createdAt: 1,
    };
    const plan = buildTodayPlan({
      ...basePlanInput(),
      questions: [],
      topics: [],
      activeGoals: [goal],
    });

    expect(plan.nextAction.type).toBe("continue_goal");
    expect(plan.goalSummary?.progressPercent).toBe(30);
  });

  it("falls back to creating the first question when no higher signal exists", () => {
    const plan = buildTodayPlan({ ...basePlanInput(), questions: [], topics: [] });

    expect(plan.nextAction.type).toBe("create_first_question");
  });
});
