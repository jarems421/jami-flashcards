import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExamQuestion } from "@/lib/practice/exam-questions";

/**
 * A person reading behind the model that approved the corpus.
 *
 * The reviewer that approves official questions is a model, and a model
 * approving licensed board material is a decision somebody has to have looked
 * at. Reading every question does not scale past the first paper; the faults
 * worth catching are systematic -- a scheme paired one question out, a region
 * located on the wrong page, a tariff read off the next line -- so they show up
 * in any honest sample.
 *
 * The rules that matter are about what does *not* get served: a paper nobody
 * sampled, and a sample that failed.
 */
type Doc = Record<string, unknown>;

const store = new Map<string, Doc>();
const committed: { path: string; patch: Doc }[] = [];

function docRef(path: string) {
  return {
    path,
    async get() {
      const value = store.get(path);
      return { exists: Boolean(value), data: () => (value ? { ...value } : undefined) };
    },
    async update(patch: Doc) {
      const current = store.get(path);
      if (current) Object.assign(current, patch);
    },
  };
}

function collection(name: string) {
  let filters: [string, string, unknown][] = [];
  const chain = {
    where(field: string, op: string, value: unknown) {
      filters = [...filters, [field, op, value]];
      return chain;
    },
    limit: () => chain,
    async get() {
      const docs = [...store.entries()]
        .filter(([path]) => path.startsWith(`${name}/`))
        .filter(([, value]) => filters.every(([field, , want]) => {
          const actual = field.split(".").reduce<unknown>(
            (node, key) => (node as Doc | undefined)?.[key], value
          );
          return actual === want;
        }))
        .map(([path, value]) => ({ ref: docRef(path), id: path.split("/")[1]!, data: () => ({ ...value }) }));
      return { docs, size: docs.length };
    },
    doc: (id: string) => docRef(`${name}/${id}`),
  };
  return chain;
}

const db = {
  collection,
  batch() {
    const writes: { path: string; patch: Doc }[] = [];
    return {
      update(ref: { path: string }, patch: Doc) { writes.push({ path: ref.path, patch }); },
      async commit() {
        for (const write of writes) {
          const current = store.get(write.path);
          if (current) Object.assign(current, write.patch);
          committed.push(write);
        }
      },
    };
  },
};

vi.mock("server-only", () => ({}));
vi.mock("@/services/firebase/admin", () => ({ getAdminDb: () => db }));

const {
  recordExamPaperSpotCheck,
  revokeExamQuestionBatch,
  sampleApprovedExamQuestions,
} = await import("@/services/practice/exam-corpus-review.server");

const { isExamQuestionServable } = await import("@/lib/practice/exam-question-rights");

function seed(count: number) {
  store.clear();
  committed.length = 0;
  store.set("examPapers/paper-1", { id: "paper-1", status: "published" });
  for (let index = 0; index < count; index += 1) {
    store.set(`examQuestions/q${index}`, {
      id: `q${index}`,
      paperId: "paper-1",
      label: `Question ${index + 1}`,
      prompt: "Solve for x.",
      marks: 3,
      difficulty: "medium",
      status: "published",
      origin: "official_past_paper",
      review: { status: "approved", by: "ai", notes: [] },
      provenance: { board: "aqa", specificationId: "8300" },
    });
  }
}

beforeEach(() => {
  seed(20);
});

describe("drawing a sample", () => {
  it("returns the requested number and the population it came from", async () => {
    const sample = await sampleApprovedExamQuestions({ paperId: "paper-1", size: 5 });
    expect(sample.questions).toHaveLength(5);
    expect(sample.population).toBe(20);
  });

  it("never draws more than the paper has", async () => {
    seed(3);
    const sample = await sampleApprovedExamQuestions({ paperId: "paper-1", size: 10 });
    expect(sample.questions).toHaveLength(3);
  });

  /*
   * Random rather than the first N. Extraction faults cluster: the early
   * questions of a paper are the ones whose regions are easiest to locate, so
   * a sample taken from the top is a sample of the cases most likely to be
   * right. Checked over repeated draws rather than by assertion on one.
   */
  it("does not simply return the first questions every time", async () => {
    const firsts = new Set<string>();
    for (let run = 0; run < 25; run += 1) {
      const sample = await sampleApprovedExamQuestions({ paperId: "paper-1", size: 3 });
      firsts.add(sample.questions[0]!.id);
    }
    expect(firsts.size).toBeGreaterThan(1);
  });

  /** The scheme travels with it: pairing is most of what is being judged. */
  it("carries the mark scheme a reviewer needs to judge the pairing", async () => {
    const sample = await sampleApprovedExamQuestions({ paperId: "paper-1", size: 1 });
    expect(sample.questions[0]).toHaveProperty("markScheme");
  });
});

