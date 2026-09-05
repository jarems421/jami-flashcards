import { describe, expect, it } from "vitest";
import {
  classifyAnswerShape,
  markTypedAnswer,
  normalizeAnswerText,
} from "@/lib/study/answer-marking";
import {
  markClozeAnswer,
  renderClozeBlank,
  renderClozePrompt,
  selectClozeSpan,
} from "@/lib/study/gap-fill";
import {
  buildDeterministicExercise,
  getGapFillEligibility,
  getModeEligibility,
  getTypeAnswerEligibility,
  needsStudyAssetPreparation,
  resolveSmartMixMode,
} from "@/lib/study/mode-eligibility";
import {
  resolveAttemptOutcome,
  type StudyMode,
} from "@/lib/study/study-modes";
import type { Card } from "@/lib/study/cards";

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: "card-1",
    deckId: "deck-1",
    userId: "user-1",
    front: "What is ATP?",
    back: "The immediate energy carrier used by every cell.",
    createdAt: 1,
    tags: [],
    ...overrides,
  };
}

describe("the marking contract", () => {
  it("commits Good only for a clean, unaided match", () => {
    expect(resolveAttemptOutcome("correct")).toEqual({
      kind: "commit",
      rating: "good",
      verdict: "correct",
    });
  });

  it("commits Again for a wrong answer, hint or no hint", () => {
    expect(resolveAttemptOutcome("incorrect")).toEqual({
      kind: "commit",
      rating: "again",
      verdict: "incorrect",
    });
    expect(resolveAttemptOutcome("incorrect", { hintUsed: true })).toEqual({
      kind: "commit",
      rating: "again",
      verdict: "incorrect",
    });
  });

  it("never awards Hard automatically", () => {
    // Hard is a *successful* recall in FSRS: it still grows the interval. A
    // half-right or assisted answer must never buy one.
    const verdicts = ["correct", "close", "partial", "incorrect", "needs-self-grade"] as const;
    for (const verdict of verdicts) {
      for (const hintUsed of [false, true]) {
        const outcome = resolveAttemptOutcome(verdict, { hintUsed });
        if (outcome.kind === "commit") {
          expect(outcome.rating).not.toBe("hard");
          expect(outcome.rating).not.toBe("easy");
        }
      }
    }
  });

  it("hands a hinted success back to the student", () => {
    expect(resolveAttemptOutcome("correct", { hintUsed: true })).toEqual({
      kind: "self-grade",
      verdict: "correct",
    });
  });

  it("hands every ambiguous verdict back to the student", () => {
    for (const verdict of ["close", "partial", "needs-self-grade"] as const) {
      expect(resolveAttemptOutcome(verdict).kind).toBe("self-grade");
    }
  });
});

describe("normalising a typed answer", () => {
  it("ignores case, spacing, smart quotes, a leading article and a full stop", () => {
    expect(normalizeAnswerText("  The  Krebs   cycle. ")).toBe("krebs cycle");
    expect(normalizeAnswerText("Ohm’s law")).toBe("ohm's law");
  });

  it("keeps accents, because they can change the word", () => {
    expect(normalizeAnswerText("resumé")).not.toBe(normalizeAnswerText("resume"));
  });
});

describe("marking short factual answers", () => {
  it("accepts an exact match and an author alias", () => {
    expect(
      markTypedAnswer({ response: "the krebs cycle", expectedAnswer: "Krebs cycle" })
        .verdict
    ).toBe("correct");
    expect(
      markTypedAnswer({
        response: "citric acid cycle",
        expectedAnswer: "Krebs cycle",
        settings: { acceptedAnswers: ["citric acid cycle"] },
      }).verdict
    ).toBe("correct");
  });

  it("calls a clear miss incorrect", () => {
    expect(
      markTypedAnswer({ response: "glycolysis", expectedAnswer: "Krebs cycle" })
        .verdict
    ).toBe("incorrect");
  });

  it("treats a typo as close rather than wrong", () => {
    expect(
      markTypedAnswer({ response: "mitochondira", expectedAnswer: "mitochondria" })
        .verdict
    ).toBe("close");
  });

  it("treats a punctuation-only difference as close", () => {
    expect(
      markTypedAnswer({ response: "ohms law", expectedAnswer: "Ohm's law" })
        .verdict
    ).toBe("close");
  });
});

