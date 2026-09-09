import { afterEach, describe, expect, it } from "vitest";
import {
  EXAM_DIFFICULTY_MAX_REVERSALS,
  nextExamDifficulty,
  resolveExamDifficulty,
} from "@/lib/practice/exam-difficulty";
import {
  projectExamAttempt,
  projectExamSessionQuestion,
} from "@/lib/practice/exam-projections";
import {
  examAnswerUnlocksModelAnswer,
  examBoardAppliesTo,
  examResultForAttempt,
  questionMatchesExamCourse,
  type ExamCourseSelection,
  type ExamQuestion,
} from "@/lib/practice/exam-questions";
import { isExamQuestionServable } from "@/lib/practice/exam-question-rights";
import { mapStudyFolderData } from "@/lib/workspace/study-folders";
import type { PracticePaperQuestionResult } from "@/lib/practice/practice-papers";

const OFFICIAL_RIGHTS = {
  key: "aqa-2026",
  version: 1,
  verified: true,
  storageAllowed: true,
  studentDisplayAllowed: true,
  aiInferenceAllowed: true,
  revoked: false,
};

const JAMI_RIGHTS = { ...OFFICIAL_RIGHTS, key: "jami-original" };

const PENDING = { status: "pending" as const, notes: [] };
const APPROVED = { status: "approved" as const, by: "ai" as const, at: 2, notes: [] };
const REJECTED = { status: "rejected" as const, by: "ai" as const, at: 2, notes: ["Tariff mismatch."] };

