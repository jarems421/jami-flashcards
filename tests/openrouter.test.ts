import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  buildOpenRouterRequestBody,
  generateOpenRouterText,
  streamOpenRouterText,
} = await import("@/lib/ai/openrouter");

const baseInput = {
  apiKey: "test-key",
  model: "xiaomi/mimo-v2.5",
  providerAllowlist: ["Xiaomi", "Parasail"],
  quantizations: ["fp32", "fp16", "bf16", "fp8"],
  request: {
    systemInstruction: "Teach clearly.",
    contents: [{
      role: "user" as const,
      parts: [{ text: "Explain mitosis." }],
    }],
  },
  timeoutMs: 5_000,
  reasoning: false,
};

function streamResponse(events: string[]) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(event));
      controller.close();
    },
  }), { status: 200 });
}

async function collect(generator: AsyncGenerator<string, void, unknown>) {
  const chunks: string[] = [];
  for await (const chunk of generator) chunks.push(chunk);
  return chunks.join("");
}

describe("OpenRouter adapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("always builds the mandatory privacy and endpoint restrictions", () => {
    const body = buildOpenRouterRequestBody(baseInput, false);
    expect(body.provider).toEqual({
      only: ["Xiaomi", "Parasail"],
      allow_fallbacks: true,
      require_parameters: true,
      data_collection: "deny",
      zdr: true,
      quantizations: ["fp32", "fp16", "bf16", "fp8"],
    });
    expect(body.model).toBe("xiaomi/mimo-v2.5");
    expect(body).not.toHaveProperty("models");
  });

  it("refuses calls without an explicit provider allowlist", () => {
    expect(() => buildOpenRouterRequestBody({
      ...baseInput,
      providerAllowlist: [],
    }, false)).toThrow(/allowlist/i);
  });

  it("refuses calls without an explicit precision allowlist", () => {
    expect(() => buildOpenRouterRequestBody({
      ...baseInput,
      quantizations: [],
    }, false)).toThrow(/precision allowlist/i);
  });

  it("converts Gemini-style schemas into strict OpenRouter structured output", () => {
    const body = buildOpenRouterRequestBody({
      ...baseInput,
      json: true,
      jsonSchema: {
        type: "OBJECT",
        properties: {
          answer: { type: "STRING" },
          sources: {
            type: "ARRAY",
            items: { type: "STRING", format: "enum", enum: ["S1"] },
          },
        },
        required: ["answer", "sources"],
      },
    }, false);
    expect((body as { response_format?: unknown }).response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "jami_response",
        strict: true,
        schema: {
          type: "object",
          properties: {
            answer: { type: "string" },
            sources: {
              type: "array",
              items: { type: "string", enum: ["S1"] },
            },
          },
          required: ["answer", "sources"],
          additionalProperties: false,
        },
      },
    });
  });

  it("normalises images but rejects raw PDF/document input", () => {
    const imageBody = buildOpenRouterRequestBody({
      ...baseInput,
      request: {
        contents: [{
          role: "user",
          parts: [{ inlineData: { mimeType: "image/png", data: "YWJj" } }],
        }],
      },
    }, false);
    expect(imageBody.messages[0].content[0]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,YWJj" },
    });
    expect(() => buildOpenRouterRequestBody({
      ...baseInput,
      request: {
        contents: [{
          role: "user",
          parts: [{ inlineData: { mimeType: "application/pdf", data: "YWJj" } }],
        }],
      },
    }, false)).toThrow(/Parse documents/i);
  });

  it("returns buffered text and content-free usage diagnostics", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        provider: "Xiaomi",
        choices: [{ message: { content: "Cell division explained." } }],
        usage: {
          prompt_tokens: 20,
          completion_tokens: 5,
          total_tokens: 25,
          cost: 0.00001,
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    );
    const onUsage = vi.fn();
    const onProvider = vi.fn();
    await expect(generateOpenRouterText({
      ...baseInput,
      onUsage,
      onProvider,
    })).resolves.toBe("Cell division explained.");
    expect(onUsage).toHaveBeenCalledWith({
      promptTokens: 20,
      completionTokens: 5,
      totalTokens: 25,
      estimatedCostUsd: 0.00001,
    });
    expect(onProvider).toHaveBeenCalledWith("Xiaomi");
    const init = fetchMock.mock.calls[0][1];
    expect(init?.cache).toBe("no-store");
    expect(new Headers(init?.headers).get("X-OpenRouter-Cache")).toBe("false");
  });

  it("parses SSE comments, CRLF boundaries, chunks, and terminal usage", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(streamResponse([
      ": OPENROUTER PROCESSING\r\n\r\n",
      "data: {\"provider\":\"Xiaomi\",\"choices\":[{\"delta\":{\"content\":\"Hello \"}}]}\r\n\r\n",
      "data: {\"choices\":[{\"delta\":{\"content\":\"world\"}}],\"usage\":{\"prompt_tokens\":2,\"completion_tokens\":2,\"total_tokens\":4,\"cost\":0.1}}\r\n\r\n",
      "data: [DONE]\r\n\r\n",
    ]));
    const onUsage = vi.fn();
    await expect(collect(streamOpenRouterText({
      ...baseInput,
      onUsage,
    }))).resolves.toBe("Hello world");
    expect(onUsage).toHaveBeenCalledWith({
      promptTokens: 2,
      completionTokens: 2,
      totalTokens: 4,
      estimatedCostUsd: 0.1,
    });
  });

  it("treats a successful but empty stream as a retryable provider failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(streamResponse([
      "data: {\"choices\":[{\"delta\":{}}],\"usage\":{\"total_tokens\":1}}\n\n",
      "data: [DONE]\n\n",
    ]));
    await expect(collect(streamOpenRouterText(baseInput))).rejects.toThrow(
      /empty response/i
    );
  });

  it("does not echo a provider error response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        error: {
          message: "private student prompt appeared here",
          metadata: { error_type: "rate_limit_exceeded" },
        },
      }), { status: 429, headers: { "Content-Type": "application/json" } })
    );
    await expect(generateOpenRouterText(baseInput)).rejects.toMatchObject({
      message: "OpenRouter request failed with status 429.",
      status: 429,
      errorType: "rate_limit_exceeded",
    });
  });
});

