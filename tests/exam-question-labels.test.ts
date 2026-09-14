import { describe, expect, it } from "vitest";
import { normaliseQuestionLabel, numberedPartLabel, printedPartReference, rootQuestionLabel } from "@/lib/practice/exam-page-regions";

describe("printedPartReference", () => {
  it("stores a lettered part under the number the paper prints", () => {
    expect(printedPartReference("3(f)", "3.6")).toEqual({ reference: "03.6", label: "Question 3 (3.6)" });
    expect(printedPartReference("1(1.2)", "1.2")).toBeNull();
  });

  it("leaves a label that already matched the paper alone", () => {
    expect(printedPartReference("03.6", "3.6")).toBeNull();
    expect(printedPartReference("3(f)", "3(f)")).toBeNull();
    expect(printedPartReference("11(a)", "11")).toBeNull();
  });
});

describe("numberedPartLabel", () => {
  const starts = ["1", "1.1", "1.2", "1.3", "2", "2.1"].map((label, index) => ({ label, page: 3, top: index * 50 }));

  it("names a lettered part by the numbered part the paper prints", () => {
    expect(numberedPartLabel("1(a)", starts)).toBe("1.1");
    expect(numberedPartLabel("1(c)", starts)).toBe("1.3");
    expect(numberedPartLabel("2(a)", starts)).toBe("2.1");
  });

  it("keeps a label the paper prints, and one it cannot place", () => {
    expect(numberedPartLabel("1.2", starts)).toBe("1.2");
    expect(numberedPartLabel("1(d)", starts)).toBe("1(d)");
    expect(numberedPartLabel("3(a)", starts)).toBe("3(a)");
  });
});

describe("normaliseQuestionLabel", () => {
  it("reads a part written inside its question as the part", () => {
    expect(normaliseQuestionLabel("1(1.1)")).toBe("1.1");
    expect(normaliseQuestionLabel("06 (06.7)")).toBe("6.7");
    expect(rootQuestionLabel("2(2.3)")).toBe("2");
  });

  it("does not trust a wrapped part that names a different question", () => {
    expect(normaliseQuestionLabel("1(2.1)")).toBeNull();
  });

  it("keeps the shapes boards already print", () => {
    expect(normaliseQuestionLabel("01.1")).toBe("1.1");
    expect(normaliseQuestionLabel("0 1 . 1")).toBe("1.1");
    expect(normaliseQuestionLabel("11 (a)")).toBe("11(a)");
    expect(normaliseQuestionLabel("3")).toBe("3");
  });
});
