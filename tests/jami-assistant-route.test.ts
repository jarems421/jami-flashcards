import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import {
  captureStructuredLogs,
  expectRedactedLogs,
} from "./support/log-capture";

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
    checkBudget: vi.fn(),
    prepareSource: vi.fn(),
    generateText: vi.fn(),
    streamText: vi.fn(),
  };
});

vi.mock("@/services/firebase/admin", () => ({
  getAdminAuth: () => ({ verifyIdToken: mocks.verifyIdToken }),
  getAdminStorageBucket: () => ({
    file: vi.fn(() => ({ download: vi.fn() })),
  }),
}));

vi.mock("@/services/ai/assistant-context", () => ({
  JamiAssistantContextError: mocks.ContextError,
  resolveJamiAssistantContext: mocks.resolveContext,
}));

vi.mock("@/services/ai/budgets", () => ({
  checkAiBudget: mocks.checkBudget,
  createAiBudgetLimitResponse: (
    _action: string,
    decision: { reason: string; retryAfterSeconds: number }
  ) =>
    Response.json(
      {
        error:
          decision.reason === "burst_limit"
            ? "Jami is receiving requests too quickly. Try again in a moment."
            : "Jami has reached today's AI limit. Try again tomorrow.",
        code: decision.reason,
        retryAfterSeconds: decision.retryAfterSeconds,
      },
      {
        status: 429,
        headers:
          decision.reason === "burst_limit"
            ? { "Retry-After": String(decision.retryAfterSeconds) }
            : undefined,
      }
    ),
  getAiTokenCap: () => 8_000,
}));

vi.mock("@/lib/ai/source-ingestion", () => ({
  prepareSourceForTutor: mocks.prepareSource,
}));

vi.mock("@/lib/ai/gemini", () => ({
  generateGeminiText: mocks.generateText,
  // The route streams the first attempt and falls back to generateGeminiText
  // only when the structured output does not parse.
  streamGeminiText: async function* (...args: unknown[]) {
    const text: string = await mocks.streamText(...args);
    const size = Math.max(1, Math.ceil(text.length / 3));
    for (let at = 0; at < text.length; at += size) {
      yield text.slice(at, at + size);
    }
  },
}));

// No cleaner mock: the route uses the real cleanAiResponseText so these tests
// exercise the seam that previously flattened every reply.

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

/**
 * The route streams newline-delimited events. Text events carry the answer as
 * it generates; a single terminal event carries the validated receipt, or an
 * error raised after the response had already begun.
 */
async function readStream(response: Response) {
  const events = (await response.text())
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Record<string, unknown>);

  return {
    streamedText: events
      .filter((event) => event.type === "text")
      .map((event) => event.value as string)
      .join(""),
    terminal: events.find(
      (event) => event.type === "done" || event.type === "error"
    ) as Record<string, unknown> | undefined,
  };
}

beforeAll(async () => {
  process.env.GEMINI_API_KEY = "test-key";
  ({ POST: postAssistant } = await import("@/app/api/ai/assistant/route"));
}, 120_000);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyIdToken.mockResolvedValue({ uid: "user-1" });
  mocks.checkBudget.mockResolvedValue({
    allowed: true,
    reason: null,
    retryAfterSeconds: 0,
  });
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
  const validAnswer = JSON.stringify({
    answer: "Plants turn light energy into stored chemical energy.",
    sourceRefs: ["S1"],
    usedCurrentContext: true,
    usedGeneralKnowledge: true,
  });
  mocks.streamText.mockResolvedValue(validAnswer);
  mocks.generateText.mockResolvedValue(validAnswer);
});

