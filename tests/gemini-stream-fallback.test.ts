import { beforeEach, describe, expect, it, vi } from "vitest";

const generateContentStream = vi.fn();

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContentStream };
  },
}));

vi.mock("server-only", () => ({}));

const { streamGeminiText } = await import("@/lib/ai/gemini");

/** A provider result that yields the given chunks and then finishes. */
function streamOf(chunks: string[]) {
  return (async function* () {
    for (const text of chunks) {
      yield { text, candidates: [{ finishReason: "STOP" }] };
    }
  })();
}

function overloaded() {
  return Object.assign(new Error("[503] model is overloaded"), { status: 503 });
}

async function collect(generator: AsyncGenerator<string, void, unknown>) {
  const out: string[] = [];
  for await (const chunk of generator) out.push(chunk);
  return out;
}

const baseInput = {
  apiKey: "test-key",
  request: { contents: [] },
  timeoutMs: 5_000,
};

describe("streamGeminiText model fallback", () => {
  beforeEach(() => {
    generateContentStream.mockReset();
  });

  it("falls back to the next model when the first is overloaded", async () => {
    generateContentStream
      .mockRejectedValueOnce(overloaded())
      .mockResolvedValueOnce(streamOf(["Hello ", "world"]));

    const onRetry = vi.fn();
    const chunks = await collect(
      streamGeminiText({
        ...baseInput,
        modelNames: ["gemini-2.5-flash-lite", "gemini-2.5-flash"],
        onRetry,
      })
    );

    expect(chunks.join("")).toBe("Hello world");
    expect(generateContentStream).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ model: "gemini-2.5-flash-lite" })
    );
    expect(generateContentStream).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ model: "gemini-2.5-flash" })
    );
    expect(onRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        modelName: "gemini-2.5-flash-lite",
        nextModelName: "gemini-2.5-flash",
      })
    );
  });

  it("does not fall back once text has reached the student", async () => {
    generateContentStream.mockReturnValueOnce(
      (async function* () {
        yield { text: "Partial answer" };
        throw overloaded();
      })()
    );

    const received: string[] = [];
    await expect(
      (async () => {
        for await (const chunk of streamGeminiText({
          ...baseInput,
          modelNames: ["gemini-2.5-flash-lite", "gemini-2.5-flash"],
        })) {
          received.push(chunk);
        }
      })()
    ).rejects.toThrow(/overloaded/);

    expect(received).toEqual(["Partial answer"]);
    expect(generateContentStream).toHaveBeenCalledTimes(1);
  });

  it("gives up when every model fails", async () => {
    generateContentStream
      .mockRejectedValueOnce(overloaded())
      .mockRejectedValueOnce(overloaded());

    await expect(
      collect(
        streamGeminiText({
          ...baseInput,
          modelNames: ["gemini-2.5-flash-lite", "gemini-2.5-flash"],
        })
      )
    ).rejects.toThrow(/overloaded/);
    expect(generateContentStream).toHaveBeenCalledTimes(2);
  });

  it("does not retry an error the fallback cannot help with", async () => {
    generateContentStream.mockRejectedValueOnce(
      Object.assign(new Error("[400] bad request"), { status: 400 })
    );

    await expect(
      collect(
        streamGeminiText({
          ...baseInput,
          modelNames: ["gemini-2.5-flash-lite", "gemini-2.5-flash"],
        })
      )
    ).rejects.toThrow(/bad request/);
    expect(generateContentStream).toHaveBeenCalledTimes(1);
  });
});
