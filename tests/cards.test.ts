import { describe, expect, it } from "vitest";
import {
  addCardTag,
  cardMatchesAnyTag,
  exportCardsToSeparatedText,
  getCardContentKey,
  getTagSuggestions,
  getCardTagsInputError,
  parseCardImportText,
  parseCardTagsInput,
  parseCardTagsParam,
  MAX_FRONT_LENGTH,
} from "@/lib/study/cards";
import {
  buildDailyReviewQueues,
  getDailyReviewBucket,
} from "@/lib/study/daily-review";
import {
  updateCardSchedule,
  getDifficultyInfo,
} from "@/lib/study/scheduler";
import { getMemoryRiskInfo } from "@/lib/study/memory-risk";

describe("card tag helpers", () => {
  it("normalizes and deduplicates comma-separated tags", () => {
    expect(parseCardTagsInput("Biology, cells, biology, Cell Biology")).toEqual([
      "Biology",
      "cells",
      "Cell Biology",
    ]);
  });

  it("rejects tag lists that exceed the per-card limit", () => {
    expect(getCardTagsInputError("a,b,c,d,e,f,g,h,i,j,k")).toBe(
      "Use up to 10 tags per card."
    );
  });

  it("matches cards when any selected tag overlaps", () => {
    expect(
      cardMatchesAnyTag({ tags: ["biology", "cells"] }, ["physics", "cells"])
    ).toBe(true);
    expect(cardMatchesAnyTag({ tags: ["biology", "cells"] }, ["physics"])).toBe(
      false
    );
    expect(
      cardMatchesAnyTag({ tags: ["Biology", "Cells"] }, ["biology"])
    ).toBe(true);
  });

  it("parses tag query params with the same normalization as card input", () => {
    expect(parseCardTagsParam("Anatomy,  cell biology,anatomy")).toEqual([
      "Anatomy",
      "cell biology",
    ]);
  });

  it("adds a normalized pending tag to the current tag list", () => {
    expect(addCardTag(["Biology"], " Cell Biology ")).toEqual({
      nextTags: ["Biology", "Cell Biology"],
      added: true,
      error: null,
    });
  });

  it("suggests reusable tags that match the current input", () => {
    expect(
      getTagSuggestions(
        ["biology", "cell biology", "physics", "anatomy"],
        "bio",
        ["physics"]
      )
    ).toEqual(["biology", "cell biology"]);
  });
});

describe("card import parser", () => {
  it("parses Front | Back rows and skips an optional header", () => {
    expect(
      parseCardImportText("Front | Back\nCapital of Japan | Tokyo\n2 + 2 | 4")
    ).toEqual({
      cards: [
        { front: "Capital of Japan", back: "Tokyo" },
        { front: "2 + 2", back: "4" },
      ],
      errors: [],
      skippedRows: 0,
    });
  });

  it("parses tab-separated Anki-style rows", () => {
    expect(parseCardImportText("mitosis\tcell division\nosmosis\twater movement").cards).toEqual([
      { front: "mitosis", back: "cell division" },
      { front: "osmosis", back: "water movement" },
    ]);
  });

  it("reports invalid and overlong rows without dropping valid rows", () => {
    const overlongFront = "x".repeat(MAX_FRONT_LENGTH + 1);
    const result = parseCardImportText(
      `Valid | Card\nMissing delimiter\n${overlongFront} | Back`
    );

    expect(result.cards).toEqual([{ front: "Valid", back: "Card" }]);
    expect(result.skippedRows).toBe(2);
    expect(result.errors).toEqual([
      "Line 2: use Front | Back, Front<Tab>Back, or two CSV columns.",
      `Line 3: front must be ${MAX_FRONT_LENGTH} characters or less.`,
    ]);
  });
});

describe("card import/export helpers", () => {
  it("builds stable duplicate keys from normalized card text", () => {
    expect(getCardContentKey("  Capital   ", " Tokyo ")).toBe(
      getCardContentKey("capital", "tokyo")
    );
  });

  it("exports cards as re-importable tsv", () => {
    expect(
      exportCardsToSeparatedText([
        { front: "Capital of Japan", back: "Tokyo" },
        { front: "Line\nbreak", back: "Tabbed\tanswer" },
      ])
    ).toBe("Front\tBack\nCapital of Japan\tTokyo\nLine break\tTabbed answer");
  });

  it("exports csv with quoted commas and quotes", () => {
    expect(
      exportCardsToSeparatedText(
        [{ front: 'Define "osmosis"', back: "Water, through a membrane" }],
        "csv"
      )
    ).toBe('Front,Back\n"Define ""osmosis""","Water, through a membrane"');
  });
});

