import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  class ContextError extends Error {
    readonly status: number;
    readonly code: string;

    constructor(message: string, status = 404, code = "context_not_found") {
      super(message);
      this.status = status;
      this.code = code;
    }
  }

  return {
    ContextError,
    verifyIdToken: vi.fn(async () => ({ uid: "user-1" })),
    resolveContext: vi.fn(),
    checkBudget: vi.fn(async () => true),
    prepareSource: vi.fn(),
    generateText: vi.fn(),
  };
});

vi.mock("@/services/firebase/admin", () => ({
  getAdminAuth: () => ({ verifyIdToken: mocks.verifyIdToken }),
  getAdminStorageBucket: () => ({
    file: vi.fn(() => ({ download: vi.fn() })),
  }),
}));

vi.mock("@/lib/ai/assistant-context.server", () => ({
  JamiAssistantContextError: mocks.ContextError,
  resolveJamiAssistantContext: mocks.resolveContext,
}));

vi.mock("@/lib/ai/budgets", () => ({
  checkAiBudget: mocks.checkBudget,
  getAiTokenCap: () => 8_000,
}));

vi.mock("@/lib/ai/source-ingestion", () => ({
  prepareSourceForTutor: mocks.prepareSource,
}));

vi.mock("@/lib/ai/gemini", () => ({
  generateGeminiText: mocks.generateText,
}));

vi.mock("@/lib/ai/card-autocomplete", () => ({
  cleanGeneratedStudyText: (value: string) => value.trim(),
}));

let postAssistant: (request: NextRequest) => Promise<Response>;

