import { describe, expect, it } from "vitest";
import {
  addModeAnswer,
  countAllModeAnswers,
  countModeAnswers,
  listModeResults,
} from "@/lib/study/mode-results";

describe("study mode results", () => {
  it("tallies each outcome, and assistance, against its mode", () => {
    let results = addModeAnswer({}, "type-answer", "correct", false);
    results = addModeAnswer(results, "type-answer", "partial", true);
    results = addModeAnswer(results, "multiple-choice", "uncertain", false);

    expect(results).toEqual({
      "type-answer": { answered: 2, correct: 1, partial: 1, uncertain: 0, assisted: 1 },
      "multiple-choice": { answered: 1, correct: 0, partial: 0, uncertain: 1, assisted: 0 },
    });
  });

  it("keeps the counts of sessions saved before partial answers were tallied", () => {
    expect(
      addModeAnswer({ classic: { answered: 3, correct: 2 } }, "classic", "incorrect", false)
    ).toEqual({ classic: { answered: 4, correct: 2, partial: 0, uncertain: 0, assisted: 0 } });
  });

  it("counts answers per mode and in total", () => {
    const results = {
      classic: { answered: 2, correct: 1 },
      "gap-fill": { answered: 3, correct: 3 },
    };

    expect(countModeAnswers(results)).toEqual({ classic: 2, "gap-fill": 3 });
    expect(countAllModeAnswers(results)).toBe(5);
    expect(countAllModeAnswers({})).toBe(0);
  });

  it("lists the modes in the order they were first used", () => {
    const results = addModeAnswer(addModeAnswer({}, "gap-fill", "correct", false), "classic", "incorrect", false);

    expect(listModeResults(results)).toEqual([
      { mode: "gap-fill", answered: 1, correct: 1 },
      { mode: "classic", answered: 1, correct: 0 },
    ]);
  });
});
