import { beforeEach, describe, expect, it, vi } from "vitest";

const generateContent = vi.fn();
const generateContentStream = vi.fn();
const getGenerativeModel = vi.fn(() => ({
  generateContent,
  generateContentStream,
}));

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel = getGenerativeModel;
  },
}));

vi.mock("server-only", () => ({}));

const { generateGeminiText, streamGeminiText } = await import(
  "@/lib/ai/gemini"
);

function overloaded() {
  return Object.assign(new Error("[503] model is overloaded"), { status: 503 });
}

/** A call that never settles until the signal it was handed aborts. */
function hangs() {
  return (_request: unknown, options: { signal: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener(
        "abort",
        () => reject(new Error("aborted")),
        { once: true }
      );
    });
}

async function drain(generator: AsyncGenerator<string, void, unknown>) {
  const out: string[] = [];
  for await (const chunk of generator) out.push(chunk);
  return out;
}

const baseInput = {
  apiKey: "test-key",
  request: { contents: [] },
  timeoutMs: 5_000,
  modelNames: ["first", "second"] as const,
};

describe("the whole call is bounded, not each attempt", () => {
  beforeEach(() => {
    generateContent.mockReset();
    generateContentStream.mockReset();
    getGenerativeModel.mockClear();
  });

  it("cuts an attempt short at the deadline rather than its own timeout", async () => {
    /*
     * The timeout used to be armed per attempt, so a two-model ladder could
     * keep a reader waiting for twice it with nothing on screen. Each attempt
     * now gets whatever is left of one shared deadline, and the ladder stops
     * when that runs out -- one bounded wait rather than one per model.
     */
    generateContent.mockImplementation(hangs());

    const started = Date.now();
    await expect(
      generateGeminiText({
        ...baseInput,
        timeoutMs: 10_000,
        deadlineAt: started + 60,
      })
    ).rejects.toThrow("Request timed out");

    // Bounded by the deadline, nowhere near the ten seconds the attempt asked
    // for, and not doubled by the second model.
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("stops laddering once the deadline has passed", async () => {
    generateContent.mockRejectedValueOnce(overloaded());

    await expect(
      generateGeminiText({
        ...baseInput,
        deadlineAt: Date.now() - 1,
      })
    ).rejects.toThrow();

    // Not even the first model is tried: there is no time to try it in.
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("still falls back normally when there is time to spare", async () => {
    generateContent.mockRejectedValueOnce(overloaded());
    generateContent.mockResolvedValueOnce({
      response: { text: () => "second", candidates: [], usageMetadata: null },
    });

    await expect(
      generateGeminiText({ ...baseInput, deadlineAt: Date.now() + 30_000 })
    ).resolves.toBe("second");
    expect(generateContent).toHaveBeenCalledTimes(2);
  });
});

describe("a caller who has gone away stops the work", () => {
  beforeEach(() => {
    generateContent.mockReset();
    generateContentStream.mockReset();
    getGenerativeModel.mockClear();
  });

  it("aborts the provider call and does not try the next model", async () => {
    const cancellation = new AbortController();
    generateContent.mockImplementationOnce(hangs());

    const pending = generateGeminiText({
      ...baseInput,
      signal: cancellation.signal,
    });
    cancellation.abort("client_gone");

    await expect(pending).rejects.toThrow();
    // An abandoned request is not a provider fault, so nothing is retried.
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("stops a stream before it has yielded anything", async () => {
    const cancellation = new AbortController();
    generateContentStream.mockImplementationOnce(hangs());

    const pending = drain(
      streamGeminiText({ ...baseInput, signal: cancellation.signal })
    );
    setTimeout(() => cancellation.abort("client_gone"), 0);

    await expect(pending).rejects.toThrow();
    // Normally a failure before the first chunk would fall to the second
    // model. A reader who left is not a failure, so nothing is retried.
    expect(generateContentStream).toHaveBeenCalledTimes(1);
  });
});
