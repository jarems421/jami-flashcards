import { describe, expect, it } from "vitest";
import { getShootingStarCount, planShootingStars } from "@/lib/constellation/shooting-stars";
import { isNightSkyRoute } from "@/lib/constellation/background";

describe("how many shooting stars a sky gets", () => {
  it("grows with the stars earned, and stops at a calm ceiling", () => {
    expect(getShootingStarCount(0, "sky")).toBe(0);
    expect(getShootingStarCount(3, "sky")).toBe(1);
    expect(getShootingStarCount(12, "sky")).toBe(2);
    expect(getShootingStarCount(40, "sky")).toBe(4);
    expect(getShootingStarCount(400, "sky")).toBe(4);
  });

  it("stays sparser behind the app than on the constellation page", () => {
    expect(getShootingStarCount(3, "background")).toBe(1);
    expect(getShootingStarCount(40, "background")).toBe(2);
    for (const stars of [1, 10, 25, 40]) {
      expect(getShootingStarCount(stars, "background")).toBeLessThanOrEqual(getShootingStarCount(stars, "sky"));
    }
  });
});

describe("where the streaks fall", () => {
  it("is the same for the same sky", () => {
    expect(planShootingStars(3, "sky-1")).toEqual(planShootingStars(3, "sky-1"));
    expect(planShootingStars(3, "sky-1")).not.toEqual(planShootingStars(3, "sky-2"));
  });

  it("keeps each streak on the sky and spreads them through the cycle", () => {
    const streaks = planShootingStars(4, "full-sky");
    expect(streaks).toHaveLength(4);
    for (const streak of streaks) {
      expect(streak.top).toBeGreaterThanOrEqual(0);
      expect(streak.top).toBeLessThanOrEqual(100);
      expect(streak.left).toBeLessThanOrEqual(100);
      expect(streak.duration).toBeGreaterThanOrEqual(20);
    }
    const delays = streaks.map((streak) => streak.delay);
    expect(new Set(delays.map((delay) => Math.floor(delay / 4))).size).toBeGreaterThan(1);
  });
});

describe("the night sky behind signing in", () => {
  it("covers the landing page and every sign-in page, and nothing inside the app", () => {
    expect(isNightSkyRoute("/")).toBe(true);
    expect(isNightSkyRoute("/auth")).toBe(true);
    expect(isNightSkyRoute("/auth/action")).toBe(true);
    expect(isNightSkyRoute("/dashboard")).toBe(false);
    expect(isNightSkyRoute("/authors")).toBe(false);
  });
});
