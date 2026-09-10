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
}): Record<string, unknown> {
  const next = (changes: Partial<typeof state>) => queryFor(path, { ...state, ...changes });
  return {
    where: (field: string, operator: string, value: unknown) =>
      next({ filters: [...state.filters, [field, operator, value]] }),
    orderBy: (field: string) => next({ order: field }),
    startAfter: (cursor: Doc) => next({ cursor }),
    limit: (count: number) => next({ limit: count }),
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
      reads.push({ path, size: docs.length });
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

const db = {
  collection: (name: string) => ({ ...queryFor(name, { filters: [] }), doc: (id: string) => docFor(`${name}/${id}`) }),
};

vi.mock("server-only", () => ({}));
vi.mock("@/services/firebase/admin", () => ({ getAdminDb: () => db }));
vi.mock("@/services/practice/exam-gap-generation.server", () => ({ generateExamGapQuestions: vi.fn(async () => []) }));
vi.mock("@/services/practice/exam-difficulty.server", () => ({ recoverExamDifficultyContributions: vi.fn(async () => 0) }));

const { getExamQuestionAvailability } = await import("@/services/practice/exam-question-bank.server");

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

  it("stops once it has a session's worth rather than counting the corpus", async () => {
    collections.set(
      "examQuestions",
      Array.from({ length: 900 }, (_unused, index) => question(index))
    );

    const availability = await getExamQuestionAvailability({ uid: "student-1", folderId: "folder-1" });

    expect(availability.counts.medium).toBe(20);
    expect(availability.hasMore.medium).toBe(true);
    // One page of two hundred already holds twenty; reading further would cost
    // four more reads and change nothing the student can choose.
    expect(reads.filter((read) => read.path === "examQuestions" && read.size > 0)).toHaveLength(1);
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
