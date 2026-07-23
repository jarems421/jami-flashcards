import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  const transactionSet = vi.fn();
  const threadSnapshot = {
    exists: false,
    data: () => undefined,
  };
  const threadRef = {
    id: "source-thread",
    get: vi.fn(async () => threadSnapshot),
  };
  const sourceDoc = (sourceId: string) => ({
    get: vi.fn(async () => ({
      id: sourceId,
      exists: true,
      data: () => ({
        title: sourceId === "source-1" ? "Plant notes" : "Diagram",
        type: "manual_note",
        contentText: "Plants absorb light energy.",
        folderIds: [],
        topicIds: [],
        status: "active",
        createdBy: "user-1",
        createdAt: 1,
        updatedAt: 1,
      }),
    })),
  });
  const userDoc = {
    collection: vi.fn((name: string) => {
      if (name === "sources") return { doc: sourceDoc };
      if (name === "tutorThreads") {
        return {
          doc: vi.fn(() => threadRef),
          get: vi.fn(async () => ({ docs: [] })),
        };
      }
      return { get: vi.fn(async () => ({ docs: [] })) };
    }),
  };
  const db = {
    collection: vi.fn(() => ({ doc: vi.fn(() => userDoc) })),
    runTransaction: vi.fn(async (callback: (transaction: unknown) => Promise<unknown>) =>
      callback({
        get: vi.fn(async () => threadSnapshot),
        set: transactionSet,
      })
    ),
    batch: vi.fn(() => ({
      delete: vi.fn(),
      commit: vi.fn(async () => undefined),
    })),
  };

  return {
    db,
    generateGeminiText: vi.fn(),
    prepareSourceForTutor: vi.fn(),
    checkAiBudget: vi.fn(async () => true),
    transactionSet,
  };
});

vi.mock("@/services/firebase/admin", () => ({
  getAdminAuth: () => ({
    verifyIdToken: vi.fn(async () => ({ uid: "user-1" })),
  }),
  getAdminDb: () => mocks.db,
  getAdminStorageBucket: () => ({
    file: vi.fn(() => ({ download: vi.fn() })),
  }),
}));

vi.mock("@/lib/auth/bearer", () => ({
  getBearerToken: () => "token",
}));

vi.mock("@/lib/ai/budgets", () => ({
  checkAiBudget: mocks.checkAiBudget,
  getAiTokenCap: () => 1_000,
}));

vi.mock("@/lib/ai/gemini", () => ({
  generateGeminiText: mocks.generateGeminiText,
}));

vi.mock("@/lib/ai/card-autocomplete", () => ({
  cleanGeneratedStudyText: (value: string) => value,
}));

vi.mock("@/lib/ai/source-ingestion", () => ({
  normalizeSourceTutorIds: (values: unknown[]) =>
    Array.from(
      new Set(
        values
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter(Boolean)
      )
    ),
  prepareSourceForTutor: mocks.prepareSourceForTutor,
}));

vi.mock("@/lib/practice/sources", () => ({
  mapSourceData: (id: string, data: Record<string, unknown>) => ({ id, ...data }),
}));

let postSourceTutor: (request: NextRequest) => Promise<Response>;

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/ai/source-tutor", {
    method: "POST",
    headers: {
      Authorization: "Bearer token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeAll(async () => {
  process.env.GEMINI_API_KEY = "test-key";
  ({ POST: postSourceTutor } = await import("@/app/api/ai/source-tutor/route"));
}, 120_000);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkAiBudget.mockResolvedValue(true);
  mocks.prepareSourceForTutor.mockResolvedValue({
    sourceId: "source-1",
    label: "Plant notes",
    inputBytes: 100,
    parts: [{ text: "Plants absorb light energy." }],
  });
});

describe("Source Tutor route truthfulness", () => {
  it("returns provider failure as a non-success response and does not save it", async () => {
    mocks.generateGeminiText.mockRejectedValue(new Error("provider unavailable"));

    const response = await postSourceTutor(
      request({ sourceIds: ["source-1"], message: "Explain this." })
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      status: "failure",
      code: "provider_failure",
    });
    expect(mocks.transactionSet).not.toHaveBeenCalled();
  });

  it("reports unreadable sources as insufficient without spending AI budget", async () => {
    mocks.prepareSourceForTutor.mockRejectedValue(new Error("Unreadable file"));

    const response = await postSourceTutor(
      request({ sourceIds: ["source-1"], message: "Explain this." })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "insufficient",
      sourcesUsed: [],
      sourceFailures: [
        { id: "source-1", title: "Plant notes", reason: "Unreadable file" },
      ],
    });
    expect(mocks.checkAiBudget).not.toHaveBeenCalled();
    expect(mocks.generateGeminiText).not.toHaveBeenCalled();
  });

  it("reports only model-cited readable sources as used", async () => {
    mocks.generateGeminiText.mockResolvedValue(
      JSON.stringify({
        outcome: "grounded",
        answer: "Plants absorb light energy. [S1]",
        sourceRefs: ["S1"],
      })
    );

    const response = await postSourceTutor(
      request({
        sourceIds: ["source-1", "source-2"],
        message: "What do plants absorb?",
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "grounded",
      sourcesUsed: [{ id: "source-1", title: "Plant notes" }],
    });
    expect(mocks.transactionSet).toHaveBeenCalledOnce();
  });
});
