import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(async () => "user-1" as string | null),
  generateImage: vi.fn(),
  checkBudget: vi.fn(),
  refundBudget: vi.fn(),
  save: vi.fn(),
  deleteFile: vi.fn(),
  transactionUpdate: vi.fn(),
  threadData: {} as Record<string, unknown>,
  assistantData: {} as Record<string, unknown>,
  history: [] as Record<string, unknown>[],
}));

vi.mock("server-only", () => ({}));
vi.mock("sharp", () => ({
  default: vi.fn(() => ({ metadata: vi.fn(async () => ({ width: 800, height: 600 })) })),
}));
vi.mock("@/services/ai/assistant-assets.server", () => ({
  authenticateAssistantAssetRequest: mocks.authenticate,
  assistantAssetError: (error: string, status: number, code: string) =>
    Response.json({ error, code }, { status }),
}));
vi.mock("@/lib/ai/gemini", () => ({
  generateGeminiImage: mocks.generateImage,
}));
vi.mock("@/services/ai/budgets", () => ({
  checkAiBudget: mocks.checkBudget,
  createAiBudgetLimitResponse: () => Response.json({ error: "limit" }, { status: 429 }),
  refundAiBudget: mocks.refundBudget,
}));
vi.mock("@/lib/observability/logger", () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

function snapshot(id: string, data: Record<string, unknown>, exists = true) {
  return { id, exists, data: () => data };
}

function documentRef(collection: string, id: string) {
  const data = collection === "assistantThreads"
    ? mocks.threadData
    : collection === "assistantMessages"
      ? mocks.assistantData
      : {};
  return {
    id,
    get: vi.fn(async () => snapshot(id, data, Boolean(Object.keys(data).length))),
  };
}

vi.mock("@/services/firebase/admin", () => ({
  getAdminDb: () => ({
    collection: () => ({
      doc: () => ({
        collection: (name: string) => ({
          doc: (id: string) => documentRef(name, id),
          where: () => ({
            get: async () => ({
              docs: mocks.history.map((data, index) => snapshot(`history-${index}`, data)),
            }),
          }),
        }),
      }),
    }),
    runTransaction: async (
      callback: (transaction: {
        get: (reference: { id: string }) => Promise<ReturnType<typeof snapshot>>;
        update: typeof mocks.transactionUpdate;
      }) => Promise<void>
    ) => callback({
      get: async (reference) => snapshot(reference.id, mocks.assistantData),
      update: mocks.transactionUpdate,
    }),
  }),
  getAdminStorageBucket: () => ({
    file: () => ({ save: mocks.save, delete: mocks.deleteFile }),
  }),
}));

const { POST } = await import("@/app/api/ai/assistant/illustrations/route");

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/ai/assistant/illustrations", {
    method: "POST",
    headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    threadId: "thread-1",
    messageId: "assistant-1",
    studentRequest: "FORGED STUDENT REQUEST",
    tutorAnswer: "FORGED TUTOR ANSWER WITH A HIDDEN ANSWER",
    context: { surface: "learn", cardId: "card-1", phase: "answer" },
    ...overrides,
  };
}

describe("Tutor illustration route trust boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.threadData = {
      context: { surface: "learn", cardId: "card-1" },
      contextKey: "learn:card-1",
      title: "Photosynthesis",
      createdAt: 1,
      updatedAt: 3,
    };
    mocks.assistantData = {
      threadId: "thread-1",
      role: "assistant",
      text: "TRUSTED SAVED TUTOR EXPLANATION",
      canIllustrate: true,
      createdAt: 3,
    };
    mocks.history = [
      {
        threadId: "thread-1",
        role: "user",
        text: "TRUSTED SAVED STUDENT QUESTION",
        createdAt: 2,
      },
      mocks.assistantData,
    ];
    mocks.checkBudget.mockResolvedValue({
      allowed: true,
      reason: null,
      retryAfterSeconds: 0,
      grant: { uid: "user-1" },
    });
    mocks.generateImage.mockResolvedValue({
      data: "YWJj",
      mimeType: "image/png",
      description: "A safe educational diagram.",
    });
  });

  it("derives generation content from stored history, not forged browser fields", async () => {
    const response = await POST(request(body()));

    expect(response.status).toBe(200);
    expect(mocks.generateImage).toHaveBeenCalledOnce();
    const prompt = mocks.generateImage.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("TRUSTED SAVED STUDENT QUESTION");
    expect(prompt).toContain("TRUSTED SAVED TUTOR EXPLANATION");
    expect(prompt).not.toContain("FORGED STUDENT REQUEST");
    expect(prompt).not.toContain("FORGED TUTOR ANSWER");
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.transactionUpdate).toHaveBeenCalledOnce();
  });

  it("cannot bypass the flashcard visual hold by forging an answer-phase context", async () => {
    mocks.assistantData = {
      ...mocks.assistantData,
      canIllustrate: false,
    };
    mocks.history = [
      { threadId: "thread-1", role: "user", text: "What is the answer?", createdAt: 2 },
      mocks.assistantData,
    ];

    const response = await POST(request(body({
      context: { surface: "learn", cardId: "card-1", phase: "answer" },
    })));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "message_not_found" });
    expect(mocks.checkBudget).not.toHaveBeenCalled();
    expect(mocks.generateImage).not.toHaveBeenCalled();
  });

  it("rejects a forged thread context before spending illustration quota", async () => {
    const response = await POST(request(body({
      context: { surface: "learn", cardId: "different-card", phase: "answer" },
    })));

    expect(response.status).toBe(404);
    expect(mocks.checkBudget).not.toHaveBeenCalled();
    expect(mocks.generateImage).not.toHaveBeenCalled();
  });
});