describe("marking numbers", () => {
  it("accepts the same value written differently", () => {
    expect(
      markTypedAnswer({ response: "1,500 m", expectedAnswer: "1500 m" }).verdict
    ).toBe("correct");
  });

  it("rejects a different value", () => {
    expect(
      markTypedAnswer({ response: "9.6 m/s^2", expectedAnswer: "9.8 m/s^2" })
        .verdict
    ).toBe("incorrect");
  });

  it("does not mistake a compound unit for a list", () => {
    expect(classifyAnswerShape("9.8 m/s")).toBe("numeric");
    expect(classifyAnswerShape("red / blue / green")).toBe("list");
  });

  it("accepts within an author tolerance", () => {
    expect(
      markTypedAnswer({
        response: "9.81",
        expectedAnswer: "9.8",
        settings: { numericTolerance: 0.05 },
      }).verdict
    ).toBe("correct");
  });

  it("marks a missing unit partial when the author required one", () => {
    const result = markTypedAnswer({
      response: "9.8",
      expectedAnswer: "9.8 m/s",
      settings: { requireUnits: true },
    });
    expect(result.verdict).toBe("partial");
    expect(result.unitMismatch).toBe(true);
  });
});

describe("marking lists", () => {
  const expected = "nitrogen, oxygen, argon";

  it("accepts every item in any order by default", () => {
    expect(
      markTypedAnswer({ response: "argon, nitrogen, oxygen", expectedAnswer: expected })
        .verdict
    ).toBe("correct");
  });

  it("reports which items were missing when only some land", () => {
    const result = markTypedAnswer({
      response: "nitrogen, oxygen",
      expectedAnswer: expected,
    });
    expect(result.verdict).toBe("partial");
    expect(result.missingItems).toEqual(["argon"]);
    expect(result.matchedItems).toEqual(["nitrogen", "oxygen"]);
  });

  it("respects an author-fixed order", () => {
    expect(
      markTypedAnswer({
        response: "oxygen, nitrogen, argon",
        expectedAnswer: expected,
        settings: { listOrder: "fixed" },
      }).verdict
    ).toBe("partial");
  });
});

describe("marking prose", () => {
  const expectedAnswer =
    "Because the membrane is selectively permeable, water moves across it towards the more concentrated solution.";

  it("recognises prose as prose", () => {
    expect(classifyAnswerShape(expectedAnswer)).toBe("prose");
  });

  it("never calls a prose answer wrong", () => {
    // A paraphrase can be perfectly correct and share almost no words. String
    // comparison cannot tell, so it must not schedule anything.
    const result = markTypedAnswer({
      response: "Water crosses the membrane to where there is more solute.",
      expectedAnswer,
    });
    expect(result.verdict).toBe("needs-self-grade");
    expect(resolveAttemptOutcome(result.verdict).kind).toBe("self-grade");
  });

  it("still accepts an exact prose match outright", () => {
    expect(
      markTypedAnswer({ response: expectedAnswer, expectedAnswer }).verdict
    ).toBe("correct");
  });

  it("treats an empty submission as wrong", () => {
    expect(markTypedAnswer({ response: "   ", expectedAnswer }).verdict).toBe(
      "incorrect"
    );
  });
});

