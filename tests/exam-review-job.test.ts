import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What a mark-check job may and may not write.
 *
 * The check moved off the request that asks for it, for the same reason marking
 * did and with a worse ratio: it is a juror read and then a reconciliation,
 * reports `markerTimeoutMs` sizes at 515 and 408 seconds, and the route gave
 * both of them 55 between them.
 *
 * What it costs is the guarantee a synchronous route gave for free -- that only
 * one check of an attempt could be in flight. A student gets one check, so the
 * rules about who may write are stricter here than in marking: a check that
 * produced nothing must not spend it, and a superseded job must not spend it
 * either.
 */
type Doc = Record<string, unknown>;

const DELETE = Symbol("delete");
const INCREMENT = "increment";

const store = new Map<string, Doc>();

function applyUpdate(target: Doc, patch: Doc) {
  for (const [key, value] of Object.entries(patch)) {
    const path = key.split(".");
    let node = target;
    for (const segment of path.slice(0, -1)) {
      if (typeof node[segment] !== "object" || node[segment] === null) node[segment] = {};
      node = node[segment] as Doc;
    }
    const last = path[path.length - 1];
    if (value === DELETE) delete node[last];
    else if (typeof value === "object" && value !== null && (value as Doc).__op === INCREMENT) {
      node[last] = (typeof node[last] === "number" ? (node[last] as number) : 0) + ((value as Doc).by as number);
    } else node[last] = value;
  }
}

function docRef(path: string) {
  return {
    path,
    async get() {
      const value = store.get(path);
      return { exists: Boolean(value), data: () => (value ? { ...value } : undefined) };
    },
    async update(patch: Doc) {
      const current = store.get(path);
      if (!current) throw new Error(`no document at ${path}`);
      applyUpdate(current, patch);
    },
  };
}

function collectionRef(path: string) {
  return { doc: (id: string) => makeRef(`${path}/${id}`) };
}

function makeRef(path: string) {
  return { ...docRef(path), collection: (name: string) => collectionRef(`${path}/${name}`) };
}

const db = {
  collection: (name: string) => collectionRef(name),
  async runTransaction<T>(body: (transaction: unknown) => Promise<T>) {
    const transaction = {
      get: (ref: { path: string }) => docRef(ref.path).get(),
      update: (ref: { path: string }, patch: Doc) => {
        const current = store.get(ref.path);
        if (current) applyUpdate(current, patch);
      },
    };
    return body(transaction);
  },
};

const mocks = vi.hoisted(() => ({
  reviewSingleQuestionIndependently: vi.fn(),
  refundAiBudget: vi.fn(async () => undefined),
  correctExamDifficultyContribution: vi.fn(async () => undefined),
  start: vi.fn<(...args: unknown[]) => Promise<{ runId: string }>>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { delete: () => DELETE, increment: (by: number) => ({ __op: INCREMENT, by }) },
}));
vi.mock("workflow/api", () => ({ start: mocks.start }));
vi.mock("@/workflows/exam-question-review", () => ({ reviewExamQuestionWorkflow: () => undefined }));
vi.mock("@/services/firebase/admin", () => ({
  getAdminDb: () => db,
  getAdminStorageBucket: () => ({ file: () => ({ download: async () => [Buffer.from("png")] }) }),
}));
vi.mock("@/lib/app/feature-flags", () => ({ featureFlags: { enablePastPaperPractice: true } }));
vi.mock("@/lib/ai/spend-context", () => ({ enterAiSpendContext: () => undefined }));
vi.mock("@/services/ai/spend.server", () => ({ aiSpendContextFor: () => ({}) }));
vi.mock("@/services/ai/budgets", () => ({
  getAiTokenCap: () => 2_000,
  refundAiBudget: mocks.refundAiBudget,
}));
vi.mock("@/services/ai/practice-paper-marking.server", () => ({
  reviewSingleQuestionIndependently: mocks.reviewSingleQuestionIndependently,
}));
vi.mock("@/services/practice/exam-difficulty.server", () => ({
  correctExamDifficultyContribution: mocks.correctExamDifficultyContribution,
}));
vi.mock("@/services/practice/exam-evidence.server", () => ({
  loadServableExamQuestion: async () => ({ id: "q1", assets: [] }),
  loadExamQuestionSecret: async () => ({
    questionId: "q1",
    markSchemeItem: {
      questionId: "q1", maxMarks: 3, marking: "additive", answer: "x = 4",
      points: [], acceptableAlternatives: [], commonMistakes: [],
    },
    officialMarkScheme: "M1 A1 A1",
  }),
  examQuestionVisualParts: async () => [],
}));

