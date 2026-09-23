import { describe, expect, it } from "vitest";
import {
  hasWorkableMaterial,
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

/**
 * The state the engine actually produces when recall holds up and application
 * does not: a practice decision, the gap it rests on, and the split behind it.
 * Recall comes from the concept itself unless a covering Topic is named.
 */
function applicationGap(
  recallFrom: { topicKey: string; label: string } = {
    topicKey: "spec:completing-the-square",
    label: "Completing the square",
  }
): LearningTopicState {
  return state({ action: "practice", reason: "low_mastery" }, {
    applicationGap: { recallFrom: recallFrom.topicKey, recallLabel: recallFrom.label },
    signal: {
      mastery: 0.5,
      evidenceMastery: 0.5,
      confidence: 0.8,
      attempts: 20,
      uniqueItems: 14,
      dueCards: 0,
      lastSeenAt: Date.now(),
      evidence: ["flashcards", "past-paper"],
      claims: {
        recall: { evidenceMastery: 0.92, confidence: 0.7, attempts: 14 },
        application: { evidenceMastery: 0.3, confidence: 0.65, attempts: 6 },
      },
    },
  } as Partial<LearningTopicState>);
}

const STUDENT_TOPIC: Partial<LearningTopicState> = {
  topicKey: "topic:quadratics",
  label: "Quadratics",
  source: "student-topic",
  provenance: "student_defined",
};

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
  it("offers to make cards when there are too few to revise from", () => {
    const choice = selectIntervention(
      state({ action: "teach", reason: "low_mastery" }, {
        ...withEvidence(["past-paper"]),
        exposure: { notebooks: 1, sources: 0, cards: 0 },
      }),
      { ...NOTHING, hasMaterial: true, hasPractice: true }
    );
    expect(choice?.type).toBe("create_flashcards");
    expect(choice?.because).toBe("weak_without_flashcards");
  });

  it("names the gap as application whether or not a corpus exists", () => {
    // The reason is about the student; the action is about what is available.
    const withCorpus = selectIntervention(applicationGap(), EVERYTHING);
    const withoutCorpus = selectIntervention(applicationGap(), { ...EVERYTHING, hasPastPaper: false });
    expect(withCorpus?.because).toBe("recall_strong_application_weak");
    expect(withoutCorpus?.because).toBe("recall_strong_application_weak");
    expect(withCorpus?.type).toBe("past_paper");
    expect(withoutCorpus?.type).toBe("create_practice");
  });

  it("names the Topic the recall came from when it is not the concept itself", () => {
    const own = selectIntervention(applicationGap(), EVERYTHING);
    const covering = selectIntervention(
      applicationGap({ topicKey: "topic:quadratics", label: "Quadratics" }),
      EVERYTHING
    );
    expect(own?.recallFrom).toBeUndefined();
    expect(covering?.recallFrom).toEqual({ topicKey: "topic:quadratics", label: "Quadratics" });
  });

  it("works through a confident weakness that has cards, rather than writing more", () => {
    const choice = selectIntervention(
      state({ action: "teach", reason: "low_mastery" }, withEvidence(["flashcards", "past-paper"])),
      { ...EVERYTHING, flashcardCount: 30 }
    );
    expect(choice?.because).toBe("evidenced_knowledge_gap");
    expect(choice?.type).not.toBe("create_flashcards");
  });

  it("never tells a student nothing is recorded about a concept they have answered", () => {
    const choice = selectIntervention(
      state({ action: "diagnose", reason: "low_confidence" }, withEvidence(["past-paper"])),
      EVERYTHING
    );
    expect(choice?.because).toBe("suspected_gap");
    expect(choice?.type).toBe("past_paper");
  });

  it("calls a decline slipping, not something the student knows", () => {
    for (const decision of [
      { action: "review", reason: "declining_mastery" },
      { action: "retrieve", reason: "knowledge_decay" },
      { action: "practice", reason: "knowledge_decay" },
    ] as const) {
      const choice = selectIntervention(
        state(decision, { ...STUDENT_TOPIC, ...withEvidence(["flashcards"]) }),
        { ...EVERYTHING, hasMaterial: true }
      );
      expect(choice?.because).toBe("slipping");
    }
  });
});

