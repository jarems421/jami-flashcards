import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Filling in concepts and command words on questions ingested before either
 * was read.
 *
 * Each question costs a provider call, so most of what follows is about the
 * calls it must not make and the writes it must not perform: nothing already
 * read is asked about again, nothing already tagged is overwritten, and an
 * answer that does not address a field never records "none found" for it.
 */
type Doc = Record<string, unknown>;

const store = new Map<string, Doc>();

const mocks = vi.hoisted(() => ({ generateAiText: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("firebase-admin/firestore", () => ({ FieldPath: { documentId: () => "__name__" } }));
vi.mock("@/lib/ai/provider-router", () => ({ generateAiText: mocks.generateAiText }));
vi.mock("@/services/ai/practice-paper-generation.server", () => ({
  parseJsonObject: (value: string) => JSON.parse(value) as Record<string, unknown>,
}));

function docRef(id: string) {
  return {
    id,
    async get() {
      const value = store.get(id);
      return { exists: Boolean(value), data: () => (value ? structuredClone(value) : undefined) };
    },
  };
}

/** Only the query shape the service builds: equality filters, ordered by id, paged by cursor. */
function query(state: { cursor?: string; limit?: number; paperId?: string }): Record<string, unknown> {
  return {
    where: (field: string, operator: string, value: unknown) =>
      query(field === "paperId" && operator === "==" ? { ...state, paperId: String(value) } : state),
    orderBy: () => query(state),
    startAfter: (cursor: string) => query({ ...state, cursor }),
    limit: (limit: number) => query({ ...state, limit }),
    async get() {
      const ids = [...store.keys()]
        .sort()
        .filter((id) => (!state.cursor || id > state.cursor) && (!state.paperId || store.get(id)!.paperId === state.paperId));
      const docs = ids
        .slice(0, state.limit ?? ids.length)
        .map((id) => ({ id, ref: docRef(id), data: () => structuredClone(store.get(id)!) }));
      return { docs, size: docs.length };
    },
  };
}

const db = {
  collection: () => query({}),
  async runTransaction<T>(body: (transaction: unknown) => Promise<T>) {
    return body({
      get: (ref: { id: string }) => docRef(ref.id).get(),
      update: (ref: { id: string }, patch: Doc) => {
        const current = store.get(ref.id);
        if (current) Object.assign(current, patch);
      },
    });
  },
};

vi.mock("@/services/firebase/admin", () => ({ getAdminDb: () => db }));

const { ExamQuestionDetailsTaggingError, tagExamQuestionDetails } = await import(
  "@/services/practice/exam-question-details-tagging.server"
);

const QUADRATICS = "aqa-8300-algebra-quadratic-equations";
const SOLVING = "aqa-8300-algebra-solving-equations-and-inequalities";

function seed(questions: Array<{ id: string } & Doc>) {
  store.clear();
  for (const { id, ...fields } of questions) {
    store.set(id, {
      id,
      label: "Question 4",
      prompt: "Solve x^2 - 5x + 6 = 0. Show that one solution is x = 2.",
      marks: 3,
      origin: "official_past_paper",
      provenance: { specificationId: "8300" },
      paperId: "paper-1",
      topicIds: [],
      ...fields,
    });
  }
}

function reply(value: Doc) {
  mocks.generateAiText.mockResolvedValueOnce(JSON.stringify(value));
}

beforeEach(() => {
  mocks.generateAiText.mockReset();
  seed([{ id: "q1" }]);
});

describe("tagging questions with concepts and command words", () => {
  it("writes the concepts, their topics and the command word the question prints", async () => {
    reply({ topicIds: [], conceptIds: [QUADRATICS], commandWord: "Show that" });
    const result = await tagExamQuestionDetails({ specificationId: "8300", limit: 5 });
    expect(result).toMatchObject({ considered: 1, updated: 1, failed: 0, nextCursor: null });
    expect(store.get("q1")).toMatchObject({ topicIds: [SOLVING], conceptIds: [QUADRATICS], commandWord: "Show that" });
  });

  it("drops invented ids and an unprinted command word, recording that the question was read", async () => {
    seed([{ id: "q1", topicIds: ["aqa-8300-probability"] }]);
    reply({ topicIds: ["aqa-8300-probability"], conceptIds: ["aqa-8300-vibes"], commandWord: "Evaluate" });
    const result = await tagExamQuestionDetails({ specificationId: "8300", limit: 5 });
    expect(result.rejected).toEqual(["aqa-8300-vibes"]);
    expect(store.get("q1")).toMatchObject({ topicIds: ["aqa-8300-probability"], conceptIds: [], commandWord: "" });
  });

  it("asks nothing about a question already read for both", async () => {
    seed([{ id: "q1", topicIds: ["aqa-8300-probability"], conceptIds: [], commandWord: "" }]);
    const result = await tagExamQuestionDetails({ specificationId: "8300", limit: 5 });
    expect(result.considered).toBe(0);
    expect(mocks.generateAiText).not.toHaveBeenCalled();
  });

  it("does not ask again about a question that was read and has no topics", async () => {
    seed([{ id: "q1", topicIds: [], conceptIds: [], commandWord: "" }]);
    const result = await tagExamQuestionDetails({ specificationId: "8300", limit: 5 });
    expect(result.considered).toBe(0);
    expect(mocks.generateAiText).not.toHaveBeenCalled();
  });

  it("adds a concept's topic beside the topics a question has, never replacing them", async () => {
    seed([{ id: "q1", topicIds: ["aqa-8300-probability"] }]);
    reply({ topicIds: ["aqa-8300-statistics"], conceptIds: [QUADRATICS], commandWord: "" });
    await tagExamQuestionDetails({ specificationId: "8300", limit: 5 });
    expect(store.get("q1")!.topicIds).toEqual(["aqa-8300-probability", SOLVING]);
  });

  it("leaves a field unwritten when the answer never addresses it", async () => {
    reply({});
    const result = await tagExamQuestionDetails({ specificationId: "8300", limit: 5 });
    expect(result.updated).toBe(0);
    expect(store.get("q1")).not.toHaveProperty("conceptIds");
    expect(store.get("q1")).not.toHaveProperty("commandWord");
  });

  it("stops at its limit and says where the next call continues", async () => {
    seed([{ id: "q1" }, { id: "q2" }, { id: "q3" }]);
    reply({ topicIds: [], conceptIds: [QUADRATICS], commandWord: "" });
    reply({ topicIds: [], conceptIds: [QUADRATICS], commandWord: "" });
    const first = await tagExamQuestionDetails({ specificationId: "8300", limit: 2 });
    expect(first).toMatchObject({ considered: 2, nextCursor: "q2" });
    expect(store.get("q3")).not.toHaveProperty("conceptIds");

    reply({ topicIds: [], conceptIds: [QUADRATICS], commandWord: "" });
    const second = await tagExamQuestionDetails({ specificationId: "8300", limit: 2, cursor: first.nextCursor! });
    expect(second).toMatchObject({ considered: 1, nextCursor: null });
    expect(store.get("q3")!.conceptIds).toEqual([QUADRATICS]);
  });

  it("counts a provider failure and writes nothing", async () => {
    mocks.generateAiText.mockRejectedValueOnce(new Error("provider gone"));
    const result = await tagExamQuestionDetails({ specificationId: "8300", limit: 5 });
    expect(result).toMatchObject({ considered: 1, failed: 1, updated: 0 });
    expect(store.get("q1")).not.toHaveProperty("conceptIds");
  });

  it("refuses a specification without a checked topic list, spending nothing", async () => {
    await expect(tagExamQuestionDetails({ specificationId: "7402", limit: 5 })).rejects.toBeInstanceOf(
      ExamQuestionDetailsTaggingError
    );
    expect(mocks.generateAiText).not.toHaveBeenCalled();
  });
});
