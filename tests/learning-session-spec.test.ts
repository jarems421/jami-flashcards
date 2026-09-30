import { describe, expect, it } from "vitest";
import {
  STUDY_SESSION_ITEM_BOUNDS,
  buildStudySessionSpec,
  itemsToReachConfidence,
} from "@/lib/learning/actions/session-spec";
import { MIN_SIGNAL_CONFIDENCE } from "@/lib/learning/profile/thresholds";
import { confidenceFromEvidence } from "@/lib/learning/scoring/confidence-score";
import type { LearningRecommendation } from "@/lib/learning/types";

function recommendation(overrides: Partial<LearningRecommendation> = {}): LearningRecommendation {
  return {
    reason: "low_mastery",
    action: "practice",
    priority: 5,
    target: { kind: "topic", topicKey: "topic:osmosis", label: "Osmosis", source: "student-topic" },
    evidence: { count: 8, uniqueItems: 8, mastery: 0.3, confidence: 0.7, sources: ["flashcards"] },
    ...overrides,
  } as LearningRecommendation;
}

describe("sizing a session from what the engine wants to learn", () => {
  it("sizes a diagnosis by the evidence still needed to reach a conclusion", () => {
    const needed = itemsToReachConfidence(0);
    // Answering that many really does clear the floor the engine needs.
    expect(confidenceFromEvidence(needed)).toBeGreaterThanOrEqual(MIN_SIGNAL_CONFIDENCE);

    // A topic already near the floor needs far less than one with nothing behind it.
    expect(itemsToReachConfidence(MIN_SIGNAL_CONFIDENCE - 0.05)).toBeLessThan(needed);
  });

  it("asks for a short session once the floor is already cleared", () => {
    expect(itemsToReachConfidence(0.99)).toBe(STUDY_SESSION_ITEM_BOUNDS.min);
  });

  it("gives a weaker topic a longer session than a stronger one", () => {
    const weak = buildStudySessionSpec(
      recommendation({ evidence: { count: 8, uniqueItems: 8, mastery: 0.2, confidence: 0.7, sources: [] } }),
      { topicIds: ["osmosis"] }
    );
    const stronger = buildStudySessionSpec(
      recommendation({ evidence: { count: 8, uniqueItems: 8, mastery: 0.6, confidence: 0.7, sources: [] } }),
      { topicIds: ["osmosis"] }
    );
    expect(weak?.targetItems).toBeGreaterThan(stronger?.targetItems ?? 0);
  });

  it("never asks for a session no one would finish", () => {
    const spec = buildStudySessionSpec(
      recommendation({
        action: "retrieve",
        reason: "due_for_retrieval",
        evidence: { count: 400, uniqueItems: 400, dueCards: 400, sources: ["flashcards"] },
      }),
      { topicIds: ["osmosis"] }
    );
    expect(spec?.targetItems).toBeLessThanOrEqual(STUDY_SESSION_ITEM_BOUNDS.max);
    expect(spec?.targetItems).toBeGreaterThanOrEqual(STUDY_SESSION_ITEM_BOUNDS.min);
  });

  it("marks a diagnosis as one, and a retrieval as not", () => {
    const diagnose = buildStudySessionSpec(
      recommendation({ action: "diagnose", reason: "low_confidence" }),
      { topicIds: ["osmosis"] }
    );
    expect(diagnose?.diagnostic).toBe(true);
    expect(diagnose?.emphasis).toBe("diagnose");

    const retrieve = buildStudySessionSpec(
      recommendation({ action: "retrieve", reason: "due_for_retrieval" }),
      { topicIds: ["osmosis"] }
    );
    expect(retrieve?.diagnostic).toBe(false);
  });

  it("reads review as retrieval, because that is what recovering a slipping topic needs", () => {
    const spec = buildStudySessionSpec(
      recommendation({ action: "review", reason: "declining_mastery" }),
      { topicIds: ["osmosis"] }
    );
    expect(spec?.emphasis).toBe("retrieve");
  });

  it("produces nothing when there is nothing to work on", () => {
    expect(buildStudySessionSpec(recommendation(), {})).toBeUndefined();
    expect(buildStudySessionSpec(recommendation(), { topicIds: [] })).toBeUndefined();
  });

  it("carries the selection through unchanged", () => {
    const spec = buildStudySessionSpec(recommendation(), { conceptIds: ["quadratics"] });
    expect(spec?.selection).toEqual({ conceptIds: ["quadratics"] });
  });
});
