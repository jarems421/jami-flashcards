import { describe, expect, it } from "vitest";
import {
  STUDY_LEVEL_OPTIONS,
  getStudyLevelLabel,
  getStudyLevelTutorLabel,
  normalizeStudyLevel,
} from "@/lib/profile/study-level";
import { mapStudyFolderData } from "@/lib/workspace/study-folders";

describe("study-level preferences", () => {
  it("offers broad, internationally understandable stages", () => {
    expect(STUDY_LEVEL_OPTIONS.map((option) => option.label)).toEqual([
      "School / early secondary",
      "GCSE, IGCSE or equivalent",
      "A level, IB or equivalent",
      "University",
      "Postgraduate",
      "Professional or other",
    ]);
  });

  it("accepts only supported stored values", () => {
    expect(normalizeStudyLevel("post-16-equivalent")).toBe(
      "post-16-equivalent"
    );
    expect(normalizeStudyLevel("a-level")).toBeUndefined();
    expect(normalizeStudyLevel(null)).toBeUndefined();
  });

  it("keeps UI wording separate from concise Tutor context wording", () => {
    expect(getStudyLevelLabel("undergraduate")).toBe("University");
    expect(getStudyLevelTutorLabel("undergraduate")).toBe(
      "undergraduate university level"
    );
  });

  it("maps a valid folder override without inventing one for legacy folders", () => {
    expect(
      mapStudyFolderData("folder-a", {
        name: "Biology",
        studyLevel: "gcse-equivalent",
      }).studyLevel
    ).toBe("gcse-equivalent");
    expect(
      mapStudyFolderData("folder-b", {
        name: "History",
        studyLevel: "made-up",
      }).studyLevel
    ).toBeUndefined();
  });
});