const {
  enqueueExamQuestionReview,
  examReviewIsCancelled,
  failExamQuestionReview,
  runExamQuestionReview,
} = await import("@/services/practice/exam-review.server");

const TOKEN = "check-1";
const LATER = "check-2";

function markedResult(awardedMarks: number) {
  return {
    questionId: "q1", label: "Question 1", awardedMarks, maxMarks: 3,
    feedback: "ok", criterionResults: [], evidence: ["seen"], strengths: [],
    improvements: [], confidence: "high", attempted: true, counted: true,
  };
}

function seed(overrides: { attempt?: Doc } = {}) {
  store.clear();
  store.set("users/student/examSessions/session-1", {
    id: "session-1", userId: "student", folderId: "folder-1", subject: "Maths",
    studyLevel: "gcse-equivalent", status: "active", answeredCount: 1,
    awardedTotal: 1, assessedTotal: 3, maxTotal: 3,
    course: { qualification: "gcse" },
    questions: [{
      id: "q1", attemptId: "attempt-1", label: "Question 1", prompt: "Solve for x.",
      marks: 3, assets: [], contentVersion: "v1",
      provenance: { boardLabel: "AQA", specificationTitle: "Spec", componentTitle: "Paper 1" },
      origin: "official_past_paper",
    }],
  });
  store.set("users/student/examAttempts/attempt-1", {
    id: "attempt-1", userId: "student", sessionId: "session-1", questionId: "q1",
    attemptNumber: 1, answerText: "x = 4", status: "marked", workingIncluded: false,
    reviewUsed: false, reviewStatus: "reviewing", reviewKey: "session-1:q1:review",
    reviewStartedAt: 5, startedAt: 1, submittedAt: 2, markedAt: 4, updatedAt: 5,
    result: markedResult(1),
    review: {
      token: TOKEN, startedAt: 5, deadlineAt: 5 + 600_000,
      budgetGrant: { uid: "student", action: "examQuestionReview", dayKey: "d", burstWindowStartedAt: 0 },
    },
    ...overrides.attempt,
  });
}

function attempt() {
  return store.get("users/student/examAttempts/attempt-1")!;
}

function reviewOutcome(awardedMarks: number) {
  return {
    result: { questionResults: [markedResult(awardedMarks)] },
    estimatedCostUsd: 0.01,
    audit: { jurorScore: awardedMarks, reviewedScore: awardedMarks, changed: true, reconciled: true },
  };
}

beforeEach(() => {
  mocks.reviewSingleQuestionIndependently.mockReset();
  mocks.reviewSingleQuestionIndependently.mockResolvedValue(reviewOutcome(2));
  mocks.refundAiBudget.mockClear();
  mocks.correctExamDifficultyContribution.mockClear();
  mocks.start.mockReset();
  mocks.start.mockResolvedValue({ runId: "run-1" });
  seed();
});

describe("a check that is still the current one", () => {
  it("writes the checked mark, spends the check, and clears its job", async () => {
    expect(await runExamQuestionReview("student", "attempt-1", TOKEN)).toBe("checked");
    expect(attempt().reviewUsed).toBe(true);
    expect(attempt().reviewStatus).toBe("complete");
    expect(attempt().reviewOriginalScore).toBe(1);
    expect((attempt().result as Doc).awardedMarks).toBe(2);
    expect(attempt().review).toBeUndefined();
  });

  it("moves the session total by the difference, not the new mark", async () => {
    await runExamQuestionReview("student", "attempt-1", TOKEN);
    expect(store.get("users/student/examSessions/session-1")!.awardedTotal).toBe(2);
  });

  it("checks against the deadline the job was given, not a request's", async () => {
    await runExamQuestionReview("student", "attempt-1", TOKEN);
    expect(mocks.reviewSingleQuestionIndependently.mock.calls[0][0].deadlineAt).toBe(5 + 600_000);
  });

  /*
   * The juror's report is the expensive half, and a student gets one check --
   * so a resumed job paying for it twice is worse here than in marking.
   */
  it("hands back the juror report a previous run already paid for", async () => {
    const stages = { juror: { result: { questionResults: [] }, diagnostics: [] } };
    seed({ attempt: { review: { token: TOKEN, startedAt: 5, deadlineAt: 600_005, stages } } });
    await runExamQuestionReview("student", "attempt-1", TOKEN);
    expect(mocks.reviewSingleQuestionIndependently.mock.calls[0][0].cachedStageResults).toEqual(stages);
  });
});

