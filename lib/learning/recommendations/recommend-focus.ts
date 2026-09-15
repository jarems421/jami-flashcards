import { hasExposure } from "@/lib/learning/profile/exposure";
import type {
  LearningError,
  LearningRecommendation,
  LearningRecommendationEvidence,
  LearningRecommendationReason,
  LearningRecommendationTarget,
  LearningTopicState,
} from "@/lib/learning/types";

/**
 * Reasons, strongest first.
 *
 * The order is the policy, and it is fixed so it can be explained: a recurring
 * error still costing marks outranks a topic in decline, then a strong topic
 * that is slipping, then a well-evidenced weak topic, then a suspicion that
 * needs checking. Retrieval of due cards and reinforcement of recent gains
 * follow. Material seen but never tested, and specification topics nobody has
 * tested, come last -- worth knowing about, never urgent.
 */
export const LEARNING_RECOMMENDATION_ORDER: readonly LearningRecommendationReason[] = [
  "persistent_error",
  "declining_mastery",
  "knowledge_decay",
  "low_mastery",
  "low_confidence",
  "due_for_retrieval",
  "recent_improvement_needs_reinforcement",
  "untested_exposure",
  "not_yet_assessed",
];

type Candidate = Omit<LearningRecommendation, "priority"> & {
  /** 0 to 1, orders candidates within one reason. */
  strength: number;
};

export type RecommendFocusInput = {
  topics: readonly LearningTopicState[];
  recurringErrors: readonly LearningError[];
};

function topicStrength(state: LearningTopicState, reason: LearningRecommendationReason) {
  const signal = state.signal;
  switch (reason) {
    case "declining_mastery":
    case "low_mastery":
    case "low_confidence":
      return signal ? (1 - signal.mastery) * signal.confidence : 0;
    case "knowledge_decay":
      return signal ? (signal.previousAccuracy ?? 0) - (signal.recentAccuracy ?? 0) : 0;
    case "due_for_retrieval":
      return signal ? 1 - 1 / (1 + signal.dueCards) : 0;
    case "recent_improvement_needs_reinforcement":
      return signal ? (signal.recentAccuracy ?? 0) - (signal.previousAccuracy ?? 0) : 0;
    case "untested_exposure": {
      const { notebooks, sources, cards } = state.exposure;
      return 1 - 1 / (1 + notebooks + sources + cards);
    }
    default:
      return 0;
  }
}

function topicEvidence(state: LearningTopicState): LearningRecommendationEvidence {
  const signal = state.signal;
  const lastEvidenceAt = signal?.lastSeenAt ?? state.exposure.lastExposedAt;
  return {
    count: signal?.attempts ?? 0,
    uniqueItems: signal?.uniqueItems ?? 0,
    ...(signal
      ? {
          mastery: signal.mastery,
          confidence: signal.confidence,
          ...(signal.trend ? { trend: signal.trend } : {}),
          ...(signal.recentAccuracy !== undefined ? { recentAccuracy: signal.recentAccuracy } : {}),
          ...(signal.previousAccuracy !== undefined ? { previousAccuracy: signal.previousAccuracy } : {}),
          ...(signal.dueCards > 0 ? { dueCards: signal.dueCards } : {}),
        }
      : {}),
    ...(hasExposure(state.exposure) ? { exposure: { ...state.exposure } } : {}),
    ...(lastEvidenceAt !== undefined ? { lastEvidenceAt } : {}),
    sources: signal?.evidence ?? [],
  };
}

function errorEvidence(error: LearningError): LearningRecommendationEvidence {
  return {
    count: error.occurrences,
    uniqueItems: error.uniqueItems,
    confidence: error.confidence,
    lastEvidenceAt: error.lastSeenAt,
    sources: error.evidence,
  };
}

export function recommendationTargetKey(target: LearningRecommendationTarget) {
  return target.kind === "topic" ? target.topicKey : `error:${target.category}`;
}

function clampStrength(value: number) {
  return Number.isFinite(value) ? Math.min(0.999, Math.max(0, value)) : 0;
}

function candidates(input: RecommendFocusInput): Candidate[] {
  const list: Candidate[] = [];

  for (const error of input.recurringErrors) {
    const target = { kind: "error", category: error.category, label: error.label } as const;
    if (error.status === "active") {
      list.push({
        reason: "persistent_error",
        action: "practice",
        target,
        evidence: errorEvidence(error),
        strength: error.confidence,
      });
    } else if (error.status === "improving") {
      list.push({
        reason: "recent_improvement_needs_reinforcement",
        action: "reinforce",
        target,
        evidence: errorEvidence(error),
        strength: error.confidence,
      });
    }
  }

  for (const state of input.topics) {
    const decision = state.decision;
    if (!decision || decision.action === "leave_alone" || decision.reason === "stable_strength") {
      continue;
    }
    // Finer, well-evidenced concepts carry this recommendation instead.
    if (state.deferredTo || (state.coveredBy?.length ?? 0) > 0) continue;
    list.push({
      reason: decision.reason,
      action: decision.action,
      target: { kind: "topic", topicKey: state.topicKey, label: state.label, source: state.source },
      evidence: topicEvidence(state),
      strength: topicStrength(state, decision.reason),
    });
  }

  return list;
}

/**
 * What should happen next, and why, decided by rule.
 *
 * Each target appears once, under its strongest reason, and every
 * recommendation carries the evidence behind it. A topic the engine decided to
 * leave alone never appears. Ties break on the most recent evidence and then
 * on the target's key, so the same evidence always gives the same list.
 */
export function recommendFocus(input: RecommendFocusInput, limit = 5): LearningRecommendation[] {
  const bands = LEARNING_RECOMMENDATION_ORDER.length;
  const ranked = candidates(input)
    .map(({ strength, ...candidate }) => ({
      candidate,
      priority:
        bands - LEARNING_RECOMMENDATION_ORDER.indexOf(candidate.reason) + clampStrength(strength),
    }))
    .sort(
      (left, right) =>
        right.priority - left.priority ||
        (right.candidate.evidence.lastEvidenceAt ?? 0) - (left.candidate.evidence.lastEvidenceAt ?? 0) ||
        recommendationTargetKey(left.candidate.target).localeCompare(
          recommendationTargetKey(right.candidate.target)
        )
    );

  const seen = new Set<string>();
  const recommendations: LearningRecommendation[] = [];
  for (const { candidate, priority } of ranked) {
    const key = recommendationTargetKey(candidate.target);
    if (seen.has(key)) continue;
    seen.add(key);
    recommendations.push({ ...candidate, priority });
    if (recommendations.length >= Math.max(0, limit)) break;
  }
  return recommendations;
}
