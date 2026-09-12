import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Filling in topics the extractor was never able to supply.
 *
 * Extraction asked the model for `topicIds` and never told it what the ids
 * were, so it returned invented strings, the canonical filter dropped every one
 * of them, and the whole corpus is stored with empty lists. Verifying a
 * catalogue on its own would hand a student a topic picker where every choice
 * returns nothing.
 *
 * This backfill costs a provider call per question, so most of what follows is
 * about the calls it must *not* make and the writes it must not perform.
 */
type Doc = Record<string, unknown>;

const store = new Map<string, Doc>();

const mocks = vi.hoisted(() => ({
  generateAiText: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai/provider-router", () => ({ generateAiText: mocks.generateAiText }));
vi.mock("@/services/ai/practice-paper-generation.server", () => ({
  parseJsonObject: (value: string) => JSON.parse(value) as Record<string, unknown>,
}));

function docRef(path: string) {
  return {
    path,
    async get() {
      const value = store.get(path);
      return { exists: Boolean(value), data: () => (value ? { ...value } : undefined) };
    },
  };
}

/** Only the query shape this service actually builds. */
function collection() {
  const chain = {
    where: () => chain,
    limit: () => chain,
    async get() {
      const docs = [...store.entries()]
        .filter(([, value]) => (value.topicIds as unknown[]).length === 0)
        .map(([path, value]) => ({ ref: docRef(path), data: () => ({ ...value }) }));
      return { docs };
    },
    count: () => ({
      async get() {
        const remaining = [...store.values()].filter((v) => (v.topicIds as unknown[]).length === 0).length;
        return { data: () => ({ count: remaining }) };
      },
    }),
    doc: (id: string) => docRef(`examQuestions/${id}`),
  };
  return chain;
}

const db = {
  collection,
  async runTransaction<T>(body: (transaction: unknown) => Promise<T>) {
    return body({
      get: (ref: { path: string }) => docRef(ref.path).get(),
      update: (ref: { path: string }, patch: Doc) => {
        const current = store.get(ref.path);
        if (current) Object.assign(current, patch);
      },
    });
  },
};

vi.mock("@/services/firebase/admin", () => ({ getAdminDb: () => db }));

const { ExamTopicTaggingError, tagExamQuestionTopics } = await import(
  "@/services/practice/exam-topic-tagging.server"
);

function seed(questions: { id: string; topicIds?: string[] }[]) {
  store.clear();
  for (const item of questions) {
    store.set(`examQuestions/${item.id}`, {
      id: item.id,
      label: "Question 1",
      prompt: "Solve 3x + 4 = 19",
      marks: 2,
      origin: "official_past_paper",
      provenance: { specificationId: "8300" },
      topicIds: item.topicIds ?? [],
    });
  }
}

function answers(...values: string[][]) {
  for (const topicIds of values) {
    mocks.generateAiText.mockResolvedValueOnce(JSON.stringify({ topicIds }));
  }
}

beforeEach(() => {
  mocks.generateAiText.mockReset();
  seed([{ id: "q1" }]);
});

describe("tagging a specification that has a checked catalogue", () => {
  it("writes the ids the specification names", async () => {
    answers(["aqa-8300-algebra-solving-equations-and-inequalities"]);
    const result = await tagExamQuestionTopics({ specificationId: "8300", limit: 5 });
    expect(result.tagged).toBe(1);
    expect(store.get("examQuestions/q1")!.topicIds).toEqual([
      "aqa-8300-algebra-solving-equations-and-inequalities",
    ]);
  });

  /*
   * The failure the whole catalogue exists to prevent. An invented id is not a
   * near miss to be corrected -- it is a topic that does not exist on this
   * course -- so it is dropped and reported rather than stored.
   */
  it("drops an invented id and reports it rather than storing it", async () => {
    answers(["quadratics-and-vibes"]);
    const result = await tagExamQuestionTopics({ specificationId: "8300", limit: 5 });
    expect(result.tagged).toBe(0);
    expect(result.rejected).toEqual(["quadratics-and-vibes"]);
    expect(store.get("examQuestions/q1")!.topicIds).toEqual([]);
  });

  /*
   * Only ever fills a gap. A question tagged by a later extraction, or
   * corrected by a person while the batch was running, is already better than
   * anything this can produce.
   */
  it("never overwrites topics a question already has", async () => {
    seed([{ id: "q1", topicIds: [] }]);
    mocks.generateAiText.mockImplementation(async () => {
      // A person tags it while the provider is still thinking.
      (store.get("examQuestions/q1")!.topicIds as string[]).push("aqa-8300-probability");
      return JSON.stringify({ topicIds: ["aqa-8300-statistics"] });
    });
    await tagExamQuestionTopics({ specificationId: "8300", limit: 5 });
    expect(store.get("examQuestions/q1")!.topicIds).toEqual(["aqa-8300-probability"]);
  });

  /** A question the tagger could not reach keeps its gap and stays in the queue. */
  it("leaves a question alone when the provider fails", async () => {
    mocks.generateAiText.mockRejectedValue(new Error("provider gone"));
    const result = await tagExamQuestionTopics({ specificationId: "8300", limit: 5 });
    expect(result.considered).toBe(0);
    expect(result.remaining).toBe(1);
    expect(store.get("examQuestions/q1")!.topicIds).toEqual([]);
  });
});

describe("tagging a specification that has no checked catalogue", () => {
  /*
   * Refused before any call. Every suggestion would be dropped by the canonical
   * filter, so a run here would spend real money writing empty arrays over
   * empty arrays -- and would report success while changing nothing.
   */
  it("refuses without spending anything", async () => {
    await expect(
      tagExamQuestionTopics({ specificationId: "8461", limit: 5 })
    ).rejects.toBeInstanceOf(ExamTopicTaggingError);
    expect(mocks.generateAiText).not.toHaveBeenCalled();
  });

  it("says which, so a caller does not retry it forever", async () => {
    await expect(
      tagExamQuestionTopics({ specificationId: "not-a-spec", limit: 5 })
    ).rejects.toMatchObject({ code: "no_catalogue" });
  });
});
