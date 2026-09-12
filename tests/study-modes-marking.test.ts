import { describe, expect, it } from "vitest";
import {
  classifyAnswerShape,
  markTypedAnswer,
  normalizeAnswerText,
  parseNumericAnswer,
} from "@/lib/study/answer-marking";
import {
  markClozeAnswer,
  markClozeAnswers,
  renderClozeBlank,
  renderClozePrompt,
  selectClozeSpan,
  selectClozeGaps,
} from "@/lib/study/gap-fill";
import {
  buildDeterministicExercise,
  canCarryModeEventually,
  getGapFillEligibility,
  getModeEligibility,
  getTypeAnswerEligibility,
  needsStudyAssetPreparation,
  resolveExerciseMode,
  resolveSmartMixMode,
} from "@/lib/study/mode-eligibility";
import { buildMultipleChoiceQuestion } from "@/lib/study/mcq";
import {
  resolveAttemptOutcome,
  type StudyMode,
} from "@/lib/study/study-modes";
import type { Card } from "@/lib/study/cards";
import { classifyStudyTask } from "@/lib/study/learning-task";

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

describe("learning-task classification", () => {
  it("uses the question as well as the answer to distinguish a calculation from a stated quantity", () => {
    expect(classifyStudyTask(card({ front: "Calculate the speed.", back: "26 m/s" })).task).toBe("calculation");
    expect(classifyStudyTask(card({ front: "State the speed of the wave.", back: "26 m/s" })).task).toBe("quantity");
  });

  it("keeps extended material on Classic unless preparation proves otherwise", () => {
    const profile = classifyStudyTask(card({ back: Array.from({ length: 60 }, () => "word").join(" ") }));
    expect(profile.preferredModes).toEqual(["classic"]);
    expect(profile.suitableModes).toEqual(["classic"]);
  });
});

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

  it("revisits a hinted success without scheduling it", () => {
    expect(resolveAttemptOutcome("correct", { hintUsed: true })).toEqual({
      kind: "revisit",
      verdict: "correct",
    });
  });

  it("hands genuinely uncertain verdicts back to the student and treats partial as Again", () => {
    for (const verdict of ["close", "needs-self-grade"] as const) {
      expect(resolveAttemptOutcome(verdict).kind).toBe("self-grade");
    }
    expect(resolveAttemptOutcome("partial")).toEqual({ kind: "commit", rating: "again", verdict: "partial" });
  });
});

describe("normalising a typed answer", () => {
  it("ignores case, spacing, smart quotes, a leading article and a full stop", () => {
    expect(normalizeAnswerText("  The  Krebs   cycle. ")).toBe("krebs cycle");
    expect(normalizeAnswerText("Ohm’s law")).toBe("ohm's law");
    expect(normalizeAnswerText("alpha−beta")).toBe("alpha-beta");
  });

  it("keeps accents, because they can change the word", () => {
    expect(normalizeAnswerText("resumé")).not.toBe(normalizeAnswerText("resume"));
  });
});

describe("domain-aware answer equivalence", () => {
  it("accepts fractions, thousands separators and supported unit conversions", () => {
    expect(parseNumericAnswer("1/2")?.value).toBe(0.5);
    expect(markTypedAnswer({ response: "1,000", expectedAnswer: "1000" }).verdict).toBe("correct");
    expect(markTypedAnswer({ response: "1000", expectedAnswer: "1,000" }).verdict).toBe("correct");
    expect(markTypedAnswer({ response: "36 km/h", expectedAnswer: "10 m/s" }).verdict).toBe("correct");
  });

  it("recognises Unicode bullets as list separators", () => {
    expect(markTypedAnswer({ response: "red • blue", expectedAnswer: "blue; red" }).verdict).toBe("correct");
  });

  it("can preserve meaningful case for scientific notation and formulae", () => {
    expect(markTypedAnswer({ response: "CO", expectedAnswer: "Co", settings: { caseSensitive: true } }).verdict).toBe("needs-self-grade");
    expect(markTypedAnswer({ response: "Co", expectedAnswer: "Co", settings: { caseSensitive: true } }).verdict).toBe("correct");
  });

  it("keeps compound units distinct and never accepts an explicit wrong unit", () => {
    expect(markTypedAnswer({ response: "26 ms", expectedAnswer: "26 m/s" }).verdict).toBe("incorrect");
    expect(markTypedAnswer({ response: "26", expectedAnswer: "26 m/s" }).verdict).toBe("partial");
    expect(markTypedAnswer({ response: "26", expectedAnswer: "26 m/s", settings: { requireUnits: false } }).verdict).toBe("correct");
  });
});

