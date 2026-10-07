import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * What the router hands each provider, and what it reports back.
 *
 * The routing tests next door pin which endpoint and model each attempt uses.
 * These pin the requests themselves -- the Gemini path, the streamed paths and
 * the diagnostics every successful call reports -- which every caller of the
 * router depends on and none of them checks.
 */

const mocks = vi.hoisted(() => ({
  generateOpenRouterText: vi.fn(),
  streamOpenRouterText: vi.fn(),
  generateGeminiText: vi.fn(),
  streamGeminiText: vi.fn(),
}));

vi.mock("@/lib/ai/openrouter", () => ({
  generateOpenRouterText: mocks.generateOpenRouterText,
  streamOpenRouterText: mocks.streamOpenRouterText,
}));
vi.mock("@/lib/ai/gemini", () => ({
  generateGeminiText: mocks.generateGeminiText,
  streamGeminiText: mocks.streamGeminiText,
}));

const { generateAiText, generateAiTextBufferedStream, streamAiText } = await import(
  "@/lib/ai/provider-router"
);

const request = {
  systemInstruction: "Be brief.",
  contents: [{ role: "user" as const, parts: [{ text: "Check this." }] }],
};

async function* chunks(...parts: string[]) {
  for (const part of parts) yield part;
}

async function* failing(message: string, ...before: string[]): AsyncGenerator<string> {
  for (const part of before) yield part;
  throw new Error(message);
}

async function collect(stream: AsyncIterable<string>) {
  const out: string[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(process.env, {
    OPENROUTER_API_KEY: "openrouter-key",
    OPENROUTER_ENABLED: "true",
    OPENROUTER_PRIVACY_APPROVED: "true",
    OPENROUTER_QUALITY_GATE_PASSED: "true",
    OPENROUTER_KILL_SWITCH: "false",
    OPENROUTER_JUROR_KILL_SWITCH: "false",
    GEMINI_API_KEY: "gemini-key",
    GEMINI_ENABLED: "true",
    GEMINI_PRIVACY_APPROVED: "true",
    GEMINI_QUALITY_GATE_PASSED: "true",
    GEMINI_KILL_SWITCH: "false",
  });
});

describe("an OpenRouter call", () => {
  it("is sent with the role's limits, and reports its usage and endpoint", async () => {
    mocks.generateOpenRouterText.mockImplementation(async (input) => {
      input.onUsage({ promptTokens: 120, completionTokens: 30, totalTokens: 150, estimatedCostUsd: 0.002 });
      input.onProvider("coreweave");
      return "an answer";
    });
    const responses: unknown[] = [];

    await expect(
      generateAiText({
        role: "supervisor",
        routeReason: "routine",
        request,
        timeoutMs: 5_000,
        reasoningEffort: "high",
        generationConfig: {
          temperature: 0.3,
          topP: 0.9,
          maxOutputTokens: 1_000_000,
          responseMimeType: "application/json",
          responseSchema: { type: "object" },
        },
        onResponse: (info) => responses.push(info),
      })
    ).resolves.toBe("an answer");

    const sent = mocks.generateOpenRouterText.mock.calls[0][0];
    expect(sent).toMatchObject({
      apiKey: "openrouter-key",
      model: "qwen/qwen3.6-35b-a3b",
      request,
      timeoutMs: 5_000,
      reasoningEffort: "high",
      temperature: 0.3,
      topP: 0.9,
      json: true,
      jsonSchema: { type: "object" },
    });
    // Capped at the role's ceiling, whatever the caller asked for.
    expect(sent.maxOutputTokens).toBeLessThan(1_000_000);
    expect(responses).toEqual([
      expect.objectContaining({
        provider: "openrouter",
        role: "supervisor",
        routeReason: "routine",
        modelName: "qwen/qwen3.6-35b-a3b",
        providerEndpoint: "coreweave",
        promptTokenCount: 120,
        candidatesTokenCount: 30,
        totalTokenCount: 150,
        estimatedCostUsd: 0.002,
        latencyMs: expect.any(Number),
      }),
    ]);
  });

  it("goes only to an override the role approves as a failover", async () => {
    mocks.generateOpenRouterText.mockResolvedValue("ok");
    await generateAiText({ role: "supervisor", request, timeoutMs: 5_000, providerOverride: ["parasail"] });
    expect(mocks.generateOpenRouterText.mock.calls[0][0].providerAllowlist).toEqual(["parasail"]);

    mocks.generateOpenRouterText.mockClear();
    await expect(
      generateAiText({ role: "supervisor", request, timeoutMs: 5_000, providerOverride: ["somewhere-else"] })
    ).rejects.toThrow("is not an approved failover");
    expect(mocks.generateOpenRouterText).not.toHaveBeenCalled();
  });
});

