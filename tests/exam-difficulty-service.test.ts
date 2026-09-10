import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Keeping a question's difficulty in step with the marks students actually got.
 *
 * Two ways it drifted. A reviewed mark moved the totals and left the tier
 * standing on the old one, so the same evidence produced a different tier
 * depending on which order two students finished in. And the statistics are
 * written after the marking transaction commits, so a request that died in
 * between left an attempt marked and uncounted with nothing to retry it.
 *
 * Both are about a shared corpus rather than one student's data, which is why
 * they are tested against a real store rather than asserted on a call.
 */
const store = new Map<string, Record<string, unknown>>();

function refFor(path: string) {
  return {
    path,
    get id() {
      return path.split("/").at(-1)!;
    },
    collection: (name: string) => collectionFor(`${path}/${name}`),
  };
}

function collectionFor(path: string) {
  return { doc: (id: string) => refFor(`${path}/${id}`) };
}

const snapshotFor = (path: string) => ({
  exists: store.has(path),
  data: () => store.get(path),
});

const db = {
  collection: (name: string) => collectionFor(name),
  runTransaction: async (work: (transaction: unknown) => Promise<unknown>) =>
    await work({
      get: async (ref: { path: string }) => snapshotFor(ref.path),
      set: (ref: { path: string }, value: Record<string, unknown>, options?: { merge?: boolean }) => {
        store.set(ref.path, options?.merge ? { ...(store.get(ref.path) ?? {}), ...value } : value);
      },
      update: (ref: { path: string }, value: Record<string, unknown>) => {
        store.set(ref.path, { ...(store.get(ref.path) ?? {}), ...value });
      },
    }),
};

vi.mock("server-only", () => ({}));
vi.mock("@/services/firebase/admin", () => ({ getAdminDb: () => db }));

const { correctExamDifficultyContribution, recordExamDifficultyContribution, recoverExamDifficultyContributions } =
  await import("@/services/practice/exam-difficulty.server");

const ATTEMPT = "users/student-1/examAttempts/attempt-1";
const STATS = "examQuestionStats/question-1_gcse";
const QUESTION = "examQuestions/question-1";

function markedAttempt(overrides: Record<string, unknown> = {}) {
  return {
    questionId: "question-1",
    attemptNumber: 1,
    status: "marked",
    startedAt: 1_000,
    submittedAt: 61_000,
    result: { attempted: true, awardedMarks: 1, maxMarks: 4 },
    ...overrides,
  };
}

describe("a reviewed mark reaching the question's difficulty", () => {
  beforeEach(() => {
    store.clear();
    store.set(QUESTION, { difficulty: "medium" });
  });

  it("recalculates the tier rather than only moving the totals", async () => {
    /*
     * Nineteen students scoring nearly everything, and this one -- reviewed
     * from 1/4 up to 4/4 -- is the attempt that takes the mean over the line.
     */
    store.set(STATS, {
      attemptCount: 20,
      scoreFractionTotal: 19 * 0.95 + 0.25,
      squaredFractionTotal: 19 * 0.95 * 0.95 + 0.0625,
      difficulty: "medium",
    });
    store.set(ATTEMPT, markedAttempt({ statsContributionFraction: 0.25, result: { attempted: true, awardedMarks: 4, maxMarks: 4 } }));

    await correctExamDifficultyContribution({
      uid: "student-1", attemptId: "attempt-1", questionId: "question-1", studyLevel: "gcse", newFraction: 1,
    });

    expect(store.get(ATTEMPT)?.statsContributionFraction).toBe(1);
    expect(store.get(STATS)?.difficulty).toBe("easy");
    expect(store.get(QUESTION)?.difficulty).toBe("easy");
    expect(store.get(QUESTION)?.difficultySource).toBe("student_data");
  });

  it("leaves the tier alone when the correction does not move it", async () => {
    store.set(STATS, {
      attemptCount: 20,
      scoreFractionTotal: 20 * 0.5,
      squaredFractionTotal: 20 * 0.25,
      difficulty: "medium",
    });
    store.set(ATTEMPT, markedAttempt({ statsContributionFraction: 0.5, result: { attempted: true, awardedMarks: 3, maxMarks: 4 } }));

    await correctExamDifficultyContribution({
      uid: "student-1", attemptId: "attempt-1", questionId: "question-1", studyLevel: "gcse", newFraction: 0.75,
    });

    expect(store.get(STATS)?.meanScoreFraction).toBeCloseTo((20 * 0.5 - 0.5 + 0.75) / 20);
    expect(store.get(QUESTION)?.difficulty).toBe("medium");
  });

  it("does nothing for an attempt that never contributed", async () => {
    store.set(STATS, { attemptCount: 3, scoreFractionTotal: 1.5, squaredFractionTotal: 0.75 });
    store.set(ATTEMPT, markedAttempt());

    await correctExamDifficultyContribution({
      uid: "student-1", attemptId: "attempt-1", questionId: "question-1", studyLevel: "gcse", newFraction: 1,
    });

    expect(store.get(STATS)?.scoreFractionTotal).toBe(1.5);
  });
});

