import { describe, expect, it } from "vitest";
import type { Card } from "@/lib/study/cards";
import {
  applySimpleStudyResultToCard,
  applySimpleStudyResultToQueue,
  buildSimpleStudyQueue,
  hasPriorCardRating,
} from "@/lib/study/simple-study";

function createCard(id: string, overrides: Partial<Card> = {}): Card {
  return {
    id,
    deckId: "deck-1",
    userId: "user-1",
    front: `Front ${id}`,
    back: `Back ${id}`,
    createdAt: 1,
    tags: [],
    ...overrides,
  };
}

describe("simple study queue", () => {
  it("shows unrated cards before wrong cards", () => {
    const queue = buildSimpleStudyQueue([
      createCard("wrong", { simpleStudyWrongCount: 2, simpleStudyLastResult: "wrong" }),
      createCard("new-a", { createdAt: 10 }),
      createCard("new-b", { createdAt: 5 }),
    ]);

    expect(queue.cards.map((card) => card.id)).toEqual(["new-b", "new-a", "wrong"]);
    expect(queue.newCount).toBe(2);
    expect(queue.wrongCount).toBe(1);
  });

  it("excludes cards cleared by Simple Study", () => {
    const queue = buildSimpleStudyQueue([
      createCard("cleared", { simpleStudyLastResult: "correct", simpleStudyCorrectCount: 1 }),
      createCard("new"),
    ]);

    expect(queue.cards.map((card) => card.id)).toEqual(["new"]);
  });

  it("includes cards that look like a prior Again or Hard answer", () => {
    const queue = buildSimpleStudyQueue([
      createCard("again-once", { reps: 1, difficulty: 6.4 }),
      createCard("hard-once", { reps: 1, difficulty: 5.1 }),
      createCard("borderline-medium", { reps: 1, difficulty: 5 }),
      createCard("good-once", { reps: 1, difficulty: 2.1 }),
      createCard("explicit-wrong", {
        reps: 1,
        difficulty: 5,
        simpleStudyLastResult: "wrong",
        simpleStudyWrongCount: 1,
      }),
    ]);

    expect(queue.cards.map((card) => card.id)).toEqual([
      "explicit-wrong",
      "again-once",
      "hard-once",
    ]);
  });

  it("reopens a Simple Study cleared card after a newer struggle", () => {
    const queue = buildSimpleStudyQueue([
      createCard("reopened", {
        reps: 3,
        simpleStudyLastResult: "correct",
        simpleStudyLastReviewedAt: 100,
        lastStruggleAt: 200,
      }),
      createCard("still-clear", {
        reps: 3,
        simpleStudyLastResult: "correct",
        simpleStudyLastReviewedAt: 300,
        lastStruggleAt: 200,
      }),
    ]);

    expect(queue.cards.map((card) => card.id)).toEqual(["reopened"]);
  });

  it("sorts missed cards hardest first", () => {
    const queue = buildSimpleStudyQueue([
      createCard("one-miss", { simpleStudyWrongCount: 1, simpleStudyLastResult: "wrong" }),
      createCard("many-misses", { simpleStudyWrongCount: 4, simpleStudyLastResult: "wrong" }),
      createCard("seeded-hard", { reps: 3, lapses: 2, difficulty: 8 }),
    ]);

    expect(queue.cards.map((card) => card.id)).toEqual(["many-misses", "one-miss", "seeded-hard"]);
  });

  it("seeds existing struggle data into the wrong-card queue", () => {
    const queue = buildSimpleStudyQueue([
      createCard("reviewed-easy", { reps: 3, difficulty: 3 }),
      createCard("lapsed", { reps: 3, lapses: 1 }),
      createCard("custom-struggle", { repetitions: 2, customStruggleCount: 1 }),
      createCard("recent-struggle", { reps: 1, lastStruggleAt: 100 }),
    ]);

    expect(queue.cards.map((card) => card.id)).toEqual([
      "lapsed",
      "custom-struggle",
      "recent-struggle",
    ]);
  });

  it("detects prior ratings from current and legacy review fields", () => {
    expect(hasPriorCardRating(createCard("new"))).toBe(false);
    expect(hasPriorCardRating(createCard("fsrs", { reps: 1 }))).toBe(true);
    expect(hasPriorCardRating(createCard("legacy", { repetitions: 1 }))).toBe(true);
    expect(hasPriorCardRating(createCard("reviewed", { lastReview: 100 }))).toBe(true);
  });
});

describe("simple study results", () => {
  it("removes a correct card from the queue", () => {
    const cards = [createCard("a"), createCard("b")];

    expect(applySimpleStudyResultToQueue(cards, "a", "correct", 100).map((card) => card.id)).toEqual(["b"]);
  });

  it("moves a missed card to the back", () => {
    const cards = [createCard("a"), createCard("b"), createCard("c")];
    const nextQueue = applySimpleStudyResultToQueue(cards, "a", "wrong", 100);

    expect(nextQueue.map((card) => card.id)).toEqual(["b", "c", "a"]);
    expect(nextQueue[2].simpleStudyWrongCount).toBe(1);
    expect(nextQueue[2].simpleStudyLastResult).toBe("wrong");
  });

  it("updates only Simple Study fields on a card", () => {
    const card = createCard("a", {
      reps: 3,
      difficulty: 8,
      dueDate: 1000,
      memoryRiskOverrideDayKey: "2026-05-03",
    });

    const nextCard = applySimpleStudyResultToCard(card, "correct", 2000);

    expect(nextCard).toMatchObject({
      reps: 3,
      difficulty: 8,
      dueDate: 1000,
      memoryRiskOverrideDayKey: "2026-05-03",
      simpleStudyCorrectCount: 1,
      simpleStudyLastResult: "correct",
      simpleStudyLastReviewedAt: 2000,
    });
  });
});
