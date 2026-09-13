import { describe, expect, it } from "vitest";
import {
  EMPTY_EXAM_COURSE_DRAFT,
  arrangeExamCourseOptions,
  describeExamCourse,
  examCourseDraftFrom,
  resolveExamCourseDraft,
  type ExamCourseOption,
} from "@/lib/practice/exam-course-form";
import type { ExamCourseSelection } from "@/lib/practice/exam-questions";

const GCSE_MATHS: ExamCourseOption = {
  specificationId: "8300",
  specificationTitle: "Mathematics",
  qualification: "gcse",
  qualificationLabel: "GCSE",
  componentIds: ["8300/1F", "8300/1H", "8300/2F", "8300/2H"],
  tiers: [
    { name: "Foundation", componentIds: ["8300/1F", "8300/2F"] },
    { name: "Higher", componentIds: ["8300/1H", "8300/2H"] },
  ],
};

const GCSE_BIOLOGY: ExamCourseOption = {
  specificationId: "8461",
  specificationTitle: "Biology",
  qualification: "gcse",
  qualificationLabel: "GCSE",
  componentIds: ["8461/1", "8461/2"],
  tiers: [],
};

const A_LEVEL_MATHS: ExamCourseOption = {
  specificationId: "7357",
  specificationTitle: "Mathematics",
  qualification: "a_level",
  qualificationLabel: "A level",
  componentIds: ["7357/1", "7357/2", "7357/3"],
  tiers: [],
};

const COURSES = [GCSE_BIOLOGY, GCSE_MATHS, A_LEVEL_MATHS];

describe("resolveExamCourseDraft", () => {
  it("has no course until a board and a course are both chosen", () => {
    expect(resolveExamCourseDraft(EMPTY_EXAM_COURSE_DRAFT, COURSES).status).toBe("none");
    expect(
      resolveExamCourseDraft({ board: "aqa", specificationId: "", tier: "" }, COURSES).status
    ).toBe("none");
  });

  it("waits for a tier when the course has them", () => {
    expect(
      resolveExamCourseDraft({ board: "aqa", specificationId: "8300", tier: "" }, COURSES)
    ).toEqual({ status: "needs_tier", course: null });
  });

  it("draws only the chosen tier's papers", () => {
    const resolved = resolveExamCourseDraft(
      { board: "aqa", specificationId: "8300", tier: "Higher" },
      COURSES
    );
    expect(resolved).toEqual({
      status: "ready",
      course: {
        board: "aqa",
        qualification: "gcse",
        specificationId: "8300",
        specificationTitle: "Mathematics",
        tier: "Higher",
        componentIds: ["8300/1H", "8300/2H"],
      },
    });
  });

  it("writes no tier key for a course without tiers", () => {
    const resolved = resolveExamCourseDraft(
      { board: "aqa", specificationId: "8461", tier: "" },
      COURSES
    );
    expect(resolved.course).toEqual({
      board: "aqa",
      qualification: "gcse",
      specificationId: "8461",
      specificationTitle: "Biology",
      componentIds: ["8461/1", "8461/2"],
    });
    expect(resolved.course && "tier" in resolved.course).toBe(false);
  });

  it("keeps an unchanged saved course while the catalogue is loading or no longer lists it", () => {
    const saved: ExamCourseSelection = {
      board: "aqa",
      qualification: "gcse",
      specificationId: "8300",
      specificationTitle: "Mathematics",
      tier: "Higher",
      componentIds: ["8300/1H"],
    };
    const draft = examCourseDraftFrom(saved);
    expect(resolveExamCourseDraft(draft, [], saved)).toEqual({ status: "ready", course: saved });
  });

  it("keeps a saved course from before the catalogue split it into tiers", () => {
    const saved: ExamCourseSelection = {
      board: "aqa",
      qualification: "gcse",
      specificationId: "8300",
      specificationTitle: "Mathematics",
      componentIds: ["8300/1F", "8300/1H"],
    };
    expect(resolveExamCourseDraft(examCourseDraftFrom(saved), COURSES, saved)).toEqual({
      status: "ready",
      course: saved,
    });
  });
});

describe("arrangeExamCourseOptions", () => {
  it("offers a GCSE folder only GCSE courses", () => {
    const { suggested, others } = arrangeExamCourseOptions(COURSES, {
      studyLevel: "gcse-equivalent",
    });
    expect(suggested).toEqual([]);
    expect(others).toEqual([GCSE_BIOLOGY, GCSE_MATHS]);
  });

  it("shows every course when the level would leave none", () => {
    const { others } = arrangeExamCourseOptions([A_LEVEL_MATHS], {
      studyLevel: "gcse-equivalent",
    });
    expect(others).toEqual([A_LEVEL_MATHS]);
  });

  it("does not narrow early secondary", () => {
    const { others } = arrangeExamCourseOptions(COURSES, { studyLevel: "early-secondary" });
    expect(others).toHaveLength(3);
  });

  it("puts the course the folder is named after first, spelt as students spell it", () => {
    expect(
      arrangeExamCourseOptions(COURSES, {
        studyLevel: "gcse-equivalent",
        subjectHint: "GCSE Maths ",
      })
    ).toEqual({ suggested: [GCSE_MATHS], others: [GCSE_BIOLOGY] });
    expect(
      arrangeExamCourseOptions(COURSES, { studyLevel: "gcse-equivalent", subjectHint: "bio" })
        .suggested
    ).toEqual([GCSE_BIOLOGY]);
  });
});

describe("describeExamCourse", () => {
  it("names the board, course and tier the way a student would say them", () => {
    expect(
      describeExamCourse({
        board: "aqa",
        qualification: "gcse",
        specificationId: "8300",
        specificationTitle: "Mathematics",
        tier: "Higher",
        componentIds: [],
      })
    ).toBe("AQA · GCSE Maths · Higher");
  });
});
