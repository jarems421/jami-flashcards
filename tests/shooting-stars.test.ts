import { describe, expect, it } from "vitest";
import {
  getShootingStarCount,
  planShootingStarPath,
  planShootingStars,
  planShootingStarTimings,
} from "@/lib/constellation/shooting-stars";
import { isNightSkyRoute } from "@/lib/constellation/background";

describe("how many shooting stars a sky gets", () => {
  it("grows with the stars earned, and stops at a ceiling", () => {
    expect(getShootingStarCount(0, "sky")).toBe(0);
    expect(getShootingStarCount(3, "sky")).toBe(1);
    expect(getShootingStarCount(12, "sky")).toBe(3);
    expect(getShootingStarCount(40, "sky")).toBe(8);
    expect(getShootingStarCount(400, "sky")).toBe(8);
  });

  it("stays sparser behind the app than on the constellation page", () => {
    expect(getShootingStarCount(3, "background")).toBe(1);
    expect(getShootingStarCount(40, "background")).toBe(5);
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

  it("falls somewhere new on each pass, across the whole sky", () => {
    const passes = Array.from({ length: 40 }, (_, pass) => planShootingStarPath("full-sky", 0, pass));
    expect(new Set(passes.map((path) => `${path.top}:${path.left}`)).size).toBe(40);
    for (const path of passes) {
      expect(path.top).toBeGreaterThanOrEqual(0);
      expect(path.top).toBeLessThanOrEqual(70);
      expect(path.left).toBeGreaterThanOrEqual(15);
      expect(path.left).toBeLessThanOrEqual(100);
    }
    // Both halves of the sky, top to bottom and side to side.
    expect(passes.some((path) => path.top < 30) && passes.some((path) => path.top > 40)).toBe(true);
    expect(passes.some((path) => path.left < 50) && passes.some((path) => path.left > 60)).toBe(true);
  });

  it("sometimes drops streaks together, and keeps them together", () => {
    const timings = planShootingStarTimings(8, "full-sky");
    expect(new Set(timings.map((timing) => timing.duration)).size).toBe(1);
    const sorted = timings.map((timing) => timing.delay).sort((a, b) => a - b);
    const together = sorted.some((delay, index) => index > 0 && delay - sorted[index - 1] <= 0.8);
    const apart = sorted.some((delay, index) => index > 0 && delay - sorted[index - 1] >= 1.5);
    expect(together).toBe(true);
    expect(apart).toBe(true);
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
