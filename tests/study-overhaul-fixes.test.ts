import { describe, expect, it } from "vitest";
import { markTypedAnswer } from "@/lib/study/answer-marking";
import { hasCurrentStudySource } from "@/lib/study/asset-freshness";
import { getCardContentHash } from "@/lib/study/study-modes";
import { readPresentationViewState } from "@/lib/study/presentation-state";

describe("reviewed study marking regressions", () => {
  it("preserves meaningful unit case before checking text equivalence", () => {
    expect(markTypedAnswer({ response: "1 ms", expectedAnswer: "1 mS" }).verdict).toBe("incorrect");
  });
  it("applies absolute tolerance in the reference unit", () => {
    expect(markTypedAnswer({ response: "99 cm", expectedAnswer: "100 cm", settings: { numericTolerance: 0.1 } }).verdict).toBe("incorrect");
    expect(markTypedAnswer({ response: "0.9995 m", expectedAnswer: "100 cm", settings: { numericTolerance: 0.1 } }).verdict).toBe("correct");
  });
  it("defers numerical wording and list aliases to semantic checking", () => {
    expect(markTypedAnswer({ response: "twenty six metres per second", expectedAnswer: "26 m/s" }).verdict).toBe("needs-self-grade");
    expect(markTypedAnswer({ response: "sodium ions; chloride ions", expectedAnswer: "Na+; Cl-" }).verdict).toBe("needs-self-grade");
  });
  it("does not erase chemical signs when comparing lists", () => {
    expect(markTypedAnswer({ response: "Na-; Cl+", expectedAnswer: "Na+; Cl-" }).verdict).not.toBe("correct");
  });
});

describe("saved exercise integrity", () => {
  const card = { front: "What is the speed?", back: "26 m/s" };
  const asset = { sourceFingerprint: getCardContentHash(card) };
  it("rejects old assets when either content or author settings change", () => {
    expect(hasCurrentStudySource(asset, card)).toBe(true);
    expect(hasCurrentStudySource(asset, { ...card, back: "30 m/s" })).toBe(false);
    expect(hasCurrentStudySource(asset, { ...card, studySettings: { acceptedAnswers: [] } })).toBe(false);
    expect(hasCurrentStudySource({}, card)).toBe(false);
  });
  it("retains the displayed verdict, selected option and assistance on reload", () => {
    const state = { phase: "marked", hintUsed: true, chosenId: "opt-2", result: { verdict: "correct", shape: "short" } };
    expect(readPresentationViewState(JSON.stringify(state))).toEqual(state);
    expect(readPresentationViewState("invalid JSON")).toEqual({});
  });
});
