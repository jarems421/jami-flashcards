import { describe, expect, it } from "vitest";
import { UNAVAILABLE, questionCountsFor } from "@/services/learning/concept-availability.server";
import { buildConceptCoverage } from "@/lib/learning/interventions/coverage";
import { selectIntervention, type InterventionAvailability } from "@/lib/learning/interventions/catalogue";
import type { LearningTopicState } from "@/lib/learning/types";

/**
 * Availability decides the action, never the diagnosis.
 *
 * These are the cases where a missing count would otherwise produce confident
 * product behaviour that is simply wrong: offering to build material that
 * already exists, or calling an outage a syllabus gap.
 */

const CONCEPT = "completing-the-square";

function state(overrides: Partial<LearningTopicState> = {}): LearningTopicState {
  return {
    topicKey: `spec:${CONCEPT}`,
    label: "Completing the square",
    source: "specification",
    provenance: "verified_specification",
    declared: true,
    exposure: { notebooks: 0, sources: 0, cards: 0 },
    demonstration: "none",
    memory: [],
    decision: { action: "diagnose", reason: "not_yet_assessed" },
    ...overrides,
  } as LearningTopicState;
}

const CAN_GENERATE = {
  canCreateFlashcards: true,
  canCreatePractice: true,
} satisfies Pick<InterventionAvailability, "canCreateFlashcards" | "canCreatePractice">;

function availabilityFor(counts: { practice?: number; pastPaper?: number }, cards = 0) {
  const coverage = buildConceptCoverage(
    state({ exposure: { notebooks: 0, sources: 0, cards } }),
    counts
  );
  return {
    hasFlashcards: coverage.coverage.flashcards > 0,
    hasPractice: coverage.coverage.practice > 0,
    hasPastPaper: coverage.coverage.pastPaper > 0,
    hasMaterial: coverage.coverage.material > 0,
    ...CAN_GENERATE,
  } satisfies InterventionAvailability;
}

describe("reading the two banks the profile cannot see", () => {
  it("reports nothing rather than zero when a bank could not be read", () => {
    const counts = questionCountsFor({ pastPaper: UNAVAILABLE, practice: UNAVAILABLE }, CONCEPT);
    // Absent, not zero: the caller must not read this as "the corpus is empty".
    expect(counts).toEqual({});
    expect(counts.pastPaper).toBeUndefined();
  });

  it("reports zero when a bank was read and genuinely holds nothing", () => {
    const counts = questionCountsFor(
      {
        pastPaper: { byConcept: {}, available: true },
        practice: { byConcept: { other: 4 }, available: true },
      },
      CONCEPT
    );
    expect(counts.pastPaper).toBe(0);
    expect(counts.practice).toBe(0);
  });

  it("passes real counts through per concept", () => {
    const counts = questionCountsFor(
      {
        pastPaper: { byConcept: { [CONCEPT]: 12 }, available: true },
        practice: { byConcept: { [CONCEPT]: 5 }, available: true },
      },
      CONCEPT
    );
    expect(counts).toEqual({ pastPaper: 12, practice: 5 });
  });
});

describe("a bank with questions is not a coverage gap", () => {
  it("does not offer to fill a gap the exam corpus already covers", () => {
    const choice = selectIntervention(state(), availabilityFor({ pastPaper: 12, practice: 0 }));
    expect(choice?.type).not.toBe("fill_specification_gap");
    expect(choice?.because).not.toBe("no_material_for_specification_concept");
  });

  it("does not offer to fill a gap generated practice already covers", () => {
    const choice = selectIntervention(state(), availabilityFor({ pastPaper: 0, practice: 6 }));
    expect(choice?.type).not.toBe("fill_specification_gap");
  });

  it("calls it a gap only when every bank was read and all were empty", () => {
    const choice = selectIntervention(state(), availabilityFor({ pastPaper: 0, practice: 0 }));
    expect(choice?.type).toBe("fill_specification_gap");
    expect(choice?.because).toBe("no_material_for_specification_concept");
  });

  it("never calls a student's own Topic a specification gap", () => {
    const choice = selectIntervention(
      state({ topicKey: "topic:mine", source: "student-topic" }),
      availabilityFor({ pastPaper: 0, practice: 0 })
    );
    expect(choice?.because).not.toBe("no_material_for_specification_concept");
  });
});

describe("availability changes the action, not the diagnosis", () => {
  const recallOnly = state({
    decision: { action: "practice", reason: "low_mastery" },
    signal: {
      mastery: 0.4,
      evidenceMastery: 0.4,
      confidence: 0.8,
      attempts: 10,
      uniqueItems: 10,
      dueCards: 0,
      lastSeenAt: Date.now(),
      evidence: ["flashcards"],
    },
  } as Partial<LearningTopicState>);

  it("keeps the same reason however the banks are stocked", () => {
    const withCorpus = selectIntervention(recallOnly, availabilityFor({ pastPaper: 20 }, 10));
    const withoutCorpus = selectIntervention(recallOnly, availabilityFor({ pastPaper: 0, practice: 0 }, 10));
    const nothingAtAll = selectIntervention(recallOnly, availabilityFor({}, 10));

    for (const choice of [withCorpus, withoutCorpus, nothingAtAll]) {
      expect(choice?.because).toBe("recall_strong_application_weak");
    }
    // Only the action moves.
    expect(withCorpus?.type).toBe("past_paper");
    expect(withoutCorpus?.type).toBe("create_practice");
  });

  it("does not let an unreadable bank turn a weakness into a coverage gap", () => {
    // Every count absent: the banks could not be asked. Cards exist, so there
    // is material -- and the diagnosis must not become "nothing is covered".
    const choice = selectIntervention(recallOnly, availabilityFor({}, 10));
    expect(choice?.because).toBe("recall_strong_application_weak");
  });
});
