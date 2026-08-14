import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  generateOpenRouterText: vi.fn(),
  streamOpenRouterText: vi.fn(),
}));

vi.mock("@/lib/ai/openrouter", () => ({
  generateOpenRouterText: mocks.generateOpenRouterText,
  streamOpenRouterText: mocks.streamOpenRouterText,
}));

vi.mock("@/lib/ai/gemini", () => ({
  generateGeminiText: vi.fn(),
  streamGeminiText: vi.fn(),
}));

const { generateAiText } = await import("@/lib/ai/provider-router");

const request = {
  contents: [{ role: "user" as const, parts: [{ text: "Check this." }] }],
};

describe("provider router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(process.env, {
      OPENROUTER_API_KEY: "test-key",
      OPENROUTER_ENABLED: "true",
      OPENROUTER_PRIVACY_APPROVED: "true",
      OPENROUTER_QUALITY_GATE_PASSED: "true",
      OPENROUTER_KILL_SWITCH: "false",
      OPENROUTER_JUROR_KILL_SWITCH: "false",
    });
    mocks.generateOpenRouterText.mockResolvedValue("ok");
  });

  it("pins the juror to approved endpoints while omitting unsupported sampling controls", async () => {
    await generateAiText({
      role: "juror",
      routeReason: "second_correction",
      request,
      timeoutMs: 5_000,
      generationConfig: { temperature: 0.2, topP: 0.8, maxOutputTokens: 500 },
    });

    expect(mocks.generateOpenRouterText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "moonshotai/kimi-k2.6",
        providerAllowlist: ["moonshotai", "siliconflow", "parasail"],
        quantizations: expect.arrayContaining(["int4"]),
        temperature: undefined,
        topP: undefined,
      })
    );
  });

  it("keeps quality sampling and FP8-or-better routing for the supervisor", async () => {
    await generateAiText({
      role: "supervisor",
      routeReason: "complex_request",
      request,
      timeoutMs: 5_000,
      generationConfig: { temperature: 0.2, topP: 0.8 },
    });

    expect(mocks.generateOpenRouterText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "minimax/minimax-m3",
        providerAllowlist: ["parasail"],
        quantizations: ["fp32", "fp16", "bf16", "fp8"],
        temperature: 0.2,
        topP: 0.8,
      })
    );
  });

  it("retries the worker before escalating without downgrading supervisor work", async () => {
    mocks.generateOpenRouterText
      .mockRejectedValueOnce(new Error("worker unavailable"))
      .mockRejectedValueOnce(new Error("worker unavailable"))
      .mockResolvedValueOnce("supervisor answer");

    await expect(generateAiText({
      role: "worker",
      request,
      timeoutMs: 5_000,
    })).resolves.toBe("supervisor answer");
    expect(mocks.generateOpenRouterText.mock.calls.map((call) => call[0].model)).toEqual([
      "xiaomi/mimo-v2.5",
      "xiaomi/mimo-v2.5",
      "minimax/minimax-m3",
    ]);

    mocks.generateOpenRouterText.mockReset();
    mocks.generateOpenRouterText.mockRejectedValue(new Error("supervisor unavailable"));
    await expect(generateAiText({
      role: "supervisor",
      request,
      timeoutMs: 5_000,
    })).rejects.toThrow("supervisor unavailable");
    expect(mocks.generateOpenRouterText.mock.calls.map((call) => call[0].model)).toEqual([
      "minimax/minimax-m3",
      "minimax/minimax-m3",
    ]);
  });
});
