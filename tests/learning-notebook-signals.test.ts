import { describe, expect, it } from "vitest";
import {
  NOTEBOOK_EVIDENCE_WEIGHT,
  notebookObservations,
  type NotebookMarkedWorking,
} from "@/lib/learning/profile/notebook-signals";
import { masteryScore } from "@/lib/learning/scoring/mastery-score";
import { evidenceConfidence } from "@/lib/learning/scoring/confidence-score";
import { MIN_STRENGTH_CONFIDENCE } from "@/lib/learning/profile/thresholds";

const NOW = Date.parse("2026-09-21T10:00:00.000Z");

function marking(overrides: Partial<NotebookMarkedWorking> = {}): NotebookMarkedWorking {
  return {
    id: "m1",
    notebookId: "n1",
    pageId: "p1",
    topicIds: ["osmosis"],
    markedAt: NOW,
    result: { attempted: true, counted: true, awardedMarks: 3, maxMarks: 4 },
    ...overrides,
  };
}

describe("marked notebook working as evidence", () => {
  it("scores marked working against the credit it earned", () => {
    const [observation] = notebookObservations([marking()]);
    expect(observation?.kind).toBe("notebook");
    expect(observation?.score).toBeCloseTo(0.75, 5);
    expect(observation?.topicKeys).toEqual(["topic:osmosis"]);
    expect(observation?.trendEligible).toBe(true);
  });

  it("counts for less than an answer marked against a scheme", () => {
    const [observation] = notebookObservations([marking()]);
    expect(observation?.weight).toBe(NOTEBOOK_EVIDENCE_WEIGHT);
    expect(NOTEBOOK_EVIDENCE_WEIGHT).toBeLessThan(1);
  });

  it("cannot by itself make a topic read as well evidenced", () => {
    // A page marked every day for a fortnight is still one page, marked often.
    const markings = Array.from({ length: 14 }, (_, index) =>
      marking({ id: `m${index}`, markedAt: NOW - index * 86_400_000 })
    );
    const observations = notebookObservations(markings);
    expect(observations).toHaveLength(1);
    expect(evidenceConfidence(observations, NOW)).toBeLessThan(MIN_STRENGTH_CONFIDENCE);
  });

  it("counts a page once however many times it was marked", () => {
    const observations = notebookObservations([
      marking({ id: "m1", markedAt: NOW - 1000 }),
      marking({ id: "m2", markedAt: NOW }),
    ]);
    expect(observations).toHaveLength(1);
  });

  it("splits working that spans two topics between them", () => {
    const [observation] = notebookObservations([marking({ topicIds: ["osmosis", "diffusion"] })]);
    expect(observation?.topicShares).toEqual({
      "topic:osmosis": 0.5,
      "topic:diffusion": 0.5,
    });
  });

  it("drops working that cannot be placed on a topic", () => {
    expect(notebookObservations([marking({ topicIds: [] })])).toEqual([]);
    expect(notebookObservations([marking({ topicIds: ["  "] })])).toEqual([]);
  });

  it("drops a marking with no usable time or result", () => {
    expect(notebookObservations([marking({ markedAt: 0 })])).toEqual([]);
    expect(notebookObservations([marking({ result: { attempted: false } })])).toEqual([]);
  });

  it("moves a mastery estimate, but less than a marked exam answer would", () => {
    const notebook = notebookObservations([marking({ result: { attempted: true, counted: true, awardedMarks: 0, maxMarks: 4 } })]);
    const asExamAnswer = notebook.map((observation) => ({ ...observation, weight: 1 }));
    const neutral = masteryScore([], NOW);
    expect(masteryScore(notebook, NOW)).toBeLessThan(neutral);
    expect(masteryScore(notebook, NOW)).toBeGreaterThan(masteryScore(asExamAnswer, NOW));
  });
});