function request(
  body: Record<string, unknown>,
  authorization = "Bearer test-token"
) {
  return new Request("http://localhost/api/ai/assistant", {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    message: "Help me understand this.",
    history: [],
    context: { surface: "learn", cardId: "card-1", phase: "answer" },
    useRelatedSources: true,
    ...overrides,
  };
}

beforeAll(async () => {
  process.env.GEMINI_API_KEY = "test-key";
  ({ POST: postAssistant } = await import("@/app/api/ai/assistant/route"));
}, 120_000);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyIdToken.mockResolvedValue({ uid: "user-1" });
  mocks.checkBudget.mockResolvedValue(true);
  mocks.resolveContext.mockResolvedValue({
    currentId: "card-1",
    currentLabel: "Current card",
    currentParts: [{ text: "Card front and answer" }],
    sources: [
      {
        id: "source-1",
        title: "Biology notes",
        type: "manual_note",
        folderIds: [],
        topicIds: [],
        contentText: "Plants capture light energy.",
        status: "active",
        createdBy: "user-1",
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  });
  mocks.prepareSource.mockResolvedValue({
    sourceId: "source-1",
    label: "Biology notes",
    inputBytes: 100,
    parts: [{ text: "Plants capture light energy." }],
  });
  mocks.generateText.mockResolvedValue(
    JSON.stringify({
      answer: "Plants turn light energy into stored chemical energy.",
      sourceRefs: ["S1"],
      usedCurrentContext: true,
      usedGeneralKnowledge: true,
    })
  );
});

describe("universal Jami assistant route", () => {
  it("returns a validated answer and exact per-response Used context", async () => {
    const response = await postAssistant(request(validBody()));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      reply: "Plants turn light energy into stored chemical energy.",
      used: [
        { kind: "current-context", id: "card-1", label: "Current card" },
        { kind: "source", id: "source-1", label: "Biology notes" },
        { kind: "general-knowledge", label: "general knowledge" },
      ],
      followUps: [
        { label: "Explain more", prompt: "Explain that in more detail." },
      ],
    });
    expect(mocks.resolveContext).toHaveBeenCalledWith({
      uid: "user-1",
      message: "Help me understand this.",
      context: { surface: "learn", cardId: "card-1", phase: "answer" },
      useRelatedSources: true,
    });
    expect(mocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        modelNames: ["gemini-2.5-flash-lite", "gemini-2.5-flash"],
        generationConfig: expect.objectContaining({
          maxOutputTokens: 1_500,
          responseSchema: expect.objectContaining({
            required: [
              "answer",
              "sourceRefs",
              "usedCurrentContext",
              "usedGeneralKnowledge",
            ],
          }),
        }),
        request: expect.objectContaining({
          systemInstruction: expect.stringContaining("BRIEF mode"),
        }),
      })
    );
  });

  it("uses the larger response budget only for an explicit depth request", async () => {
    await postAssistant(
      request(
        validBody({
          message: "Walk me through this in detail, step by step.",
        })
      )
    );

    expect(mocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        modelNames: ["gemini-2.5-flash", "gemini-2.5-flash-lite"],
        generationConfig: expect.objectContaining({ maxOutputTokens: 6_000 }),
        request: expect.objectContaining({
          systemInstruction: expect.stringContaining("DETAILED mode"),
        }),
      })
    );
  });

  it("rejects unauthenticated and invalid surface requests before generation", async () => {
    mocks.verifyIdToken.mockRejectedValueOnce(new Error("expired"));
    const unauthorized = await postAssistant(request(validBody()));
    expect(unauthorized.status).toBe(401);

    const invalid = await postAssistant(
      request(validBody({ context: { surface: "goals", id: "goal-1" } }))
    );
    expect(invalid.status).toBe(400);
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("does not expose or continue with an unowned current context", async () => {
    mocks.resolveContext.mockRejectedValueOnce(
      new mocks.ContextError("This card could not be found.")
    );
    const response = await postAssistant(request(validBody()));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "context_not_found" });
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("rejects invented source references from the provider", async () => {
    const invalidAnswer = JSON.stringify({
      answer: "Unsupported answer.",
      sourceRefs: ["S9"],
      usedCurrentContext: false,
      usedGeneralKnowledge: true,
    });
    mocks.generateText
      .mockResolvedValueOnce(invalidAnswer)
      .mockResolvedValueOnce(invalidAnswer);
    const response = await postAssistant(request(validBody()));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      code: "invalid_provider_response",
    });
    expect(mocks.generateText).toHaveBeenCalledTimes(2);
  });

  it("retries one malformed structured response with the alternate model", async () => {
    mocks.generateText.mockResolvedValueOnce('{"answer":"Incomplete');

    const response = await postAssistant(request(validBody()));

    expect(response.status).toBe(200);
    expect(mocks.generateText).toHaveBeenCalledTimes(2);
    expect(mocks.generateText).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        modelNames: ["gemini-2.5-flash"],
        generationConfig: expect.objectContaining({ maxOutputTokens: 8_000 }),
        request: expect.objectContaining({
          systemInstruction: expect.stringContaining(
            "This is a structured-output retry"
          ),
        }),
      })
    );
  });

  it("can answer from general knowledge when a related source is unreadable", async () => {
    mocks.prepareSource.mockRejectedValueOnce(new Error("Unreadable file"));
    mocks.generateText.mockResolvedValueOnce(
      JSON.stringify({
        answer: "A general explanation.",
        sourceRefs: [],
        usedCurrentContext: false,
        usedGeneralKnowledge: true,
      })
    );
    const response = await postAssistant(request(validBody()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      reply: "A general explanation.",
      used: [{ kind: "general-knowledge", label: "general knowledge" }],
      followUps: [
        { label: "Explain more", prompt: "Explain that in more detail." },
      ],
      sourceFailures: [
        {
          id: "source-1",
          title: "Biology notes",
          reason: "Unreadable file",
        },
      ],
    });
  });

  it("enforces the transactional daily budget before provider work", async () => {
    mocks.checkBudget.mockResolvedValueOnce(false);
    const response = await postAssistant(request(validBody()));
    expect(response.status).toBe(429);
    expect(mocks.prepareSource).not.toHaveBeenCalled();
    expect(mocks.generateText).not.toHaveBeenCalled();
  });
});
