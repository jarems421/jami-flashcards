import { describe, expect, it } from "vitest";
import {
  attachInlineMathPunctuation,
  normalizeLegacyJamiMathText,
  splitMathRichText,
} from "@/lib/study/math-text";

describe("math-rich study text", () => {
  it("separates inline and display TeX without exposing delimiters", () => {
    expect(
      splitMathRichText(
        "Evaluate $\\int_{0}^{2} x^2\\,dx = \\frac{8}{3}$.\n$$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$$"
      )
    ).toEqual([
      { type: "text", value: "Evaluate " },
      {
        type: "math",
        value: "\\int_{0}^{2} x^2\\,dx = \\frac{8}{3}",
        display: false,
      },
      { type: "text", value: ".\n" },
      {
        type: "math",
        value: "\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}",
        display: true,
      },
    ]);
  });

  it("supports parenthesized TeX and leaves ordinary currency alone", () => {
    expect(
      splitMathRichText("The fee is $5. Use \\(x^2 + y^2\\) here.")
    ).toEqual([
      { type: "text", value: "The fee is $5. Use " },
      { type: "math", value: "x^2 + y^2", display: false },
      { type: "text", value: " here." },
    ]);
  });

  it("falls back to plain text when delimiters are unbalanced", () => {
    expect(splitMathRichText("Use $\\frac{1}{3} without a closer")).toEqual([
      { type: "text", value: "Use $\\frac{1}{3} without a closer" },
    ]);
  });

  it("cleans sizing-command remnants from older saved assistant replies", () => {
    expect(
      normalizeLegacyJamiMathText("x³ Bigl {0}^{2} and Bigl(x + 1 Bigr)")
    ).toBe("x³ evaluated from 0 to 2 and (x + 1 )");
  });

  it("keeps punctuation attached to an inline equation", () => {
    expect(
      attachInlineMathPunctuation(
        splitMathRichText("Use $x^{n+1}/(n+1) + C$, where $n \\ne -1$.")
      )
    ).toEqual([
      { type: "text", value: "Use " },
      {
        type: "math",
        value: "x^{n+1}/(n+1) + C",
        display: false,
        trailingPunctuation: ",",
      },
      { type: "text", value: " where " },
      {
        type: "math",
        value: "n \\ne -1",
        display: false,
        trailingPunctuation: ".",
      },
      { type: "text", value: "" },
    ]);
  });
});
