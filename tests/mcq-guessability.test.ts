import { describe, expect, it } from "vitest";
import { buildMultipleChoiceQuestion } from "@/lib/study/mcq";
import { optionsLookGuessable, withoutStemEcho } from "@/lib/study/mcq-shape";
import { validateStudyAsset } from "@/lib/ai/study-assets";
import type { Card } from "@/lib/study/cards";

const FRONT = "What happens to a plant cell in pure water?";
const ECHOING_ANSWER =
  "When a plant cell is placed in pure water, water moves into the cell by osmosis, causing it to expand.";
const DISTRACTORS = [
  "Water moves into the cell by osmosis, causing it to burst.",
  "Water moves into the cell by active transport, causing it to expand.",
  "Water moves out of the cell by osmosis, causing it to shrink.",
];

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: "card-1",
    deckId: "deck-1",
    userId: "user-1",
    front: FRONT,
    back: ECHOING_ANSWER,
    createdAt: 1,
    tags: [],
    studySettings: { mcqDistractors: DISTRACTORS },
    ...overrides,
  };
}

describe("the question restated inside its own answer", () => {
  it("drops the lead-in no wrong option carries", () => {
    expect(withoutStemEcho(FRONT, ECHOING_ANSWER, DISTRACTORS)).toBe(
      "Water moves into the cell by osmosis, causing it to expand."
    );
  });

  it("keeps the lead-in when every option opens the same way", () => {
    const matched = DISTRACTORS.map(
      (distractor) => `When a plant cell is placed in pure water, ${distractor.toLowerCase()}`
    );
    expect(withoutStemEcho(FRONT, ECHOING_ANSWER, matched)).toBe(ECHOING_ANSWER);
  });

  it("shows the correct option without the restatement", () => {
    const question = buildMultipleChoiceQuestion({ card: card(), seed: 3 })!;
    const correct = question.options.find(
      (option) => option.id === question.correctOptionId
    )!;
    expect(correct.text).toBe("Water moves into the cell by osmosis, causing it to expand.");
    expect(correct.text.startsWith("When a plant cell")).toBe(false);
  });

  it("leaves the card's own answer alone", () => {
    const subject = card();
    buildMultipleChoiceQuestion({ card: subject, seed: 3 });
    expect(subject.back).toBe(ECHOING_ANSWER);
  });
});

describe("options a student could pick without knowing the material", () => {
  it("refuses a set where only the right answer is a full sentence", () => {
    expect(
      buildMultipleChoiceQuestion({
        card: card({
          front: "Which organelle makes ATP?",
          back: "The mitochondrion releases energy from glucose during aerobic respiration.",
          studySettings: {
            mcqDistractors: ["The ribosome", "The nucleus", "The lysosome"],
          },
        }),
        seed: 1,
      })
    ).toBeNull();
  });

  it("refuses a set where two of the three wrong options are the wrong length", () => {
    expect(
      optionsLookGuessable("Which organelle makes ATP?", "The mitochondrion", [
        "The ribosome",
        "The organelle that builds proteins from amino acids in the cytoplasm",
        "The membrane-bound sac that digests worn-out organelles",
      ])
    ).toBe(true);
  });

  it("accepts a set that is all the same shape", () => {
    expect(
      optionsLookGuessable("Which organelle makes ATP?", "The mitochondrion", [
        "The ribosome",
        "The nucleus",
        "The lysosome",
      ])
    ).toBe(false);
  });
});

describe("validating the variants a model wrote", () => {
  function asset(mcqVariants: unknown) {
    return validateStudyAsset(
      {
        cardId: "card-1",
        answerShape: "prose",
        acceptedAliases: [],
        requiredConcepts: [],
        clozeCandidates: [],
        distractors: [],
        misconceptions: {},
        confidence: 0.9,
        ambiguous: false,
        mcqVariants,
      },
      { id: "card-1", front: FRONT, back: ECHOING_ANSWER }
    );
  }

  const explanations = (options: string[]) =>
    Object.fromEntries(options.map((option) => [option, "Because of what it claims."]));

  it("keeps a variant whose options share one shape", () => {
    const correctAnswer = "Water moves into the cell by osmosis, causing it to expand.";
    const variant = {
      id: "mcq-1",
      correctAnswer,
      distractors: DISTRACTORS,
      explanations: explanations([correctAnswer, ...DISTRACTORS]),
    };
    expect(asset([variant])?.mcqVariants).toHaveLength(1);
  });

  it("discards a variant where only the right answer names the question", () => {
    const variant = {
      id: "mcq-1",
      correctAnswer: ECHOING_ANSWER,
      distractors: [
        "It bursts",
        "It shrinks",
        "It stays the same",
      ],
      explanations: explanations([
        ECHOING_ANSWER,
        "It bursts",
        "It shrinks",
        "It stays the same",
      ]),
    };
    expect(asset([variant])?.mcqVariants).toBeUndefined();
  });
});
