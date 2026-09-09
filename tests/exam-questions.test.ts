import { describe, expect, it } from "vitest";
import { canServeExamRights, isCurrentSpecificationQuestion, normalizeDifficultyMix } from "@/lib/practice/exam-questions";
import { EXAM_SOURCE_CONNECTORS } from "@/lib/practice/exam-source-connectors";
import { buildSingleQuestionPaper } from "@/lib/practice/single-question-paper";

const rights = { key: "permission", version: 1, verified: true, storageAllowed: true, studentDisplayAllowed: true, aiInferenceAllowed: true, revoked: false };

describe("Past Paper Practice safety contracts", () => {
  it("accepts only a one-to-twenty question difficulty mix", () => {
    expect(normalizeDifficultyMix({ easy: 2, medium: 3, hard: 1 })).toEqual({ easy: 2, medium: 3, hard: 1 });
    expect(normalizeDifficultyMix({ easy: 0, medium: 0, hard: 0 })).toBeNull();
    expect(normalizeDifficultyMix({ easy: 20, medium: 1, hard: 0 })).toBeNull();
    expect(normalizeDifficultyMix({ easy: 1.5, medium: 0, hard: 0 })).toBeNull();
  });

  it("fails closed for incomplete or revoked permission evidence", () => {
    expect(canServeExamRights(rights)).toBe(true);
    expect(canServeExamRights({ ...rights, aiInferenceAllowed: false })).toBe(false);
    expect(canServeExamRights({ ...rights, revoked: true })).toBe(false);
    expect(isCurrentSpecificationQuestion({ status: "published", rights })).toBe(true);
    expect(isCurrentSpecificationQuestion({ status: "needs_review", rights })).toBe(false);
  });

  it("keeps the board connector rollout in the locked order", () => {
    expect(EXAM_SOURCE_CONNECTORS.find((item) => item.board === "aqa")?.priority).toBe(1);
    expect(EXAM_SOURCE_CONNECTORS.find((item) => item.board === "pearson_edexcel")?.priority).toBe(2);
    expect(EXAM_SOURCE_CONNECTORS.find((item) => item.board === "ocr")?.priority).toBe(3);
    expect(EXAM_SOURCE_CONNECTORS.find((item) => item.board === "ib")?.priority).toBe(7);
  });
});

describe("single-question marking adapter", () => {
  it("builds the same minimal paper shape used by production marking", () => {
    const paper = buildSingleQuestionPaper({
      id: "attempt-1", folderId: "folder-1", title: "Biology Q4",
      question: { id: "q4", label: "Q4", prompt: "State two functions.", marks: 2, assets: [] },
      markSchemeItem: { questionId: "q4", maxMarks: 2, marking: "additive", answer: "A and B", acceptableAlternatives: [], commonMistakes: [], points: [
        { id: "q4.m1", marks: 1, code: "B", text: "A", dep: [], ft: false, essentialTerms: [], allow: [], reject: [] },
        { id: "q4.m2", marks: 1, code: "B", text: "B", dep: [], ft: false, essentialTerms: [], allow: [], reject: [] },
      ] },
      studyLevel: "gcse-equivalent", qualification: "gcse", awardingBody: "AQA", specification: "GCSE Biology", component: "Paper 1", markSchemeKind: "official",
    });
    expect(paper.questions).toHaveLength(1);
    expect(paper.totalMarks).toBe(2);
    expect(paper.markScheme.items[0]?.questionId).toBe("q4");
  });
});
