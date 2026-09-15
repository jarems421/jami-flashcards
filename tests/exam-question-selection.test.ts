import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Finding the questions a session is built from.
 *
 * Tier, component and licence eligibility cannot be Firestore filters -- a
 * question with no tier suits every tier, and a course can name more components
 * than an `in` query accepts -- so they are applied after the read. That made
 * the read's window the real limit: the search took the first two hundred
 * published questions of a difficulty and filtered them, so a student whose
 * eligible questions sat past that point was told there were none, while the
 * questions to fill the session sat unread in the same collection.
 */
type Doc = { id: string; data: Record<string, unknown> };

const collections = new Map<string, Doc[]>();
const reads: { path: string; size: number }[] = [];

function matches(doc: Doc, filters: [string, string, unknown][]) {
  return filters.every(([field, , value]) => {
    const actual = field.split(".").reduce<unknown>(
      (current, key) => (current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined),
      doc.data
    );
    return actual === value;
  });
}

function queryFor(path: string, state: {
  filters: [string, string, unknown][];
  order?: string;
  cursor?: Doc;
  limit?: number;
  /** A field-only read, such as the papers' calculator rules, rather than a page of questions. */
  projection?: boolean;
}): Record<string, unknown> {
  const next = (changes: Partial<typeof state>) => queryFor(path, { ...state, ...changes });
  return {
    where: (field: string, operator: string, value: unknown) =>
      next({ filters: [...state.filters, [field, operator, value]] }),
    orderBy: (field: string) => next({ order: field }),
    startAfter: (cursor: Doc) => next({ cursor }),
    limit: (count: number) => next({ limit: count }),
    select: () => next({ projection: true }),
    get: async () => {
      let docs = (collections.get(path) ?? []).filter((doc) => matches(doc, state.filters));
      if (state.order) {
        docs = [...docs].sort(
          (left, right) => Number(left.data[state.order!] ?? 0) - Number(right.data[state.order!] ?? 0)
        );
      }
      if (state.cursor) {
        docs = docs.slice(docs.findIndex((doc) => doc.id === state.cursor!.id) + 1);
      }
      if (state.limit !== undefined) docs = docs.slice(0, state.limit);
      // The read budget is about pages of questions searched; a field-only read
      // describing the papers is not one of them.
      if (!state.projection) reads.push({ path, size: docs.length });
      return {
        empty: docs.length === 0,
        size: docs.length,
        docs: docs.map((doc) => ({ id: doc.id, data: () => doc.data })),
      };
    },
  };
}

function docFor(path: string): Record<string, unknown> {
  return {
    id: path.split("/").at(-1),
    collection: (name: string) => ({
      ...queryFor(`${path}/${name}`, { filters: [] }),
      doc: (id: string) => docFor(`${path}/${name}/${id}`),
    }),
    get: async () => {
      const parent = path.split("/").slice(0, -1).join("/");
      const id = path.split("/").at(-1);
      const found = (collections.get(parent) ?? []).find((doc) => doc.id === id);
      return { exists: Boolean(found), id, data: () => found?.data };
    },
  };
}

const writes: { path: string; data: Record<string, unknown> }[] = [];

const db = {
  collection: (name: string) => ({ ...queryFor(name, { filters: [] }), doc: (id: string) => docFor(`${name}/${id}`) }),
  batch: () => ({
    set: (ref: { id?: string }, data: Record<string, unknown>) => writes.push({ path: String(ref.id), data }),
    commit: async () => undefined,
  }),
};

vi.mock("server-only", () => ({}));
vi.mock("@/services/firebase/admin", () => ({ getAdminDb: () => db }));
vi.mock("@/services/practice/exam-gap-generation.server", () => ({ generateExamGapQuestions: vi.fn(async () => []) }));
vi.mock("@/services/practice/exam-difficulty.server", () => ({ recoverExamDifficultyContributions: vi.fn(async () => 0) }));

const { createExamSession, getExamQuestionAvailability } = await import("@/services/practice/exam-question-bank.server");

const COURSE = {
  board: "aqa",
  qualification: "gcse",
  specificationId: "8461",
  specificationTitle: "GCSE Biology (8461)",
  tier: "foundation",
  componentIds: [],
};

