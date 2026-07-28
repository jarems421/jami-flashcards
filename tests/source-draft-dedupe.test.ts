import { describe, expect, it } from "vitest";

import {
  filterSourceFlashcardDrafts,
  filterSourceQuestionDrafts,
  getSourceDraftPromptKey,
} from "@/lib/ai/source-draft-quality";

const card = (front: string, back = "A sufficiently long answer.") => ({ front, back });

/**
 * The wordings below are real output from pressing Make twice on the same
 * source, which is how this was found.
 */
describe("skipping drafts that repeat one already awaiting review", () => {
  it("drops an exact repeat", () => {
    const existing = [getSourceDraftPromptKey("What is the primary function of photosynthesis?")];
    const kept = filterSourceFlashcardDrafts(
      [card("What is the primary function of photosynthesis?"), card("Where does the Calvin cycle happen?")],
      5,
      existing
    );

    expect(kept.map((draft) => draft.front)).toEqual(["Where does the Calvin cycle happen?"]);
  });

  it("drops a reworded repeat", () => {
    const existing = [
      getSourceDraftPromptKey(
        "What is another name for the light-independent reactions, where do they occur, and what is their main function?"
      ),
    ];
    const kept = filterSourceFlashcardDrafts(
      [
        card(
          "What is the name of the light-independent reactions, where do they occur, and what is their main function?"
        ),
      ],
      5,
      existing
    );

    expect(kept).toHaveLength(0);
  });

  it("drops a repeat that differs only by an adjective", () => {
    const existing = [
      getSourceDraftPromptKey(
        "Where do the light-dependent reactions occur, and what are their main products?"
      ),
    ];
    const kept = filterSourceFlashcardDrafts(
      [card("Where do the light-dependent reactions occur, and what are their key products?")],
      5,
      existing
    );

    expect(kept).toHaveLength(0);
  });

  it("keeps a question that only looks similar", () => {
    // One word apart, but light-dependent and light-independent are the two
    // halves of photosynthesis and deserve their own cards.
    const existing = [
      getSourceDraftPromptKey("Where do the light-dependent reactions occur?"),
    ];
    const kept = filterSourceFlashcardDrafts(
      [card("Where do the light-independent reactions occur?")],
      5,
      existing
    );

    expect(kept).toHaveLength(1);
  });

  it("keeps unrelated questions", () => {
    const existing = [getSourceDraftPromptKey("What is the overall equation for photosynthesis?")];
    const kept = filterSourceFlashcardDrafts(
      [
        card("Which pigment absorbs light, and at which wavelengths?"),
        card("What three factors limit the rate of photosynthesis?"),
      ],
      5,
      existing
    );

    expect(kept).toHaveLength(2);
  });

  it("also stops a batch repeating itself", () => {
    const kept = filterSourceFlashcardDrafts(
      [
        card("Where do the light-dependent reactions occur, and what are their main products?"),
        card("Where do the light-dependent reactions occur, and what are their key products?"),
      ],
      5
    );

    expect(kept).toHaveLength(1);
  });

  it("applies the same rule to practice questions", () => {
    const existing = [
      getSourceDraftPromptKey("Explain how a plant stores light energy as chemical energy."),
    ];
    const kept = filterSourceQuestionDrafts(
      [
        {
          questionText: "Explain how a plant stores light energy as chemical energy.",
          answerText: "Photosynthesis converts it into glucose.",
        },
        {
          questionText: "Describe the role of chlorophyll in absorbing specific wavelengths.",
          answerText: "It absorbs red and blue light.",
        },
      ],
      5,
      existing
    );

    expect(kept).toHaveLength(1);
    expect(kept[0].questionText).toMatch(/chlorophyll/);
  });

  it("is unaffected when nothing is waiting", () => {
    const kept = filterSourceFlashcardDrafts(
      [card("What is the primary function of photosynthesis?")],
      5
    );

    expect(kept).toHaveLength(1);
  });
});