describe("the rest of the decisions", () => {
  it("teaches a well-evidenced gap on a Topic from its own page", () => {
    const choice = selectIntervention(
      state({ action: "teach", reason: "low_mastery" }, { ...STUDENT_TOPIC, ...withEvidence(["flashcards"]) }),
      EVERYTHING
    );
    expect(choice?.type).toBe("teach");
    expect(choice?.because).toBe("evidenced_knowledge_gap");
  });

  it("retrieves what is due", () => {
    const choice = selectIntervention(
      state({ action: "retrieve", reason: "due_for_retrieval" }, { ...STUDENT_TOPIC, ...withEvidence(["flashcards"]) }),
      EVERYTHING
    );
    expect(choice?.type).toBe("retrieve");
    expect(choice?.because).toBe("due_for_retrieval");
  });

  it("sends material seen but never tested to something that tests it", () => {
    const topic = selectIntervention(
      state({ action: "diagnose", reason: "untested_exposure" }, {
        ...STUDENT_TOPIC,
        exposure: { notebooks: 2, sources: 1, cards: 4 },
      }),
      { ...NOTHING, hasMaterial: true, hasFlashcards: true }
    );
    expect(topic?.type).toBe("retrieve");
    expect(topic?.because).toBe("material_never_tested");

    const concept = selectIntervention(
      state({ action: "diagnose", reason: "untested_exposure" }, {
        exposure: { notebooks: 2, sources: 1, cards: 0 },
      }),
      { ...NOTHING, hasMaterial: true }
    );
    expect(concept?.type).toBe("create_practice");
  });

  it("does not offer reading as a test", () => {
    // Notes and no cards on a Topic: nothing here can ask the student anything.
    const choice = selectIntervention(
      state({ action: "diagnose", reason: "untested_exposure" }, {
        ...STUDENT_TOPIC,
        exposure: { notebooks: 2, sources: 0, cards: 0 },
      }),
      { ...NOTHING, hasMaterial: true }
    );
    expect(choice).toBeUndefined();
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
    const choice = selectIntervention(applicationGap(), {
      hasFlashcards: false,
      hasPractice: false,
      hasPastPaper: false,
      hasMaterial: false,
      canCreateFlashcards: false,
      canCreatePractice: false,
    });
    expect(choice).toBeUndefined();
  });

  it("falls through to something that can be done", () => {
    // No corpus for this course, so real questions are not an option.
    const choice = selectIntervention(applicationGap(), { ...EVERYTHING, hasPastPaper: false });
    expect(choice?.type).toBe("create_practice");
  });

  it("does not offer retrieval with no cards to retrieve", () => {
    const choice = selectIntervention(
      state({ action: "retrieve", reason: "due_for_retrieval" }, { ...STUDENT_TOPIC, ...withEvidence(["flashcards"]) }),
      { ...EVERYTHING, hasFlashcards: false }
    );
    expect(choice?.type).not.toBe("retrieve");
  });

  it("offers each action only on a kind of concept that has somewhere to do it", () => {
    // A specification concept has no card queue or page of its own...
    const concept = selectIntervention(
      state({ action: "retrieve", reason: "due_for_retrieval" }, withEvidence(["flashcards"])),
      EVERYTHING
    );
    expect(concept).toBeUndefined();
    // ...and a student's Topic cannot be sent to the corpus or the writer.
    const topic = selectIntervention(
      state({ action: "diagnose", reason: "low_confidence" }, { ...STUDENT_TOPIC, ...withEvidence(["practice"]) }),
      { ...EVERYTHING, hasFlashcards: false }
    );
    expect(topic).toBeUndefined();
  });

  it("keeps the alternatives that were also possible", () => {
    const choice = selectIntervention(applicationGap(), EVERYTHING);
    expect(choice?.alternatives).toContain("create_practice");
    expect(choice?.alternatives).not.toContain(choice?.type);
  });
});

describe("the helpers the rules rest on", () => {
  it("knows when there is nothing to work from", () => {
    expect(hasWorkableMaterial(NOTHING)).toBe(false);
    expect(hasWorkableMaterial({ ...NOTHING, hasMaterial: true })).toBe(true);
  });

  it("does not call a concept with recorded answers uncovered", () => {
    const choice = selectIntervention(
      state({ action: "diagnose", reason: "low_confidence" }, withEvidence(["past-paper"])),
      NOTHING
    );
    expect(choice?.because).not.toBe("no_material_for_specification_concept");
  });

  it("is deterministic", () => {
    const subject = applicationGap();
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
    const choice = selectIntervention(applicationGap(), { ...unchecked, hasFlashcards: true });
    expect(choice?.type).toBe("past_paper");
  });

  it("stops offering them once the corpus is known to hold nothing", () => {
    const choice = selectIntervention(applicationGap(), {
      ...unchecked,
      hasFlashcards: true,
      hasPastPaper: false,
    });
    expect(choice?.type).not.toBe("past_paper");
  });
});