function question(index: number, overrides: Record<string, unknown> = {}): Doc {
  return {
    id: `question-${index}`,
    data: {
      prompt: `Question ${index}`,
      marks: 3,
      label: `Question ${index}`,
      subjectKey: "biology",
      studyLevel: "gcse-equivalent",
      difficulty: "medium",
      status: "published",
      selectionKey: index,
      origin: "official_past_paper",
      topicIds: [],
      humanChecked: true,
      review: { status: "approved", reviewedBy: "owner", reviewedAt: 1_700_000_000_000 },
      // Official material also waits on a person sampling its paper.
      paperSpotCheckedAt: 1_700_000_000_000,
      rights: {
        key: "aqa-2026", version: 1, verified: true, storageAllowed: true,
        studentDisplayAllowed: true, aiInferenceAllowed: true, revoked: false,
      },
      provenance: {
        board: "aqa", qualification: "gcse", specificationId: "8461",
        componentCode: "8461/1F", boardLabel: "AQA", specificationTitle: "GCSE Biology (8461)",
        componentTitle: "Paper 1 Foundation",
      },
      ...overrides,
    },
  };
}

beforeEach(() => {
  // Boards are opt-in now, so a fixture corpus needs its board switched on.
  process.env.EXAM_QUESTION_AQA_ENABLED = "true";
  collections.clear();
  reads.length = 0;
  collections.set("users/student-1/studyFolders", [
    { id: "folder-1", data: { name: "Biology", subject: "Biology", studyLevel: "gcse-equivalent", examCourse: COURSE } },
  ]);
  collections.set("examFormatCatalogue", [
    { id: "aqa-8461", data: { board: "aqa", status: "current", qualification: "gcse", specificationCode: "8461", tier: "foundation" } },
  ]);
  collections.set("examSpecificationTopics", []);
});

describe("counting the questions a folder can draw on", () => {
  it("finds the eligible questions sitting past the first page", async () => {
    /*
     * Two hundred questions for the higher tier, then the foundation ones this
     * student can actually be asked. Every one of them used to be invisible.
     */
    collections.set("examQuestions", [
      ...Array.from({ length: 200 }, (_unused, index) => question(index, { tier: "higher" })),
      ...Array.from({ length: 3 }, (_unused, index) => question(200 + index, { tier: "foundation" })),
    ]);

    const availability = await getExamQuestionAvailability({ uid: "student-1", folderId: "folder-1" });

    expect(availability.counts.medium).toBe(3);
    expect(availability.hasMore.medium).toBe(false);
  });

  it("counts every eligible question rather than stopping at a session's worth", async () => {
    /*
     * This used to stop at twenty, so a well-stocked course read "20 ready" on
     * every difficulty -- which looked like a count and was only where the
     * search gave up.
     */
    collections.set(
      "examQuestions",
      Array.from({ length: 900 }, (_unused, index) => question(index))
    );

    const availability = await getExamQuestionAvailability({ uid: "student-1", folderId: "folder-1" });

    expect(availability.counts.medium).toBe(900);
    expect(availability.hasMore.medium).toBe(false);
    expect(reads.filter((read) => read.path === "examQuestions" && read.size > 0)).toHaveLength(5);
  });

  it("reports an exact count as exact", async () => {
    collections.set("examQuestions", Array.from({ length: 4 }, (_unused, index) => question(index)));

    const availability = await getExamQuestionAvailability({ uid: "student-1", folderId: "folder-1" });

    expect(availability.counts.medium).toBe(4);
    expect(availability.hasMore.medium).toBe(false);
  });

  /** A page cap bounds a specification with thousands published and none eligible. */
  it("gives up rather than scanning a corpus with nothing eligible in it", async () => {
    collections.set(
      "examQuestions",
      Array.from({ length: 6_000 }, (_unused, index) => question(index, { tier: "higher" }))
    );

    const availability = await getExamQuestionAvailability({ uid: "student-1", folderId: "folder-1" });

    expect(availability.counts.medium).toBe(0);
    expect(reads.filter((read) => read.path === "examQuestions").length).toBeLessThanOrEqual(75);
  });
});

/**
 * A question is served whole: every part, together, in the paper's order.
 *
 * Parts used to be drawn one at a time, so a session could hold 5(c) with no
 * 5(a) or 5(b) in it. The mix now counts whole questions, a question is as
 * hard as its hardest part, and one part held back holds the question back.
 */
