import { describe, expect, it } from "vitest";
import { buildStudyActions, cheapAvailability } from "@/lib/learning/actions/study-actions";
import { practiceToStore } from "@/lib/learning/interventions/practice-store";
import { mapCardData } from "@/lib/study/cards";
import type { LearnerProfile, LearningTopicState } from "@/lib/learning/types";

/**
 * Where a piece of material came from, and whether it survives being stored.
 *
 * The intervention loop asks one question of everything Jami writes: did the
 * work we recommended actually happen? It can only be asked of material that
 * remembers which recommendation asked for it, so provenance being dropped on
 * the way into storage is not untidiness -- it silently removes the loop's
 * ability to answer at all, while every type in the codebase still claims it
 * is there.
 */

function topicState(overrides: Partial<LearningTopicState> = {}): LearningTopicState {
  return {
    topicKey: "spec:quad-complete",
    label: "Completing the square",
    source: "specification",
    declared: true,
    exposure: { notebooks: 0, sources: 0, cards: 0 },
    decision: { action: "practice", reason: "low_mastery" },
    ...overrides,
  } as LearningTopicState;
}

describe("material remembers what asked for it", () => {
  it("keeps the recommendation on a card it is read back from storage with", () => {
    const card = mapCardData("card-1", {
      deckId: "deck-1",
      userId: "u1",
      front: "What is completing the square?",
      back: "Rewriting ax^2+bx+c in the form a(x+p)^2+q.",
      topicIds: ["quad-complete"],
      createdAt: 1,
      createdByInterventionId: "folder:f1|low_mastery|topic:spec:quad-complete",
    });

    expect(card.createdByInterventionId).toBe(
      "folder:f1|low_mastery|topic:spec:quad-complete"
    );
  });

  it("attaches the concept to generated questions at the moment they are stored", () => {
    const { questions, markScheme } = practiceToStore(
      [
        {
          prompt: "Solve x^2 + 6x + 5 = 0 by completing the square.",
          marks: 3,
          answer: "(x+3)^2 - 4 = 0, so x = -1 or x = -5.",
          points: [
            { marks: 1, text: "Writes (x+3)^2 - 4" },
            { marks: 1, text: "Rearranges to (x+3)^2 = 4" },
            { marks: 1, text: "Both roots" },
          ],
        },
      ],
      { conceptId: "quad-complete", interventionId: "folder:f1|low_mastery|topic:spec:quad-complete" }
    );

    // Attached here rather than inferred later: this is what makes an attempt
    // land on the right concept in the profile.
    expect(questions[0]?.conceptIds).toEqual(["quad-complete"]);

    // Narrowed explicitly: a mark scheme item can be banded instead of
    // additive, and only an additive one has points to add up.
    const item = markScheme[0];
    expect(item).toBeDefined();
    if (!item || item.marking !== "additive") throw new Error("expected an additive scheme");
    const awarded = item.points.reduce((sum, point) => sum + point.marks, 0);
    expect(awarded).toBe(questions[0]?.marks);
  });
});

describe("what a deployment is allowed to offer", () => {
  it("offers nothing generative when this deployment cannot write material", () => {
    const availability = cheapAvailability(topicState(), {
      questionPracticeAvailable: false,
    });

    expect(availability.canCreateFlashcards).toBe(false);
    expect(availability.canCreatePractice).toBe(false);
    // Nobody asked the banks, so they are unknown rather than empty.
    expect(availability.hasPractice).toBeUndefined();
  });

  it("offers to write cards once the deployment can, and the concept has none", () => {
    const availability = cheapAvailability(topicState(), {
      questionPracticeAvailable: false,
      canGenerate: { flashcards: true, practice: true },
    });

    expect(availability.canCreateFlashcards).toBe(true);
    expect(availability.hasFlashcards).toBe(false);
  });

  it("reaches a generating intervention only when generation is switched on", () => {
    const profile = {
      scope: { folderId: "f1" },
      topics: [topicState({ decision: { action: "diagnose", reason: "not_yet_assessed" } })],
      recommendedFocus: [
        {
          reason: "not_yet_assessed" as const,
          action: "diagnose" as const,
          priority: 2,
          target: {
            kind: "topic" as const,
            topicKey: "spec:quad-complete",
            label: "Completing the square",
            source: "specification" as const,
          },
          evidence: { count: 0, uniqueItems: 0, sources: [] },
        },
      ],
    } as unknown as LearnerProfile;

    const without = buildStudyActions(profile, { questionPracticeAvailable: true });
    const with_ = buildStudyActions(profile, {
      questionPracticeAvailable: true,
      canGenerate: { flashcards: true, practice: true },
    });

    expect(without[0]?.intervention?.type).not.toBe("create_practice");
    expect(with_[0]?.intervention?.type).toBe("create_practice");
  });
});
