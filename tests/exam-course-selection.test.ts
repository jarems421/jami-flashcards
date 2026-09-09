import { describe, expect, it } from "vitest";
import { buildExamCourseSelection } from "@/lib/practice/exam-questions";
import { mapStudyFolderData } from "@/lib/workspace/study-folders";

/**
 * A course with no tier has to save.
 *
 * Both places that built one wrote `tier: tier || undefined`. Firestore
 * rejects an explicit undefined outright and neither SDK here enables
 * `ignoreUndefinedProperties`, so every non-tiered course -- which is most
 * A-level subjects -- failed to save, and the student was told only that it
 * could not be saved.
 */
describe("building a course selection", () => {
  const base = {
    board: "aqa" as const,
    qualification: "a_level" as const,
    specificationId: "7402",
    specificationTitle: "A-level Biology",
  };

  it("leaves the tier key out entirely when there is no tier", () => {
    const course = buildExamCourseSelection(base);
    expect("tier" in course).toBe(false);
    expect(JSON.stringify(course)).not.toContain("tier");
  });

  it("leaves it out for an empty or whitespace tier too", () => {
    expect("tier" in buildExamCourseSelection({ ...base, tier: "" })).toBe(false);
    expect("tier" in buildExamCourseSelection({ ...base, tier: "   " })).toBe(false);
  });

  it("keeps a real tier, trimmed", () => {
    expect(buildExamCourseSelection({ ...base, tier: " Higher " }).tier).toBe("Higher");
  });

  it("trims the identifiers and defaults the components", () => {
    const course = buildExamCourseSelection({
      ...base,
      specificationId: "  8461 ",
      specificationTitle: " GCSE Biology ",
    });
    expect(course.specificationId).toBe("8461");
    expect(course.specificationTitle).toBe("GCSE Biology");
    expect(course.componentIds).toEqual([]);
  });

  it("round-trips through the folder mapper", () => {
    const course = buildExamCourseSelection({ ...base, componentIds: ["1", "2"] });
    const folder = mapStudyFolderData("folder-1", {
      name: "Biology",
      studyLevel: "post-16-equivalent",
      examCourse: course,
    });
    expect(folder.examCourse).toMatchObject({ specificationId: "7402", componentIds: ["1", "2"] });
    expect(folder.examCourse?.tier).toBeUndefined();
  });
});