describe("serving a question whole", () => {
  function partOf(index: number, questionNumber: string, overrides: Record<string, unknown> = {}): Doc {
    const base = question(index);
    return {
      id: `part-${questionNumber.replace(/\W/g, "")}`,
      data: {
        ...base.data,
        paperId: "paper-7",
        label: `Question ${questionNumber}`,
        provenance: { ...(base.data.provenance as Record<string, unknown>), questionNumber },
        ...overrides,
      },
    };
  }

  beforeEach(() => {
    writes.length = 0;
    collections.set("examQuestions", [
      // Stored out of order on purpose: the session must follow the paper.
      partOf(3, "5(c)", { difficulty: "medium" }),
      partOf(1, "5(a)", { difficulty: "easy" }),
      partOf(2, "5(b)", { difficulty: "easy" }),
      partOf(4, "6", { difficulty: "medium" }),
    ]);
  });

  it("counts a question once, at its hardest part", async () => {
    const availability = await getExamQuestionAvailability({ uid: "student-1", folderId: "folder-1" });

    expect(availability.counts).toEqual({ easy: 0, medium: 2, hard: 0 });
  });

  it("holds the whole question back when one of its parts cannot be served", async () => {
    collections.set("examQuestions", [
      partOf(3, "5(c)", { difficulty: "medium" }),
      partOf(1, "5(a)", { difficulty: "easy", status: "needs_review" }),
      partOf(2, "5(b)", { difficulty: "easy" }),
      partOf(4, "6", { difficulty: "medium" }),
    ]);

    const availability = await getExamQuestionAvailability({ uid: "student-1", folderId: "folder-1" });

    expect(availability.counts.medium).toBe(1);
  });

  it("builds a session from whole questions, parts together and in order", async () => {
    const session = await createExamSession({
      uid: "student-1",
      folderId: "folder-1",
      mix: { easy: 0, medium: 2, hard: 0 },
    });

    expect(session.questions.map((item) => item.label)).toEqual([
      "Question 5(a)", "Question 5(b)", "Question 5(c)", "Question 6",
    ]);
    // One attempt per part, each still marked on its own.
    expect(writes.filter((write) => write.data.status === "draft")).toHaveLength(4);
  });

  it("counts a short session in whole questions", async () => {
    await expect(
      createExamSession({ uid: "student-1", folderId: "folder-1", mix: { easy: 0, medium: 3, hard: 0 } })
    ).rejects.toMatchObject({
      code: "coverage_gap",
      availableMix: { easy: 0, medium: 2, hard: 0 },
      missingByDifficulty: { medium: 1 },
    });
  });
});

/**
 * Narrowing to one paper, on a course whose papers carry no calculator rule.
 *
 * Biology is split into papers by topic, not by calculator, so the setup screen
 * asks which paper and leaves the calculator question out.
 */
describe("choosing a paper", () => {
  beforeEach(() => {
    collections.set("examFormatCatalogue", [
      { id: "aqa-8461-1f", data: { board: "aqa", status: "current", qualification: "gcse", specificationCode: "8461", tier: "foundation", componentCode: "1F", componentTitle: "Paper 1 Foundation" } },
      { id: "aqa-8461-2f", data: { board: "aqa", status: "current", qualification: "gcse", specificationCode: "8461", tier: "foundation", componentCode: "2F", componentTitle: "Paper 2 Foundation" } },
      { id: "aqa-8461-1h", data: { board: "aqa", status: "current", qualification: "gcse", specificationCode: "8461", tier: "higher", componentCode: "1H", componentTitle: "Paper 1 Higher" } },
    ]);
    collections.set("examQuestions", [
      ...Array.from({ length: 3 }, (_unused, index) => question(index)),
      ...Array.from({ length: 2 }, (_unused, index) =>
        question(10 + index, {
          provenance: {
            board: "aqa", qualification: "gcse", specificationId: "8461",
            componentCode: "8461/2F", boardLabel: "AQA", specificationTitle: "GCSE Biology (8461)",
            componentTitle: "Paper 2 Foundation",
          },
        })
      ),
    ]);
  });

  it("lists the course's papers and says nothing about calculators", async () => {
    const availability = await getExamQuestionAvailability({ uid: "student-1", folderId: "folder-1" });

    expect(availability.papers.map((paper) => paper.label)).toEqual(["Paper 1", "Paper 2"]);
    expect(availability.counts.medium).toBe(5);
    expect(availability.calculatorPolicyKnown).toBe(false);
  });

  it("counts only the paper chosen", async () => {
    const availability = await getExamQuestionAvailability({
      uid: "student-1",
      folderId: "folder-1",
      paperIds: ["paper-2"],
    });

    expect(availability.counts.medium).toBe(2);
  });

  it("refuses a paper the course does not have", async () => {
    await expect(
      getExamQuestionAvailability({ uid: "student-1", folderId: "folder-1", paperIds: ["paper-3"] })
    ).rejects.toMatchObject({ code: "unknown_papers" });
  });

  it("asks about calculators once a paper records a rule", async () => {
    collections.set("examQuestions", [question(0, { calculatorAllowed: false })]);

    const availability = await getExamQuestionAvailability({ uid: "student-1", folderId: "folder-1" });

    expect(availability.calculatorPolicyKnown).toBe(true);
  });
});

