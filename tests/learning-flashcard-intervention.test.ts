import { describe, expect, it } from "vitest";
import {
  MIN_USEFUL_FLASHCARDS,
  needsMoreFlashcards,
  selectIntervention,
  type InterventionAvailability,
} from "@/lib/learning/interventions/catalogue";
import { mapCardData } from "@/lib/study/cards";
import type { LearningTopicState } from "@/lib/learning/types";

/**
 * Creating cards is offered when cards are what is missing.
 *
 * The product rule this pins down: Jami does not answer "you are weak at this"
 * with "here are ten cards". Weakness is a fact about the student; needing
 * cards is a fact about what they have to work with, and only the second
 * justifies writing more.
 */

const BASE: InterventionAvailability = {
  hasFlashcards: false,
  hasPractice: true,
  hasPastPaper: true,
  hasMaterial: true,
  canCreateFlashcards: true,
  canCreatePractice: true,
};

function weakState(): LearningTopicState {
  return {
    topicKey: "spec:completing-the-square",
    label: "Completing the square",
    source: "specification",
    provenance: "verified_specification",
    declared: true,
    exposure: { notebooks: 1, sources: 0, cards: 0 },
    demonstration: "weak",
    memory: [],
    // What the engine decides for a confident weakness with no strong recall behind it.
    decision: { action: "teach", reason: "low_mastery" },
    signal: {
      topicKey: "spec:completing-the-square",
      topic: "Completing the square",
      topicSource: "specification",
      accuracy: 0.35,
      mastery: 0.35,
      evidenceMastery: 0.35,
      confidence: 0.82,
      attempts: 12,
      uniqueItems: 12,
      dueCards: 0,
      lastSeenAt: Date.now(),
      // No recall evidence, so this is not an application gap.
      evidence: ["past-paper", "practice"],
    },
  } as LearningTopicState;
}

describe("only when cards would add something", () => {
  it("offers cards when there are none", () => {
    expect(needsMoreFlashcards({ ...BASE, flashcardCount: 0 })).toBe(true);
    const choice = selectIntervention(weakState(), { ...BASE, flashcardCount: 0 });
    expect(choice?.type).toBe("create_flashcards");
    expect(choice?.because).toBe("weak_without_flashcards");
  });

  it("offers cards when there are too few to study from", () => {
    expect(needsMoreFlashcards({ ...BASE, hasFlashcards: true, flashcardCount: 1 })).toBe(true);
  });

  it("does not offer cards to a weak concept that already has plenty", () => {
    const stocked = { ...BASE, hasFlashcards: true, flashcardCount: 30 };
    expect(needsMoreFlashcards(stocked)).toBe(false);
    const choice = selectIntervention(weakState(), stocked);
    // Weak with cards means work through what exists, not write more.
    expect(choice?.type).not.toBe("create_flashcards");
    expect(choice?.because).toBe("evidenced_knowledge_gap");
  });

  it("stops offering exactly at the threshold", () => {
    expect(
      needsMoreFlashcards({ ...BASE, hasFlashcards: true, flashcardCount: MIN_USEFUL_FLASHCARDS })
    ).toBe(false);
    expect(
      needsMoreFlashcards({
        ...BASE,
        hasFlashcards: true,
        flashcardCount: MIN_USEFUL_FLASHCARDS - 1,
      })
    ).toBe(true);
  });

  it("falls back to presence when the count is unknown", () => {
    expect(needsMoreFlashcards({ ...BASE, hasFlashcards: true })).toBe(false);
    expect(needsMoreFlashcards({ ...BASE, hasFlashcards: false })).toBe(true);
  });

  it("never offers cards a deployment cannot write", () => {
    expect(
      needsMoreFlashcards({ ...BASE, flashcardCount: 0, canCreateFlashcards: false })
    ).toBe(false);
  });
});

describe("a card remembers which advice asked for it", () => {
  it("keeps the intervention on the card", () => {
    const card = mapCardData("c1", {
      deckId: "d1",
      userId: "u1",
      front: "a",
      back: "b",
      createdByInterventionId: "folder:f1|low_mastery|spec:completing-the-square",
    });
    expect(card.createdByInterventionId).toBe("folder:f1|low_mastery|spec:completing-the-square");
  });

  it("leaves a hand-written card unattributed", () => {
    const card = mapCardData("c1", { deckId: "d1", userId: "u1", front: "a", back: "b" });
    expect(card.createdByInterventionId).toBeUndefined();
  });

  it("does not treat creating a card as evidence of anything", () => {
    const card = mapCardData("c1", {
      deckId: "d1",
      userId: "u1",
      front: "a",
      back: "b",
      createdByInterventionId: "folder:f1|low_mastery|spec:x",
    });
    // No reviews, no repetitions: the card exists and says nothing about the
    // student until they answer it.
    expect(card.reps ?? 0).toBe(0);
    expect(card.lastReview).toBeUndefined();
  });
});