describe("multi-gap marking", () => {
  const gaps = [
    { id: "a", start: 0, end: 12, answer: "kinetic energy", acceptedAnswers: [], concept: "energy store" },
    { id: "b", start: 20, end: 24, answer: "mass", acceptedAnswers: [], concept: "mass" },
    { id: "c", start: 30, end: 38, answer: "velocity", acceptedAnswers: ["speed"], concept: "velocity" },
  ];

  it("marks each gap independently and aggregates mixed outcomes as partial", () => {
    const result = markClozeAnswers({ a: "kinetic energy", b: "weight", c: "speed" }, gaps);
    expect(result.verdict).toBe("needs-self-grade");
    expect(result.outcomes.map((outcome) => outcome.verdict)).toEqual(["correct", "needs-self-grade", "correct"]);
  });

  it("rotates prepared gap variants without changing their exact offsets", () => {
    const subject = card({
      back: "Alpha beta gamma delta epsilon zeta",
      studySettings: { generatedStudy: {
        bundleVersion: 3, sourceHash: "hash", gapVariants: [
          { id: "one", gaps: [{ id: "one-a", start: 6, end: 10, answer: "beta", acceptedAnswers: [], concept: "beta" }] },
          { id: "two", gaps: [{ id: "two-a", start: 17, end: 22, answer: "delta", acceptedAnswers: [], concept: "delta" }] },
        ], mcqVariants: [],
      } },
    });
    expect(selectClozeGaps({ front: subject.front, back: subject.back, settings: subject.studySettings, variantIndex: 0 })[0]?.answer).toBe("beta");
    expect(selectClozeGaps({ front: subject.front, back: subject.back, settings: subject.studySettings, variantIndex: 1 })[0]?.answer).toBe("delta");
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

  it("sends an unmatched short answer to semantic checking", () => {
    expect(
      markTypedAnswer({ response: "glycolysis", expectedAnswer: "Krebs cycle" })
        .verdict
    ).toBe("needs-self-grade");
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
    expect(markClozeAnswer("ribosome", span).verdict).toBe("needs-self-grade");
  });
});

describe("mode eligibility", () => {
  it("treats intentionally empty author variant lists as disabled, not unspecified", () => {
    const subject = card({ studySettings: { pinnedGaps: [], mcqDistractors: [] } });
    expect(getModeEligibility(subject, "gap-fill")).toEqual({ eligible: false, reason: "disabled-by-author" });
    expect(getModeEligibility(subject, "multiple-choice")).toEqual({ eligible: false, reason: "disabled-by-author" });
    expect(needsStudyAssetPreparation(subject, { kind: "smart" })).toBe(false);
  });
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

  /*
   * The difference between "not yet" and "never".
   *
   * Preparation waits for the first few cards and reads the rest behind the
   * student, so at the moment a session is built almost every card in a fresh
   * queue still has no distractors. Judging that the same way as an answer that
   * is a formula emptied the queue, which is why a pinned Multiple Choice
   * session worked on the second run of a deck and never on the first.
   */
  it("keeps an unprepared card in a multiple-choice session", () => {
    expect(canCarryModeEventually(card(), "multiple-choice")).toBe(true);
  });

  it("still drops a card that can never carry the mode", () => {
    expect(
      canCarryModeEventually(card({ back: "Paris" }), "gap-fill")
    ).toBe(false);
    expect(
      canCarryModeEventually(
        card({ studySettings: { disabledModes: ["multiple-choice"] } }),
        "multiple-choice"
      )
    ).toBe(false);
  });

  it("does not silently substitute a fixed mode while preparation is missing", () => {
    const mode = resolveExerciseMode(
      card(),
      { kind: "fixed", mode: "multiple-choice" },
      0
    );
    expect(mode).toBeNull();
  });
});

/*
 * The wrong options are the question. A set a student can pass by picking the
 * longest, the shortest, or the only full sentence tests nothing at all, and it
 * is the failure this deck kept producing: a definition off the back of a card
 * sat beside three short phrases a model wrote.
 */
describe("multiple choice that cannot be guessed on shape", () => {
  const SENTENCE = "The immediate energy carrier used by every cell.";

  it("rejects an option that restates the same numeric answer in a sentence", () => {
    const question = buildMultipleChoiceQuestion({
      card: card({
        front: "What is the speed?",
        back: "26 m/s",
        studySettings: {
          mcqDistractors: ["The speed is 26 m/s", "20 m/s", "30 m/s"],
          mcqExplanations: { "20 m/s": "Too low.", "30 m/s": "Too high." },
        },
      }),
    });
    expect(question).toBeNull();
  });

  it("rejects a distractor that is the same quantity in converted units", () => {
    const question = buildMultipleChoiceQuestion({
      card: card({
        front: "What is the speed?",
        back: "10 m/s",
        studySettings: {
          mcqDistractors: ["36 km/h", "8 m/s", "12 m/s"],
          mcqExplanations: { "36 km/h": "Converted units.", "8 m/s": "Too low.", "12 m/s": "Too high." },
        },
      }),
    });
    expect(question).toBeNull();
  });

  it("rotates substantively different prepared option sets", () => {
    const subject = card({
      front: "What is the speed?",
      back: "26 m/s",
      studySettings: { generatedStudy: {
        bundleVersion: 3, sourceHash: "hash", gapVariants: [], mcqVariants: [
          { id: "a", correctAnswer: "26 m/s", distractors: ["20 m/s", "24 m/s", "28 m/s"], explanations: { "26 m/s": "Correct calculation.", "20 m/s": "Too low.", "24 m/s": "A rounding error.", "28 m/s": "Too high." } },
          { id: "b", correctAnswer: "26 m/s", distractors: ["13 m/s", "52 m/s", "676 m/s"], explanations: { "26 m/s": "Correct calculation.", "13 m/s": "Divided by two.", "52 m/s": "Multiplied by two.", "676 m/s": "Squared the result." } },
        ],
      } },
    });
    const first = buildMultipleChoiceQuestion({ card: subject, variantIndex: 0 });
    const second = buildMultipleChoiceQuestion({ card: subject, variantIndex: 1 });
    expect(first?.variantId).toBe("a");
    expect(second?.variantId).toBe("b");
    expect(first?.options.map((option) => option.text).sort()).not.toEqual(second?.options.map((option) => option.text).sort());
  });

  it("refuses a question whose answer is the only full sentence", () => {
    const question = buildMultipleChoiceQuestion({
      card: card({
        back: SENTENCE,
        studySettings: {
          mcqDistractors: ["The ribosome", "The nucleus", "The lysosome"],
        },
      }),
    });
    expect(question).toBeNull();
  });

  it("refuses a question whose answer is the only short one", () => {
    const question = buildMultipleChoiceQuestion({
      card: card({
        back: "Mitochondria",
        studySettings: {
          mcqDistractors: [
            "The organelle where proteins are folded and packaged for export.",
            "The structure that holds the cell's genetic material safely.",
            "The membrane system that transports lipids around the cell.",
          ],
        },
      }),
    });
    expect(question).toBeNull();
  });

  it("builds when the wrong options are written to the same shape", () => {
    const question = buildMultipleChoiceQuestion({
      card: card({
        back: SENTENCE,
        studySettings: {
          mcqDistractors: [
            "The long-term energy store held in the liver.",
            "The molecule that carries oxygen around the body.",
            "The template every protein in the cell is read from.",
          ],
        },
      }),
    });
    expect(question?.options).toHaveLength(4);
  });

  /*
   * Preparation is asked for five or six so the weakest can be dropped. Taking
   * the first three wasted that choice; the three that match the answer's shape
   * are what make the four options indistinguishable.
   */
  it("spends the spare distractors on the ones that match the answer", () => {
    const question = buildMultipleChoiceQuestion({
      card: card({
        back: SENTENCE,
        studySettings: {
          mcqDistractors: [
            "Glucose",
            "The nucleus",
            "The long-term energy store held in the liver.",
            "The molecule that carries oxygen around the body.",
            "The template every protein in the cell is read from.",
          ],
        },
      }),
    });
    const texts = question?.options.map((option) => option.text) ?? [];
    expect(texts).toHaveLength(4);
    expect(texts).not.toContain("Glucose");
    expect(texts).not.toContain("The nucleus");
  });

  it("requires question-specific preparation for a numeric question", () => {
    const question = buildMultipleChoiceQuestion({
      card: card({ front: "Gravity at sea level?", back: "9.8 m/s^2" }),
    });
    expect(question).toBeNull();
  });
});

describe("Smart Mix", () => {
  it("selects Classic regularly and avoids three typing exercises in a row", () => {
    const counts: Partial<Record<StudyMode, number>> = {};
    const recent: StudyMode[] = [];
    const modes = Array.from({ length: 40 }, (_, position) => {
      const mode = resolveSmartMixMode(card({ id: `card-${position}`, front: `Define ATP ${position}`, back: "The immediate energy carrier used by every cell." }), position, { modeCounts: counts, recentModes: recent, seed: 41 });
      counts[mode] = (counts[mode] ?? 0) + 1;
      recent.push(mode);
      if (recent.length > 8) recent.shift();
      return mode;
    });
    expect(modes.filter((mode) => mode === "classic").length).toBeGreaterThanOrEqual(8);
    expect(modes.some((mode, index) => mode === "type-answer" && modes[index - 1] === mode && modes[index - 2] === mode)).toBe(false);
  });
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
      back: "The immediate energy carrier used by every cell.",
      studySettings: {
        // Written to the same shape as the answer. Three two-word organelles
        // beside a full sentence is the question the length guard refuses.
        mcqDistractors: [
          "The long-term energy store held in the liver.",
          "The molecule that carries oxygen around the body.",
          "The template every protein in the cell is read from.",
        ],
      },
    });
    const modes = Array.from({ length: 8 }, (_, position) =>
      resolveSmartMixMode(subject, position)
    );
    expect(modes).toContain("multiple-choice");
  });

  it("uses a meaningful author gap instead of inventing one locally", () => {
    const modes = new Set(
      [0, 1, 2, 3].map((position) =>
        resolveSmartMixMode(
          card({ back: "The immediate energy carrier used by every cell.", studySettings: { pinnedGaps: ["energy carrier"] } }),
          position
        )
      )
    );
    expect(modes).toContain("gap-fill");
  });

  it("does not invent numeric MCQ distractors or gap a number", () => {
    const subject = card({
      front: "What is the acceleration due to gravity at sea level?",
      back: "9.8 m/s^2",
    });
    const modes = new Set(
      [0, 1, 2, 3].map((position) => resolveSmartMixMode(subject, position))
    );
    expect(modes).not.toContain("gap-fill");
    expect(modes).not.toContain("multiple-choice");
  });

  it("stops asking a card to be typed once the student keeps missing it", () => {
    const back = "The immediate energy carrier used by every cell.";
    const known = new Set(
      [0, 1, 2, 3].map((position) =>
        resolveSmartMixMode(card({ back, fsrsState: 2 }), position)
      )
    );
    const struggling = new Set(
      [0, 1, 2, 3].map((position) =>
        resolveSmartMixMode(card({ back, fsrsState: 3, lapses: 3 }), position)
      )
    );
    expect(known).toContain("type-answer");
    expect(struggling).not.toContain("type-answer");
  });

  it("picks different modes for different kinds of answer", () => {
    const front = "Question?";
    const first = resolveSmartMixMode(card({ front, back: "9.8 m/s^2" }), 0);
    const chosen = [first, resolveSmartMixMode(
      card({ front, back: "The immediate energy carrier used by every cell." }),
      1,
      { modeCounts: { [first]: 1 }, recentModes: [first] }
    )];
    expect(new Set(chosen).size).toBe(2);
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
    const exercise = buildDeterministicExercise(card({ studySettings: { pinnedGaps: ["energy carrier"] } }), "gap-fill", "hash-1");
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

  it("prepares numeric answers instead of manufacturing generic distractors", () => {
    const subject = card({ back: "9.8 m/s" });
    expect(needsStudyAssetPreparation(subject, SMART)).toBe(true);
    expect(needsStudyAssetPreparation(subject, fixed("multiple-choice"))).toBe(
      true
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
        mcqDistractors: [
          "The long-term energy store held in the liver.",
          "The molecule that carries oxygen around the body.",
          "The template every protein in the cell is read from.",
        ],
      },
    });
    expect(
      needsStudyAssetPreparation(subject, fixed("multiple-choice"))
    ).toBe(false);
  });

  /*
   * Written options that make a guessable question are not preparation done.
   * Three two-word organelles beside a full-sentence answer build nothing, so
   * the card still wants reading -- which is the honest answer, and the one
   * that gets the student a question worth asking.
   */
  it("does not overwrite author-supplied options even when they are unusable", () => {
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
