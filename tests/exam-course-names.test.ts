import { describe, expect, it } from "vitest";
import {
  examCourseLabels,
  examCourseName,
  examSubjectFromTitle,
} from "@/lib/practice/exam-course-names";
import { sameExamTier } from "@/lib/practice/exam-course-tiers";
import { EXAM_BOARDS_OFFERED } from "@/lib/practice/exam-formats";

describe("examCourseName", () => {
  it.each([
    ["gcse", "GCSE Mathematics", "GCSE Maths"],
    ["gcse", "GCSE Mathematics (8300)", "GCSE Maths"],
    ["a_level", "A-level Mathematics", "A level Maths"],
    ["gcse", "Pearson Edexcel GCSE Mathematics", "GCSE Maths"],
    ["gcse", "Pearson Edexcel Level 1/Level 2 GCSE in Mathematics (1MA1)", "GCSE Maths"],
    ["gcse", "GCSE Biology (8461)", "GCSE Biology"],
    ["a_level", "AS and A-level Further Mathematics", "A level Further Maths"],
    ["gcse", "Combined Science: Trilogy", "GCSE Combined Science: Trilogy"],
    ["a_level", "OCR A Level Chemistry A (H432)", "A level Chemistry A"],
  ])("names %s %j as %j", (qualification, specificationTitle, expected) => {
    expect(examCourseName({ qualification, specificationTitle })).toBe(expected);
  });

  it("keeps a title that is nothing but a qualification rather than showing nothing", () => {
    expect(examCourseName({ qualification: "gcse", specificationTitle: "GCSE" })).toBe("GCSE GCSE");
  });
});

describe("examSubjectFromTitle", () => {
  it("leaves the subject the paper is filed under, unshortened", () => {
    expect(examSubjectFromTitle("GCSE Mathematics (8300)")).toBe("Mathematics");
    expect(examSubjectFromTitle("Information Technology")).toBe("Information Technology");
  });
});

describe("examCourseLabels", () => {
  it("adds the code back only where two courses would read the same", () => {
    const labels = examCourseLabels([
      { specificationId: "8300", qualification: "gcse", specificationTitle: "GCSE Mathematics" },
      { specificationId: "8461", qualification: "gcse", specificationTitle: "GCSE Biology" },
      { specificationId: "8464", qualification: "gcse", specificationTitle: "GCSE Combined Science" },
      { specificationId: "8465", qualification: "gcse", specificationTitle: "GCSE Combined Science (8465)" },
    ]);
    expect(labels.get("8300")).toBe("GCSE Maths");
    expect(labels.get("8461")).toBe("GCSE Biology");
    expect(labels.get("8464")).toBe("GCSE Combined Science (8464)");
    expect(labels.get("8465")).toBe("GCSE Combined Science (8465)");
  });
});

describe("sameExamTier", () => {
  it("matches a tier however its source capitalised or suffixed it", () => {
    expect(sameExamTier("Higher", "higher")).toBe(true);
    expect(sameExamTier("Foundation Tier", "foundation")).toBe(true);
    expect(sameExamTier("Higher", "Foundation")).toBe(false);
    expect(sameExamTier("", "")).toBe(false);
    expect(sameExamTier("higher", undefined)).toBe(false);
  });
});

describe("EXAM_BOARDS_OFFERED", () => {
  it("offers only the boards being supported", () => {
    expect(EXAM_BOARDS_OFFERED).toEqual(["aqa", "ocr", "pearson_edexcel"]);
  });
});
