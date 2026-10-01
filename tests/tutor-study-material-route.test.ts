import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  updates: [] as Array<{ path: string; data: Record<string, unknown> }>,
  batchSets: [] as Array<{ path: string; data: Record<string, unknown> }>,
  resolveContext: vi.fn(),
  checkBudget: vi.fn(),
  refundBudget: vi.fn(),
  generateText: vi.fn(),
  createPracticeSet: vi.fn(),
}));

vi.mock("@/services/firebase/admin", () => {
  let autoId = 0;
  const docRef = (path: string): Record<string, unknown> => ({
    id: path.split("/").at(-1),
    path,
    collection: (name: string) => collectionRef(`${path}/${name}`),
    get: vi.fn(async () => {
      const data = mocks.docs.get(path);
      return { exists: Boolean(data), id: path.split("/").at(-1), data: () => data };
    }),
    update: vi.fn(async (data: Record<string, unknown>) => {
      mocks.updates.push({ path, data });
    }),
  });
  const collectionRef = (path: string): Record<string, unknown> => ({
    path,
    doc: (id?: string) => docRef(`${path}/${id ?? `auto-${++autoId}`}`),
    where: (_field: string, _op: string, value: unknown) => ({
      get: vi.fn(async () => ({
        docs: [...mocks.docs.entries()]
          .filter(([key, data]) => key.startsWith(`${path}/`) && data.threadId === value)
          .map(([key, data]) => ({ id: key.split("/").at(-1), data: () => data })),
      })),
    }),
  });
  return {
    getAdminAuth: () => ({ verifyIdToken: vi.fn(async () => ({ uid: "user-1" })) }),
    getAdminDb: () => ({
      collection: (name: string) => collectionRef(name),
      batch: () => ({
        set: (ref: { path: string }, data: Record<string, unknown>) =>
          mocks.batchSets.push({ path: ref.path, data }),
        commit: vi.fn(async () => undefined),
      }),
    }),
  };
});

vi.mock("@/services/ai/assistant-context", () => ({
  JamiAssistantContextError: class extends Error {},
  resolveJamiAssistantContext: mocks.resolveContext,
}));

vi.mock("@/services/ai/budgets", () => ({
  checkAiBudget: mocks.checkBudget,
  refundAiBudget: mocks.refundBudget,
  createAiBudgetLimitResponse: () => Response.json({ error: "limit" }, { status: 429 }),
}));

vi.mock("@/services/ai/spend.server", () => ({ aiSpendContextFor: () => ({}) }));
vi.mock("@/lib/ai/spend-context", () => ({ enterAiSpendContext: () => undefined }));

vi.mock("@/lib/ai/provider-router", () => ({
  generateAiText: (...args: unknown[]) => mocks.generateText(...args),
}));

vi.mock("@/services/practice/practice-sets.server", () => ({
  PracticeSetError: class extends Error {},
  createPracticeSet: mocks.createPracticeSet,
}));

let postStudyMaterial: (request: NextRequest) => Promise<Response>;

const THREAD = "users/user-1/assistantThreads/thread-1";
const ANSWER = "users/user-1/assistantMessages/answer-1";

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/ai/assistant/study-material", {
    method: "POST",
    headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function body(kind: string) {
  return {
    threadId: "thread-1",
    messageId: "answer-1",
    kind,
    context: { surface: "sources", sourceIds: ["source-1"] },
  };
}

beforeAll(async () => {
  postStudyMaterial = (await import("@/app/api/ai/assistant/study-material/route")).POST;
}, 120_000);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.docs.clear();
  mocks.updates.length = 0;
  mocks.batchSets.length = 0;
  mocks.docs.set(THREAD, {
    title: "Differential equations",
    surface: "sources",
    context: { surface: "sources", sourceIds: ["source-1"] },
    contextKey: "sources:source-1",
    contextLabel: "Calculus notes",
    createdAt: 1,
    updatedAt: 3,
  });
  mocks.docs.set("users/user-1/assistantMessages/question-1", {
    threadId: "thread-1",
    role: "user",
    text: "I don't know when to divide x over. Can you make me flashcards on this?",
    createdAt: 2,
  });
  mocks.docs.set(ANSWER, {
    threadId: "thread-1",
    role: "assistant",
    text: "Making you flashcards on separating variables now.",
    studyMaterialRequest: { kind: "flashcards", focus: "separating variables: which side to divide", count: 4 },
    studyMaterialOffers: ["practice"],
    studyMaterialFocus: "separating variables: which side to divide",
    createdAt: 3,
  });
  mocks.resolveContext.mockResolvedValue({
    currentId: "source-1",
    currentLabel: "Calculus notes",
    currentParts: [{ text: "The student is asking from Sources." }],
    sources: [{ id: "source-1", title: "Calculus notes", contentText: "Separable equations dy/dx = f(x)g(y)." }],
    studyLevelContext: "Study-level preference: undergraduate university level (folder override).",
    folderIds: ["maths"],
  });
  mocks.checkBudget.mockResolvedValue({ allowed: true, grant: { key: "grant" } });
  mocks.refundBudget.mockResolvedValue(undefined);
  mocks.generateText.mockResolvedValue(
    JSON.stringify([
      { front: "In dy/dx = f(x)g(y), which side does g(y) go to?", back: "The dy side, as 1/g(y) dy." },
      { front: "What goes with dx when separating variables?", back: "Every factor that depends only on x." },
    ])
  );
});

