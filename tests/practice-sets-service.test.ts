import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  writes: [] as Array<{ path: string; data: Record<string, unknown> }>,
  deletes: [] as string[],
  updates: [] as Array<{ path: string; data: Record<string, unknown> }>,
  generate: vi.fn(),
  loadCourse: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/services/firebase/admin", () => {
  const docRef = (path: string): Record<string, unknown> => ({
    id: path.split("/").at(-1),
    path,
    collection: (name: string) => collectionRef(`${path}/${name}`),
    get: vi.fn(async () => {
      const data = mocks.docs.get(path);
      return { exists: Boolean(data), id: path.split("/").at(-1), data: () => data };
    }),
  });
  const collectionRef = (path: string): Record<string, unknown> => ({
    doc: (id?: string) => docRef(`${path}/${id ?? "session-1"}`),
    where: (field: string, _op: string, value: unknown) => ({
      limit: () => ({
        get: vi.fn(async () => {
          const docs = [...mocks.docs.entries()]
            .filter(([key, data]) => key.startsWith(`${path}/`) && data[field] === value)
            .map(([key]) => ({ id: key.split("/").at(-1), ref: { path: key } }));
          return { empty: docs.length === 0, docs };
        }),
      }),
    }),
  });
  return {
    getAdminDb: () => ({
      collection: (name: string) => collectionRef(name),
      batch: () => ({
        set: (ref: { path: string }, data: Record<string, unknown>) => mocks.writes.push({ path: ref.path, data }),
        delete: (ref: { path: string }) => mocks.deletes.push(ref.path),
        commit: vi.fn(async () => undefined),
      }),
      runTransaction: async (work: (transaction: unknown) => Promise<unknown>) =>
        work({
          get: async (ref: { get: () => Promise<unknown> }) => ref.get(),
          update: (ref: { path: string }, data: Record<string, unknown>) => mocks.updates.push({ path: ref.path, data }),
        }),
    }),
  };
});

vi.mock("@/services/practice/exam-gap-generation.server", () => ({
  generateExamGapQuestions: mocks.generate,
}));

vi.mock("@/services/practice/exam-question-bank.server", () => ({
  loadPracticeSetCourse: mocks.loadCourse,
}));

let createPracticeSet: typeof import("@/services/practice/practice-sets.server").createPracticeSet;
let updatePracticeSet: typeof import("@/services/practice/practice-sets.server").updatePracticeSet;

function question(id: string, marks: number) {
  return {
    id,
    label: id,
    prompt: `Question ${id}`,
    marks,
    difficulty: "medium",
    origin: "jami_generated",
    provenance: { board: "jami", boardLabel: "Jami", questionNumber: "1" },
    contentVersion: "v1",
    topicIds: [],
    assets: [],
  };
}

beforeAll(async () => {
  ({ createPracticeSet, updatePracticeSet } = await import("@/services/practice/practice-sets.server"));
}, 120_000);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.docs.clear();
  mocks.writes.length = 0;
  mocks.deletes.length = 0;
  mocks.updates.length = 0;
  mocks.loadCourse.mockResolvedValue(null);
  mocks.generate.mockResolvedValue([question("q1", 2), question("q2", 4)]);
});