describe("a check the attempt has moved past", () => {
  /*
   * The stranded-and-retried race. The first job's key is the client's
   * idempotency key, which is the same string every time this answer is
   * checked -- so identity has to come from the job's own token instead.
   */
  it("does not write a result once a newer check has taken over", async () => {
    mocks.reviewSingleQuestionIndependently.mockImplementation(async () => {
      applyUpdate(attempt(), { "review.token": LATER });
      return reviewOutcome(3);
    });
    expect(await runExamQuestionReview("student", "attempt-1", TOKEN)).toBe("cancelled");
    expect(attempt().reviewUsed).toBe(false);
    expect((attempt().result as Doc).awardedMarks).toBe(1);
    expect(store.get("users/student/examSessions/session-1")!.awardedTotal).toBe(1);
  });

  it("does not leave its checkpoints for the check that replaced it", async () => {
    mocks.reviewSingleQuestionIndependently.mockImplementation(async (input: {
      onStageResult: (stage: string, value: unknown) => Promise<void>;
    }) => {
      applyUpdate(attempt(), { "review.token": LATER });
      await input.onStageResult("juror", { result: { questionResults: [] }, diagnostics: [] });
      return reviewOutcome(3);
    });
    await runExamQuestionReview("student", "attempt-1", TOKEN);
    expect((attempt().review as Doc).stages).toBeUndefined();
  });

  it("does not fail a check it no longer owns", async () => {
    applyUpdate(attempt(), { "review.token": LATER });
    await failExamQuestionReview("student", "attempt-1", "marking_failed", TOKEN);
    expect(attempt().reviewStatus).toBe("reviewing");
    expect(mocks.refundAiBudget).not.toHaveBeenCalled();
  });

  it("stops rather than check an answer the student deleted", async () => {
    applyUpdate(attempt(), { answerDeletedAt: 9 });
    expect(await examReviewIsCancelled("student", "attempt-1", TOKEN)).toBe(true);
    expect(await runExamQuestionReview("student", "attempt-1", TOKEN)).toBe("cancelled");
    expect(mocks.reviewSingleQuestionIndependently).not.toHaveBeenCalled();
  });

  /*
   * Unlike a marking, a finished session does not stop a check: the mark report
   * stays reachable from history, and a student may ask there.
   */
  it("carries on for a session the student has finished", async () => {
    store.get("users/student/examSessions/session-1")!.status = "completed";
    expect(await examReviewIsCancelled("student", "attempt-1", TOKEN)).toBe(false);
  });
});

describe("a check that produces nothing", () => {
  /*
   * The rule that matters most here. A check that did not happen has not been
   * spent, so `reviewUsed` stays false and the mark and feedback are untouched
   * -- otherwise a provider outage silently costs the student their one check.
   */
  it("does not spend the student's one check", async () => {
    mocks.reviewSingleQuestionIndependently.mockRejectedValue(new Error("provider gone"));
    expect(await runExamQuestionReview("student", "attempt-1", TOKEN)).toBe("failed");
    expect(attempt().reviewUsed).toBe(false);
    expect(attempt().reviewStatus).toBe("failed");
    expect((attempt().result as Doc).awardedMarks).toBe(1);
    expect(mocks.refundAiBudget).toHaveBeenCalledTimes(1);
  });

  it("leaves a reason the page can explain, not just a status", async () => {
    mocks.reviewSingleQuestionIndependently.mockRejectedValue(new Error("input_too_large"));
    await runExamQuestionReview("student", "attempt-1", TOKEN);
    const failure = attempt().reviewFailure as Doc;
    expect(failure.code).toBe("input_too_large");
    expect(String(failure.message)).toContain("has not been used up");
  });

  it("settles a check whose job could not be queued at all", async () => {
    mocks.start.mockRejectedValue(new Error("workflow unavailable"));
    expect(await enqueueExamQuestionReview("student", "attempt-1", TOKEN)).toBe(false);
    expect(attempt().reviewStatus).toBe("failed");
    expect(attempt().reviewUsed).toBe(false);
    expect(mocks.refundAiBudget).toHaveBeenCalledTimes(1);
  });

  it("records the run id when the job does start", async () => {
    expect(await enqueueExamQuestionReview("student", "attempt-1", TOKEN)).toBe(true);
    expect((attempt().review as Doc).runId).toBe("run-1");
    expect(mocks.start.mock.calls[0][1]).toEqual(["student", "attempt-1", TOKEN]);
  });
});
