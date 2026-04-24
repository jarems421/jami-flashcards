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
});
