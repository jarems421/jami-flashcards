import { describe, expect, it } from "vitest";
import {
  buildFlashcardReviewEventWrite,
  decodeFlashcardReviewEvent,
} from "@/lib/learning/events/flashcard-review-event";
import { flashcardObservations } from "@/lib/learning/profile/flashcard-signals";
import { measureInterventionEffect } from "@/lib/learning/evaluation/intervention-effect";
import type { StudyActionEvent } from "@/lib/learning/events/study-action-event";
import type { LearningObservation } from "@/lib/learning/types";

const NOW = Date.parse("2026-09-21T10:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const ACTION = "folder:f1|low_mastery|topic:osmosis";

const REVIEW = {
  cardId: "c1",
  deckId: "d1",
  reviewedAt: NOW,
  studyDayKey: "2026-09-21",
  isCorrect: true,
  rating: "good" as const,
  sessionKind: "custom" as const,
};

/**
 * Which evidence belongs to which piece of advice.
 *
 * Timestamps cannot answer this. A student opens nine cards, does six, comes
 * back two days later and studies something unrelated -- and a window drawn
 * around the moment they acted would claim all of it. The id travels with the
 * answer instead.
 */
describe("attributing evidence to the intervention that caused it", () => {
  it("records the intervention on an answer given in its session", () => {
    const write = buildFlashcardReviewEventWrite({ ...REVIEW, interventionId: ACTION }, NOW);
    expect(write?.interventionId).toBe(ACTION);
    expect(decodeFlashcardReviewEvent("e1", { ...write })?.interventionId).toBe(ACTION);
  });

  it("leaves ordinary study unattributed", () => {
    const write = buildFlashcardReviewEventWrite(REVIEW, NOW);
    expect(write).not.toHaveProperty("interventionId");
    expect(decodeFlashcardReviewEvent("e1", { ...write })?.interventionId).toBeUndefined();
  });

  it("carries the attribution through to the observation the engine scores", () => {
    const card = {
      id: "c1",
      deckId: "d1",
      topicIds: ["osmosis"],
      reps: 2,
      lapses: 0,
      difficulty: 4,
      fsrsState: 2,
      stability: 20,
      lastReview: NOW - DAY,
      dueDate: NOW + DAY,
      createdAt: NOW - 40 * DAY,
    };
    const [observation] = flashcardObservations(
      [card] as never,
      [
        {
          id: "e1",
          cardId: "c1",
          deckId: "d1",
          reviewedAt: NOW - DAY,
          studyDayKey: "2026-09-20",
          correct: true,
          rating: "good",
          interventionId: ACTION,
        },
      ],
      NOW
    );
    expect(observation?.interventionId).toBe(ACTION);
  });

  it("counts how much of an intervention's evidence is actually its own", () => {
    const acted: StudyActionEvent = {
      id: "e",
      actionId: ACTION,
      reason: "low_mastery",
      targetKey: "topic:osmosis",
      folderId: "f1",
      outcome: "completed",
      at: NOW - 5 * DAY,
      studyDayKey: "2026-09-16",
    };
    const observation = (index: number, attributed: boolean): LearningObservation => ({
      kind: "flashcards",
      evidenceId: `o${index}`,
      itemId: `card-${index}`,
      topicKeys: ["topic:osmosis"],
      score: 1,
      weight: 1,
      count: 1,
      at: NOW - (index < 2 ? 6 : 4) * DAY,
      trendEligible: true,
      errorChecks: [],
      ...(attributed ? { interventionId: ACTION } : {}),
    });

    const effect = measureInterventionEffect(
      [acted],
      [
        // Two before the student acted, two after: one of the later pair was
        // produced inside the session Jami opened, the other merely followed it.
        observation(0, false),
        observation(1, false),
        observation(2, true),
        observation(3, false),
      ],
      NOW
    );
    expect(effect.acted.samples).toBe(1);
    expect(effect.outcomes[0]?.attributedAnswers).toBe(1);
    expect(effect.acted.withAttributedEvidence).toBe(1);
  });

  it("says plainly when an intervention produced no evidence of its own", () => {
    const acted: StudyActionEvent = {
      id: "e",
      actionId: ACTION,
      reason: "low_mastery",
      targetKey: "topic:osmosis",
      outcome: "started",
      at: NOW - 5 * DAY,
      studyDayKey: "2026-09-16",
    };
    const plain = (index: number, at: number): LearningObservation => ({
      kind: "flashcards",
      evidenceId: `o${index}`,
      itemId: `card-${index}`,
      topicKeys: ["topic:osmosis"],
      score: 1,
      weight: 1,
      count: 1,
      at,
      trendEligible: true,
      errorChecks: [],
    });
    const effect = measureInterventionEffect(
      [acted],
      [plain(0, NOW - 6 * DAY), plain(1, NOW - 4 * DAY)],
      NOW
    );
    // They opened it and produced nothing in it. A real outcome, not a gap.
    expect(effect.outcomes[0]?.attributedAnswers).toBe(0);
    expect(effect.acted.withAttributedEvidence).toBe(0);
  });
});
