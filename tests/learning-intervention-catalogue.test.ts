import { describe, expect, it } from "vitest";
import {
  hasWorkableMaterial,
  lacksApplicationEvidence,
  selectIntervention,
  type InterventionAvailability,
} from "@/lib/learning/interventions/catalogue";
import type {
  LearningEvidenceKind,
  LearningTopicDecision,
  LearningTopicState,
} from "@/lib/learning/types";

/**
 * Choosing what to do about a need, given what exists to do it with.
 *
 * The engine's decision is taken as given throughout. Nothing here may change
 * what the student is judged to need -- only how that need is acted on.
 */

const NOTHING: InterventionAvailability = {
  hasFlashcards: false,
  hasPractice: false,
  hasPastPaper: false,
  hasMaterial: false,
  canCreateFlashcards: true,
  canCreatePractice: true,
};

const EVERYTHING: InterventionAvailability = {
  hasFlashcards: true,
  hasPractice: true,
  hasPastPaper: true,
  hasMaterial: true,
  canCreateFlashcards: true,
  canCreatePractice: true,
};

function state(
  decision: LearningTopicDecision | undefined,
  overrides: Partial<LearningTopicState> = {}
): LearningTopicState {
  return {
    topicKey: "spec:completing-the-square",
    label: "Completing the square",
    source: "specification",
    provenance: "verified_specification",
    declared: true,
    exposure: { notebooks: 0, sources: 0, cards: 0 },
    demonstration: "weak",
    memory: [],
    ...(decision ? { decision } : {}),
    ...overrides,
  } as LearningTopicState;
}

function withEvidence(sources: LearningEvidenceKind[]): Partial<LearningTopicState> {
  return {
    signal: {
      mastery: 0.4,
      evidenceMastery: 0.4,
      confidence: 0.8,
      attempts: 8,
      uniqueItems: 8,
      dueCards: 0,
      lastSeenAt: Date.now(),
      evidence: sources,
    },
  } as Partial<LearningTopicState>;
}

describe("leaving the engine's decision alone", () => {
  it("offers nothing when the engine says leave it alone", () => {
    expect(
      selectIntervention(
        state({ action: "leave_alone", reason: "stable_strength" }),
        EVERYTHING
      )
    ).toBeUndefined();
  });

  it("offers nothing when the engine reached no decision", () => {
    expect(selectIntervention(state(undefined), EVERYTHING)).toBeUndefined();
  });
});

describe("coverage is not a claim about the student", () => {
  it("offers to build material for a specification concept that has none", () => {
    const choice = selectIntervention(
      state({ action: "diagnose", reason: "not_yet_assessed" }),
      NOTHING
    );
    expect(choice?.type).toBe("fill_specification_gap");
    expect(choice?.because).toBe("no_material_for_specification_concept");
  });

  it("does not treat a student's own Topic as a specification gap", () => {
    const choice = selectIntervention(
      state({ action: "diagnose", reason: "not_yet_assessed" }, {
        source: "student-topic",
        topicKey: "topic:mine",
      }),
      NOTHING
    );
    expect(choice?.because).not.toBe("no_material_for_specification_concept");
  });

  it("stops calling it a gap once there is material to work from", () => {
    const choice = selectIntervention(
      state({ action: "diagnose", reason: "not_yet_assessed" }),
      { ...NOTHING, hasFlashcards: true }
    );
    expect(choice?.type).not.toBe("fill_specification_gap");
  });
});

describe("weakness, and what is actually missing", () => {
  it("offers to make cards when there is nothing to retrieve from", () => {
    const choice = selectIntervention(
      state({ action: "practice", reason: "low_mastery" }, {
        ...withEvidence(["practice"]),
        exposure: { notebooks: 1, sources: 0, cards: 0 },
      }),
      { ...NOTHING, hasMaterial: true, hasPractice: true }
    );
    expect(choice?.type).toBe("create_flashcards");
    expect(choice?.because).toBe("weak_without_flashcards");
  });

  it("names the gap as application whether or not a corpus exists", () => {
    // The reason is about the student; the action is about what is available.
    const withCorpus = selectIntervention(
      state({ action: "practice", reason: "low_mastery" }, withEvidence(["flashcards"])),
      EVERYTHING
    );
    const withoutCorpus = selectIntervention(
      state({ action: "practice", reason: "low_mastery" }, withEvidence(["flashcards"])),
      { ...EVERYTHING, hasPastPaper: false }
    );
    expect(withCorpus?.because).toBe("recall_strong_application_weak");
    expect(withoutCorpus?.because).toBe("recall_strong_application_weak");
    expect(withCorpus?.type).toBe("past_paper");
    expect(withoutCorpus?.type).toBe("create_practice");
  });

  it("sends strong recall with weak application to real questions", () => {
    const choice = selectIntervention(
      state({ action: "practice", reason: "low_mastery" }, withEvidence(["flashcards"])),
      EVERYTHING
    );
    expect(choice?.type).toBe("past_paper");
    expect(choice?.because).toBe("recall_strong_application_weak");
  });

  it("practises normally when both kinds of evidence already exist", () => {
    const choice = selectIntervention(
      state({ action: "practice", reason: "low_mastery" }, withEvidence(["flashcards", "past-paper"])),
      EVERYTHING
    );
    expect(choice?.because).toBe("weak_with_flashcards");
  });
});

