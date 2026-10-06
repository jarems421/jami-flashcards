import { describe, expect, it } from "vitest";
import { countMarkedExamQuestions, examQuestionAttempts } from "@/lib/practice/exam-session-attempts";

const question = { attemptId: "s1_q1_1" };

describe("examQuestionAttempts", () => {
  it("answers the first attempt until a retry is opened", () => {
    const first = { id: "s1_q1_1", status: "draft" as const };
    expect(examQuestionAttempts(question, [first])).toMatchObject({
      activeAttempt: first,
      retryOpen: false,
      markedAttempt: undefined,
      retryId: "s1_q1_2",
    });
  });

  it("answers an open retry, while showing the first attempt's mark", () => {
    const first = { id: "s1_q1_1", status: "marked" as const };
    const retry = { id: "s1_q1_2", status: "draft" as const };
    expect(examQuestionAttempts(question, [first, retry])).toMatchObject({
      activeAttempt: retry,
      retryOpen: true,
      markedAttempt: first,
    });
  });

  it("shows the retry's mark once it has one", () => {
    const first = { id: "s1_q1_1", status: "marked" as const };
    const retry = { id: "s1_q1_2", status: "marked" as const };
    expect(examQuestionAttempts(question, [first, retry])).toMatchObject({
      activeAttempt: first,
      retryOpen: false,
      markedAttempt: retry,
    });
  });
});

describe("countMarkedExamQuestions", () => {
  it("counts a question only once every part has a marked first attempt", () => {
    const runs = [
      { from: 0, count: 2 },
      { from: 2, count: 1 },
    ];
    const parts = [{ id: "3a" }, { id: "3b" }, { id: "4" }];
    const attempts = [
      { questionId: "3a", attemptNumber: 1 as const, status: "marked" as const },
      { questionId: "3b", attemptNumber: 2 as const, status: "marked" as const },
      { questionId: "4", attemptNumber: 1 as const, status: "marked" as const },
    ];

    expect(countMarkedExamQuestions(runs, parts, attempts)).toBe(1);
  });
});