describe("choosing a gap", () => {
  it("blanks a meaningful term and leaves the sentence intact", () => {
    const span = selectClozeSpan({
      front: "What carries energy in a cell?",
      back: "The immediate energy carrier used by every cell is adenosine triphosphate.",
    });
    expect(span).not.toBeNull();
    // Either half of the term makes a good blank; what matters is that it chose
    // a carrier of meaning rather than a connective.
    expect(["adenosine", "triphosphate"]).toContain(span!.answer);
    expect(renderClozePrompt("abc def ghi jkl", { start: 4, end: 7, answer: "def" })).toBe(
      "abc _____ ghi jkl"
    );
  });

  it("never blanks a stop word", () => {
    const span = selectClozeSpan({
      front: "Question",
      back: "It is one of the four things that we can see",
    });
    expect(span?.answer).not.toMatch(/^(the|is|of|that|we|can)$/i);
  });

  it("never blanks a word the question already gives away", () => {
    const span = selectClozeSpan({
      front: "What does mitochondria produce in the cell?",
      back: "The mitochondria produce most cellular adenosine triphosphate",
    });
    expect(span?.answer.toLowerCase()).not.toBe("mitochondria");
  });

  it("refuses to cut into a maths expression", () => {
    const back = "Kinetic energy is given by $E = \\frac{1}{2}mv^2$ in every frame";
    const span = selectClozeSpan({ front: "Kinetic energy?", back });
    expect(span).not.toBeNull();
    const blanked = renderClozePrompt(back, span!);
    expect(blanked).toContain("$E = \\frac{1}{2}mv^2$");
  });

  it("refuses to cut into inline code", () => {
    const back = "Call `Array.prototype.flatMap` to map and flatten together";
    const span = selectClozeSpan({ front: "Which method?", back });
    expect(span).not.toBeNull();
    expect(renderClozePrompt(back, span!)).toContain("`Array.prototype.flatMap`");
  });

  it("returns nothing for an answer too short to hide part of", () => {
    expect(selectClozeSpan({ front: "Capital of France?", back: "Paris" })).toBeNull();
  });

  it("honours an author-pinned gap", () => {
    const span = selectClozeSpan({
      front: "What is the capital?",
      back: "The capital city of France is Paris",
      settings: { pinnedGaps: ["France"] },
    });
    expect(span?.answer).toBe("France");
  });

  it("is stable, so a resumed session shows the same blank", () => {
    const input = {
      front: "What is ATP?",
      back: "The immediate energy carrier used by every living cell",
    };
    expect(selectClozeSpan(input)).toEqual(selectClozeSpan(input));
  });

  it("marks a gap through the same tiers as a typed answer", () => {
    const span = { start: 0, end: 12, answer: "mitochondria" };
    expect(markClozeAnswer("mitochondria", span).verdict).toBe("correct");
    expect(markClozeAnswer("mitochondira", span).verdict).toBe("close");
    expect(markClozeAnswer("ribosome", span).verdict).toBe("incorrect");
  });
});

describe("mode eligibility", () => {
  it("excludes an answer that is mostly maths from typing", () => {
    const result = getTypeAnswerEligibility(
      card({ back: "$\\int_0^1 x^2 dx = \\frac{1}{3}$" })
    );
    expect(result).toEqual({ eligible: false, reason: "answer-is-maths" });
  });

  it("keeps an answer that merely mentions a symbol", () => {
    expect(
      getTypeAnswerEligibility(
        card({
          back: "The gradient of the line, written $m$, is rise over run in every case.",
        })
      ).eligible
    ).toBe(true);
  });

  it("excludes an answer too long to type", () => {
    expect(
      getTypeAnswerEligibility(card({ back: "word ".repeat(120) }))
    ).toEqual({ eligible: false, reason: "answer-too-long" });
  });

  it("respects an author disabling a mode", () => {
    expect(
      getTypeAnswerEligibility(
        card({ studySettings: { disabledModes: ["type-answer"] } })
      )
    ).toEqual({ eligible: false, reason: "disabled-by-author" });
  });

  it("reports a one-word answer as having no safe gap", () => {
    expect(getGapFillEligibility(card({ back: "Paris" }))).toEqual({
      eligible: false,
      reason: "no-safe-gap",
    });
  });

  it("reports multiple choice as needing preparation until assets exist", () => {
    expect(getModeEligibility(card(), "multiple-choice")).toEqual({
      eligible: false,
      reason: "needs-preparation",
    });
  });
});

describe("Smart Mix", () => {
  it("varies the mode across a session rather than repeating one", () => {
    const subject = card();
    const modes = [0, 1, 2, 3].map((position) => resolveSmartMixMode(subject, position));
    expect(new Set(modes).size).toBeGreaterThan(1);
  });

  it("leaves multiple choice out until its wrong answers exist", () => {
    const subject = card();
    for (let position = 0; position < 12; position += 1) {
      expect(resolveSmartMixMode(subject, position)).not.toBe("multiple-choice");
    }
  });

  it("brings multiple choice in once the card has been prepared", () => {
    const subject = card({
      studySettings: {
        mcqDistractors: ["The ribosome", "The nucleus", "The lysosome"],
      },
    });
    const modes = Array.from({ length: 8 }, (_, position) =>
      resolveSmartMixMode(subject, position)
    );
    expect(modes).toContain("multiple-choice");
  });

  it("falls back to Classic when nothing else can be built", () => {
    expect(resolveSmartMixMode(card({ back: "$x^2$" }), 0)).toBe("classic");
  });

  it("resolves the same card to the same mode on resume", () => {
    const subject = card();
    expect(resolveSmartMixMode(subject, 5)).toBe(resolveSmartMixMode(subject, 5));
  });
});