function question(overrides: Partial<ExamQuestion> = {}): ExamQuestion {
  return {
    id: "q1",
    paperId: "paper-1",
    subject: "Biology",
    subjectKey: "biology",
    studyLevel: "gcse-equivalent",
    label: "Question 3",
    prompt: "Describe how enzymes are affected by temperature.",
    marks: 4,
    assets: [],
    topicIds: ["enzymes"],
    tier: "Higher",
    difficulty: "medium",
    aiDifficulty: "medium",
    difficultyScore: 0.55,
    difficultySource: "ai_ingest",
    origin: "jami_generated",
    provenance: {
      board: "aqa",
      boardLabel: "AQA",
      qualification: "gcse",
      specificationId: "8461",
      specificationTitle: "GCSE Biology",
      componentCode: "1F",
      componentTitle: "Paper 1",
      year: 2024,
      series: "June",
      paperReference: "8461/1H",
      questionNumber: "3",
      sourceUrl: "https://www.aqa.org.uk/paper.pdf",
      sourceSha256: "abc",
    },
    rights: JAMI_RIGHTS,
    status: "published",
    review: { status: "pending" as const, notes: [] },
    contentVersion: "v1",
    selectionKey: 0.5,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function result(overrides: Partial<PracticePaperQuestionResult> = {}): PracticePaperQuestionResult {
  return {
    questionId: "q1",
    label: "Question 3",
    awardedMarks: 0,
    maxMarks: 4,
    feedback: "Nearly.",
    strengths: [],
    improvements: [],
    confidence: "high",
    counted: true,
    attempted: true,
    modelAnswer: "Enzymes denature above their optimum temperature.",
    ...overrides,
  };
}

describe("the licence gate", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("serves a Jami-created question that carries the checked-in rights record", () => {
    expect(isExamQuestionServable(question())).toBe(true);
  });

  it("refuses a question whose rights key is not in the registry at all", () => {
    expect(
      isExamQuestionServable(question({ rights: { ...OFFICIAL_RIGHTS, key: "invented" } }))
    ).toBe(false);
  });

  it("refuses a question whose own snapshot says the permission was revoked", () => {
    expect(
      isExamQuestionServable(question({ rights: { ...JAMI_RIGHTS, revoked: true } }))
    ).toBe(false);
  });

  it("refuses a question whose snapshot withholds provider inference", () => {
    expect(
      isExamQuestionServable(question({ rights: { ...JAMI_RIGHTS, aiInferenceAllowed: false } }))
    ).toBe(false);
  });

  it("refuses a question nobody has published", () => {
    expect(isExamQuestionServable(question({ status: "needs_review" }))).toBe(false);
    expect(isExamQuestionServable(question({ status: "withdrawn" }))).toBe(false);
  });

  it("serves a licensed board's question once a person has checked it", () => {
    expect(
      isExamQuestionServable(
        question({ origin: "official_past_paper", review: APPROVED, rights: OFFICIAL_RIGHTS })
      )
    ).toBe(true);
  });

  /*
   * Evidence is recorded per board, and the registry holds the UK domestic
   * seven. A board nobody has licensed cannot borrow another board's record:
   * the permission has to name the board whose material is being served.
   */
  it("refuses a board with no evidence of its own", () => {
    expect(
      isExamQuestionServable(
        question({
          origin: "official_past_paper",
          review: APPROVED,
          rights: OFFICIAL_RIGHTS,
          provenance: { ...question().provenance, board: "cambridge_international" },
        })
      )
    ).toBe(false);
  });

  /*
   * A licence makes material lawful to serve. It does not make an AI
   * extraction of it correct, and a wrong mark scheme marks a student wrongly.
   */
  it("refuses official material the reviewer turned down", () => {
    expect(
      isExamQuestionServable(
        question({ origin: "official_past_paper", review: REJECTED, rights: OFFICIAL_RIGHTS })
      )
    ).toBe(false);
  });

  it("refuses official material nobody has reviewed", () => {
    expect(
      isExamQuestionServable(
        question({ origin: "official_past_paper", review: PENDING, rights: OFFICIAL_RIGHTS })
      )
    ).toBe(false);
  });

  it("stops serving a board's own material the moment its kill switch is set", () => {
    process.env.EXAM_QUESTION_AQA_ENABLED = "false";
    expect(
      isExamQuestionServable(
        question({ origin: "official_past_paper", review: APPROVED, rights: OFFICIAL_RIGHTS })
      )
    ).toBe(false);
  });

  /*
   * The switch is there to stop sending a board's material, and Jami's own
   * questions are not the board's. Covering them too would mean shipping
   * .env.example -- which disables every board -- silently breaks the one
   * content path that works before any licence exists, and breaks it at
   * marking time, long after the session looked fine.
   */
  it("leaves Jami-created questions alone when their board is switched off", () => {
    process.env.EXAM_QUESTION_AQA_ENABLED = "false";
    expect(isExamQuestionServable(question())).toBe(true);
  });

  it("stops serving one specification without touching the rest of its board", () => {
    process.env.EXAM_QUESTION_DISABLED_SPECIFICATIONS = "8461, 7402";
    expect(isExamQuestionServable(question())).toBe(false);
    expect(
      isExamQuestionServable(
        question({ provenance: { ...question().provenance, specificationId: "8462" } })
      )
    ).toBe(true);
  });
});

describe("what reaches the client", () => {
  it("hands over no mark scheme, model answer or storage path with a question", () => {
    const projected = projectExamSessionQuestion(
      question({
        assets: [
          {
            id: "figure-1",
            type: "image",
            title: "Figure 1",
            content: "",
            altText: "A graph",
            storagePath: "internal/examQuestionBank/aqa/paper-1/figure.png",
            mimeType: "image/png",
            source: "deterministic",
            validationStatus: "valid",
          },
        ],
      }),
      "session_1_1"
    );
    const serialised = JSON.stringify(projected);
    expect(serialised).not.toContain("internal/examQuestionBank");
    expect(serialised).not.toContain("markScheme");
    expect(serialised).not.toContain("modelAnswer");
    expect(projected.assets[0]).not.toHaveProperty("storagePath");
    expect(projected.prompt).toContain("enzymes");
  });

  it("withholds the official scheme from an attempt that is still a draft", () => {
    const projected = projectExamAttempt("attempt-1", {
      userId: "student-1",
      sessionId: "session-1",
      questionId: "q1",
      attemptNumber: 1,
      answerText: "",
      status: "draft",
      officialMarkScheme: "B1 for stating denaturation",
      workingIncluded: false,
      reviewUsed: false,
      startedAt: 1,
      updatedAt: 1,
    });
    expect(projected.result).toBeUndefined();
    expect(projected.officialMarkScheme).toBeUndefined();
  });
});

describe("teaching material after marking", () => {
  it("gives the worked answer to any attempt that reached the marker", () => {
    // A wrong numeric answer is three characters and a page of handwritten
    // working is none, and both are genuine attempts.
    expect(examAnswerUnlocksModelAnswer(result())).toBe(true);
    expect(examAnswerUnlocksModelAnswer(result({ awardedMarks: 0 }))).toBe(true);
    expect(examResultForAttempt(result()).modelAnswer).toBeDefined();
  });

  it("blanks the report entirely when nothing was attempted", () => {
    const blank = examResultForAttempt(result({ attempted: false }));
    expect(examAnswerUnlocksModelAnswer(result({ attempted: false }))).toBe(false);
    expect(blank.modelAnswer).toBeUndefined();
    expect(blank.feedback).toContain("wasn't enough of an answer");
    expect(blank.awardedMarks).toBe(0);
  });
});

describe("course matching", () => {
  const course: ExamCourseSelection = {
    board: "aqa",
    qualification: "gcse",
    specificationId: "8461",
    specificationTitle: "GCSE Biology",
    tier: "Higher",
    componentIds: ["1F"],
  };
  const official = question({ origin: "official_past_paper" });

  it("takes a question from the exact board, qualification, spec, tier and component", () => {
    expect(questionMatchesExamCourse(official, course)).toBe(true);
  });

  it("never treats a Jami-created question as past-paper stock", () => {
    expect(questionMatchesExamCourse(question(), course)).toBe(false);
  });

  it("refuses another tier or another component of the same specification", () => {
    expect(questionMatchesExamCourse({ ...official, tier: "Foundation" }, course)).toBe(false);
    expect(
      questionMatchesExamCourse(
        { ...official, provenance: { ...official.provenance, componentCode: "2H" } },
        course
      )
    ).toBe(false);
  });

  it("accepts any component when the folder named none", () => {
    expect(questionMatchesExamCourse(official, { ...course, componentIds: [] })).toBe(true);
  });
});

describe("exam board scope", () => {
  it("applies to school qualifications and stops above A level", () => {
    expect(examBoardAppliesTo("gcse-equivalent")).toBe(true);
    expect(examBoardAppliesTo("post-16-equivalent")).toBe(true);
    expect(examBoardAppliesTo("undergraduate")).toBe(false);
    expect(examBoardAppliesTo(undefined)).toBe(false);
  });

  it("drops a stored course when the folder is promoted past A level", () => {
    const stored = {
      name: "Biology",
      studyLevel: "undergraduate",
      examCourse: { board: "aqa", qualification: "gcse", specificationId: "8461", specificationTitle: "GCSE Biology", componentIds: [] },
    };
    expect(mapStudyFolderData("folder-1", stored).examCourse).toBeUndefined();
    expect(
      mapStudyFolderData("folder-1", { ...stored, studyLevel: "gcse-equivalent" }).examCourse
    ).toMatchObject({ specificationId: "8461" });
  });
});

describe("difficulty learned from real scores", () => {
  const steady = { attemptCount: 40, previousDirection: 0 as const, reversals: 0 };

  it("leaves the ingest tier alone until enough students have answered", () => {
    expect(
      resolveExamDifficulty({ current: "hard", mean: 0.95, attemptCount: 11, previousDirection: 0, reversals: 0 })
    ).toMatchObject({ difficulty: "hard", changed: false });
    expect(
      resolveExamDifficulty({ current: "hard", mean: 0.95, ...steady })
    ).toMatchObject({ difficulty: "medium", changed: true });
  });

  it("keeps a gap between the bands so a question cannot flip on one attempt", () => {
    // Easy holds down to 0.7; medium only becomes easy at 0.8. Everything in
    // between leaves whichever tier it already has untouched.
    expect(nextExamDifficulty("easy", 0.75)).toBe("easy");
    expect(nextExamDifficulty("medium", 0.75)).toBe("medium");
    expect(nextExamDifficulty("medium", 0.45)).toBe("medium");
    expect(nextExamDifficulty("hard", 0.45)).toBe("hard");
  });

  it("sends a question that keeps changing its mind back for review", () => {
    let state = { previousDirection: 1 as -1 | 0 | 1, reversals: EXAM_DIFFICULTY_MAX_REVERSALS - 1 };
    const outcome = resolveExamDifficulty({
      current: "medium",
      mean: 0.9,
      attemptCount: 40,
      ...state,
    });
    expect(outcome.difficulty).toBe("easy");
    expect(outcome.needsReview).toBe(true);

    state = { previousDirection: 1, reversals: 0 };
    expect(resolveExamDifficulty({ current: "medium", mean: 0.9, attemptCount: 40, ...state }).needsReview).toBe(
      false
    );
  });
});