describe("FSRS scheduler", () => {
  it("schedules a new card with 'good' rating and returns FSRS fields", () => {
    const result = updateCardSchedule({}, "good");
    expect(result.dueDate).toBeGreaterThan(Date.now() - 1000);
    expect(result.stability).toBeGreaterThan(0);
    expect(result.difficulty).toBeGreaterThan(0);
    expect(result.reps).toBe(1);
    expect(result.fsrsState).toBeGreaterThanOrEqual(0);
    expect(result.lapses).toBe(0);
    expect(result.lastReview).toBeGreaterThan(0);
    // Legacy fields still present
    expect(result.interval).toBeGreaterThanOrEqual(1);
    expect(result.easeFactor).toBe(2.5);
    expect(result.repetitions).toBe(1);
  });

  it("increases review pressure when rating 'again'", () => {
    const first = updateCardSchedule({}, "good");
    const second = updateCardSchedule(first, "again");
    expect(second.lapses).toBeGreaterThanOrEqual(0);
    expect(second.reps).toBe(2);
    expect(second.dueDate).toBeGreaterThan(Date.now() - 1000);
  });

  it("handles legacy cards without FSRS fields", () => {
    const legacyCard = {
      interval: 4,
      repetitions: 3,
      easeFactor: 2.2,
      dueDate: Date.now() - 86400000,
    };
    const result = updateCardSchedule(legacyCard, "good");
    // Should produce valid FSRS output even from legacy input
    expect(result.stability).toBeGreaterThan(0);
    expect(result.difficulty).toBeGreaterThan(0);
    expect(result.dueDate).toBeGreaterThan(Date.now() - 1000);
  });

  it("uses the four standard FSRS ratings", () => {
    const first = updateCardSchedule({}, "good");
    const again = updateCardSchedule(first, "again");
    const hard = updateCardSchedule(first, "hard");
    const good = updateCardSchedule(first, "good");
    const easy = updateCardSchedule(first, "easy");

    expect(again.dueDate).toBeLessThanOrEqual(hard.dueDate);
    expect(hard.dueDate).toBeLessThanOrEqual(good.dueDate);
    expect(good.dueDate).toBeLessThanOrEqual(easy.dueDate);
  });

  it("repeated 'again' answers make the memory risk high", () => {
    let card = updateCardSchedule({}, "again");
    for (let index = 0; index < 4; index += 1) {
      card = updateCardSchedule(card, "again");
    }

    expect(card.difficulty).toBeGreaterThanOrEqual(7);
    expect(getMemoryRiskInfo(card).tier).toBe("high");
  });
});

describe("getDifficultyInfo", () => {
  it("returns 'New' for undefined or zero difficulty", () => {
    expect(getDifficultyInfo(undefined)).toEqual({ label: "New", tier: "easy" });
    expect(getDifficultyInfo(0)).toEqual({ label: "New", tier: "easy" });
  });

  it("returns correct tier for difficulty ranges", () => {
    expect(getDifficultyInfo(2).tier).toBe("easy");
    expect(getDifficultyInfo(5).tier).toBe("medium");
    expect(getDifficultyInfo(8).tier).toBe("hard");
  });
});

describe("daily review memory risk", () => {
  it("keeps new cards in required medium review", () => {
    const now = Date.now();
    expect(
      getDailyReviewBucket({
        id: "new",
        deckId: "deck",
        userId: "user",
        front: "front",
        back: "back",
        createdAt: now,
        tags: [],
      })
    ).toBe("medium");
  });

  it("pulls easy due cards into required review when memory risk is high", () => {
    const now = Date.now();
    const { requiredCards, optionalCards } = buildDailyReviewQueues(
      [
        {
          id: "risky-easy",
          deckId: "deck",
          userId: "user",
          front: "front",
          back: "back",
          createdAt: now,
          tags: [],
          difficulty: 2,
          reps: 5,
          lapses: 3,
          dueDate: now - 1000,
        },
      ],
      now
    );

    expect(requiredCards.map((card) => card.id)).toEqual(["risky-easy"]);
    expect(optionalCards).toHaveLength(0);
  });

  it("includes custom struggles on their override study day even if not due", () => {
    const now = Date.UTC(2026, 0, 2, 17);
    const { requiredCards } = buildDailyReviewQueues(
      [
        {
          id: "custom-struggle",
          deckId: "deck",
          userId: "user",
          front: "front",
          back: "back",
          createdAt: now,
          tags: [],
          difficulty: 2,
          reps: 5,
          lapses: 0,
          dueDate: now + 7 * 24 * 60 * 60 * 1000,
          memoryRiskOverrideDayKey: "2026-01-02",
        },
      ],
      now
    );

    expect(requiredCards.map((card) => card.id)).toEqual(["custom-struggle"]);
  });
});
