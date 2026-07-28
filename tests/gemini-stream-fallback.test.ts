import { beforeEach, describe, expect, it, vi } from "vitest";

const generateContentStream = vi.fn();
const getGenerativeModel = vi.fn(() => ({ generateContentStream }));

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel = getGenerativeModel;
  },
}));

vi.mock("server-only", () => ({}));

const { streamGeminiText } = await import("@/lib/ai/gemini");

/** A provider result that yields the given chunks and then finishes. */
function streamOf(chunks: string[]) {
  return {
    stream: (async function* () {
      for (const text of chunks) yield { text: () => text };
    })(),
    response: Promise.resolve({ candidates: [{ finishReason: "STOP" }] }),
  };
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
    getGenerativeModel.mockClear();
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
    expect(getGenerativeModel).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ model: "gemini-2.5-flash-lite" })
    );
    expect(getGenerativeModel).toHaveBeenNthCalledWith(
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
    generateContentStream.mockReturnValueOnce({
      stream: (async function* () {
        yield { text: () => "Partial answer" };
        throw overloaded();
      })(),
      response: Promise.resolve({ candidates: [] }),
    });

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
    expect(getGenerativeModel).toHaveBeenCalledTimes(1);
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
    expect(getGenerativeModel).toHaveBeenCalledTimes(2);
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
    expect(getGenerativeModel).toHaveBeenCalledTimes(1);
  });
});
