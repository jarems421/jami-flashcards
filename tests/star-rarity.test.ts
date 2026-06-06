import { describe, expect, it } from "vitest";
import { resolveStarPresetId } from "@/lib/constellation/stars";
import type { Goal } from "@/lib/study/goals";

function buildGoal(targetCards: number, targetAccuracy = 0.8): Goal {
  return {
    id: "goal",
    targetCards,
    targetAccuracy,
    deadline: 0,
    progress: {
      cardsCompleted: 0,
      correctAnswers: 0,
      totalAnswers: 0,
    },
    status: "active",
    createdAt: 0,
  };
}

describe("star rarity", () => {
  it("rewards more demanding goals with rarer presets", () => {
    expect(resolveStarPresetId(buildGoal(10))).toBe("classic");
    expect(resolveStarPresetId(buildGoal(20))).toBe("blue-spark");
    expect(resolveStarPresetId(buildGoal(40))).toBe("violet-comet");
    expect(resolveStarPresetId(buildGoal(70))).toBe("gold-burst");
    expect(resolveStarPresetId(buildGoal(100, 0.95))).toBe("magenta-elite");
  });

  it("upgrades rewards for longer study streaks", () => {
    const smallGoal = buildGoal(5, 0.7);

    expect(resolveStarPresetId(smallGoal, 2)).toBe("classic");
    expect(resolveStarPresetId(smallGoal, 3)).toBe("blue-spark");
    expect(resolveStarPresetId(smallGoal, 7)).toBe("violet-comet");
    expect(resolveStarPresetId(smallGoal, 14)).toBe("gold-burst");
    expect(resolveStarPresetId(smallGoal, 30)).toBe("magenta-elite");
  });

  it("keeps a harder goal preset when it is rarer than the streak preset", () => {
    expect(resolveStarPresetId(buildGoal(100, 0.95), 3)).toBe(
      "magenta-elite"
    );
  });
});