describe("Tutor study material route", () => {
  it("drafts flashcards from the saved conversation and records them on the answer", async () => {
    const response = await postStudyMaterial(request(body("flashcards")));
    const data = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(data.result).toMatchObject({
      kind: "flashcards",
      focus: "separating variables: which side to divide",
      folderId: "maths",
    });
    expect(data.drafts).toHaveLength(2);
    expect(mocks.checkBudget).toHaveBeenCalledWith({ uid: "user-1", action: "sourceFlashcardDrafts" });

    // Written from the conversation the server holds, fenced as data, at the student's level.
    const call = mocks.generateText.mock.calls[0]?.[0] as {
      request: { systemInstruction: string; contents: Array<{ parts: Array<{ text: string }> }> };
    };
    expect(call.request.systemInstruction).toContain("undergraduate university level");
    const prompt = call.request.contents[0]!.parts[0]!.text;
    expect(prompt).toMatch(/Create up to 4 flashcards/);
    expect(prompt).toMatch(/BEGIN MATERIAL[\s\S]*Student: I don't know when to divide x over[\s\S]*Separable equations[\s\S]*END MATERIAL/);

    expect(mocks.batchSets.map((entry) => entry.data)).toEqual([
      expect.objectContaining({ kind: "flashcard", contentStatus: "draft", sourceType: "tutor", sourceId: "source-1", folderId: "maths", threadId: "thread-1", messageId: "answer-1" }),
      expect.objectContaining({ kind: "flashcard", sourceType: "tutor" }),
    ]);
    expect(mocks.updates).toEqual([
      {
        path: ANSWER,
        data: { "studyMaterialResults.flashcards": expect.objectContaining({ kind: "flashcards", draftIds: expect.any(Array) }) },
      },
    ]);
  });

  it("writes an offered practice set into Practice, in the conversation's folder", async () => {
    mocks.createPracticeSet.mockResolvedValue({
      id: "session-1",
      questions: [{}, {}, {}, {}, {}],
      maxTotal: 18,
      practiceSet: { title: "Separating variables: which side to divide" },
    });

    const response = await postStudyMaterial(request(body("practice")));
    const data = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(mocks.checkBudget).toHaveBeenCalledWith({ uid: "user-1", action: "sourcePracticeDrafts" });
    expect(mocks.createPracticeSet).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: "user-1",
        origin: "tutor",
        focus: "separating variables: which side to divide",
        folderId: "maths",
        sourceIds: ["source-1"],
        threadId: "thread-1",
        messageId: "answer-1",
        context: expect.stringContaining("undergraduate university level"),
      })
    );
    expect(data.result).toMatchObject({
      kind: "practice",
      sessionId: "session-1",
      questionCount: 5,
      totalMarks: 18,
    });
  });

  it("refuses a kind nobody asked for or offered, before charging", async () => {
    mocks.docs.set(ANSWER, { ...mocks.docs.get(ANSWER), studyMaterialRequest: undefined, studyMaterialOffers: [] });

    const response = await postStudyMaterial(request(body("flashcards")));

    expect(response.status).toBe(409);
    expect(mocks.checkBudget).not.toHaveBeenCalled();
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("returns what was already made rather than making it twice", async () => {
    mocks.docs.set(ANSWER, {
      ...mocks.docs.get(ANSWER),
      studyMaterialResults: {
        flashcards: { kind: "flashcards", draftIds: ["draft-1"], focus: "f", createdAt: 9 },
      },
    });

    const response = await postStudyMaterial(request(body("flashcards")));
    const data = (await response.json()) as Record<string, unknown>;

    expect(data.result).toMatchObject({ kind: "flashcards", draftIds: ["draft-1"] });
    expect(mocks.checkBudget).not.toHaveBeenCalled();
  });

  it("refuses an answer from another study context", async () => {
    const response = await postStudyMaterial(
      request({ ...body("flashcards"), context: { surface: "sources", sourceIds: ["source-2"] } })
    );

    expect(response.status).toBe(404);
    expect(mocks.checkBudget).not.toHaveBeenCalled();
  });

  it("gives the allowance back when drafting fails", async () => {
    mocks.generateText.mockResolvedValueOnce("[]");

    const response = await postStudyMaterial(request(body("flashcards")));

    expect(response.status).toBe(422);
    expect(mocks.refundBudget).toHaveBeenCalledWith({ key: "grant" });
    expect(mocks.updates).toEqual([]);
  });
});
