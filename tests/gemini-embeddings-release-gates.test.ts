import { describe, expect, it } from "vitest";
import { getConfiguredGeminiEmbeddingApiKey } from "@/lib/ai/gemini-embeddings";

function approved(overrides: Record<string, string | undefined> = {}) {
  return {
    GEMINI_API_KEY: " paid-key ",
    GEMINI_ENABLED: "true",
    GEMINI_PRIVACY_APPROVED: "true",
    GEMINI_QUALITY_GATE_PASSED: "true",
    GEMINI_KILL_SWITCH: "false",
    ...overrides,
  };
}

describe("Gemini embedding release gates", () => {
  it("returns the server key only after all shared Gemini gates pass", () => {
    expect(getConfiguredGeminiEmbeddingApiKey(approved())).toBe("paid-key");
  });

  it.each([
    ["missing key", { GEMINI_API_KEY: undefined }],
    ["provider disabled", { GEMINI_ENABLED: "false" }],
    ["privacy approval missing", { GEMINI_PRIVACY_APPROVED: "false" }],
    ["quality gate missing", { GEMINI_QUALITY_GATE_PASSED: "false" }],
    ["emergency kill switch", { GEMINI_KILL_SWITCH: "true" }],
  ])("fails closed when %s", (_label, overrides) => {
    expect(getConfiguredGeminiEmbeddingApiKey(approved(overrides))).toBeNull();
  });
});
