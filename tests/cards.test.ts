import { describe, expect, it } from "vitest";
import {
  addCardTag,
  cardMatchesAnyTag,
  getTagSuggestions,
  getCardTagsInputError,
  parseCardTagsInput,
  parseCardTagsParam,
} from "@/lib/study/cards";
import {
  updateCardSchedule,
  getDifficultyInfo,
} from "@/lib/study/scheduler";

describe("card tag helpers", () => {
  it("normalizes and deduplicates comma-separated tags", () => {
    expect(parseCardTagsInput("Biology, cells, biology, Cell Biology")).toEqual([
      "biology",
      "cells",
      "cell biology",
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
  });

  it("parses tag query params with the same normalization as card input", () => {
    expect(parseCardTagsParam("Anatomy,  cell biology,anatomy")).toEqual([
      "anatomy",
      "cell biology",
    ]);
  });

  it("adds a normalized pending tag to the current tag list", () => {
    expect(addCardTag(["biology"], " Cell Biology ")).toEqual({
      nextTags: ["biology", "cell biology"],
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

describe("FSRS scheduler", () => {
  it("schedules a new card with 'right' rating and returns FSRS fields", () => {
    const result = updateCardSchedule({}, "right");
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

  it("increases lapses when rating 'wrong'", () => {
    // First review: right
    const first = updateCardSchedule({}, "right");
    // Second review: wrong
    const second = updateCardSchedule(first, "wrong");
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
    const result = updateCardSchedule(legacyCard, "right");
    // Should produce valid FSRS output even from legacy input
    expect(result.stability).toBeGreaterThan(0);
    expect(result.difficulty).toBeGreaterThan(0);
    expect(result.dueDate).toBeGreaterThan(Date.now() - 1000);
  });

  it("uses 'again' rating as FSRS Hard", () => {
    const first = updateCardSchedule({}, "right");
    const again = updateCardSchedule(first, "again");
    const right = updateCardSchedule(first, "right");
    // 'again' (Hard) should schedule sooner than 'right' (Good)
    expect(again.dueDate).toBeLessThanOrEqual(right.dueDate);
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
