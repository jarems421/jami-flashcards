import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What a marking job may and may not write.
 *
 * Marking one question moved off the request that submits it, which buys the
 * marker the time its own measurements say it needs and costs the guarantee
 * that came free with a synchronous route: that only one marking of an attempt
 * could ever be in flight. A student whose mark fails can resubmit, and the
 * attempt is back at `marking` seconds later -- a second job, over different
 * evidence, writing to the same document. Every test here is about the first
 * job not being allowed to speak for the second.
 */
type Doc = Record<string, unknown>;

const DELETE = Symbol("delete");

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
    else node[last] = value;
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
    async set(value: Doc) {
      store.set(path, { ...value });
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
      set: (ref: { path: string }, value: Doc) => store.set(ref.path, { ...value }),
    };
    return body(transaction);
  },
};

const mocks = vi.hoisted(() => ({
  markSingleQuestionAdaptively: vi.fn(),
  refundAiBudget: vi.fn(async () => undefined),
  recordExamDifficultyContribution: vi.fn(async () => undefined),
  start: vi.fn<(...args: unknown[]) => Promise<{ runId: string }>>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("firebase-admin/firestore", () => ({ FieldValue: { delete: () => DELETE } }));
vi.mock("workflow/api", () => ({ start: mocks.start }));
vi.mock("@/workflows/exam-question-marking", () => ({ markExamQuestionWorkflow: () => undefined }));
vi.mock("@/services/firebase/admin", () => ({
  getAdminDb: () => db,
  getAdminStorageBucket: () => ({
    file: () => ({ download: async () => [Buffer.from("png")] }),
  }),
}));
vi.mock("@/lib/app/feature-flags", () => ({ featureFlags: { enablePastPaperPractice: true } }));
vi.mock("@/lib/ai/spend-context", () => ({ enterAiSpendContext: () => undefined }));
vi.mock("@/services/ai/spend.server", () => ({ aiSpendContextFor: () => ({}) }));
vi.mock("@/services/ai/budgets", () => ({
  getAiTokenCap: () => 2_000,
  refundAiBudget: mocks.refundAiBudget,
}));
vi.mock("@/services/ai/practice-paper-marking.server", () => ({
  markSingleQuestionAdaptively: mocks.markSingleQuestionAdaptively,
}));
vi.mock("@/services/practice/exam-difficulty.server", () => ({
  recordExamDifficultyContribution: mocks.recordExamDifficultyContribution,
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
  enqueueExamQuestionMarking,
  examMarkingIsCancelled,
  failExamQuestionMarking,
  runExamQuestionMarking,
} = await import("@/services/practice/exam-marking.server");

const TOKEN = "job-1";
const LATER = "job-2";

function seed(overrides: { attempt?: Doc; session?: Doc } = {}) {
  store.clear();
  store.set("users/student/examSessions/session-1", {
    id: "session-1", userId: "student", folderId: "folder-1", subject: "Maths",
    studyLevel: "gcse-equivalent", status: "active", answeredCount: 0,
    awardedTotal: 0, assessedTotal: 0, maxTotal: 3,
    course: { qualification: "gcse" },
    questions: [{
      id: "q1", attemptId: "attempt-1", label: "Question 1", prompt: "Solve for x.",
      marks: 3, assets: [], contentVersion: "v1",
      provenance: { boardLabel: "AQA", specificationTitle: "Spec", componentTitle: "Paper 1" },
      origin: "official_past_paper",
    }],
    ...overrides.session,
  });
  store.set("users/student/examAttempts/attempt-1", {
    id: "attempt-1", userId: "student", sessionId: "session-1", questionId: "q1",
    attemptNumber: 1, answerText: "x = 4", status: "marking", workingIncluded: false,
    reviewUsed: false, startedAt: 1, submittedAt: 2, updatedAt: 2,
    marking: { token: TOKEN, startedAt: 2, deadlineAt: 2 + 600_000, attempts: 1, budgetGrant: { uid: "student", action: "examQuestionMarking", dayKey: "d", burstWindowStartedAt: 0 } },
    ...overrides.attempt,
  });
}

function attempt() {
  return store.get("users/student/examAttempts/attempt-1")!;
}

function markingResult(awardedMarks: number) {
  return {
    result: {
      questionResults: [{
        questionId: "q1", label: "Question 1", awardedMarks, maxMarks: 3,
        feedback: "ok", criterionResults: [], evidence: ["seen"], strengths: [],
        improvements: [], confidence: "high", attempted: true, counted: true,
      }],
    },
    audit: { primaryScore: awardedMarks, adaptivelyVerified: false, adjudicated: false },
    estimatedCostUsd: 0.01,
    costAccounting: { usd: 0.01, unreportedCalls: 0 },
  };
}

beforeEach(() => {
  mocks.markSingleQuestionAdaptively.mockReset();
  mocks.markSingleQuestionAdaptively.mockResolvedValue(markingResult(3));
  mocks.refundAiBudget.mockClear();
  mocks.recordExamDifficultyContribution.mockClear();
  mocks.start.mockReset();
  mocks.start.mockResolvedValue({ runId: "run-1" });
  seed();
});

describe("a marking that is still the current one", () => {
  it("writes the mark and clears its own job", async () => {
    expect(await runExamQuestionMarking("student", "attempt-1", TOKEN)).toBe("marked");
    expect(attempt().status).toBe("marked");
    expect(attempt().marking).toBeUndefined();
    const session = store.get("users/student/examSessions/session-1")!;
    expect(session.answeredCount).toBe(1);
    expect(session.awardedTotal).toBe(3);
  });

  it("marks against the deadline the job was given, not the request's", async () => {
    await runExamQuestionMarking("student", "attempt-1", TOKEN);
    const [call] = mocks.markSingleQuestionAdaptively.mock.calls[0];
    expect(call.deadlineAt).toBe(2 + 600_000);
  });

  it("hands the marker the reports a previous run already paid for", async () => {
    const stages = { primary: { result: { questionResults: [] }, diagnostics: [] } };
    seed({ attempt: { marking: { token: TOKEN, startedAt: 2, deadlineAt: 600_002, attempts: 2, stages } } });
    await runExamQuestionMarking("student", "attempt-1", TOKEN);
    expect(mocks.markSingleQuestionAdaptively.mock.calls[0][0].cachedStageResults).toEqual(stages);
  });

  /*
   * Written when the report arrives, not when the marking finishes. A marking
   * that dies between the second marker and the adjudicator is exactly the one
   * whose reports are worth keeping, and it never reaches an end to save them
   * at.
   */
  it("saves each report as it arrives, before the marking has finished", async () => {
    let checkpointDuringMarking: unknown;
    mocks.markSingleQuestionAdaptively.mockImplementation(async (input: {
      onStageResult: (stage: string, value: unknown) => Promise<void>;
    }) => {
      await input.onStageResult("primary", {
        result: { questionResults: [{ questionId: "q1", awardedMarks: 2 }] },
        diagnostics: [],
      });
      checkpointDuringMarking = (attempt().marking as Doc).stages;
      return markingResult(3);
    });
    await runExamQuestionMarking("student", "attempt-1", TOKEN);
    expect(checkpointDuringMarking).toMatchObject({
      primary: { result: { questionResults: [{ awardedMarks: 2 }] } },
    });
  });
});

describe("a marking the student has moved past", () => {
  /*
   * The resubmission race. The first job is mid-call when the student gives up
   * and submits again; the second job replaces the token. Whatever the first
   * one comes back with is a mark of evidence that is no longer the answer.
   */
  it("does not write a mark once a newer submission has taken over", async () => {
    mocks.markSingleQuestionAdaptively.mockImplementation(async () => {
      applyUpdate(attempt(), { "marking.token": LATER });
      return markingResult(1);
    });
    expect(await runExamQuestionMarking("student", "attempt-1", TOKEN)).toBe("cancelled");
    expect(attempt().status).toBe("marking");
    expect(attempt().result).toBeUndefined();
    expect(mocks.recordExamDifficultyContribution).not.toHaveBeenCalled();
  });

  /*
   * A checkpoint is evidence-specific. Leaving the old job's report where the
   * new one reads it would mark the new answer with a report of the old one --
   * cheaper than remarking, and wrong in a way nothing downstream could see.
   */
  it("does not leave its checkpoints for the marking that replaced it", async () => {
    mocks.markSingleQuestionAdaptively.mockImplementation(async (input: {
      onStageResult: (stage: string, value: unknown) => Promise<void>;
    }) => {
      applyUpdate(attempt(), { "marking.token": LATER });
      await input.onStageResult("primary", { result: { questionResults: [] }, diagnostics: [] });
      return markingResult(1);
    });
    await runExamQuestionMarking("student", "attempt-1", TOKEN);
    expect((attempt().marking as Doc).stages).toBeUndefined();
  });

  it("does not fail a marking it no longer owns", async () => {
    applyUpdate(attempt(), { "marking.token": LATER });
    await failExamQuestionMarking("student", "attempt-1", "marking_failed", TOKEN);
    expect(attempt().status).toBe("marking");
    expect(mocks.refundAiBudget).not.toHaveBeenCalled();
  });

  it("reports itself cancelled rather than marking a deleted answer", async () => {
    applyUpdate(attempt(), { answerDeletedAt: 5 });
    expect(await examMarkingIsCancelled("student", "attempt-1", TOKEN)).toBe(true);
    expect(await runExamQuestionMarking("student", "attempt-1", TOKEN)).toBe("cancelled");
    expect(mocks.markSingleQuestionAdaptively).not.toHaveBeenCalled();
  });

  it("stops for a session the student has already finished", async () => {
    const session = store.get("users/student/examSessions/session-1")!;
    session.status = "completed";
    expect(await examMarkingIsCancelled("student", "attempt-1", TOKEN)).toBe(true);
  });
});

describe("a marking that produces nothing", () => {
  it("settles the attempt and hands back the day's allowance", async () => {
    mocks.markSingleQuestionAdaptively.mockRejectedValue(new Error("provider gone"));
    expect(await runExamQuestionMarking("student", "attempt-1", TOKEN)).toBe("failed");
    expect(attempt().status).toBe("marking_failed");
    expect((attempt().markingFailure as Doc).code).toBe("marking_failed");
    expect(mocks.refundAiBudget).toHaveBeenCalledTimes(1);
  });

  /*
   * An oversized request never reached a provider and never will while it is
   * that size, so the answer is handed back for editing rather than left
   * frozen with a retry button that cannot work.
   */
  it("reopens an answer that was refused for being too long", async () => {
    mocks.markSingleQuestionAdaptively.mockRejectedValue(new Error("input_too_large"));
    await runExamQuestionMarking("student", "attempt-1", TOKEN);
    expect(attempt().status).toBe("draft");
    expect((attempt().markingFailure as Doc).code).toBe("input_too_large");
  });

  it("says so when the question changed under a live session", async () => {
    mocks.markSingleQuestionAdaptively.mockRejectedValue(new Error("question_changed"));
    await runExamQuestionMarking("student", "attempt-1", TOKEN);
    expect(attempt().status).toBe("marking_failed");
    expect((attempt().markingFailure as Doc).code).toBe("question_changed");
  });

  /*
   * A job that never started will never write its own failure, so an attempt
   * queued into nothing would sit at `marking` until its lease ran out --
   * telling the student to keep waiting for something that does not exist.
   */
  it("settles an attempt whose job could not be queued at all", async () => {
    mocks.start.mockRejectedValue(new Error("workflow unavailable"));
    expect(await enqueueExamQuestionMarking("student", "attempt-1", TOKEN)).toBe(false);
    expect(attempt().status).toBe("marking_failed");
    expect(mocks.refundAiBudget).toHaveBeenCalledTimes(1);
  });

  it("records the run id when the job does start", async () => {
    expect(await enqueueExamQuestionMarking("student", "attempt-1", TOKEN)).toBe(true);
    expect((attempt().marking as Doc).runId).toBe("run-1");
    expect(mocks.start.mock.calls[0][1]).toEqual(["student", "attempt-1", TOKEN]);
  });
});
