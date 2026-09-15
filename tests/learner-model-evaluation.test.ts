import { describe, expect, it } from "vitest";
import {
  MIN_EVALUATION_PREDICTIONS,
  replayLearnerModelPredictions,
  summarizeLearnerModelEvaluation,
} from "@/lib/learning/evaluation/learner-model-evaluation";
import { evidenceConfidence } from "@/lib/learning/scoring/confidence-score";
import { masteryScore } from "@/lib/learning/scoring/mastery-score";
import type { LearningObservation } from "@/lib/learning/types";

/**
 * Measuring the learner model instead of trusting it.
 *
 * The replay must predict each answer from strictly earlier answers -- any
 * leakage from the answer being predicted would make a useless model look
 * perfect -- and it must refuse evidence it could not have replayed.
 */

const NOW = Date.UTC(2026, 8, 15, 12);
const DAY = 24 * 60 * 60 * 1000;

function observation(
  id: string,
  at: number,
  score: number,
  overrides: Partial<LearningObservation> = {}
): LearningObservation {
  return {
    kind: "flashcards",
    evidenceId: id,
    itemId: `card:${id}`,
    topicKeys: ["topic:eigen"],
    score,
    weight: 1,
    count: 1,
    at,
    trendEligible: true,
    errorChecks: [],
    ...overrides,
  };
}

describe("replaying the learner model", () => {
  it("predicts each answer from earlier answers only", () => {
    const first = observation("a", NOW - 3 * DAY, 1);
    const second = observation("b", NOW - 2 * DAY, 0);
    const third = observation("c", NOW - DAY, 1);
    const predictions = replayLearnerModelPredictions([third, first, second]);

    expect(predictions).toHaveLength(2);
    expect(predictions[0]).toEqual({
      topicKey: "topic:eigen",
      at: second.at,
      predictedMastery: masteryScore([first], second.at),
      confidence: evidenceConfidence([first], second.at),
      trend: "unknown",
      outcome: 0,
    });
    expect(predictions[1]?.predictedMastery).toBe(masteryScore([first, second], third.at));
  });

  it("replays a mixed answer as its share of each concept", () => {
    const mixed = {
      topicKeys: ["topic:algebra", "topic:quadratics", "topic:sequences"],
      topicShares: { "topic:algebra": 1, "topic:quadratics": 0.5, "topic:sequences": 0.5 },
    };
    const first = observation("a", NOW - 2 * DAY, 1, mixed);
    const second = observation("b", NOW - DAY, 0, mixed);
    const predictions = replayLearnerModelPredictions([first, second]);
    const confidenceFor = (topicKey: string) =>
      predictions.find((prediction) => prediction.topicKey === topicKey)?.confidence;

    expect(confidenceFor("topic:algebra")).toBe(evidenceConfidence([first], second.at));
    expect(confidenceFor("topic:quadratics")).toBe(evidenceConfidence([{ ...first, share: 0.5 }], second.at));
    expect(confidenceFor("topic:quadratics")).toBeLessThan(confidenceFor("topic:algebra") ?? 0);
  });

  it("does not count an answer recorded at the same moment as prior knowledge", () => {
    const predictions = replayLearnerModelPredictions([
      observation("a", NOW, 1),
      observation("b", NOW, 0),
    ]);
    expect(predictions).toEqual([]);
  });

  it("leaves out evidence with no dated history, and answers with no topic", () => {
    const predictions = replayLearnerModelPredictions([
      observation("agg-1", NOW - 2 * DAY, 1, { trendEligible: false }),
      observation("agg-2", NOW - DAY, 0, { trendEligible: false }),
      observation("p-1", NOW - 2 * DAY, 1, { kind: "practice", topicKeys: [] }),
      observation("p-2", NOW - DAY, 0, { kind: "practice", topicKeys: [] }),
    ]);
    expect(predictions).toEqual([]);
  });
});

describe("summarising an evaluation", () => {
  it("reports calibration, error by confidence and outcomes by trend, and flags a small sample", () => {
    const history = Array.from({ length: 12 }, (_, index) =>
      observation(`e${index}`, NOW - (12 - index) * DAY, index % 3 === 0 ? 0 : 1)
    );
    const predictions = replayLearnerModelPredictions(history);
    const summary = summarizeLearnerModelEvaluation(predictions);

    expect(summary.predictions).toBe(11);
    expect(summary.sufficient).toBe(predictions.length >= MIN_EVALUATION_PREDICTIONS);
    expect(summary.sufficient).toBe(false);
    expect(summary.calibration.reduce((total, bucket) => total + bucket.predictions, 0)).toBe(11);
    expect(summary.byConfidence.reduce((total, group) => total + group.predictions, 0)).toBe(11);
    expect(summary.byTrend.reduce((total, group) => total + group.predictions, 0)).toBe(11);
    expect(summary.meanSquaredError).toBeGreaterThan(0);
    expect(summary.meanSquaredError).toBeLessThan(1);
  });

  it("reports nothing rather than zeros when there is nothing to measure", () => {
    const summary = summarizeLearnerModelEvaluation([]);
    expect(summary).toMatchObject({ predictions: 0, sufficient: false, meanSquaredError: null });
    expect(summary.calibration.every((bucket) => bucket.meanPredicted === null)).toBe(true);
  });
});