describe("a mark that was awarded but never counted", () => {
  beforeEach(() => {
    store.clear();
    store.set(QUESTION, { difficulty: "medium" });
  });

  it("repairs a missed review delta once, even when retried with a stale snapshot", async () => {
    store.set(STATS, { attemptCount: 12, scoreFractionTotal: 6, squaredFractionTotal: 3, difficulty: "medium" });
    const stale = markedAttempt({ statsContributionFraction: 0.25,
      result: { attempted: true, awardedMarks: 3, maxMarks: 4 } });
    store.set(ATTEMPT, stale);
    const recover = () => recoverExamDifficultyContributions({ uid: "student-1", studyLevel: "gcse",
      attempts: [{ id: "attempt-1", data: stale }] });
    await recover();
    const corrected = { ...store.get(STATS) };
    expect(corrected.attemptCount).toBe(12);
    expect(corrected.scoreFractionTotal).toBe(6.5);
    expect(corrected.squaredFractionTotal).toBe(3.5);
    expect(store.get(ATTEMPT)?.statsContributionFraction).toBe(0.75);
    await recover();
    expect(store.get(STATS)).toEqual(corrected);
  });

  it("is counted when the session is next loaded", async () => {
    store.set(ATTEMPT, markedAttempt());

    const recovered = await recoverExamDifficultyContributions({
      uid: "student-1",
      studyLevel: "gcse",
      attempts: [{ id: "attempt-1", data: store.get(ATTEMPT)! }],
    });

    expect(recovered).toBe(1);
    expect(store.get(STATS)?.attemptCount).toBe(1);
    expect(store.get(ATTEMPT)?.statsContributionFraction).toBe(0.25);
  });

  /** Recording is idempotent, so a second pass must not count it twice. */
  it("is not counted twice however often the session is loaded", async () => {
    store.set(ATTEMPT, markedAttempt());
    const load = async () =>
      await recoverExamDifficultyContributions({
        uid: "student-1",
        studyLevel: "gcse",
        attempts: [{ id: "attempt-1", data: store.get(ATTEMPT)! }],
      });

    await load();
    await load();
    await load();

    expect(store.get(STATS)?.attemptCount).toBe(1);
  });

  it("leaves alone everything that is not a counted-once first attempt", async () => {
    const cases = [
      markedAttempt({ status: "marking" }),
      markedAttempt({ attemptNumber: 2 }),
      markedAttempt({ result: { attempted: false, awardedMarks: 0, maxMarks: 4 } }),
      markedAttempt({ statsContributionFraction: 0.25 }),
    ];

    const recovered = await recoverExamDifficultyContributions({
      uid: "student-1",
      studyLevel: "gcse",
      attempts: cases.map((data, index) => ({ id: `attempt-${index}`, data })),
    });

    expect(recovered).toBe(0);
    expect(store.has(STATS)).toBe(false);
  });

  /*
   * The recovery is the same call the route makes, so a first attempt counted
   * normally and one counted late must land on identical statistics.
   */
  it("counts a recovered attempt exactly as the route would have", async () => {
    store.set(ATTEMPT, markedAttempt());
    await recordExamDifficultyContribution({
      uid: "student-1", attemptId: "attempt-1", questionId: "question-1", studyLevel: "gcse",
      fraction: 0.25, durationMs: 60_000,
    });
    const direct = { ...store.get(STATS)! };

    store.delete(STATS);
    store.set(ATTEMPT, markedAttempt());
    await recoverExamDifficultyContributions({
      uid: "student-1",
      studyLevel: "gcse",
      attempts: [{ id: "attempt-1", data: store.get(ATTEMPT)! }],
    });

    expect({ ...store.get(STATS)!, updatedAt: 0 }).toEqual({ ...direct, updatedAt: 0 });
  });
});