describe("the rest of the decisions", () => {
  it("teaches a well-evidenced gap", () => {
    const choice = selectIntervention(
      state({ action: "teach", reason: "low_mastery" }, withEvidence(["past-paper"])),
      EVERYTHING
    );
    expect(choice?.type).toBe("teach");
    expect(choice?.because).toBe("evidenced_knowledge_gap");
  });

  it("retrieves what is due", () => {
    const choice = selectIntervention(
      state({ action: "retrieve", reason: "due_for_retrieval" }, withEvidence(["flashcards"])),
      EVERYTHING
    );
    expect(choice?.type).toBe("retrieve");
    expect(choice?.because).toBe("due_for_retrieval");
  });

  it("sends material seen but never tested to be tested", () => {
    const choice = selectIntervention(
      state({ action: "diagnose", reason: "untested_exposure" }, {
        exposure: { notebooks: 2, sources: 1, cards: 0 },
      }),
      { ...NOTHING, hasMaterial: true }
    );
    expect(choice?.type).toBe("review_material");
    expect(choice?.because).toBe("material_never_tested");
  });

  it("consolidates a recent gain", () => {
    const choice = selectIntervention(
      state({ action: "reinforce", reason: "recent_improvement_needs_reinforcement" }, withEvidence(["flashcards"])),
      EVERYTHING
    );
    expect(choice?.because).toBe("recent_gain");
  });
});

describe("never offering what cannot be done", () => {
  it("offers nothing when no action is available at all", () => {
    const choice = selectIntervention(
      state({ action: "practice", reason: "low_mastery" }, withEvidence(["flashcards", "past-paper"])),
      {
        hasFlashcards: false,
        hasPractice: false,
        hasPastPaper: false,
        hasMaterial: false,
        canCreateFlashcards: false,
        canCreatePractice: false,
      }
    );
    expect(choice).toBeUndefined();
  });

  it("falls through to something that can be done", () => {
    // No corpus for this course, so real questions are not an option.
    const choice = selectIntervention(
      state({ action: "practice", reason: "low_mastery" }, withEvidence(["flashcards"])),
      { ...EVERYTHING, hasPastPaper: false }
    );
    expect(choice?.type).toBe("create_practice");
  });

  it("does not offer retrieval with no cards to retrieve", () => {
    const choice = selectIntervention(
      state({ action: "retrieve", reason: "due_for_retrieval" }, withEvidence(["flashcards"])),
      { ...EVERYTHING, hasFlashcards: false }
    );
    expect(choice?.type).not.toBe("retrieve");
  });

  it("keeps the alternatives that were also possible", () => {
    const choice = selectIntervention(
      state({ action: "practice", reason: "low_mastery" }, withEvidence(["flashcards"])),
      EVERYTHING
    );
    expect(choice?.alternatives).toContain("create_practice");
    expect(choice?.alternatives).not.toContain(choice?.type);
  });
});

describe("the helpers the rules rest on", () => {
  it("knows when there is nothing to work from", () => {
    expect(hasWorkableMaterial(NOTHING)).toBe(false);
    expect(hasWorkableMaterial({ ...NOTHING, hasMaterial: true })).toBe(true);
  });

  it("reads application from the kind of evidence, not its quality", () => {
    expect(lacksApplicationEvidence(state(undefined, withEvidence(["flashcards"])))).toBe(true);
    expect(lacksApplicationEvidence(state(undefined, withEvidence(["past-paper"])))).toBe(false);
    expect(lacksApplicationEvidence(state(undefined, withEvidence(["practice"])))).toBe(false);
    // No evidence at all is not the same as evidence of the wrong kind.
    expect(lacksApplicationEvidence(state(undefined))).toBe(false);
  });

  it("is deterministic", () => {
    const subject = state({ action: "practice", reason: "low_mastery" }, withEvidence(["flashcards"]));
    expect(selectIntervention(subject, EVERYTHING)).toEqual(
      selectIntervention(subject, EVERYTHING)
    );
  });
});

/**
 * Not having looked is not the same as having found nothing.
 *
 * Today cannot afford the bank lookups -- the corpus scan costs more than a
 * whole profile build -- so it passes what it knows and leaves the rest
 * undefined. The rules have to tell that apart from a bank that answered and
 * was empty, because only the second can justify telling a student their
 * specification is uncovered.
 */
describe("unknown availability", () => {
  const unchecked: InterventionAvailability = {
    hasFlashcards: false,
    hasMaterial: false,
    canCreateFlashcards: true,
    canCreatePractice: true,
    // hasPractice and hasPastPaper deliberately absent: nobody asked.
  };

  it("does not claim a specification gap when the banks were never asked", () => {
    const choice = selectIntervention(
      state({ action: "diagnose", reason: "not_yet_assessed" }),
      unchecked
    );
    expect(choice?.because).not.toBe("no_material_for_specification_concept");
  });

  it("does claim one when every bank answered and all were empty", () => {
    const choice = selectIntervention(
      state({ action: "diagnose", reason: "not_yet_assessed" }),
      { ...unchecked, hasPractice: false, hasPastPaper: false }
    );
    expect(choice?.because).toBe("no_material_for_specification_concept");
  });

  it("still offers real questions when nobody has checked the corpus", () => {
    // Otherwise Today would never suggest past papers, because it cannot
    // afford to find out whether they exist.
    const choice = selectIntervention(
      state({ action: "practice", reason: "low_mastery" }, withEvidence(["flashcards"])),
      { ...unchecked, hasFlashcards: true }
    );
    expect(choice?.type).toBe("past_paper");
  });

  it("stops offering them once the corpus is known to hold nothing", () => {
    const choice = selectIntervention(
      state({ action: "practice", reason: "low_mastery" }, withEvidence(["flashcards"])),
      { ...unchecked, hasFlashcards: true, hasPastPaper: false }
    );
    expect(choice?.type).not.toBe("past_paper");
  });
});