/**
 * The subject a folder searches under, which is the course's and not its own.
 *
 * A real AQA GCSE maths folder found none of the 101 published questions and
 * was offered generated ones instead. The folder's subject read "gcse maths",
 * because that is what the student typed; the questions were filed under the
 * subject printed on the paper, "Mathematics". The query asked for
 * `gcse-maths`, the corpus held `mathematics`, and the coverage-shortage path
 * then did exactly what it should with a query that could never match.
 *
 * The fixtures above never caught it because their folder says "Biology" and
 * their questions say "biology", which agree by luck of wording.
 */
describe("a folder whose subject is not written the way the paper writes it", () => {
  beforeEach(() => {
    collections.set("users/student-1/studyFolders", [
      {
        id: "folder-maths",
        data: {
          name: "Maths",
          subject: "gcse maths",
          studyLevel: "gcse-equivalent",
          examCourse: { ...COURSE, specificationId: "8300", specificationTitle: "GCSE Mathematics (8300)", tier: "higher" },
        },
      },
    ]);
    collections.set("examFormatCatalogue", [
      {
        id: "aqa-8300",
        data: {
          board: "aqa", status: "current", qualification: "gcse",
          specificationCode: "8300", tier: "higher", subject: "Mathematics",
        },
      },
    ]);
    collections.set("examQuestions", Array.from({ length: 4 }, (_unused, index) =>
      question(index, {
        subjectKey: "mathematics",
        tier: "higher",
        provenance: {
          board: "aqa", qualification: "gcse", specificationId: "8300",
          componentCode: "8300/1H", boardLabel: "AQA",
          specificationTitle: "GCSE Mathematics (8300)", componentTitle: "Paper 1 Higher",
        },
      })
    ));
  });

  it("finds the questions the paper filed under its own subject", async () => {
    const availability = await getExamQuestionAvailability({ uid: "student-1", folderId: "folder-maths" });

    expect(availability.counts.medium).toBe(4);
  });

  it("searches the subject the course names, not the words the student typed", async () => {
    await getExamQuestionAvailability({ uid: "student-1", folderId: "folder-maths" });

    expect(reads.some((read) => read.path === "examQuestions" && read.size > 0)).toBe(true);
  });

  /*
   * A catalogue entry that names no subject must not empty a folder that was
   * working: the student's own wording stays the fallback.
   */
  it("falls back to the folder's own subject when the course names none", async () => {
    collections.set("examFormatCatalogue", [
      { id: "aqa-8300", data: { board: "aqa", status: "current", qualification: "gcse", specificationCode: "8300", tier: "higher" } },
    ]);
    collections.set("examQuestions", Array.from({ length: 2 }, (_unused, index) =>
      question(index, {
        subjectKey: "gcse-maths",
        tier: "higher",
        provenance: {
          board: "aqa", qualification: "gcse", specificationId: "8300",
          componentCode: "8300/1H", boardLabel: "AQA",
          specificationTitle: "GCSE Mathematics (8300)", componentTitle: "Paper 1 Higher",
        },
      })
    ));

    const availability = await getExamQuestionAvailability({ uid: "student-1", folderId: "folder-maths" });

    expect(availability.counts.medium).toBe(2);
  });

  /*
   * The subject detail is optional. A folder given a board, course and tier
   * with nothing typed in that box was refused as having no course, and the
   * only way through was typing the course into it.
   */
  it("practises a folder whose subject detail was left empty", async () => {
    collections.set("users/student-1/studyFolders", [
      {
        id: "folder-maths",
        data: {
          name: "Maths",
          studyLevel: "gcse-equivalent",
          // "Higher" as the picker names it, against "higher" in the catalogue and on the questions.
          examCourse: { ...COURSE, specificationId: "8300", specificationTitle: "GCSE Mathematics", tier: "Higher" },
        },
      },
    ]);

    const availability = await getExamQuestionAvailability({ uid: "student-1", folderId: "folder-maths" });

    expect(availability.counts.medium).toBe(4);
    expect(availability.folder.subject).toBe("Mathematics");
  });
});

