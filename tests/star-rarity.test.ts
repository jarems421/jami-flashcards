import { describe, expect, it } from "vitest";
import {
  buildPreviewStar,
  resolveStarPresetId,
} from "@/lib/constellation/stars";
import type { Goal } from "@/lib/study/goals";

function buildGoal(targetCards: number, targetAccuracy = 0.8): Goal {
  return {
    id: "goal",
    name: "Test goal",
    scope: { type: "all" },
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

  it("uses goal values alone to determine the reward", () => {
    expect(resolveStarPresetId(buildGoal(5, 0.7))).toBe("classic");
    expect(resolveStarPresetId(buildGoal(100, 0.95))).toBe("magenta-elite");
  });

  it("keeps preview presets aligned with earned goal presets", () => {
    for (const [targetCards, targetAccuracy] of [
      [10, 0.8],
      [20, 0.8],
      [40, 0.8],
      [70, 0.8],
      [100, 0.95],
    ] as const) {
      expect(
        buildPreviewStar({
          targetCards,
          targetAccuracy,
          completedGoalsCount: 0,
        }).presetId
      ).toBe(resolveStarPresetId(buildGoal(targetCards, targetAccuracy)));
    }
  });
});
