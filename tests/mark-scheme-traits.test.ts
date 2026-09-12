import { describe, expect, it } from "vitest";
import { parseTraitsFromScheme } from "@/lib/evaluation/mark-scheme-traits";

const rubric = "AO5: Content (4 marks)\nLevel 1: Limited (1-2 marks)\nLevel 2: Clear (3-4 marks)\nAO6: Accuracy (2 marks)\nSCORE OF 1: Some accuracy\nSCORE OF 2: Consistent accuracy";
describe("published AO rubric extraction", () => {
  it("preserves the published maxima and separate descriptors", () => {
    expect(parseTraitsFromScheme(rubric, 6).map((trait) => trait.maxMarks)).toEqual([4, 2]);
  });
  it("rejects mismatched totals, missing maxima, overlapping bands and missing bands", () => {
    expect(parseTraitsFromScheme(rubric, 7)).toEqual([]);
    expect(parseTraitsFromScheme(rubric.replace("(2 marks)", ""), 6)).toEqual([]);
    expect(parseTraitsFromScheme(rubric.replace("(3-4 marks)", "(2-4 marks)"), 6)).toEqual([]);
    expect(parseTraitsFromScheme(rubric.replace("SCORE OF 2: Consistent accuracy", ""), 6)).toEqual([]);
  });
});