/**
 * Narrowing practice to a concept, one grain finer than a topic.
 *
 * A student who wants quadratic equations rather than all of solving equations
 * gets questions tagged with that concept -- and a topic and a concept chosen
 * together widen the session rather than cancelling each other out.
 */
describe("narrowing to a concept", () => {
  const QUADRATICS = "aqa-8300-algebra-quadratic-equations";
  const SOLVING = "aqa-8300-algebra-solving-equations-and-inequalities";

  beforeEach(() => {
    writes.length = 0;
    collections.set("users/student-1/studyFolders", [
      {
        id: "folder-maths",
        data: {
          name: "Maths",
          subject: "Mathematics",
          studyLevel: "gcse-equivalent",
          examCourse: { ...COURSE, specificationId: "8300", specificationTitle: "GCSE Mathematics (8300)", tier: "higher" },
        },
      },
    ]);
    collections.set("examFormatCatalogue", [
      {
        id: "aqa-8300",
        data: { board: "aqa", status: "current", qualification: "gcse", specificationCode: "8300", tier: "higher", subject: "Mathematics" },
      },
    ]);
    const maths = (index: number, overrides: Record<string, unknown>) =>
      question(index, {
        subjectKey: "mathematics",
        tier: "higher",
        provenance: {
          board: "aqa", qualification: "gcse", specificationId: "8300",
          componentCode: "8300/1H", boardLabel: "AQA",
          specificationTitle: "GCSE Mathematics (8300)", componentTitle: "Paper 1 Higher",
        },
        ...overrides,
      });
    collections.set("examQuestions", [
      maths(0, { topicIds: [SOLVING], conceptIds: [QUADRATICS] }),
      maths(1, { topicIds: [SOLVING], conceptIds: ["aqa-8300-algebra-linear-equations"] }),
      maths(2, { topicIds: [SOLVING] }),
      maths(3, { topicIds: ["aqa-8300-probability"], conceptIds: ["aqa-8300-probability-venn-and-tree-diagrams"] }),
    ]);
  });

  it("offers each topic with the checked concepts beneath it", async () => {
    const availability = await getExamQuestionAvailability({ uid: "student-1", folderId: "folder-maths" });

    expect(availability.topics.find((topic) => topic.id === SOLVING)?.concepts.map((concept) => concept.id)).toContain(
      QUADRATICS
    );
    expect(availability.topics.flatMap((topic) => topic.concepts)).toHaveLength(97);
  });

  it("counts only the questions tagged with the chosen concept", async () => {
    const availability = await getExamQuestionAvailability({
      uid: "student-1",
      folderId: "folder-maths",
      conceptIds: [QUADRATICS],
    });

    expect(availability.counts.medium).toBe(1);
    expect(availability.conceptIds).toEqual([QUADRATICS]);
  });

  it("draws on a chosen topic and a chosen concept together", async () => {
    const availability = await getExamQuestionAvailability({
      uid: "student-1",
      folderId: "folder-maths",
      topicIds: ["aqa-8300-probability"],
      conceptIds: [QUADRATICS],
    });

    expect(availability.counts.medium).toBe(2);
  });

  it("builds a session from the concept and records what it was narrowed to", async () => {
    const session = await createExamSession({
      uid: "student-1",
      folderId: "folder-maths",
      mix: { easy: 0, medium: 1, hard: 0 },
      conceptIds: [QUADRATICS],
    });

    expect(session.conceptIds).toEqual([QUADRATICS]);
    expect(session.questions.map((item) => item.conceptIds)).toEqual([[QUADRATICS]]);
  });

  it("refuses a concept the course does not have", async () => {
    await expect(
      getExamQuestionAvailability({ uid: "student-1", folderId: "folder-maths", conceptIds: ["aqa-8300-vibes"] })
    ).rejects.toMatchObject({ code: "unknown_concepts" });
  });
});