describe("universal Jami assistant route", () => {
  it("returns a validated answer and exact per-response Used context", async () => {
    const response = await postAssistant(request(validBody()));
    const { streamedText, terminal } = await readStream(response);

    expect(response.status).toBe(200);
    expect(streamedText).toBe(
      "Plants turn light energy into stored chemical energy."
    );
    expect(terminal).toEqual({
      type: "done",
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
    expect(mocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        // Brief answers lead with the cheaper model and keep the other as the
        // fallback the stream uses if the first one is unavailable.
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
          systemInstruction: expect.stringMatching(
            /current context C1 is authoritative[\s\S]*valid TeX delimiters[\s\S]*BRIEF mode/
          ),
        }),
      })
    );
    const generationRequest = mocks.streamText.mock.calls[0]?.[0] as {
      request: { contents: Array<{ parts: Array<{ text?: string }> }> };
    };
    const finalParts = generationRequest.request.contents.at(-1)?.parts ?? [];
    const referenceOrder = finalParts
      .map((part) => part.text ?? "")
      .join("\n");
    expect(referenceOrder.indexOf("REFERENCE S1")).toBeLessThan(
      referenceOrder.indexOf("REFERENCE C1")
    );
    expect(referenceOrder.indexOf("REFERENCE C1")).toBeLessThan(
      referenceOrder.indexOf("GROUNDING PRIORITY")
    );
    expect(referenceOrder).toContain(
      "ignore it completely when it is about something else"
    );
  });

  it("returns the reply with its Markdown and LaTeX intact", async () => {
    mocks.streamText.mockResolvedValue(
      JSON.stringify({
        answer:
          "**Method**\n\n1. Differentiate: $f'(x) = 2x$\n2. Solve for $x_1$.\n\n$$\\frac{n(n+1)}{2}$$",
        sourceRefs: [],
        usedCurrentContext: true,
        usedGeneralKnowledge: false,
      })
    );

    const { terminal } = await readStream(
      await postAssistant(request(validBody()))
    );
    const body = terminal as { reply: string };

    expect(body.reply).toContain("**Method**");
    expect(body.reply).toContain("$f'(x) = 2x$");
    expect(body.reply).toContain("$x_1$");
    expect(body.reply).toContain("\\frac{n(n+1)}{2}");
  });

  it("uses the larger response budget only for an explicit depth request", async () => {
    await postAssistant(
      request(
        validBody({
          message: "Walk me through this in detail, step by step.",
        })
      )
    );

    expect(mocks.streamText).toHaveBeenCalledWith(
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
    expect(mocks.streamText).not.toHaveBeenCalled();
  });

  it("does not expose or continue with an unowned current context", async () => {
    mocks.resolveContext.mockRejectedValueOnce(
      new mocks.ContextError("This card could not be found.")
    );
    const response = await postAssistant(request(validBody()));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "context_not_found" });
    expect(mocks.checkBudget).not.toHaveBeenCalled();
    expect(mocks.streamText).not.toHaveBeenCalled();
  });

  it("rejects obviously oversized source selections before charging", async () => {
    mocks.resolveContext.mockResolvedValueOnce({
      currentId: "card-1",
      currentLabel: "Current card",
      currentParts: [{ text: "Card front and answer" }],
      sources: [
        {
          id: "source-large",
          title: "Large paper",
          type: "file",
          folderIds: [],
          topicIds: [],
          status: "active",
          createdBy: "user-1",
          createdAt: 1,
          updatedAt: 1,
          sizeBytes: 31 * 1024 * 1024,
        },
      ],
    });

    const response = await postAssistant(request(validBody()));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      code: "sources_too_large",
    });
    expect(mocks.checkBudget).not.toHaveBeenCalled();
    expect(mocks.prepareSource).not.toHaveBeenCalled();
  });

  it("rejects invented source references from the provider", async () => {
    const invalidAnswer = JSON.stringify({
      answer: "Unsupported answer.",
      sourceRefs: ["S9"],
      usedCurrentContext: false,
      usedGeneralKnowledge: true,
    });
    mocks.streamText.mockResolvedValue(invalidAnswer);
    mocks.generateText.mockResolvedValue(invalidAnswer);

    const response = await postAssistant(request(validBody()));
    const { terminal } = await readStream(response);

    // Once the response has started the status line is already sent, so a
    // failure after that point arrives as a terminal event rather than a code.
    expect(response.status).toBe(200);
    expect(terminal).toMatchObject({
      type: "error",
      code: "invalid_provider_response",
    });
    expect(mocks.streamText).toHaveBeenCalledTimes(1);
    expect(mocks.generateText).toHaveBeenCalledTimes(1);
  });

  it("retries one malformed structured response with the alternate model", async () => {
    mocks.streamText.mockResolvedValue('{"answer":"Incomplete');

    const response = await postAssistant(request(validBody()));
    const { terminal } = await readStream(response);

    expect(response.status).toBe(200);
    expect(terminal).toMatchObject({ type: "done" });
    expect(mocks.generateText).toHaveBeenCalledTimes(1);
    expect(mocks.generateText).toHaveBeenNthCalledWith(
      1,
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
    mocks.streamText.mockResolvedValueOnce(
      JSON.stringify({
        answer: "A general explanation.",
        sourceRefs: [],
        usedCurrentContext: false,
        usedGeneralKnowledge: true,
      })
    );
    const response = await postAssistant(request(validBody()));
    const { terminal } = await readStream(response);

    expect(response.status).toBe(200);
    expect(terminal).toEqual({
      type: "done",
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
    mocks.checkBudget.mockResolvedValueOnce({
      allowed: false,
      reason: "daily_limit",
      retryAfterSeconds: 4_000,
    });
    const response = await postAssistant(request(validBody()));
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      code: "daily_limit",
      retryAfterSeconds: 4_000,
    });
    expect(mocks.prepareSource).not.toHaveBeenCalled();
    expect(mocks.streamText).not.toHaveBeenCalled();
  });

  it("returns retry timing for a burst rejection", async () => {
    mocks.checkBudget.mockResolvedValueOnce({
      allowed: false,
      reason: "burst_limit",
      retryAfterSeconds: 12,
    });

    const response = await postAssistant(request(validBody()));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("12");
    await expect(response.json()).resolves.toMatchObject({
      code: "burst_limit",
      retryAfterSeconds: 12,
    });
    expect(mocks.prepareSource).not.toHaveBeenCalled();
    expect(mocks.streamText).not.toHaveBeenCalled();
  });

  it("fails closed when the budget store cannot be reached", async () => {
    mocks.checkBudget.mockRejectedValueOnce(new Error("Firestore unavailable"));

    const response = await postAssistant(request(validBody()));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "budget_unavailable",
    });
    expect(mocks.prepareSource).not.toHaveBeenCalled();
    expect(mocks.streamText).not.toHaveBeenCalled();
  });

  /**
   * The logger redacts by field name, which is only worth anything if the route
   * actually routes its logs through it. This drives a real request whose every
   * moving part carries recognisable student text, then reads back what was
   * written.
   */
  it("logs a correlated request without writing student work to the log", async () => {
    mocks.prepareSource.mockRejectedValue(
      new Error("This source could not be read.")
    );
    mocks.streamText.mockRejectedValue(
      Object.assign(new Error("Gemini is overloaded"), { status: 503 })
    );

    const { records, lines } = await captureStructuredLogs(async () =>
      readStream(
        await postAssistant(
          request(
            validBody({ message: "Explain SECRET_STUDENT_QUESTION to me." })
          )
        )
      )
    );

    expectRedactedLogs({
      records,
      lines,
      route: "ai.assistant",
      // The unreadable source and the provider failure are one story.
      events: ["source.prepare_failed", "provider.failed"],
      studentText: [
        "SECRET_STUDENT_QUESTION",
        "Biology notes",
        "Plants capture light energy.",
        "Card front and answer",
      ],
    });

    const failure = records.find((record) => record.event === "provider.failed");
    expect(failure?.error).toMatchObject({ status: 503 });
    expect(failure?.uid).toBe("user-1");
  });
});