describe("building an exercise", () => {
  it("gives Gap Fill the blank as its expected answer", () => {
    const exercise = buildDeterministicExercise(card(), "gap-fill", "hash-1");
    expect(exercise?.mode).toBe("gap-fill");
    expect(exercise?.cloze).toBeDefined();
    expect(exercise?.expectedAnswer).toBe(exercise?.cloze?.answer);
  });

  it("gives Type Answer the whole back", () => {
    const subject = card();
    const exercise = buildDeterministicExercise(subject, "type-answer", "hash-1");
    expect(exercise?.expectedAnswer).toBe(subject.back);
  });

  it("builds nothing for a mode the card cannot carry", () => {
    expect(
      buildDeterministicExercise(card({ back: "Paris" }), "gap-fill", "hash-1")
    ).toBeNull();
    expect(
      buildDeterministicExercise(card(), "multiple-choice", "hash-1")
    ).toBeNull();
  });
});

/*
 * What decides whether a card costs a model call. Preparation is the only thing
 * standing between Start and the first card, so the cheap answer -- not sending
 * it -- has to be the one these cards get.
 */
describe("deciding what is worth preparing", () => {
  const SMART = { kind: "smart" } as const;
  const fixed = (mode: StudyMode) => ({ kind: "fixed", mode }) as const;

  it("never sends a numeric answer", () => {
    const subject = card({ back: "9.8 m/s" });
    expect(needsStudyAssetPreparation(subject, SMART)).toBe(false);
    expect(needsStudyAssetPreparation(subject, fixed("multiple-choice"))).toBe(
      false
    );
  });

  it("never sends a formula", () => {
    const subject = card({ back: "$E_k = \frac{1}{2}mv^2$" });
    expect(needsStudyAssetPreparation(subject, SMART)).toBe(false);
  });

  it("never sends anything for Type Answer", () => {
    // Presenting the card is deterministic and prose marking is asked for on
    // demand, so there is nothing an asset would add up front.
    expect(needsStudyAssetPreparation(card(), fixed("type-answer"))).toBe(false);
  });

  it("never sends anything for Classic", () => {
    expect(needsStudyAssetPreparation(card(), fixed("classic"))).toBe(false);
  });

  it("sends a wordy answer that has no multiple-choice options yet", () => {
    expect(needsStudyAssetPreparation(card(), fixed("multiple-choice"))).toBe(
      true
    );
    expect(needsStudyAssetPreparation(card(), SMART)).toBe(true);
  });

  it("stops sending a card once its options have been written", () => {
    const subject = card({
      studySettings: {
        mcqDistractors: ["The ribosome", "The nucleus", "The lysosome"],
      },
    });
    expect(
      needsStudyAssetPreparation(subject, fixed("multiple-choice"))
    ).toBe(false);
  });

  it("sends a long answer for Gap Fill but not a one-word one", () => {
    expect(needsStudyAssetPreparation(card(), fixed("gap-fill"))).toBe(true);
    expect(
      needsStudyAssetPreparation(card({ back: "Paris" }), fixed("gap-fill"))
    ).toBe(false);
  });
});

describe("showing how much of the answer is missing", () => {
  it("draws one blank per hidden word, spaced apart", () => {
    // A single blank for a three-word answer reads as one word, so a student
    // answers with one word and is marked wrong for something the prompt never
    // told them.
    expect(renderClozeBlank("kinetic energy")).toBe("_____ _____");
    expect(renderClozeBlank("rate of reaction")).toBe("_____ _____ _____");
  });

  it("draws a single blank for a single word", () => {
    expect(renderClozeBlank("photosynthesis")).toBe("_____");
  });

  it("ignores stray whitespace rather than counting it as a word", () => {
    expect(renderClozeBlank("  kinetic   energy  ")).toBe("_____ _____");
    expect(renderClozeBlank("   ")).toBe("_____");
  });

  it("spaces the blanks inside the sentence it replaces", () => {
    const back = "The store of kinetic energy increases.";
    const span = {
      start: back.indexOf("kinetic energy"),
      end: back.indexOf("kinetic energy") + "kinetic energy".length,
      answer: "kinetic energy",
    };

    expect(renderClozePrompt(back, span)).toBe(
      "The store of _____ _____ increases."
    );
  });
});
