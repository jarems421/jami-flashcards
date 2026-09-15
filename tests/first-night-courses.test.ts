import { describe, expect, it } from "vitest";
import {
  firstNightCourseChoices,
  firstNightExamCourse,
  firstNightLevelHasBoards,
} from "@/lib/onboarding/first-night-courses";
import type { ExamCourseOption } from "@/lib/practice/exam-course-form";

function course(
  specificationId: string,
  specificationTitle: string,
  qualification: "gcse" | "a_level",
  tiers: ExamCourseOption["tiers"] = []
): ExamCourseOption {
  return {
    specificationId,
    specificationTitle,
    qualification,
    qualificationLabel: qualification === "gcse" ? "GCSE" : "A level",
    componentIds: tiers.length ? tiers.flatMap((tier) => tier.componentIds) : [`${specificationId}/1`],
    tiers,
  };
}

const AQA: ExamCourseOption[] = [
  course("8300", "GCSE Mathematics (8300)", "gcse", [
    { name: "Foundation", componentIds: ["8300/1F", "8300/2F", "8300/3F"] },
    { name: "Higher", componentIds: ["8300/1H", "8300/2H", "8300/3H"] },
  ]),
  course("8461", "GCSE Biology (8461)", "gcse", [
    { name: "Foundation", componentIds: ["8461/1F", "8461/2F"] },
    { name: "Higher", componentIds: ["8461/1H", "8461/2H"] },
  ]),
  course("8464", "GCSE Combined Science: Trilogy (8464)", "gcse"),
  course("8700", "GCSE English Language (8700)", "gcse"),
  course("8702", "GCSE English Literature (8702)", "gcse"),
  course("8525", "GCSE Computer Science (8525)", "gcse"),
  course("7402", "A-level Biology (7402)", "a_level"),
];

const ids = (level: string, subject: string) =>
  firstNightCourseChoices(AQA, level, subject).map((choice) => choice.specificationId);

describe("which course a subject could be", () => {
  it("asks for a board only at levels the boards examine", () => {
    expect(firstNightLevelHasBoards("GCSE")).toBe(true);
    expect(firstNightLevelHasBoards("A level")).toBe(true);
    expect(firstNightLevelHasBoards("IB")).toBe(false);
    expect(firstNightLevelHasBoards("University")).toBe(false);
    expect(firstNightLevelHasBoards(null)).toBe(false);
  });

  it("finds the course however the subject is spelt, with its tiers", () => {
    expect(firstNightCourseChoices(AQA, "GCSE", "Maths")).toEqual([
      { specificationId: "8300", label: "GCSE Maths", tiers: ["Foundation", "Higher"] },
    ]);
  });

  it("offers a GCSE scientist their own subject and Combined Science", () => {
    expect(ids("GCSE", "Biology")).toEqual(["8461", "8464"]);
    expect(ids("GCSE", "Combined Science")).toEqual(["8464"]);
  });

  it("keeps only the closest match, so Literature is not offered Language", () => {
    expect(ids("GCSE", "English Literature")).toEqual(["8702"]);
    expect(ids("GCSE", "Computer Science")).toEqual(["8525"]);
  });

  it("stays at the level chosen", () => {
    expect(ids("A level", "Biology")).toEqual(["7402"]);
    expect(ids("University", "Biology")).toEqual([]);
    expect(ids("GCSE", "Latin")).toEqual([]);
  });
});

describe("the course saved on the folder", () => {
  it("is not settled until a tiered course has its tier", () => {
    expect(firstNightExamCourse({ courses: AQA, board: "AQA", specificationId: "8300" })).toBeNull();
    expect(firstNightExamCourse({ courses: AQA, board: "AQA", specificationId: "8300", tier: "Higher" })).toEqual({
      board: "aqa",
      qualification: "gcse",
      specificationId: "8300",
      specificationTitle: "GCSE Mathematics (8300)",
      tier: "Higher",
      componentIds: ["8300/1H", "8300/2H", "8300/3H"],
    });
  });

  it("needs no tier for a course without them, and a board Jami has", () => {
    expect(firstNightExamCourse({ courses: AQA, board: "AQA", specificationId: "8464" })?.specificationId).toBe("8464");
    expect(firstNightExamCourse({ courses: AQA, board: "Edexcel", specificationId: "8464" })?.board).toBe("pearson_edexcel");
    expect(firstNightExamCourse({ courses: AQA, board: "Something else", specificationId: "8464" })).toBeNull();
    expect(firstNightExamCourse({ courses: AQA, board: "AQA", specificationId: null })).toBeNull();
  });
});
