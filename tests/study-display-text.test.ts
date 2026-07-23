import { describe, expect, it } from "vitest";
import { splitStudyTextForDisplay } from "@/lib/study/display-text";

describe("study text display helpers", () => {
  it("renders decimal and negative exponents as superscript segments", () => {
    expect(splitStudyTextForDisplay("Ka = 10^-4.9")).toEqual([
      { type: "text", value: "Ka = 1" },
      { type: "text", value: "0" },
      { type: "sup", value: "-4.9" },
    ]);
  });

  it("renders starred and braced exponents with the same display rules", () => {
    expect(splitStudyTextForDisplay("x**2 and y^{n+1}")).toEqual([
      { type: "text", value: "x" },
      { type: "sup", value: "2" },
      { type: "text", value: " and " },
      { type: "text", value: "y" },
      { type: "sup", value: "n+1" },
    ]);
  });

  it("renders an integral upper limit after a Unicode lower limit", () => {
    expect(splitStudyTextForDisplay("∫₀^{2} x² dx")).toEqual([
      { type: "text", value: "∫" },
      { type: "text", value: "₀" },
      { type: "sup", value: "2" },
      { type: "text", value: " x² dx" },
    ]);
  });

  it("turns numeric and grouped slash notation into display fractions", () => {
    expect(
      splitStudyTextForDisplay(
        "A third is 1/3 and the gradient is (Δ y)/(Δ x)."
      )
    ).toEqual([
      { type: "text", value: "A third is " },
      { type: "fraction", numerator: "1", denominator: "3" },
      { type: "text", value: " and the gradient is " },
      { type: "fraction", numerator: "Δ y", denominator: "Δ x" },
      { type: "text", value: "." },
    ]);
  });

  it("does not mistake prose slashes or dates for mathematical fractions", () => {
    expect(
      splitStudyTextForDisplay("Use and/or on 23/07/2026.")
    ).toEqual([{ type: "text", value: "Use and/or on 23/07/2026." }]);
  });
});