describe("recording what the sample found", () => {
  it("stamps the paper's questions so they can be served", async () => {
    const result = await recordExamPaperSpotCheck({
      paperId: "paper-1", reviewerUid: "owner", size: 5, rejected: 0,
    });
    expect(result.passed).toBe(true);
    expect(result.stamped).toBe(20);
    expect(typeof store.get("examQuestions/q0")!.paperSpotCheckedAt).toBe("number");
    expect((store.get("examPapers/paper-1")!.spotCheck as Doc).population).toBe(20);
  });

  /*
   * A sample that threw back everything it drew is not a pass. The paper is
   * recorded as looked at and nothing is stamped, so it stays unservable until
   * somebody looks again at whatever is left.
   */
  it("stamps nothing when the sample rejected everything it drew", async () => {
    const result = await recordExamPaperSpotCheck({
      paperId: "paper-1", reviewerUid: "owner", size: 4, rejected: 4,
    });
    expect(result.passed).toBe(false);
    expect(result.stamped).toBe(0);
    expect(store.get("examQuestions/q0")!.paperSpotCheckedAt).toBeUndefined();
    // Recorded all the same: "nobody looked" and "it failed" are different.
    expect(store.get("examPapers/paper-1")!.spotCheck).toBeDefined();
  });

  it("refuses a paper that does not exist", async () => {
    await expect(
      recordExamPaperSpotCheck({ paperId: "ghost", reviewerUid: "owner", size: 5, rejected: 0 })
    ).rejects.toThrow("paper_not_found");
  });

  /* The gate this all exists for, end to end. */
  it("is what stands between an approved question and a student", async () => {
    const question = () => ({
      ...store.get("examQuestions/q0"),
      rights: { key: "aqa-2026", version: 1, verified: true, storageAllowed: true, studentDisplayAllowed: true, aiInferenceAllowed: true, revoked: false },
    }) as unknown as ExamQuestion;
    process.env.EXAM_QUESTION_AQA_ENABLED = "true";
    expect(isExamQuestionServable(question())).toBe(false);
    await recordExamPaperSpotCheck({ paperId: "paper-1", reviewerUid: "owner", size: 5, rejected: 0 });
    expect(isExamQuestionServable(question())).toBe(true);
    delete process.env.EXAM_QUESTION_AQA_ENABLED;
  });
});

describe("withdrawing what the sample rejected", () => {
  /*
   * Pulled as a class. A spot-check that finds a fault has almost never found
   * one fault, and the useful response is withdrawing the batch rather than
   * hunting the rest one at a time.
   */
  it("withdraws every named question and records who and why", async () => {
    const result = await revokeExamQuestionBatch({
      questionIds: ["q0", "q1"], reviewerUid: "owner", reason: "Scheme paired one question out.",
    });
    expect(result.withdrawn).toBe(2);
    expect(store.get("examQuestions/q0")!.status).toBe("withdrawn");
    const review = store.get("examQuestions/q1")!.review as Doc;
    expect(review.by).toBe("human");
    expect(review.status).toBe("rejected");
    expect(review.notes).toEqual(["Scheme paired one question out."]);
  });

  /*
   * Withdrawn, not returned to the queue. The reviewer already approved these,
   * so sending them back would hand them to the thing that missed it.
   */
  it("does not send them back to the reviewer that approved them", async () => {
    await revokeExamQuestionBatch({ questionIds: ["q0"], reviewerUid: "owner", reason: "Wrong page." });
    expect(store.get("examQuestions/q0")!.status).not.toBe("needs_review");
  });

  it("refuses a revocation with nothing named or no reason given", async () => {
    await expect(
      revokeExamQuestionBatch({ questionIds: [], reviewerUid: "owner", reason: "Wrong page." })
    ).rejects.toThrow("invalid_revocation");
    await expect(
      revokeExamQuestionBatch({ questionIds: ["q0"], reviewerUid: "owner", reason: "x" })
    ).rejects.toThrow("invalid_revocation");
  });
});
