import { describe, expect, it } from "vitest";
import { applyPracticePaperMarkRanges } from "@/lib/evaluation/marking-calibration";
import {
  mapPracticePaperData,
  mapPracticePaperMarkingJobData,
  type PracticePaperResult,
} from "@/lib/practice/practice-papers";

const paper = mapPracticePaperData("paper-1", {
  notebookId: "paper-1",
  folderId: "folder-1",
  title: "A-level Maths",
  status: "submitted",
  assessmentProfile: {
    studyLevel: "A-level",
    qualificationOrModule: "A-level Mathematics",
    awardingBodyOrInstitution: "Example board",
    specificationOrCourse: "Mathematics",
  },
  questions: [
    { id: "q1", label: "Question 1", prompt: "Differentiate x²", marks: 4 },
    { id: "q2", label: "Question 2", prompt: "Integrate x", marks: 6 },
  ],
  markScheme: {
    kind: "official",
    items: [
      { questionId: "q1", answer: "2x", marking: "additive", criteria: [], acceptableAlternatives: [], commonMistakes: [] },
      { questionId: "q2", answer: "x²/2 + c", marking: "additive", criteria: [], acceptableAlternatives: [], commonMistakes: [] },
    ],
  },
});

const result: PracticePaperResult = {
  awardedMarks: 7,
  totalMarks: 10,
  percentage: 70,
  summary: "A sound attempt.",
  strengths: [],
  priorities: [],
  questionResults: [
    { questionId: "q1", label: "Question 1", awardedMarks: 3, maxMarks: 4, feedback: "", strengths: [], improvements: [], confidence: "high", counted: true, attempted: true },
    { questionId: "q2", label: "Question 2", awardedMarks: 4, maxMarks: 6, feedback: "", strengths: [], improvements: [], confidence: "low", counted: true, attempted: true },
  ],
};

const audit = {
  version: 1,
  primaryScores: { q1: 3, q2: 5 },
  verifierScores: { q1: 3, q2: 3 },
  disputedQuestionIds: ["q2"],
  adjudicatedQuestionIds: ["q2"],
  thirdViewQuestionIds: [],
  createdAt: 1,
};

describe("practice-paper mark calibration", () => {
  it("projects a content-free marking job without provider cost or evidence", () => {
    const projected = mapPracticePaperMarkingJobData("job-1", {
      paperId: "paper-1",
      attemptId: "attempt-1",
      status: "running",
      stage: "marking",
      estimatedCostUsd: 0.42,
      providerOutput: "private answer",
      evidenceManifest: { private: true },
    });
    expect(projected).toMatchObject({ paperId: "paper-1", status: "running", stage: "marking" });
    expect(projected).not.toHaveProperty("estimatedCostUsd");
    expect(projected).not.toHaveProperty("providerOutput");
    expect(projected).not.toHaveProperty("evidenceManifest");
  });

  it("keeps the rubric score exact and always adds an asymmetric overall range", () => {
    const calibrated = applyPracticePaperMarkRanges({ paper, result, audit });
    expect(calibrated.awardedMarks).toBe(7);
    expect(calibrated.markRange).toMatchObject({ lower: 5, upper: 8, earlyEstimate: false });
  });

  it("shows question ranges only for flagged decisions and includes marker bounds", () => {
    const calibrated = applyPracticePaperMarkRanges({ paper, result, audit });
    expect(calibrated.questionResults[0].markRange).toBeUndefined();
    expect(calibrated.questionResults[1].markRange).toMatchObject({ lower: 1, upper: 6 });
  });

  it("widens visible uncertainty for missing evidence without blocking a score", () => {
    const calibrated = applyPracticePaperMarkRanges({
      paper,
      result,
      audit: { ...audit, disputedQuestionIds: [], adjudicatedQuestionIds: [] },
      evidenceIssues: [{
        code: "answer_image_unreadable",
        severity: "warning",
        questionId: "q1",
        message: "Some handwriting was difficult to read.",
      }],
    });
    expect(calibrated.awardedMarks).toBe(7);
    expect(calibrated.questionResults[0].markRange?.reasons).toContain(
      "Some handwriting was difficult to read."
    );
    expect(calibrated.evidenceWarnings).toContain("Some handwriting was difficult to read.");
  });
});
