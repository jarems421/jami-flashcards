import { beforeEach, describe, expect, it, vi } from "vitest";

const generateContent = vi.fn();

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
}));
vi.mock("server-only", () => ({}));

const { generateGeminiImage, generateGroundedResearch } = await import(
  "@/lib/ai/gemini"
);

const trackedEnv = [
  "GEMINI_API_KEY",
  "GEMINI_ENABLED",
  "GEMINI_PRIVACY_APPROVED",
  "GEMINI_QUALITY_GATE_PASSED",
  "GEMINI_KILL_SWITCH",
  "AI_WEB_RESEARCH_ENABLED",
  "AI_TUTOR_IMAGES_ENABLED",
  "AI_PAPER_IMAGES_ENABLED",
] as const;
const originalEnv = Object.fromEntries(
  trackedEnv.map((key) => [key, process.env[key]])
);

describe("Gemini specialists", () => {
  beforeEach(() => {
    generateContent.mockReset();
    for (const key of trackedEnv) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_ENABLED = "true";
    process.env.GEMINI_PRIVACY_APPROVED = "true";
    process.env.GEMINI_QUALITY_GATE_PASSED = "true";
  });

  it("fails grounded research gracefully when its release gate is closed", async () => {
    await expect(generateGroundedResearch({
      sanitizedQuery: "AQA GCSE biology mitosis specification",
    })).resolves.toEqual({ ok: false, reason: "not_configured" });
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("uses Search and URL Context and returns citations", async () => {
    process.env.AI_WEB_RESEARCH_ENABLED = "true";
    generateContent.mockResolvedValueOnce({
      text: "Verified course evidence.",
      candidates: [{
        groundingMetadata: {
          groundingChunks: [{
            web: { title: "Official specification", uri: "https://example.edu/spec" },
          }],
        },
        urlContextMetadata: {
          urlMetadata: [{ retrievedUrl: "https://example.edu/module" }],
        },
      }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, totalTokenCount: 14 },
    });
    await expect(generateGroundedResearch({
      sanitizedQuery: "university module exam format",
      urls: ["https://example.edu/module", "http://localhost/private"],
    })).resolves.toMatchObject({
      ok: true,
      brief: "Verified course evidence.",
      citations: [
        { title: "Official specification", url: "https://example.edu/spec" },
        { title: "https://example.edu/module", url: "https://example.edu/module" },
      ],
    });
    const params = generateContent.mock.calls[0][0];
    expect(params.model).toBe("gemini-3.5-flash-lite");
    expect(params.config.tools).toEqual([{ googleSearch: {} }, { urlContext: {} }]);
    expect(JSON.stringify(params.contents)).not.toContain("localhost");
  });

  it("never sends private URL targets or returns unsafe provider citations", async () => {
    process.env.AI_WEB_RESEARCH_ENABLED = "true";
    generateContent.mockResolvedValueOnce({
      text: "Verified public evidence.",
      candidates: [{
        groundingMetadata: {
          groundingChunks: [
            { web: { title: "Public", uri: "https://example.edu/spec#section" } },
            { web: { title: "Metadata", uri: "http://169.254.169.254/latest/meta-data" } },
            { web: { title: "Signed", uri: "https://example.edu/file?signature=secret" } },
          ],
        },
        urlContextMetadata: {
          urlMetadata: [
            { retrievedUrl: "https://example.edu/module" },
            { retrievedUrl: "http://10.0.0.4/private" },
          ],
        },
      }],
    });

    const result = await generateGroundedResearch({
      sanitizedQuery: "AQA GCSE biology specification",
      urls: [
        "https://example.edu/module#week-2",
        "http://10.0.0.4/private",
        "http://169.254.169.254/latest/meta-data",
        "https://example.edu/file?access_token=secret",
        "https://user:password@example.edu/private",
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      citations: [
        { title: "Public", url: "https://example.edu/spec" },
        { title: "https://example.edu/module", url: "https://example.edu/module" },
      ],
    });
    const requestText = JSON.stringify(generateContent.mock.calls[0][0].contents);
    expect(requestText).toContain("https://example.edu/module");
    expect(requestText).not.toMatch(/10\.0\.0\.4|169\.254\.169\.254|access_token|password/);
  });

  it("resolves the image model from role and returns private base64", async () => {
    process.env.AI_TUTOR_IMAGES_ENABLED = "true";
    generateContent.mockResolvedValueOnce({
      candidates: [{
        content: {
          parts: [
            { text: "A labelled cell diagram." },
            { inlineData: { data: "YWJj", mimeType: "image/png" } },
          ],
        },
      }],
    });
    await expect(generateGeminiImage({
      role: "tutorImage",
      prompt: "A labelled cell diagram",
    })).resolves.toEqual({
      data: "YWJj",
      mimeType: "image/png",
      description: "A labelled cell diagram.",
    });
    expect(generateContent.mock.calls[0][0]).toMatchObject({
      model: "gemini-3.1-flash-lite-image",
      config: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: "4:3", imageSize: "1K" },
      },
    });
  });
});
