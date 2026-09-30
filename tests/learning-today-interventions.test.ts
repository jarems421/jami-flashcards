import { describe, expect, it } from "vitest";
import { buildStudyActions, cheapAvailability } from "@/lib/learning/actions/study-actions";
import { selectIntervention } from "@/lib/learning/interventions/catalogue";
import type { LearnerProfile, LearningTopicState } from "@/lib/learning/types";

/**
 * What Today can afford to know, and what it may say on that basis.
 *
 * The recommendation path pays nothing for the question banks -- the corpus
 * scan costs more than a whole profile build -- so it works from exposure
 * alone. The rule that matters is that not having asked never becomes a claim.
 */

function topic(overrides: Partial<LearningTopicState> = {}): LearningTopicState {
  return {
    topicKey: "spec:completing-the-square",
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

function profileWith(topics: LearningTopicState[]): LearnerProfile {
  return {
    scope: { folderId: "f1" },
    topics,
    recommendedFocus: topics
      .filter((entry) => entry.decision)
      .map((entry) => ({
        reason: entry.decision!.reason,
        action: entry.decision!.action,
        priority: 5,
        target: {
          kind: "topic" as const,
          topicKey: entry.topicKey,
          label: entry.label,
          source: entry.source,
        },
        evidence: { count: 0, uniqueItems: 0, sources: [] },
      })),
  } as unknown as LearnerProfile;
}

const CAN_GENERATE = { flashcards: true, practice: true };

describe("what Today knows for free", () => {
  it("reads cards and material from exposure", () => {
    const availability = cheapAvailability(
      topic({ exposure: { notebooks: 1, sources: 2, cards: 9 } }),
      { questionPracticeAvailable: true, canGenerate: CAN_GENERATE }
    );
    expect(availability.hasFlashcards).toBe(true);
    expect(availability.flashcardCount).toBe(9);
    expect(availability.hasMaterial).toBe(true);
  });

  it("leaves the banks unknown rather than guessing", () => {
    const availability = cheapAvailability(topic(), {
      questionPracticeAvailable: true,
      canGenerate: CAN_GENERATE,
    });
    // Nobody asked, so neither may be reported as empty.
    expect(availability.hasPractice).toBeUndefined();
    expect(availability.hasPastPaper).toBeUndefined();
  });

  it("does know the corpus is unavailable when the folder has no course", () => {
    const availability = cheapAvailability(topic(), {
      questionPracticeAvailable: false,
      canGenerate: CAN_GENERATE,
    });
    // This one is genuinely known, and cheaply: no course, no corpus.
    expect(availability.hasPastPaper).toBe(false);
  });
});

describe("an action that offers to make something", () => {
  /*
   * Today cannot claim a coverage gap, and this is by construction rather than
   * by oversight.
   *
   * Claiming one needs every bank to have answered and all to be empty. A
   * specification concept only exists when the folder has a course, and a
   * course means a corpus that would have to be scanned -- which costs more
   * than a whole profile build and so is never done here. So the gap claim
   * belongs to a surface where the student is already waiting, not to Today.
   */
  it("does not claim a coverage gap from signals that cannot establish one", () => {
    const [action] = buildStudyActions(profileWith([topic()]), {
      questionPracticeAvailable: false,
      canGenerate: CAN_GENERATE,
    });
    expect(action?.intervention?.because).not.toBe("no_material_for_specification_concept");
    // And it does not borrow the wording for material that exists but has
    // never been used, because here there may be none.
    expect(action?.intervention?.because).not.toBe("material_never_tested");
    // What it says instead: on the course, nothing recorded either way.
    expect(action?.intervention?.because).toBe("declared_but_unevidenced");
    expect(action?.intervention?.type).toBe("create_practice");
  });

  it("claims one only when the banks have been asked and were empty", () => {
    // What a surface that can afford the lookup would pass.
    const availability = {
      ...cheapAvailability(topic(), {
        questionPracticeAvailable: false,
        canGenerate: CAN_GENERATE,
      }),
      hasPractice: false,
      hasPastPaper: false,
    };
    expect(availability.hasPractice).toBe(false);
    expect(selectIntervention(topic(), availability)?.because).toBe(
      "no_material_for_specification_concept"
    );
  });

  it("does not offer to make anything a deployment cannot write", () => {
    const [action] = buildStudyActions(profileWith([topic()]), {
      questionPracticeAvailable: false,
      canGenerate: { flashcards: false, practice: false },
    });
    // No generator, so no offer. A promise the product cannot keep is worse
    // than saying nothing.
    expect(action?.intervention).toBeUndefined();
  });

  it("stops offering to build once the student has material", () => {
    const stocked = topic({ exposure: { notebooks: 0, sources: 0, cards: 12 } });
    const [action] = buildStudyActions(profileWith([stocked]), {
      questionPracticeAvailable: false,
      canGenerate: CAN_GENERATE,
    });
    expect(action?.intervention?.type).not.toBe("fill_specification_gap");
  });

  it("attaches no intervention to a recurring error", () => {
    const profile = {
      scope: { folderId: "f1" },
      topics: [],
      recommendedFocus: [
        {
          reason: "persistent_error",
          action: "practice",
          priority: 9,
          target: { kind: "error", category: "missing_units", label: "Missing units" },
          evidence: { count: 3, uniqueItems: 3, sources: ["past-paper"] },
        },
      ],
    } as unknown as LearnerProfile;
    const [action] = buildStudyActions(profile, {
      questionPracticeAvailable: true,
      canGenerate: CAN_GENERATE,
    });
    // An error spans topics and has no single body of material to ask about.
    expect(action?.intervention).toBeUndefined();
  });

  it("leaves the engine's own decision untouched", () => {
    const subject = topic();
    const [action] = buildStudyActions(profileWith([subject]), {
      questionPracticeAvailable: false,
      canGenerate: CAN_GENERATE,
    });
    // The intervention says how to meet the need; the decision says what it is.
    expect(action?.action).toBe(subject.decision?.action);
    expect(action?.reason).toBe(subject.decision?.reason);
  });
});
