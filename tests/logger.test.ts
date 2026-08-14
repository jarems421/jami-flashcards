import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildLogRecord, createLogger } from "@/lib/observability/logger";

describe("buildLogRecord", () => {
  it("stamps the record with its own level, event, and time", () => {
    const record = buildLogRecord({
      level: "warn",
      event: "provider.model_fallback",
      fields: { modelName: "gemini-2.5-flash" },
      time: "2026-08-02T10:00:00.000Z",
    });

    expect(record).toEqual({
      level: "warn",
      event: "provider.model_fallback",
      time: "2026-08-02T10:00:00.000Z",
      modelName: "gemini-2.5-flash",
    });
  });

  it("does not let caller fields rewrite the record's identity", () => {
    const record = buildLogRecord({
      level: "error",
      event: "provider.failed",
      fields: { level: "debug", event: "something.else", time: "not a time" },
      time: "2026-08-02T10:00:00.000Z",
    });

    expect(record.level).toBe("error");
    expect(record.event).toBe("provider.failed");
    expect(record.time).toBe("2026-08-02T10:00:00.000Z");
  });

  it("drops undefined fields rather than logging empty keys", () => {
    const record = buildLogRecord({
      level: "info",
      event: "request.completed",
      fields: { deckId: undefined, draftCount: 0 },
    });

    expect("deckId" in record).toBe(false);
    expect(record.draftCount).toBe(0);
  });
});

describe("redaction", () => {
  it.each([
    "prompt",
    "systemInstruction",
    "front",
    "back",
    "answerText",
    "questionText",
    "contentText",
    "message",
    "title",
    "email",
    "apiKey",
    "authorization",
    "token",
    "uid",
    "userId",
  ])("redacts %s, whatever the call site passes", (key) => {
    const record = buildLogRecord({
      level: "info",
      event: "test",
      fields: { [key]: "a student's actual work" },
    });

    expect(record[key]).toBe("[redacted]");
  });

  it("matches key names case-insensitively", () => {
    const record = buildLogRecord({
      level: "info",
      event: "test",
      fields: { APIKey: "secret-value", Front: "photosynthesis" },
    });

    expect(record.APIKey).toBe("[redacted]");
    expect(record.Front).toBe("[redacted]");
  });

  it("keeps token counts, which are diagnostics rather than credentials", () => {
    const record = buildLogRecord({
      level: "info",
      event: "request.completed",
      fields: {
        promptTokenCount: 900,
        candidatesTokenCount: 120,
        totalTokenCount: 1_020,
        maxOutputTokens: 8_000,
      },
    });

    expect(record).toMatchObject({
      promptTokenCount: 900,
      candidatesTokenCount: 120,
      totalTokenCount: 1_020,
      maxOutputTokens: 8_000,
    });
  });

  it("redacts nested student work, not just top-level fields", () => {
    const record = buildLogRecord({
      level: "warn",
      event: "test",
      fields: {
        request: { contents: [{ parts: [{ text: "student notes" }] }] },
      },
    });

    expect(record.request).toEqual({ contents: "[redacted]" });
  });

  it("truncates long values so one field cannot swamp the line", () => {
    const record = buildLogRecord({
      level: "info",
      event: "test",
      fields: { sourceId: "x".repeat(600) },
    });

    expect(String(record.sourceId)).toHaveLength(512 + "…(+88)".length);
    expect(String(record.sourceId).endsWith("…(+88)")).toBe(true);
  });

  it("caps depth and array length instead of walking a whole payload", () => {
    const record = buildLogRecord({
      level: "info",
      event: "test",
      fields: {
        deep: { a: { b: { c: { d: { e: "too far" } } } } },
        wide: Array.from({ length: 25 }, (_, index) => index),
      },
    });

    expect(record.deep).toEqual({ a: { b: { c: { d: "[object]" } } } });
    expect(record.wide).toHaveLength(21);
    expect((record.wide as unknown[])[20]).toBe("…(+5)");
  });

  it("survives a circular payload rather than throwing inside the logger", () => {
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;

    expect(() =>
      JSON.stringify(
        buildLogRecord({ level: "error", event: "test", fields: { circular } })
      )
    ).not.toThrow();
  });
});

describe("error fields", () => {
  it("keeps a content-free error category and status", () => {
    const error = Object.assign(new Error("Gemini is overloaded"), {
      status: 503,
    });

    const record = buildLogRecord({
      level: "error",
      event: "provider.failed",
      fields: { error },
    });

    expect(record.error).toMatchObject({
      name: "Error",
      errorCategory: "upstream_failure",
      status: 503,
    });
    expect(JSON.stringify(record)).not.toContain("Gemini is overloaded");
  });

  it("describes a thrown non-Error instead of logging [object Object]", () => {
    const record = buildLogRecord({
      level: "error",
      event: "provider.failed",
      fields: { error: { reason: "nope" } },
    });

    expect(record.error).toEqual({ name: "NonError", errorCategory: "unknown" });
    expect(JSON.stringify(record)).not.toContain("[object Object]");
  });

  it("still redacts student work carried on a thrown non-Error", () => {
    const record = buildLogRecord({
      level: "error",
      event: "provider.failed",
      fields: { error: { front: "photosynthesis", status: 500 } },
    });

    expect(record.error).toEqual({
      name: "NonError",
      errorCategory: "unknown",
      status: 500,
    });
    expect(JSON.stringify(record)).not.toContain("photosynthesis");
  });
});

describe("createLogger", () => {
  const originalLogLevel = process.env.LOG_LEVEL;

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalLogLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = originalLogLevel;
    }
  });

  function parseCall(spy: ReturnType<typeof vi.spyOn>) {
    return JSON.parse(String(spy.mock.calls[0]?.[0]));
  }

  it("repeats its bindings on every record", () => {
    const log = createLogger({ route: "ai.assistant", requestId: "req-1" });
    log.warn("provider.model_fallback", { modelName: "gemini-2.5-flash" });

    expect(parseCall(vi.mocked(console.warn))).toMatchObject({
      route: "ai.assistant",
      requestId: "req-1",
      event: "provider.model_fallback",
      modelName: "gemini-2.5-flash",
    });
  });

  it("carries bindings through a child so a retry stays correlated", () => {
    const log = createLogger({ route: "ai.assistant", requestId: "req-1" });
    log.child({ uid: "user-1" }).error("provider.failed");

    expect(parseCall(vi.mocked(console.error))).toMatchObject({
      route: "ai.assistant",
      requestId: "req-1",
      uid: "[redacted]",
    });
  });

  it("writes one JSON line per record", () => {
    createLogger().info("request.completed", { durationMs: 12 });

    const line = String(vi.mocked(console.log).mock.calls[0]?.[0]);
    expect(line.includes("\n")).toBe(false);
    expect(JSON.parse(line).durationMs).toBe(12);
  });

  it("suppresses debug records unless LOG_LEVEL asks for them", () => {
    delete process.env.LOG_LEVEL;
    createLogger().debug("noisy");
    expect(console.log).not.toHaveBeenCalled();

    process.env.LOG_LEVEL = "debug";
    createLogger().debug("noisy");
    expect(console.log).toHaveBeenCalledTimes(1);
  });
});
