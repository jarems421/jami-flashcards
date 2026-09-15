import { describe, expect, it } from "vitest";
import { projectExamAttempt, projectExamSessionQuestion } from "@/lib/practice/exam-projections";
import type { ExamSessionQuestion } from "@/lib/practice/exam-questions";

describe("projectExamAttempt", () => {
  it("keeps student feedback while removing internal marking and evidence fields", () => {
    const projected = projectExamAttempt("attempt-1", {
      userId: "student-1",
      sessionId: "session-1",
      questionId: "question-1",
      attemptNumber: 1,
      answerText: "My answer",
      status: "marked",
      workingIncluded: true,
      workingSnapshotPath: "users/student-1/private/working.png",
      statsContributionFraction: 0.5,
      idempotencyKey: "private-key",
      audit: { primaryScore: 2, verifierScore: 3 },
      reviewAudit: { provider: "private" },
      reviewUsed: false,
      startedAt: 1,
      updatedAt: 2,
      result: {
        questionId: "question-1",
        label: "1",
        awardedMarks: 2,
        maxMarks: 4,
        feedback: "Good start",
        confidence: "low",
        strengths: [],
        improvements: [],
        counted: true,
        attempted: true,
        criterionResults: [{ criterionId: "C1", criterion: "Valid method", awarded: true, evidence: "x = 2" }],
      },
    });

    expect(projected.answerText).toBe("My answer");
    expect(projected.result?.feedback).toBe("Good start");
    expect(projected.result).not.toHaveProperty("confidence");
    expect(projected.result?.criterionResults?.[0]).not.toHaveProperty("criterionId");
    expect(projected).not.toHaveProperty("workingSnapshotPath");
    expect(projected).not.toHaveProperty("statsContributionFraction");
    expect(projected).not.toHaveProperty("idempotencyKey");
    expect(projected).not.toHaveProperty("audit");
    expect(projected).not.toHaveProperty("reviewAudit");
  });
});

describe("projectExamSessionQuestion", () => {
  const base = {
    id: "question-1",
    attemptId: "attempt-1",
    label: "Question 1",
    prompt: "Explain why the rate increases.",
    marks: 2,
    difficulty: "easy",
    origin: "official_past_paper",
    provenance: { board: "aqa", specificationId: "8461" },
    contentVersion: "v1",
    topicIds: ["aqa-8461-cell-biology"],
    assets: [],
  };

  it("carries what a question was about and the command word it opened with", () => {
    const projected = projectExamSessionQuestion(
      { ...base, conceptIds: ["aqa-8461-cell-biology-osmosis"], commandWord: "Explain" } as unknown as ExamSessionQuestion,
      "attempt-1"
    );
    expect(projected).toMatchObject({ conceptIds: ["aqa-8461-cell-biology-osmosis"], commandWord: "Explain" });
  });

  it("reads a snapshot from before concepts as having none, and invents no command word", () => {
    const projected = projectExamSessionQuestion(base as unknown as ExamSessionQuestion, "attempt-1");
    expect(projected.conceptIds).toEqual([]);
    expect(projected).not.toHaveProperty("commandWord");
  });
});
