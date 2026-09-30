import { describe, expect, it } from "vitest";
import {
  DEFAULT_REQUESTED_CARDS,
  MAX_EXCLUSION_FRONTS,
  buildFlashcardRequest,
  flashcardGenerationPrompt,
  readFlashcardDrafts,
} from "@/lib/learning/interventions/flashcard-request";
import { flashcardsToCreate } from "@/services/learning/flashcard-intervention.server";
import { MAX_GENERATED_CARDS, MIN_GENERATED_CARDS } from "@/lib/ai/card-generation";
import { servableExamSpecificationConcepts } from "@/lib/practice/exam-specification-concepts";

/**
 * Generating cards a student did not ask for, and never writing them.
 *
 * The invariants worth holding: a real concept, a recorded intervention, no
 * silent writes, and a failure that leaves the intervention honestly open
 * rather than quietly finished.
 */

const SPEC = "8300";
const REAL_CONCEPT = servableExamSpecificationConcepts(SPEC)[0]?.id ?? "";
const INTERVENTION = "folder:f1|low_mastery|spec:x";

function request(overrides: Record<string, unknown> = {}) {
  return buildFlashcardRequest({
    conceptId: REAL_CONCEPT,
    conceptLabel: "Ordering integers",
    specificationId: SPEC,
    interventionId: INTERVENTION,
    ...overrides,
  });
}

describe("asking for cards on a real concept", () => {
  it("accepts a concept the catalogue holds", () => {
    const built = request();
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.request.conceptId).toBe(REAL_CONCEPT);
    expect(built.request.interventionId).toBe(INTERVENTION);
  });

  it("cannot invent a specification concept", () => {
    expect(request({ conceptId: "not-in-any-catalogue" })).toEqual({
      ok: false,
      reason: "unknown_concept",
    });
  });

  it("refuses without a course to check the concept against", () => {
    expect(request({ specificationId: "" })).toEqual({ ok: false, reason: "no_specification" });
  });

  it("refuses without an intervention to attribute the cards to", () => {
    expect(request({ interventionId: "  " })).toEqual({
      ok: false,
      reason: "missing_intervention",
    });
  });

  it("keeps the requested count inside what the generator supports", () => {
    const many = request({ requestedCount: 500 });
    const few = request({ requestedCount: 1 });
    expect(many.ok && many.request.requestedCount).toBe(MAX_GENERATED_CARDS);
    expect(few.ok && few.request.requestedCount).toBe(MIN_GENERATED_CARDS);
    const standard = request();
    expect(standard.ok && standard.request.requestedCount).toBe(DEFAULT_REQUESTED_CARDS);
  });
});

describe("telling the model what already exists", () => {
  it("passes existing fronts through, deduplicated and bounded", () => {
    const fronts = Array.from({ length: MAX_EXCLUSION_FRONTS + 20 }, (_, i) => `Question ${i}`);
    const built = request({ existingFronts: [...fronts, "Question 0", "Question 0"] });
    expect(built.ok && built.request.existingFronts.length).toBe(MAX_EXCLUSION_FRONTS);
  });

  it("puts them in the prompt as things not to repeat", () => {
    const built = request({ existingFronts: ["What is a surd?"] });
    if (!built.ok) throw new Error("expected a request");
    const prompt = flashcardGenerationPrompt(built.request);
    expect(prompt).toContain("What is a surd?");
    expect(prompt).toContain("Do not write another card that asks the same thing");
  });

  it("says nothing about exclusions when there are none", () => {
    const built = request();
    if (!built.ok) throw new Error("expected a request");
    expect(flashcardGenerationPrompt(built.request)).not.toContain("already has cards");
  });
});

describe("judging what came back", () => {
  const existingFronts = ["What is a surd?"];

  it("keeps usable cards", () => {
    const read = readFlashcardDrafts(
      [
        { front: "Simplify root 12", back: "2 root 3" },
        { front: "Rationalise 1/root 2", back: "root 2 / 2" },
      ],
      { existingFronts }
    );
    expect(read.ok && read.drafts).toHaveLength(2);
  });

  it("drops a card the student already has, however it is punctuated", () => {
    const read = readFlashcardDrafts(
      [
        { front: "what is a SURD??", back: "An irrational root" },
        { front: "Simplify root 12", back: "2 root 3" },
      ],
      { existingFronts }
    );
    expect(read.ok && read.drafts).toHaveLength(1);
    expect(read.ok && read.droppedDuplicates).toBe(1);
  });

  it("drops a card the model repeated within its own answer", () => {
    const read = readFlashcardDrafts(
      [
        { front: "Simplify root 12", back: "2 root 3" },
        { front: "Simplify root 12", back: "2 root 3" },
      ],
      { existingFronts: [] }
    );
    expect(read.ok && read.drafts).toHaveLength(1);
  });

  it("fails closed on nothing usable", () => {
    expect(readFlashcardDrafts([], { existingFronts })).toEqual({
      ok: false,
      reason: "no_usable_cards",
    });
    expect(
      readFlashcardDrafts([{ front: "  ", back: "  " }], { existingFronts })
    ).toEqual({ ok: false, reason: "no_usable_cards" });
  });

  it("says so when every card was one the student already had", () => {
    // Better covered than the coverage signal thought, which is worth knowing.
    expect(
      readFlashcardDrafts([{ front: "What is a surd?", back: "x" }], { existingFronts })
    ).toEqual({ ok: false, reason: "all_duplicates" });
  });
});

describe("what gets written, once the student agrees", () => {
  it("attaches the concept and the intervention to every card", () => {
    const cards = flashcardsToCreate(
      [
        { front: "a", back: "1" },
        { front: "b", back: "2" },
      ],
      { conceptId: REAL_CONCEPT, interventionId: INTERVENTION }
    );
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card.topicIds).toEqual([REAL_CONCEPT]);
      expect(card.createdByInterventionId).toBe(INTERVENTION);
    }
  });

  it("carries no review state, because nobody has answered anything", () => {
    const [card] = flashcardsToCreate([{ front: "a", back: "1" }], {
      conceptId: REAL_CONCEPT,
      interventionId: INTERVENTION,
    });
    // Creating a card is not evidence. Only answering it is.
    expect(card).not.toHaveProperty("reps");
    expect(card).not.toHaveProperty("lastReview");
    expect(Object.keys(card).sort()).toEqual([
      "back",
      "createdByInterventionId",
      "front",
      "topicIds",
    ]);
  });
});
