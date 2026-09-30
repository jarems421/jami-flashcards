import { describe, expect, it } from "vitest";
import {
  MIN_COVERED_ITEMS,
  buildConceptCoverage,
  describeCoverage,
  emptyCoverage,
  findCoverageGaps,
  isUntestedMaterial,
} from "@/lib/learning/interventions/coverage";
import type { LearningTopicState } from "@/lib/learning/types";

/**
 * Coverage is about the shelf, not the student.
 *
 * The whole reason it is a separate quantity is that the same fact supports
 * one sentence and not another: "this isn't covered in your material" is fair,
 * "you don't know this" is not.
 */

function state(overrides: Partial<LearningTopicState> = {}): LearningTopicState {
  return {
    topicKey: "spec:completing-the-square",
    label: "Completing the square",
    source: "specification",
    provenance: "verified_specification",
    declared: true,
    exposure: { notebooks: 0, sources: 0, cards: 0 },
    demonstration: "none",
    memory: [],
    ...overrides,
  } as LearningTopicState;
}

function withAttempts(attempts: number): Partial<LearningTopicState> {
  return {
    signal: {
      mastery: 0.5,
      evidenceMastery: 0.5,
      confidence: 0.4,
      attempts,
      uniqueItems: attempts,
      dueCards: 0,
      lastSeenAt: Date.now(),
      evidence: ["flashcards"],
    },
  } as Partial<LearningTopicState>;
}

describe("how well covered a concept is", () => {
  it("calls a concept with nothing at all uncovered", () => {
    const described = describeCoverage("spec:x", emptyCoverage(), false);
    expect(described.level).toBe("none");
    expect(described.missing).toEqual(["flashcards", "practice", "past-paper", "material"]);
  });

  it("wants one kind genuinely stocked rather than several thin ones", () => {
    // One of each is a concept nobody has built for yet.
    const scattered = describeCoverage(
      "spec:x",
      { flashcards: 1, practice: 1, pastPaper: 1, material: 1 },
      false
    );
    expect(scattered.level).toBe("partial");

    const stocked = describeCoverage(
      "spec:x",
      { ...emptyCoverage(), flashcards: MIN_COVERED_ITEMS },
      false
    );
    expect(stocked.level).toBe("covered");
  });

  it("says which kinds are missing", () => {
    const described = describeCoverage(
      "spec:x",
      { flashcards: 8, practice: 0, pastPaper: 0, material: 2 },
      true
    );
    expect(described.missing).toEqual(["practice", "past-paper"]);
  });
});

describe("material nobody has been tested on", () => {
  it("is coverage without evidence, and says so", () => {
    const described = describeCoverage(
      "spec:x",
      { ...emptyCoverage(), flashcards: 10 },
      false
    );
    expect(described.untested).toBe(true);
    expect(described.level).toBe("covered");
  });

  it("stops being untested once anything has been answered", () => {
    const described = describeCoverage("spec:x", { ...emptyCoverage(), flashcards: 10 }, true);
    expect(described.untested).toBe(false);
  });

  it("is not claimed for a concept with no material either", () => {
    expect(describeCoverage("spec:x", emptyCoverage(), false).untested).toBe(false);
  });

  it("agrees with the profile's own exposure reading", () => {
    expect(
      isUntestedMaterial(state({ exposure: { notebooks: 2, sources: 0, cards: 0 } }))
    ).toBe(true);
    expect(
      isUntestedMaterial(
        state({ exposure: { notebooks: 2, sources: 0, cards: 0 }, ...withAttempts(4) })
      )
    ).toBe(false);
    expect(isUntestedMaterial(state())).toBe(false);
  });
});

describe("building coverage from what the profile knows", () => {
  it("reads cards, notebooks and sources from exposure", () => {
    const built = buildConceptCoverage(
      state({ exposure: { notebooks: 2, sources: 1, cards: 7 } })
    );
    expect(built.coverage.flashcards).toBe(7);
    expect(built.coverage.material).toBe(3);
  });

  it("takes question counts from the caller, because the profile cannot see them", () => {
    const built = buildConceptCoverage(state(), { practice: 4, pastPaper: 6 });
    expect(built.coverage.practice).toBe(4);
    expect(built.coverage.pastPaper).toBe(6);
  });

  it("treats an absent count as nothing known, never as a negative", () => {
    const built = buildConceptCoverage(state(), { practice: -3 });
    expect(built.coverage.practice).toBe(0);
  });
});

describe("finding gaps in the specification", () => {
  const uncoveredTopic = state({ topicKey: "spec:a" });
  const thinTopic = state({ topicKey: "spec:b" });
  const studentTopic = state({ topicKey: "topic:mine", source: "student-topic" });
  const undeclared = state({ topicKey: "spec:c", declared: false });

  const states = [
    describeCoverage("spec:a", emptyCoverage(), false),
    describeCoverage("spec:b", { ...emptyCoverage(), flashcards: 1 }, false),
    describeCoverage("topic:mine", emptyCoverage(), false),
    describeCoverage("spec:c", emptyCoverage(), false),
  ];

  it("separates nothing at all from not very much", () => {
    const { uncovered, thin } = findCoverageGaps(states, [
      uncoveredTopic,
      thinTopic,
      studentTopic,
      undeclared,
    ]);
    expect(uncovered.map((entry) => entry.topicKey)).toEqual(["spec:a"]);
    expect(thin.map((entry) => entry.topicKey)).toEqual(["spec:b"]);
  });

  it("only reports concepts the specification actually declares", () => {
    const { uncovered } = findCoverageGaps(states, [
      uncoveredTopic,
      thinTopic,
      studentTopic,
      undeclared,
    ]);
    // A student's own Topic is not a hole in the syllabus.
    expect(uncovered.map((entry) => entry.topicKey)).not.toContain("topic:mine");
    // Nor is a catalogue concept this folder never declared.
    expect(uncovered.map((entry) => entry.topicKey)).not.toContain("spec:c");
  });
});