describe("a Gemini call", () => {
  it("is sent with the role's limits, and reports what Gemini measured", async () => {
    mocks.generateGeminiText.mockImplementation(async (input) => {
      input.onResponse({
        modelName: "gemini-served",
        promptTokenCount: 50,
        candidatesTokenCount: 20,
        totalTokenCount: 90,
        thoughtsTokenCount: 15,
        toolUsePromptTokenCount: 5,
        finishReason: "STOP",
      });
      return "researched";
    });
    const responses: unknown[] = [];
    const signal = new AbortController().signal;

    await expect(
      generateAiText({
        role: "research",
        routeReason: "routine",
        request,
        timeoutMs: 7_000,
        signal,
        generationConfig: { temperature: 0.1, maxOutputTokens: 1_000_000 },
        onResponse: (info) => responses.push(info),
      })
    ).resolves.toBe("researched");

    const sent = mocks.generateGeminiText.mock.calls[0][0];
    expect(sent).toMatchObject({
      apiKey: "gemini-key",
      request,
      timeoutMs: 7_000,
      signal,
      generationConfig: { temperature: 0.1 },
      modelNames: [expect.any(String)],
    });
    expect(sent.generationConfig.maxOutputTokens).toBeLessThan(1_000_000);
    expect(responses).toEqual([
      expect.objectContaining({
        provider: "gemini",
        role: "research",
        routeReason: "routine",
        modelName: "gemini-served",
        promptTokenCount: 50,
        candidatesTokenCount: 20,
        totalTokenCount: 90,
        thoughtsTokenCount: 15,
        toolUsePromptTokenCount: 5,
        finishReason: "STOP",
      }),
    ]);
  });

  it("streams through the same request", async () => {
    mocks.streamGeminiText.mockImplementation((input) => {
      input.onResponse({ modelName: "gemini-served", finishReason: "STOP" });
      return chunks("res", "earch");
    });
    const responses: unknown[] = [];

    const out = await collect(
      streamAiText({ role: "research", request, timeoutMs: 7_000, onResponse: (info) => responses.push(info) })
    );

    expect(out).toEqual(["res", "earch"]);
    expect(mocks.streamGeminiText.mock.calls[0][0]).toMatchObject({
      apiKey: "gemini-key",
      request,
      timeoutMs: 7_000,
      modelNames: [expect.any(String)],
    });
    expect(responses).toEqual([expect.objectContaining({ provider: "gemini", modelName: "gemini-served" })]);
  });
});

describe("a streamed answer", () => {
  it("hands each piece on as it arrives, then reports the call", async () => {
    mocks.streamOpenRouterText.mockImplementation((input) => {
      input.onUsage({ promptTokens: 10, completionTokens: 4, totalTokens: 14 });
      return chunks("Hel", "lo");
    });
    const responses: unknown[] = [];

    const out = await collect(
      streamAiText({ role: "supervisor", request, timeoutMs: 5_000, onResponse: (info) => responses.push(info) })
    );

    expect(out).toEqual(["Hel", "lo"]);
    expect(mocks.streamOpenRouterText.mock.calls[0][0]).toMatchObject({
      apiKey: "openrouter-key",
      model: "qwen/qwen3.6-35b-a3b",
      providerAllowlist: ["coreweave", "siliconflow", "akashml"],
    });
    expect(responses).toEqual([
      expect.objectContaining({ provider: "openrouter", promptTokenCount: 10, totalTokenCount: 14 }),
    ]);
  });

  it("moves to the next endpoint when one fails before saying anything", async () => {
    mocks.streamOpenRouterText
      .mockImplementationOnce(() => failing("coreweave down"))
      .mockImplementationOnce(() => chunks("from the failover"));
    const retries: string[] = [];

    const out = await collect(
      streamAiText({
        role: "supervisor",
        request,
        timeoutMs: 5_000,
        onRetry: (info) => retries.push(`${info.provider}:${info.modelName}->${info.nextModelName}`),
      })
    );

    expect(out).toEqual(["from the failover"]);
    expect(retries).toEqual(["openrouter:qwen/qwen3.6-35b-a3b->qwen/qwen3.6-35b-a3b"]);
  });

  it("does not start again elsewhere once part of an answer has been shown", async () => {
    mocks.streamOpenRouterText.mockImplementationOnce(() => failing("cut off", "Half an"));

    await expect(
      collect(streamAiText({ role: "supervisor", request, timeoutMs: 5_000 }))
    ).rejects.toThrow("cut off");
    expect(mocks.streamOpenRouterText).toHaveBeenCalledTimes(1);
  });
});

describe("a buffered stream", () => {
  it("returns the whole answer, and fails over like a buffered call", async () => {
    mocks.streamOpenRouterText
      .mockImplementationOnce(() => failing("busy", "partial"))
      .mockImplementationOnce(() => chunks("whole ", "answer"));
    const responses: unknown[] = [];

    await expect(
      generateAiTextBufferedStream({
        role: "supervisor",
        request,
        timeoutMs: 5_000,
        onResponse: (info) => responses.push(info),
      })
    ).resolves.toBe("whole answer");
    expect(mocks.streamOpenRouterText).toHaveBeenCalledTimes(2);
    expect(responses).toHaveLength(1);
  });
});
