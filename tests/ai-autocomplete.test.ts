import { describe, expect, it } from "vitest";
import {
  cleanGeneratedCardBack,
  cleanGeneratedStudyText,
  detectCardBackSubject,
  normalizeMathNotation,
} from "@/lib/ai/card-autocomplete";
import { parseGeneratedCardDrafts } from "@/lib/ai/card-generation";

describe("card autocomplete helpers", () => {
  it("normalizes common maths notation into readable symbols", () => {
    expect(
      normalizeMathNotation(
        "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}, where x >= 0 and theta <= pi"
      )
    ).toBe(
      "x = (-b \u00b1 \u221a(b\u00b2 - 4ac))/(2 \u00b7 a), where x \u2265 0 and \u03b8 \u2264 \u03c0"
    );
  });

  it("normalizes latex wrappers and markdown emphasis from AI output", () => {
    expect(
      cleanGeneratedStudyText(
        "**Result:** $\\theta >= \\frac{pi}{2}$ and 3 * 4 = 12\n*Use this when* x**2 <= 9"
      )
    ).toBe(
      "Result: \u03b8 \u2265 (\u03c0)/(2) and 3 \u00b7 4 = 12\nUse this when x\u00b2 \u2264 9"
    );
  });

  it("converts plain-word greek symbols and infinity", () => {
    expect(
      cleanGeneratedStudyText(
        "alpha + beta + gamma -> theta, and radius goes to infinity"
      )
    ).toBe(
      "\u03b1 + \u03b2 + \u03b3 \u2192 \u03b8, and radius goes to \u221e"
    );
  });

  it("normalizes roots and implicit multiplication safely", () => {
    expect(
      cleanGeneratedStudyText(
        "sqrt(x+1) + cbrt(8), and 2x + 3(4 + y) + (a+b)(c+d)"
      )
    ).toBe(
      "\u221a(x+1) + \u221b(8), and 2 \u00b7 x + 3 \u00b7 (4 + y) + (a+b) \u00b7 (c+d)"
    );
  });

  it("removes visible latex backslashes and underscore notation", () => {
    expect(
      cleanGeneratedStudyText(
        "$F_{net} = m \\cdot a$, with x_1 = \\alpha and \\mathrm{rate} = \\frac{\\Delta y}{\\Delta x}"
      )
    ).toBe(
      "F\u2099\u2091\u209c = m \u00b7 a, with x\u2081 = \u03b1 and rate = (\u0394 y)/(\u0394 x)"
    );
  });

  it("cleans model wrappers without stripping the actual answer", () => {
    expect(cleanGeneratedCardBack("```text\nAnswer: F = ma, where F = force\n```")).toBe(
      "F = ma, where F = force"
    );
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

describe("card generation helpers", () => {
  it("parses generated JSON card drafts", () => {
    expect(
      parseGeneratedCardDrafts(
        '[{"front":"What is osmosis?","back":"Water moves across a partially permeable membrane."}]'
      )
    ).toEqual([
      {
        front: "What is osmosis?",
        back: "Water moves across a partially permeable membrane.",
      },
    ]);
  });

  it("normalizes generated power notation into the card storage format", () => {
    expect(
      parseGeneratedCardDrafts(
        '[{"front":"What is Ka?","back":"Ka = 10**(-4.9) and x² + y² = z²"}]'
      )
    ).toEqual([
      {
        front: "What is Ka?",
        back: "Ka = 10^-4.9 and x^2 + y^2 = z^2",
      },
    ]);
  });

  it("falls back to labelled text blocks", () => {
    expect(
      parseGeneratedCardDrafts(
        "Front: What is diffusion?\nBack: Net movement from high to low concentration."
      )
    ).toEqual([
      {
        front: "What is diffusion?",
        back: "Net movement from high to low concentration.",
      },
    ]);
  });
});
