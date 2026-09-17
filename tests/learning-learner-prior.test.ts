import { describe, expect, it } from "vitest";
import {
  buildLearnerProfile,
  type LearnerEvidence,
} from "@/lib/learning/profile/build-learner-profile";
import type { FlashcardEvidenceCard } from "@/lib/learning/profile/flashcard-signals";
import { learnerPrior } from "@/lib/learning/scoring/learner-prior";
import { DEFAULT_LEARNING_TUNING } from "@/lib/learning/scoring/tuning";
import type { LearningObservation } from "@/lib/learning/types";

/**
 * Pooling a thin topic towards how the student does generally.
 *
 * The estimate and the decision are deliberately two different numbers here.
 * Pooling is right about the estimate -- one wrong answer from a strong student
 * probably is noise -- but a gap that only looks fine because of the student's
 * own average is the gap most worth finding, so nothing that decides what to
 * study is allowed to read the pooled number.
 */

const NOW = Date.UTC(2026, 8, 15, 12);
const DAY = 24 * 60 * 60 * 1000;

let sequence = 0;
function observation(score: number, overrides: Partial<LearningObservation> = {}): LearningObservation {
  sequence += 1;
  return {
    kind: "flashcards",
    evidenceId: `e-${sequence}`,
    itemId: `item-${sequence}`,
    topicKeys: ["topic:algebra"],
    score,
    weight: 1,
    count: 1,
    at: NOW,
    trendEligible: true,
    errorChecks: [],
    ...overrides,
  };
}

const many = (count: number, score: number) => Array.from({ length: count }, () => observation(score));

describe("the learner's own prior", () => {
  it("is the neutral one for a student with no history", () => {
    expect(learnerPrior([], NOW)).toBe(DEFAULT_LEARNING_TUNING.masteryPrior);
  });

  it("moves towards how the student actually does, once there is enough to say", () => {
    expect(learnerPrior(many(30, 1), NOW)).toBeGreaterThan(0.8);
    expect(learnerPrior(many(30, 0), NOW)).toBeLessThan(0.2);
  });

  it("barely moves on a couple of answers", () => {
    const thin = learnerPrior(many(2, 1), NOW);
    expect(thin).toBeGreaterThan(DEFAULT_LEARNING_TUNING.masteryPrior);
    expect(thin).toBeLessThan(0.7);
  });

  it("can be turned off, leaving exactly the old behaviour", () => {
    expect(
      learnerPrior(many(30, 1), NOW, { ...DEFAULT_LEARNING_TUNING, studentPriorStrength: 0 })
    ).toBe(DEFAULT_LEARNING_TUNING.masteryPrior);
  });
});

function card(id: string, topicId: string, overrides: Partial<FlashcardEvidenceCard> = {}): FlashcardEvidenceCard {
  return {
    id,
    deckId: "deck-1",
    topicIds: [topicId],
    reps: 6,
    lapses: 0,
    difficulty: 2,
    fsrsState: 2,
    lastReview: NOW - DAY,
    ...overrides,
  };
}

/** Strong across the folder, with one topic answered badly a couple of times. */
function strongStudentWithOneGap(): LearnerEvidence {
  return {
    cards: [
      ...Array.from({ length: 17 }, (_, index) => card(`s-${index}`, "sequences")),
      card("g-0", "gaps", { reps: 2, lapses: 2, difficulty: 9 }),
    ],
    flashcardReviewEvents: [],
    pastPaperAttempts: [],
    practicePaperAttempts: [],
    topicLabels: {
      "topic:sequences": { label: "Sequences", source: "student-topic" },
      "topic:gaps": { label: "Discriminants", source: "student-topic" },
    },
  };
}

describe("a strong student's thin weak topic", () => {
  const profile = buildLearnerProfile({
    scope: { folderId: "folder-1" },
    evidence: strongStudentWithOneGap(),
    now: NOW,
  });
  const gap = profile.topics.find((topic) => topic.topicKey === "topic:gaps");

  it("is estimated more kindly than its own evidence alone", () => {
    expect(gap?.signal).toBeDefined();
    expect(gap?.signal?.mastery ?? 0).toBeGreaterThan(gap?.signal?.evidenceMastery ?? 1);
  });

  it("is still classified on its own evidence, so the gap stays visible", () => {
    expect(gap?.demonstration).not.toBe("strong");
    const named =
      profile.weaknesses.some((signal) => signal.topicKey === "topic:gaps") ||
      profile.uncertain.some((signal) => signal.topicKey === "topic:gaps") ||
      gap?.decision !== undefined ||
      gap?.deferredTo !== undefined;
    expect(named).toBe(true);
  });

  it("does not let the student's average manufacture a strength", () => {
    expect(profile.strengths.some((signal) => signal.topicKey === "topic:gaps")).toBe(false);
  });
});
