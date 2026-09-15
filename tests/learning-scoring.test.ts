import { describe, expect, it } from "vitest";
import {
  confidenceFromEvidence,
  confidenceLabel,
  evidenceConfidence,
} from "@/lib/learning/scoring/confidence-score";
import { MAX_EVIDENCE_PER_ITEM, capItemWeights } from "@/lib/learning/scoring/item-weights";
import {
  MASTERY_PRIOR,
  masteryScore,
  recencyWeight,
  weightedAccuracy,
} from "@/lib/learning/scoring/mastery-score";
import { measureTrend } from "@/lib/learning/scoring/trend-score";

/**
 * The Learning Engine's arithmetic, pinned.
 *
 * Mastery and confidence are separate numbers on purpose, and most of what
 * these tests guard is that separation: thin or repetitive evidence must not
 * produce a confident claim in either direction.
 */

const NOW = Date.UTC(2026, 8, 15);
const DAY = 24 * 60 * 60 * 1000;

let sequence = 0;
function observation(
  score: number,
  overrides: Partial<{ itemId: string; weight: number; at: number; trendEligible: boolean }> = {}
) {
  sequence += 1;
  return {
    itemId: `item-${sequence}`,
    score,
    weight: 1,
    at: NOW,
    trendEligible: true,
    ...overrides,
  };
}

function many(count: number, score: number, overrides: Parameters<typeof observation>[1] = {}) {
  return Array.from({ length: count }, () => observation(score, overrides));
}

describe("mastery", () => {
  it("starts at the prior and needs evidence to move far from it", () => {
    expect(masteryScore([], NOW)).toBe(MASTERY_PRIOR);
    const oneWrong = masteryScore([observation(0)], NOW);
    expect(oneWrong).toBeLessThan(0.5);
    expect(oneWrong).toBeGreaterThan(0.2);
    expect(masteryScore(many(20, 1), NOW)).toBeGreaterThan(0.9);
  });

  it("lets recent work outweigh old work without rewriting the record", () => {
    expect(recencyWeight(NOW - 45 * DAY, NOW)).toBeCloseTo(0.5, 5);
    const history = [
      ...many(10, 0, { at: NOW - 180 * DAY }),
      ...many(5, 1, { at: NOW - DAY }),
    ];
    expect(masteryScore(history, NOW)).toBeGreaterThan(0.7);
    expect(weightedAccuracy(history)).toBeCloseTo(5 / 15, 5);
  });

  it("keeps a shared answer's accuracy but holds its estimate nearer the prior", () => {
    const whole = many(4, 1);
    const half = whole.map((item) => ({ ...item, share: 0.5 }));
    expect(weightedAccuracy(half)).toBe(weightedAccuracy(whole));
    expect(masteryScore(half, NOW)).toBeLessThan(masteryScore(whole, NOW));
    expect(masteryScore(half, NOW)).toBeGreaterThan(MASTERY_PRIOR);
  });
});

describe("repetition", () => {
  it("leaves a question and its half-weight retry untouched", () => {
    const capped = capItemWeights([
      { itemId: "question", weight: 2 },
      { itemId: "question", weight: 1 },
    ]);
    expect(capped.map((item) => item.weight)).toEqual([2, 1]);
  });

  it("does not let one card reviewed every day decide a topic", () => {
    const history = [...many(20, 1, { itemId: "same-card" }), ...many(3, 0)];
    expect(masteryScore(history, NOW)).toBeLessThan(0.5);
  });
});

describe("confidence", () => {
  it("separates three answers from seventeen from eighty-four", () => {
    expect(confidenceLabel(evidenceConfidence(many(3, 0.33), NOW))).toBe("low");
    expect(confidenceLabel(evidenceConfidence(many(17, 0.42), NOW))).toBe("high");
    expect(evidenceConfidence(many(84, 0.58), NOW)).toBeGreaterThan(0.99);
  });

  it("does not count retries of one question as independent evidence", () => {
    const retries = many(5, 1, { itemId: "same-question" });
    expect(evidenceConfidence(retries, NOW)).toBeCloseTo(
      confidenceFromEvidence(MAX_EVIDENCE_PER_ITEM),
      5
    );
  });

  it("counts an item that tests two concepts as half the evidence about each, however often it was answered", () => {
    const half = many(5, 1, { itemId: "mixed-card" }).map((item) => ({ ...item, share: 0.5 }));
    expect(evidenceConfidence(half, NOW)).toBeCloseTo(
      confidenceFromEvidence(MAX_EVIDENCE_PER_ITEM / 2),
      5
    );
  });

  it("loses confidence as evidence ages", () => {
    const lastYear = many(17, 0.42, { at: NOW - 365 * DAY });
    expect(confidenceLabel(evidenceConfidence(lastYear, NOW))).toBe("low");
  });
});

describe("trend", () => {
  it("claims nothing without two full windows of dated evidence", () => {
    expect(measureTrend(many(5, 1))).toBeNull();
    expect(measureTrend(many(12, 1, { trendEligible: false }))).toBeNull();
  });

  it("claims nothing when a window is one item answered repeatedly", () => {
    const history = [
      ...Array.from({ length: 3 }, (_, index) => observation(1, { at: NOW - (10 - index) * DAY })),
      ...Array.from({ length: 3 }, (_, index) =>
        observation(0, { itemId: "stubborn-card", at: NOW - (3 - index) * DAY })
      ),
    ];
    expect(measureTrend(history)).toBeNull();
  });

  it("compares the latest answers with the same number before them", () => {
    const declining = [
      ...Array.from({ length: 5 }, (_, index) => observation(0.9, { at: NOW - (20 - index) * DAY })),
      ...Array.from({ length: 5 }, (_, index) => observation(0.3, { at: NOW - (5 - index) * DAY })),
    ];
    expect(measureTrend(declining)).toEqual({
      trend: "declining",
      previousAccuracy: expect.closeTo(0.9, 5),
      recentAccuracy: expect.closeTo(0.3, 5),
    });

    const steady = [
      ...Array.from({ length: 5 }, (_, index) => observation(0.6, { at: NOW - (20 - index) * DAY })),
      ...Array.from({ length: 5 }, (_, index) => observation(0.65, { at: NOW - (5 - index) * DAY })),
    ];
    expect(measureTrend(steady)?.trend).toBe("stable");
  });
});
