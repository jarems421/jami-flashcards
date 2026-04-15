import { describe, expect, it } from "vitest";
import {
  cleanGeneratedCardBack,
  detectCardBackSubject,
  normalizeMathNotation,
} from "@/lib/ai/card-autocomplete";

describe("card autocomplete helpers", () => {
  it("normalizes common maths notation into readable symbols", () => {
    expect(
      normalizeMathNotation(
        "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}, where x >= 0 and theta <= pi"
      )
    ).toBe("x = (-b ± √(b² - 4ac))/(2a), where x ≥ 0 and θ ≤ π");
  });

  it("cleans model wrappers without stripping the actual answer", () => {
    expect(cleanGeneratedCardBack("```text\nAnswer: F = ma, where F = force\n```"))
      .toBe("F = ma, where F = force");
  });

  it("detects maths cards from formula style or symbols", () => {
    expect(
      detectCardBackSubject({
        front: "Solve x^2 - 4 = 0",
        deckName: "Algebra",
        tags: [],
        style: "auto",
      })
    ).toBe("maths");

    expect(
      detectCardBackSubject({
        front: "What is photosynthesis?",
        deckName: "Biology",
        tags: [],
        style: "auto",
      })
    ).toBe("science");
  });
});
