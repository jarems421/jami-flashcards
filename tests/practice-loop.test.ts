import { afterEach, describe, expect, it, vi } from "vitest";
import { isFeatureEnabled } from "@/lib/app/feature-flags";
import { mapCardData } from "@/lib/study/cards";
import { getAttemptMasteryWeight, getMasteryScoreDelta } from "@/lib/practice/mastery";
import { buildTopicProgress } from "@/lib/practice/progress";
import { mapQuestionData, normalizeConfidence } from "@/lib/practice/questions";
import { mapTopicData, slugifyTopicName } from "@/lib/practice/topics";
import {
  buildFlashcardDraftCardData,
  buildPracticeQuestionDraftData,
} from "@/lib/practice/generated-content";
import { buildSourcePayload, mapSourceData } from "@/lib/practice/sources";

describe("Jami learning loop foundations", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps topics distinct from flexible card tags", () => {
    const card = mapCardData("card-1", {
      deckId: "deck-1",
      userId: "user-1",
      front: "Define eigenvalue",
      back: "A scalar lambda where Av = lambda v for non-zero v.",
      tags: ["exam", "week-5"],
      topicIds: ["topic-eigenvalues"],
      createdAt: 1,
    });

    expect(card.tags).toEqual(["exam", "week-5"]);
    expect(card.topicIds).toEqual(["topic-eigenvalues"]);
  });

  it("allows feature flags to be disabled by environment", () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_PRACTISE", "false");
    vi.stubEnv("NEXT_PUBLIC_ENABLE_LIBRARY", "true");

    expect(isFeatureEnabled("enablePractise")).toBe(false);
    expect(isFeatureEnabled("enableLibrary")).toBe(true);
  });

  it("keeps Library enabled by default for the source loop", () => {
    expect(isFeatureEnabled("enableLibrary")).toBe(true);
  });

  it("normalizes topic and question data for the practice loop", () => {
    expect(slugifyTopicName("  Integration by Parts! ")).toBe("integration-by-parts");

    const topic = mapTopicData("topic-1", {
      name: "  Integration by Parts  ",
      subject: " Analysis 2 ",
      aliases: ["IBP", "integration parts"],
      status: "active",
      createdBy: "ai-suggested",
      createdAt: 1,
      updatedAt: 2,
    });
    const question = mapQuestionData("question-1", {
      questionText: "Evaluate the integral.",
      topicIds: ["topic-1"],
      sourceType: "manual",
      origin: "user-authored",
      contentStatus: "approved",
      createdAt: 3,
      updatedAt: 4,
    });

    expect(topic.slug).toBe("integration-by-parts");
    expect(topic.createdBy).toBe("ai-suggested");
    expect(question.topicIds).toEqual(["topic-1"]);
    expect(question.contentStatus).toBe("approved");
    expect(normalizeConfidence(99)).toBe(5);
  });

  it("weights mastery from user evidence, not AI explanations alone", () => {
    expect(
      getAttemptMasteryWeight({
        isCorrect: true,
        confidence: 5,
        hintsUsed: 0,
        tutorUsed: false,
      })
    ).toBe("high");
    expect(
      getAttemptMasteryWeight({
        isCorrect: true,
        confidence: 3,
        hintsUsed: 1,
        tutorUsed: true,
      })
    ).toBe("medium");
    expect(
      getAttemptMasteryWeight({
        isCorrect: false,
        confidence: 2,
        hintsUsed: 2,
        tutorUsed: true,
      })
    ).toBe("negative");
    expect(getMasteryScoreDelta("neutral")).toBe(0);
  });

  it("builds a narrow progress summary from cards, attempts, and mastery events", () => {
    const topic = mapTopicData("topic-1", {
      name: "Eigenvalues",
      subject: "Linear Algebra",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    const card = mapCardData("card-1", {
      deckId: "deck-1",
      userId: "user-1",
      front: "What is an eigenvalue?",
      back: "A scalar lambda where Av = lambda v.",
      topicIds: ["topic-1"],
      tags: ["exam"],
      createdAt: 1,
      dueDate: 1,
      difficulty: 8,
      reps: 2,
    });
    const question = mapQuestionData("question-1", {
      questionText: "Find the eigenvalues.",
      topicIds: ["topic-1"],
      sourceType: "manual",
      origin: "user-authored",
      contentStatus: "approved",
      createdAt: 1,
      updatedAt: 1,
    });

    const summary = buildTopicProgress({
      topics: [topic],
      cards: [card],
      questions: [question],
      attempts: [
        {
          id: "attempt-1",
          questionId: "question-1",
          userAnswer: "wrong",
          isCorrect: false,
          confidence: 2,
          tutorUsed: true,
          hintsUsed: 2,
          mistakeLabels: ["conceptual mix-up"],
          createdAt: 2,
        },
      ],
      masteryEvents: [
        {
          id: "event-1",
          topicId: "topic-1",
          sourceType: "question",
          sourceId: "attempt-1",
          weight: "negative",
          scoreDelta: -2,
          reason: "Incorrect practice attempt",
          algorithmVersion: "test",
          createdAt: 2,
        },
      ],
      now: 10,
    });

    expect(summary[0].topic.name).toBe("Eigenvalues");
    expect(summary[0].weakCardCount).toBe(1);
    expect(summary[0].accuracy).toBe(0);
    expect(summary[0].supportLevel).toBe("High");
    expect(summary[0].recentMistakes).toEqual(["conceptual mix-up"]);
    expect(summary[0].masteryScore).toBe(-2);
  });

  it("turns an approved tutor flashcard draft into card data without losing provenance", () => {
    const card = buildFlashcardDraftCardData(
      {
        id: "draft-1",
        kind: "flashcard",
        title: "Multiplicity",
        front: " What is geometric multiplicity? ",
        back: " The dimension of the eigenspace. ",
        topicIds: ["topic-multiplicity"],
        origin: "ai-assisted",
        contentStatus: "draft",
        sourceType: "question",
        sourceId: "question-1",
        createdAt: 1,
        updatedAt: 1,
      },
      {
        userId: "user-1",
        deckId: "deck-1",
        now: 10,
      }
    );

    expect(card).toMatchObject({
      deckId: "deck-1",
      userId: "user-1",
      front: "What is geometric multiplicity?",
      back: "The dimension of the eigenspace.",
      tags: [],
      topicIds: ["topic-multiplicity"],
      sourceIds: ["question-1"],
      createdAt: 10,
    });
  });

  it("validates and maps saved Library sources", () => {
    const payload = buildSourcePayload("user-1", {
      title: " Lecture 5 notes ",
      type: "pasted_text",
      subject: " Linear Algebra ",
      topicIds: ["topic-eigenvalues"],
      contentText: " Eigenvalues help test diagonalisation. ",
      now: 10,
    });
    const source = mapSourceData("source-1", payload);

    expect(source).toMatchObject({
      id: "source-1",
      title: "Lecture 5 notes",
      type: "pasted_text",
      subject: "Linear Algebra",
      topicIds: ["topic-eigenvalues"],
      contentText: "Eigenvalues help test diagonalisation.",
      status: "active",
      createdBy: "user-1",
      createdAt: 10,
      updatedAt: 10,
    });
    expect(() =>
      buildSourcePayload("user-1", {
        title: "Empty source",
        type: "pasted_text",
        contentText: "",
      })
    ).toThrow("Paste or write source text");
    expect(() =>
      buildSourcePayload("user-1", {
        title: "Bad link",
        type: "link",
        externalUrl: "not a url",
      })
    ).toThrow("valid source link");
  });

  it("approves source practice drafts into questions with source links", () => {
    const question = buildPracticeQuestionDraftData(
      {
        id: "draft-question-1",
        kind: "practice-question",
        title: "Diagonalisation",
        questionText: "State the diagonalisation criterion.",
        answerText: "There must be enough independent eigenvectors.",
        solutionText: "Compare algebraic and geometric multiplicity.",
        topicIds: ["topic-eigenvalues"],
        origin: "source-derived",
        contentStatus: "draft",
        sourceType: "source",
        sourceId: "source-lecture-5",
        createdAt: 1,
        updatedAt: 1,
      },
      {
        userId: "user-1",
        now: 20,
      }
    );

    expect(question).toMatchObject({
      questionText: "State the diagonalisation criterion.",
      answerText: "There must be enough independent eigenvectors.",
      solutionText: "Compare algebraic and geometric multiplicity.",
      topicIds: ["topic-eigenvalues"],
      sourceType: "ai-generated",
      origin: "source-derived",
      contentStatus: "approved",
      reviewedAt: 20,
      reviewedBy: "user-1",
      sourceIds: ["source-lecture-5"],
      createdAt: 20,
      updatedAt: 20,
    });
  });

  it("rejects draft-to-card conversion for unsafe draft states", () => {
    expect(() =>
      buildFlashcardDraftCardData(
        {
          kind: "practice-question",
          front: "Front",
          back: "Back",
          topicIds: [],
          contentStatus: "draft",
        },
        { userId: "user-1", deckId: "deck-1" }
      )
    ).toThrow("Only flashcard drafts");

    expect(() =>
      buildFlashcardDraftCardData(
        {
          kind: "flashcard",
          front: "Front",
          back: "",
          topicIds: [],
          contentStatus: "draft",
        },
        { userId: "user-1", deckId: "deck-1" }
      )
    ).toThrow("both a front and back");

    expect(() =>
      buildFlashcardDraftCardData(
        {
          kind: "flashcard",
          front: "Front",
          back: "Back",
          topicIds: [],
          contentStatus: "approved",
        },
        { userId: "user-1", deckId: "deck-1" }
      )
    ).toThrow("must still be a draft");

    expect(() =>
      buildFlashcardDraftCardData(
        {
          kind: "flashcard",
          front: "Front",
          back: "Back",
          topicIds: [],
          contentStatus: "draft",
        },
        { userId: "user-1", deckId: "" }
      )
    ).toThrow("destination deck");
  });
});