/**
 * Thinking tokens are still tokens: they spend the output budget and the clock,
 * and `exclude: true` only keeps them out of the reply. Asking for reasoning
 * with no ceiling let the paper design pass spend a full 600-second timeout
 * thinking and return nothing, three runs in a row, while the same model and
 * provider answered the same prompt in one to three seconds with effort capped.
 */
describe("how hard a model is allowed to think", () => {
  const SSE = ['data: {"choices":[{"delta":{"content":"hi"}}]}\n\n', "data: [DONE]\n\n"];
  // The most recent call, not the first: the fetch spy accumulates across the
  // tests in this file, so calls[0] belongs to whichever ran earliest.
  const bodyOf = (mock: ReturnType<typeof vi.spyOn>) =>
    JSON.parse(String((mock.mock.calls.at(-1)?.[1] as RequestInit)?.body ?? "{}"));

  it("bounds reasoning by default rather than leaving it open", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(streamResponse(SSE));
    await collect(streamOpenRouterText({ ...baseInput, reasoning: true }));
    expect(bodyOf(fetchMock).reasoning).toEqual({
      enabled: true,
      exclude: true,
      effort: "medium",
    });
  });

  it("lets a caller ask for more, but only deliberately", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(streamResponse(SSE));
    await collect(streamOpenRouterText({ ...baseInput, reasoning: true, reasoningEffort: "high" }));
    expect(bodyOf(fetchMock).reasoning.effort).toBe("high");
  });

  /** A role that does not reason must not be sent a reasoning budget at all. */
  it("sends nothing when the role does not reason", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(streamResponse(SSE));
    await collect(streamOpenRouterText({ ...baseInput, reasoning: false }));
    expect(bodyOf(fetchMock).reasoning).toBeUndefined();
  });
});
