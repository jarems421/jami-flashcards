import { describe, expect, it } from "vitest";
import {
  buildFlashcardReviewEventWrite,
  decodeFlashcardReviewEvent,
  flashcardReviewEventId,
  flashcardReviewEventScore,
} from "@/lib/learning/events/flashcard-review-event";

/**
 * The shape of one recorded flashcard answer.
 *
 * Small on purpose, and pinned here so it stays small: ids, a time, a study
 * day, a result. Anything else a review carries -- topics, folders, timings,
 * card text -- is not needed to learn from and is not stored.
 */

const REVIEWED_AT = Date.UTC(2026, 8, 15, 9);

const review = {
  cardId: "card-1",
  deckId: "deck-1",
  reviewedAt: REVIEWED_AT,
  studyDayKey: "2026-09-15",
  isCorrect: false,
  rating: "hard" as const,
  sessionKind: "daily-required" as const,
};

describe("writing a flashcard review event", () => {
  it("keeps only what the Learning Engine scores", () => {
    const write = buildFlashcardReviewEventWrite(
      { ...review, ...{ topicIds: ["t"], folderIds: ["f"], durationMs: 2_000 } },
      REVIEWED_AT + 5
    );
    expect(write).toEqual({
      schemaVersion: 1,
      cardId: "card-1",
      deckId: "deck-1",
      reviewedAt: REVIEWED_AT,
      studyDayKey: "2026-09-15",
      correct: false,
      rating: "hard",
      createdAt: REVIEWED_AT + 5,
    });
  });

  it("records a simple-study answer without a rating", () => {
    const write = buildFlashcardReviewEventWrite(
      { ...review, isCorrect: true, rating: "good", sessionKind: "simple" },
      REVIEWED_AT
    );
    expect(write).toMatchObject({ correct: true });
    expect(write).not.toHaveProperty("rating");
  });

  it("refuses an answer it could not scope or date", () => {
    expect(buildFlashcardReviewEventWrite({ ...review, deckId: undefined }, REVIEWED_AT)).toBeNull();
    expect(buildFlashcardReviewEventWrite({ ...review, reviewedAt: 1_760_000_000 }, REVIEWED_AT)).toBeNull();
    expect(buildFlashcardReviewEventWrite({ ...review, studyDayKey: "yesterday" }, REVIEWED_AT)).toBeNull();
  });

  it("is keyed by the answer's commit id, which retries share", () => {
    expect(flashcardReviewEventId({ commitId: "commit-1", id: "review-1" })).toBe("commit-1");
    expect(flashcardReviewEventId({ id: "review-1" })).toBe("review-1");
    expect(flashcardReviewEventId({ commitId: "a/b", id: "" })).toBeNull();
  });
});

describe("reading a flashcard review event", () => {
  const stored = {
    schemaVersion: 1,
    cardId: "card-1",
    deckId: "deck-1",
    reviewedAt: REVIEWED_AT,
    studyDayKey: "2026-09-15",
    correct: true,
    rating: "good",
    createdAt: REVIEWED_AT,
  };

  it("reads a well-formed event", () => {
    expect(decodeFlashcardReviewEvent("event-1", stored)).toEqual({
      id: "event-1",
      cardId: "card-1",
      deckId: "deck-1",
      reviewedAt: REVIEWED_AT,
      studyDayKey: "2026-09-15",
      correct: true,
      rating: "good",
    });
  });

  it("skips anything malformed or from a schema it does not know", () => {
    expect(decodeFlashcardReviewEvent("event-1", { ...stored, schemaVersion: 2 })).toBeNull();
    expect(decodeFlashcardReviewEvent("event-1", { ...stored, rating: "perfect" })).toBeNull();
    expect(decodeFlashcardReviewEvent("event-1", { ...stored, correct: "yes" })).toBeNull();
    expect(decodeFlashcardReviewEvent("event-1", { ...stored, reviewedAt: "today" })).toBeNull();
    expect(decodeFlashcardReviewEvent("event-1", { ...stored, cardId: "" })).toBeNull();
  });

  it("gives half credit for a recall the student rated hard", () => {
    expect(flashcardReviewEventScore({ correct: true, rating: "good" })).toBe(1);
    expect(flashcardReviewEventScore({ correct: false, rating: "hard" })).toBe(0.5);
    expect(flashcardReviewEventScore({ correct: false, rating: "again" })).toBe(0);
    expect(flashcardReviewEventScore({ correct: false })).toBe(0);
  });
});
