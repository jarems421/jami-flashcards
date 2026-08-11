import { describe, expect, it } from "vitest";
import {
  isCompletePracticePaperCandidate,
  parsePracticePaperQualityAudit,
} from "@/lib/ai/practice-paper-quality";

describe("complete practice-paper gate", () => {
  it("rejects topic-test sized outputs", () => {
    expect(isCompletePracticePaperCandidate({
      status: "ready",
      assessmentProfile: {
        studyLevel: "GCSE",
        qualificationOrModule: "Biology",
        awardingBodyOrInstitution: "AQA",
        specificationOrCourse: "Biology",
        tierOrComponent: "Topic test",
        formatSummary: "Short test",
        confidence: "high",
      },
      title: "Cells test",
      instructions: [],
      durationMinutes: 15,
      questions: [{ id: "q1", label: "Question 1", prompt: "Name a cell.", marks: 5, assets: [] }],
      choiceGroups: [],
      totalMarks: 5,
      markScheme: {
        kind: "generated",
        label: "Guide",
        notice: "",
        items: [{ questionId: "q1", maxMarks: 5, answer: "", criteria: [], acceptableAlternatives: [], commonMistakes: [] }],
      },
      sourceRefs: [],
      gradeGuidance: { kind: "none", label: "", notice: "", boundaries: [] },
      examinerInsights: [],
    })).toBe(false);
  });

  it("keeps only structured audit issues", () => {
    expect(parsePracticePaperQualityAudit(JSON.stringify({
      pass: false,
      issues: [{ code: "missing-choice", severity: "error", detail: "Section B choice is absent." }],
    }))).toEqual({
      pass: false,
      issues: [{ code: "missing-choice", severity: "error", detail: "Section B choice is absent.", questionId: undefined }],
    });
  });
});
