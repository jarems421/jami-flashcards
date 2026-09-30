import { describe, expect, it } from "vitest";
import {
  MIN_INTERVENTION_SAMPLES,
  measureInterventionEffect,
} from "@/lib/learning/evaluation/intervention-effect";
import type { StudyActionEvent } from "@/lib/learning/events/study-action-event";
import type { LearningObservation } from "@/lib/learning/types";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-21T10:00:00.000Z");

function observation(topicKey: string, at: number, score: number, index: number): LearningObservation {
  return {
    kind: "flashcards",
    evidenceId: `${topicKey}-${index}`,
    itemId: `${topicKey}-item-${index}`,
    topicKeys: [topicKey],
    score,
    weight: 1,
    count: 1,
    at,
    trendEligible: true,
    errorChecks: [],
  };
}

function acted(topicKey: string, at: number): StudyActionEvent {
  return {
    id: `e-${topicKey}`,
    actionId: `folder:f1|low_mastery|${topicKey}`,
    reason: "low_mastery",
    targetKey: topicKey,
    folderId: "f1",
    outcome: "completed",
    at,
    studyDayKey: "2026-09-01",
  };
}

describe("measuring whether taken advice helps", () => {
  it("reports the change on topics acted on against topics that were not", () => {
    const actedAt = NOW - 10 * DAY;
    const observations: LearningObservation[] = [];
    const events: StudyActionEvent[] = [];

    // Topics that were acted on: poor before, better after.
    for (let index = 0; index < MIN_INTERVENTION_SAMPLES; index += 1) {
      const topicKey = `topic:acted-${index}`;
      observations.push(observation(topicKey, actedAt - 5 * DAY, 0.2, 0));
      observations.push(observation(topicKey, actedAt + 2 * DAY, 0.8, 1));
      events.push(acted(topicKey, actedAt));
    }
    // Topics nobody was sent to: unchanged over the same period.
    for (let index = 0; index < 5; index += 1) {
      const topicKey = `topic:untouched-${index}`;
      observations.push(observation(topicKey, actedAt - 5 * DAY, 0.5, 0));
      observations.push(observation(topicKey, actedAt + 2 * DAY, 0.5, 1));
    }

    const effect = measureInterventionEffect(events, observations, NOW);
    expect(effect.sufficient).toBe(true);
    expect(effect.acted.samples).toBe(MIN_INTERVENTION_SAMPLES);
    expect(effect.acted.meanChange).toBeCloseTo(0.6, 5);
    expect(effect.acted.improved).toBe(MIN_INTERVENTION_SAMPLES);
    expect(effect.untouched.meanChange).toBeCloseTo(0, 5);
    expect(effect.difference).toBeCloseTo(0.6, 5);
  });

  it("says so rather than presenting noise as a result", () => {
    const actedAt = NOW - 5 * DAY;
    const effect = measureInterventionEffect(
      [acted("topic:a", actedAt)],
      [observation("topic:a", actedAt - DAY, 0.2, 0), observation("topic:a", actedAt + DAY, 0.9, 1)],
      NOW
    );
    expect(effect.acted.samples).toBe(1);
    expect(effect.sufficient).toBe(false);
  });

  it("counts a topic once, at the first time the student acted on it", () => {
    const first = NOW - 20 * DAY;
    const later = NOW - 5 * DAY;
    const effect = measureInterventionEffect(
      [acted("topic:a", later), acted("topic:a", first)],
      [observation("topic:a", first - DAY, 0.4, 0), observation("topic:a", first + DAY, 0.6, 1)],
      NOW
    );
    expect(effect.acted.samples).toBe(1);
    expect(effect.outcomes[0]?.actedAt).toBe(first);
  });

  it("ignores advice that was only shown, and errors that name no topic", () => {
    const actedAt = NOW - 5 * DAY;
    const shown: StudyActionEvent = { ...acted("topic:a", actedAt), outcome: "shown" };
    const error: StudyActionEvent = {
      ...acted("topic:b", actedAt),
      targetKey: "error:units",
    };
    const observations = [
      observation("topic:a", actedAt - DAY, 0.2, 0),
      observation("topic:a", actedAt + DAY, 0.9, 1),
    ];
    const effect = measureInterventionEffect([shown, error], observations, NOW);
    expect(effect.acted.samples).toBe(0);
  });

  it("skips a topic with no answers on one side of the action", () => {
    const actedAt = NOW - 5 * DAY;
    const effect = measureInterventionEffect(
      [acted("topic:a", actedAt)],
      [observation("topic:a", actedAt + DAY, 0.9, 0)],
      NOW
    );
    expect(effect.acted.samples).toBe(0);
    expect(effect.difference).toBeNull();
  });
});
