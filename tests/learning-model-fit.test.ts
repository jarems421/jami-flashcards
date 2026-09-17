import { describe, expect, it } from "vitest";
import {
  FITTABLE_TUNING_FIELDS,
  fitLearningTuning,
  meanSquaredError,
  splitTimeForPredictions,
} from "@/lib/learning/evaluation/fit-tuning";
import { replayLearnerModelPredictions } from "@/lib/learning/evaluation/learner-model-evaluation";
import { DEFAULT_LEARNING_TUNING } from "@/lib/learning/scoring/tuning";
import type { LearningObservation } from "@/lib/learning/types";

/**
 * Does fitting the constants actually find anything?
 *
 * Real histories live in Firebase and cannot be reached from a test, so these
 * build students whose answers were generated from a known rule and ask whether
 * the fitter recovers it. That is the part worth testing: whether the search can
 * hear a signal it is supposed to hear, and stay quiet when there is none.
 */

const NOW = Date.UTC(2026, 8, 15);
const DAY = 24 * 60 * 60 * 1000;

/** Deterministic, so a failure is reproducible rather than a bad afternoon. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A student's answers, generated from a known ability.
 *
 * `ability` is the chance of getting an answer right, and may depend on which
 * topic it is and how far through the history the answer falls.
 */
function history(input: {
  topics: number;
  answersPerTopic: number;
  ability: (topic: number, step: number, total: number) => number;
  seed?: number;
}): LearningObservation[] {
  const next = random(input.seed ?? 1);
  const observations: LearningObservation[] = [];
  for (let step = 0; step < input.answersPerTopic; step += 1) {
    for (let topic = 0; topic < input.topics; topic += 1) {
      const chance = input.ability(topic, step, input.answersPerTopic);
      observations.push({
        kind: "flashcards",
        evidenceId: `e-${topic}-${step}`,
        // A fresh item each time: repetition of one item is capped, and that
        // cap is one of the things being fitted.
        itemId: `item-${topic}-${step}`,
        topicKeys: [`topic:${topic}`],
        score: next() < chance ? 1 : 0,
        weight: 1,
        count: 1,
        at: NOW - (input.answersPerTopic - step) * DAY,
        trendEligible: true,
        errorChecks: [],
      });
    }
  }
  return observations;
}

describe("fitting the model's constants", () => {
  it("never returns constants worse than the ones it started from", () => {
    const observations = history({
      topics: 4,
      answersPerTopic: 40,
      ability: () => 0.7,
    });
    const fit = fitLearningTuning(observations);
    expect(fit.fittedScore.trainMse ?? 1).toBeLessThanOrEqual((fit.baselineScore.trainMse ?? 0) + 1e-12);
  });

  it("finds a short memory when the student changed inside the fitted window", () => {
    const changed = fitLearningTuning(
      history({
        topics: 4,
        answersPerTopic: 40,
        // Hopeless at first, then reliably good. The turn has to fall inside
        // the part being fitted on, or there is nothing there to find.
        ability: (_topic, step, total) => (step < total * 0.4 ? 0.1 : 0.95),
        seed: 7,
      })
    );
    expect(changed.fitted.masteryRecencyHalfLifeDays).toBeLessThan(
      DEFAULT_LEARNING_TUNING.masteryRecencyHalfLifeDays
    );
  });

  it("stays quiet when a student never changed and the error is flat", () => {
    // Across half-lives from a week to three years this student's error moves
    // in the fourth decimal. A search that reported one of them would be
    // reporting noise.
    const steady = fitLearningTuning(
      history({ topics: 4, answersPerTopic: 40, ability: () => 0.75, seed: 7 })
    );
    expect(steady.fitted.masteryRecencyHalfLifeDays).toBe(
      DEFAULT_LEARNING_TUNING.masteryRecencyHalfLifeDays
    );
  });

  it("pools harder when every topic tells the same story than when they disagree", () => {
    const alike = fitLearningTuning(
      history({ topics: 6, answersPerTopic: 30, ability: () => 0.85, seed: 3 })
    );
    const mixed = fitLearningTuning(
      history({
        topics: 6,
        answersPerTopic: 30,
        // Half the topics near-perfect, half near-hopeless: the student's
        // average says nothing useful about any single topic.
        ability: (topic) => (topic % 2 === 0 ? 0.95 : 0.1),
        seed: 3,
      })
    );
    expect(alike.fitted.studentPriorStrength).toBeGreaterThanOrEqual(
      mixed.fitted.studentPriorStrength
    );
  });

  it("generalises to answers it was not fitted on", () => {
    const observations = history({ topics: 5, answersPerTopic: 40, ability: () => 0.8, seed: 11 });
    const fit = fitLearningTuning(observations);
    expect(fit.sufficient).toBe(true);
    expect(fit.fittedScore.holdoutMse ?? 1).toBeLessThanOrEqual(
      (fit.baselineScore.holdoutMse ?? 0) + 1e-9
    );
  });

  it("survives a student with no history at all", () => {
    // The first folder this was ever run against had no evidence in it, and a
    // split time of infinity reached a date formatter. Nothing here may throw.
    const fit = fitLearningTuning([]);
    expect(fit.changes).toEqual([]);
    expect(fit.sufficient).toBe(false);
    expect(fit.fitted).toEqual(DEFAULT_LEARNING_TUNING);
    expect(fit.fittedScore.trainMse).toBeNull();
    expect(Number.isFinite(fit.splitAt)).toBe(false);
  });

  it("survives evidence that exists but can never be replayed", () => {
    // Cards read from their running totals: real evidence, no dated history.
    const undated = history({ topics: 2, answersPerTopic: 20, ability: () => 0.8 }).map(
      (observation) => ({ ...observation, trendEligible: false })
    );
    const fit = fitLearningTuning(undated);
    expect(fit.fittedScore.trainPredictions + fit.fittedScore.holdoutPredictions).toBe(0);
    expect(fit.changes).toEqual([]);
  });

  it("says so when there is too little held back to judge", () => {
    const fit = fitLearningTuning(history({ topics: 1, answersPerTopic: 6, ability: () => 0.5 }));
    expect(fit.sufficient).toBe(false);
  });

  it("only offers to change constants a replay can actually speak to", () => {
    const observations = history({ topics: 3, answersPerTopic: 30, ability: () => 0.6 });
    const fit = fitLearningTuning(observations);
    for (const change of fit.changes) {
      expect(FITTABLE_TUNING_FIELDS).toContain(change.field);
    }
    // The memory model, the lapse blend and the trend label are scored nowhere
    // in a replay, so the fitter must leave them exactly as it found them.
    expect(fit.fitted.masteryHorizonDays).toBe(DEFAULT_LEARNING_TUNING.masteryHorizonDays);
    expect(fit.fitted.flashcardLapseWeight).toBe(DEFAULT_LEARNING_TUNING.flashcardLapseWeight);
    expect(fit.fitted.trendThreshold).toBe(DEFAULT_LEARNING_TUNING.trendThreshold);
  });
});

describe("the holdout split", () => {
  it("keeps back the later part of the history", () => {
    const observations = history({ topics: 3, answersPerTopic: 30, ability: () => 0.6 });
    const predictions = replayLearnerModelPredictions(observations);
    const splitAt = splitTimeForPredictions(predictions, 0.7);
    const before = predictions.filter((p) => p.at < splitAt).length;
    expect(before).toBeGreaterThan(0);
    expect(before).toBeLessThan(predictions.length);
    expect(meanSquaredError([])).toBeNull();
  });
});