describe("createPracticeSet", () => {
  it("writes a university folder's set to its level and material, with no exam course", async () => {
    mocks.docs.set("users/user-1", { defaultStudyLevel: "gcse-equivalent", studySubjects: ["Law LLB"] });
    mocks.docs.set("users/user-1/studyFolders/contract", {
      name: "Contract law",
      subject: "Law",
      studyLevel: "undergraduate",
    });

    const session = await createPracticeSet({
      uid: "user-1",
      origin: "tutor",
      focus: "consideration: past consideration and its exceptions",
      count: 5,
      folderId: "contract",
      context: "Tutoring conversation:\nStudent: I don't get past consideration",
      threadId: "thread-1",
      messageId: "answer-1",
    });

    expect(mocks.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        studyLevel: "undergraduate",
        subject: "Law",
        missing: { easy: 2, medium: 2, hard: 1 },
        paperId: "jami-set-session-1",
        inferLevel: false,
        brief: {
          focus: "consideration: past consideration and its exceptions",
          context: expect.stringMatching(/Folder: "Contract law"[\s\S]*"Law LLB"[\s\S]*past consideration/),
        },
      })
    );
    expect(mocks.generate.mock.calls[0]?.[0]).not.toHaveProperty("course");
    expect(session).toMatchObject({
      id: "session-1",
      folderId: "contract",
      studyLevel: "undergraduate",
      status: "active",
      answeredCount: 0,
      maxTotal: 6,
      practiceSet: {
        origin: "tutor",
        status: "ready",
        title: "Consideration: past consideration and its exceptions",
        threadId: "thread-1",
      },
    });
    expect(session).not.toHaveProperty("course");
    // The session and one blank attempt per question, in one batch.
    expect(mocks.writes.map((write) => write.path)).toEqual([
      "users/user-1/examSessions/session-1",
      "users/user-1/examAttempts/session-1_1_1",
      "users/user-1/examAttempts/session-1_2_1",
    ]);
  });

  it("writes to the folder's exam course where it has one", async () => {
    const course = {
      board: "aqa",
      qualification: "gcse",
      specificationId: "8300",
      specificationTitle: "Mathematics",
      componentIds: [],
    };
    mocks.docs.set("users/user-1", {});
    mocks.docs.set("users/user-1/studyFolders/maths", { name: "Maths", studyLevel: "gcse-equivalent" });
    mocks.loadCourse.mockResolvedValue({
      folder: { id: "maths", name: "Maths", studyLevel: "gcse-equivalent" },
      course,
      subject: "Mathematics",
      subjectKey: "mathematics",
      topicIds: ["algebra"],
      conceptIds: [],
    });

    const session = await createPracticeSet({
      uid: "user-1",
      origin: "learning",
      focus: "Quadratics",
      folderId: "maths",
      topicIds: ["algebra"],
    });

    expect(mocks.generate).toHaveBeenCalledWith(
      expect.objectContaining({ course, subjectKey: "mathematics", topicIds: ["algebra"] })
    );
    expect(session.course).toEqual(course);
  });

  it("asks the writer to judge the level when nobody has said it", async () => {
    mocks.docs.set("users/user-1", {});
    mocks.generate.mockImplementation(async (input: { onLevelInferred?: (level: string) => void }) => {
      input.onLevelInferred?.("postgraduate");
      return [question("q1", 3)];
    });

    const session = await createPracticeSet({ uid: "user-1", origin: "source", focus: "Bayesian priors" });

    expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ inferLevel: true }));
    expect(session.studyLevel).toBe("postgraduate");
    expect(session.folderId).toBe("");
  });

  it("refuses a folder the student does not have", async () => {
    mocks.docs.set("users/user-1", {});
    await expect(
      createPracticeSet({ uid: "user-1", origin: "tutor", focus: "x", folderId: "missing" })
    ).rejects.toMatchObject({ status: 404, code: "folder_not_found" });
    expect(mocks.generate).not.toHaveBeenCalled();
  });
});

describe("updatePracticeSet", () => {
  const session = {
    status: "active",
    answeredCount: 0,
    questions: [],
    practiceSet: { origin: "tutor", status: "ready", title: "Enzymes", focus: "enzymes" },
  };

  it("turns a set down, abandons it unstarted and deletes its questions", async () => {
    mocks.docs.set("users/user-1/examSessions/set-1", session);
    mocks.docs.set("users/user-1/examGeneratedQuestions/jami_a", { paperId: "jami-set-set-1" });
    mocks.docs.set("users/user-1/examGeneratedQuestions/jami_other", { paperId: "jami-set-set-2" });

    const updated = await updatePracticeSet("user-1", "set-1", "dismiss");

    expect(updated).toMatchObject({ status: "abandoned", practiceSet: { status: "dismissed" } });
    expect(mocks.updates[0]?.data).toMatchObject({ status: "abandoned", practiceSet: { status: "dismissed" } });
    expect(mocks.deletes).toEqual([
      "users/user-1/examGeneratedQuestions/jami_a",
      "users/user-1/examGeneratedSecrets/jami_a",
    ]);
  });

  it("keeps a set without touching its questions", async () => {
    mocks.docs.set("users/user-1/examSessions/set-1", session);

    const updated = await updatePracticeSet("user-1", "set-1", "accept");

    expect(updated).toMatchObject({ status: "active", practiceSet: { status: "ready", acceptedAt: expect.any(Number) } });
    expect(mocks.deletes).toEqual([]);
  });

  it("will not treat an ordinary session as a set", async () => {
    mocks.docs.set("users/user-1/examSessions/plain", { status: "active", answeredCount: 0, questions: [] });
    await expect(updatePracticeSet("user-1", "plain", "dismiss")).rejects.toMatchObject({ status: 400 });
  });
});
