import { groupObservationsByTopic } from "@/lib/learning/profile/observations";
import {
  confidenceLabel,
  evidenceConfidence,
  type ConfidenceLabel,
} from "@/lib/learning/scoring/confidence-score";
import { clampUnit, masteryScore } from "@/lib/learning/scoring/mastery-score";
import { measureTrend } from "@/lib/learning/scoring/trend-score";
import type { LearningObservation, LearningTrend } from "@/lib/learning/types";

/**
 * Does the learner model predict anything?
 *
 * Replays a student's dated evidence in order. Before each answer on a topic,
 * the model is rebuilt from that topic's earlier answers only, and its mastery
 * estimate is recorded next to what then happened. Nothing from the answer or
 * after it leaks into the prediction.
 *
 * Only dated evidence can be replayed: recorded review events and marked
 * answers. A card read from its aggregate totals has no history to replay, so
 * it takes no part -- an evaluation over it would grade the model on data it
 * could not have had.
 *
 * These are observational measurements of prediction quality, not claims
 * about causes. A summary below the minimum sample says so rather than
 * presenting noise as a result.
 */

export const LEARNER_MODEL_EVALUATION_VERSION = "learner-model-evaluation-v2-2026-09-15";
/** Below this many predictions the numbers describe noise, and the summary says so. */
export const MIN_EVALUATION_PREDICTIONS = 30;
export const CALIBRATION_BUCKET_COUNT = 5;

export type LearnerModelPrediction = {
  topicKey: string;
  at: number;
  predictedMastery: number;
  confidence: number;
  trend: LearningTrend | "unknown";
  /** 0 to 1: the credit the answer actually earned. */
  outcome: number;
};

export type CalibrationBucket = {
  lower: number;
  upper: number;
  predictions: number;
  meanPredicted: number | null;
  meanOutcome: number | null;
};

export type LearnerModelEvaluation = {
  version: string;
  predictions: number;
  /** Whether there are enough predictions for the numbers to mean anything. */
  sufficient: boolean;
  /** Mean squared gap between predicted mastery and the credit earned. Lower is better. */
  meanSquaredError: number | null;
  calibration: CalibrationBucket[];
  byConfidence: { confidence: ConfidenceLabel; predictions: number; meanAbsoluteError: number | null }[];
  byTrend: { trend: LearningTrend | "unknown"; predictions: number; meanOutcome: number | null }[];
};

export function replayLearnerModelPredictions(
  observations: readonly LearningObservation[]
): LearnerModelPrediction[] {
  const byTopic = groupObservationsByTopic(
    observations.filter((observation) => observation.trendEligible)
  );

  const predictions: LearnerModelPrediction[] = [];
  for (const topicKey of Array.from(byTopic.keys()).sort()) {
    const ordered = [...(byTopic.get(topicKey) ?? [])].sort(
      (left, right) => left.at - right.at || left.evidenceId.localeCompare(right.evidenceId)
    );
    let priorCount = 0;
    ordered.forEach((current, index) => {
      // Strictly earlier answers only: one recorded at the same moment is not prior knowledge.
      while (priorCount < index && (ordered[priorCount]?.at ?? Number.POSITIVE_INFINITY) < current.at) {
        priorCount += 1;
      }
      if (priorCount === 0) return;
      const prior = ordered.slice(0, priorCount);
      predictions.push({
        topicKey,
        at: current.at,
        predictedMastery: masteryScore(prior, current.at),
        confidence: evidenceConfidence(prior, current.at),
        trend: measureTrend(prior)?.trend ?? "unknown",
        outcome: clampUnit(current.score),
      });
    });
  }
  return predictions.sort((left, right) => left.at - right.at || left.topicKey.localeCompare(right.topicKey));
}

function mean(values: readonly number[]) {
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

export function summarizeLearnerModelEvaluation(
  predictions: readonly LearnerModelPrediction[]
): LearnerModelEvaluation {
  const calibration: CalibrationBucket[] = Array.from({ length: CALIBRATION_BUCKET_COUNT }, (_, index) => {
    const lower = index / CALIBRATION_BUCKET_COUNT;
    const upper = (index + 1) / CALIBRATION_BUCKET_COUNT;
    const inBucket = predictions.filter(
      (prediction) =>
        prediction.predictedMastery >= lower &&
        (prediction.predictedMastery < upper || (index === CALIBRATION_BUCKET_COUNT - 1 && prediction.predictedMastery <= upper))
    );
    return {
      lower,
      upper,
      predictions: inBucket.length,
      meanPredicted: mean(inBucket.map((prediction) => prediction.predictedMastery)),
      meanOutcome: mean(inBucket.map((prediction) => prediction.outcome)),
    };
  });

  const confidenceLevels: ConfidenceLabel[] = ["low", "medium", "high"];
  const trends: (LearningTrend | "unknown")[] = ["improving", "stable", "declining", "unknown"];

  return {
    version: LEARNER_MODEL_EVALUATION_VERSION,
    predictions: predictions.length,
    sufficient: predictions.length >= MIN_EVALUATION_PREDICTIONS,
    meanSquaredError: mean(
      predictions.map((prediction) => (prediction.predictedMastery - prediction.outcome) ** 2)
    ),
    calibration,
    byConfidence: confidenceLevels.map((confidence) => {
      const matching = predictions.filter((prediction) => confidenceLabel(prediction.confidence) === confidence);
      return {
        confidence,
        predictions: matching.length,
        meanAbsoluteError: mean(
          matching.map((prediction) => Math.abs(prediction.predictedMastery - prediction.outcome))
        ),
      };
    }),
    byTrend: trends.map((trend) => {
      const matching = predictions.filter((prediction) => prediction.trend === trend);
      return {
        trend,
        predictions: matching.length,
        meanOutcome: mean(matching.map((prediction) => prediction.outcome)),
      };
    }),
  };
}
