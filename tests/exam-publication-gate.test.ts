import { describe, expect, it } from "vitest";
import {
  canPublishExamQuestion,
  examQuestionPublicationBlockers,
  type ExamIngestionVerification,
} from "@/lib/practice/exam-questions";

function verification(overrides: Partial<ExamIngestionVerification> = {}): ExamIngestionVerification {
  return {
    paperIdentityMatches: true,
    questionLabelMatches: true,
    tariffMatches: true,
    markSchemeLabelMatches: true,
    questionComplete: true,
    assetsComplete: true,
    specificationCurrent: true,
    issues: [],
    ...overrides,
  };
}

/**
 * One gate, asked by ingestion, by review and by selection.
 *
 * Before this there were three different opinions about whether a question was
 * fit to serve, and the review path had the weakest: an approving verdict
 * could publish a question whose scheme had never been paired to it.
 */
describe("the publication gate", () => {
  it("passes a question whose every structural check compared cleanly", () => {
    expect(canPublishExamQuestion(verification())).toBe(true);
    expect(examQuestionPublicationBlockers(verification())).toEqual([]);
  });

  it("refuses a question with no verification record at all", () => {
    expect(canPublishExamQuestion(undefined)).toBe(false);
  });

  it.each([
    ["paperIdentityMatches", "does not identify itself"],
    ["questionLabelMatches", "label was not found"],
    ["tariffMatches", "tariff does not match"],
    ["markSchemeLabelMatches", "could not be paired"],
    ["questionComplete", "incomplete"],
    ["assetsComplete", "region of the paper is missing"],
    ["specificationCurrent", "not current"],
  ] as const)("refuses a question where %s failed", (field, expected) => {
    const blockers = examQuestionPublicationBlockers(verification({ [field]: false }));
    expect(canPublishExamQuestion(verification({ [field]: false }))).toBe(false);
    expect(blockers.join(" ")).toContain(expected);
  });

  /*
   * A reviewer judges wording. A mispaired mark scheme is wrong however
   * confident anyone is about the wording, so no opinion clears it.
   */
  it("cannot be talked round by an approving reviewer", () => {
    const mispaired = verification({ markSchemeLabelMatches: false });
    expect(canPublishExamQuestion(mispaired)).toBe(false);
  });

  it("reports every blocker at once, so one re-ingest can fix them all", () => {
    const broken = verification({ tariffMatches: false, assetsComplete: false, questionComplete: false });
    expect(examQuestionPublicationBlockers(broken)).toHaveLength(3);
  });
});
