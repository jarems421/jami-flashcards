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
    // Exhausts the primary, then the standby, then fails closed. Supervisor
    // work is never quietly served by a smaller model.
    expect(mocks.generateOpenRouterText.mock.calls.map((call) => call[0].model)).toEqual([
      "minimax/minimax-m3",
      "minimax/minimax-m3",
      "minimax/minimax-m3",
      "moonshotai/kimi-k3",
    ]);
  });

  /**
   * The order matters as much as the fallbacks existing. When MiniMax's own
   * endpoint went down it returned 502 in under half a second on every call,
   * and the same model on DeepInfra answered in 1.4 seconds throughout, so
   * reaching for a different model first would have swapped a working endpoint
   * for an unnecessary change of marker.
   */
  it("tries the same model elsewhere before it tries a different model", async () => {
    mocks.generateOpenRouterText
      .mockRejectedValueOnce(new Error("parasail down"))
      .mockRejectedValueOnce(new Error("parasail down"))
      .mockResolvedValueOnce("failover answer");

    const retries: string[] = [];
    await expect(generateAiText({
      role: "supervisor",
      request,
      timeoutMs: 5_000,
      onRetry: (info) => retries.push(`${info.modelName}->${info.nextModelName}`),
    })).resolves.toBe("failover answer");

    const calls = mocks.generateOpenRouterText.mock.calls.map((call) => call[0]);
    expect(calls.map((call) => call.model)).toEqual([
      "minimax/minimax-m3",
      "minimax/minimax-m3",
      "minimax/minimax-m3",
    ]);
    expect(calls[0].providerAllowlist).toEqual(["parasail"]);
    expect(calls[2].providerAllowlist).toEqual(["deepinfra"]);
    expect(calls[2].quantizations).toEqual(["fp32", "fp16", "bf16", "fp8"]);
    expect(retries).toEqual([
      "minimax/minimax-m3->minimax/minimax-m3",
      "minimax/minimax-m3->minimax/minimax-m3",
    ]);
  });

  it("reaches the different-model standby only once the failover is gone too", async () => {
    mocks.generateOpenRouterText
      .mockRejectedValueOnce(new Error("parasail down"))
      .mockRejectedValueOnce(new Error("parasail down"))
      .mockRejectedValueOnce(new Error("deepinfra down"))
      .mockResolvedValueOnce("standby answer");

    await expect(generateAiText({
      role: "supervisor",
      request,
      timeoutMs: 5_000,
    })).resolves.toBe("standby answer");

    const calls = mocks.generateOpenRouterText.mock.calls.map((call) => call[0]);
    expect(calls.map((call) => call.model)).toEqual([
      "minimax/minimax-m3",
      "minimax/minimax-m3",
      "minimax/minimax-m3",
      "moonshotai/kimi-k3",
    ]);
  });
});

/**
 * The standby exists to survive an outage of the role's usual endpoint, and it
 * is a different model on a different host: the supervisor's is Kimi K3 on
 * DeepInfra against MiniMax's own endpoint. Handing it the primary's budget
 * meant that during an outage -- exactly when it is reached -- it died at the
 * ceiling instead of answering. Four of six markings in one smoke run were
 * lost this way, every one of them after the primary had returned 502.
 */
describe("what an attempt off the primary is given to work with", () => {
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
  });

  const failThenSucceed = () => {
    mocks.generateOpenRouterText
      .mockRejectedValueOnce(Object.assign(new Error("upstream"), { status: 502 }))
      .mockRejectedValueOnce(Object.assign(new Error("upstream"), { status: 502 }))
      .mockResolvedValueOnce("ok");
  };

  it("gives every attempt off the primary its own budget", async () => {
    failThenSucceed();
    await generateAiText({
      role: "supervisor",
      request,
      timeoutMs: 60_000,
      fallbackTimeoutMs: 180_000,
    });

    const calls = mocks.generateOpenRouterText.mock.calls.map(([options]) => options);
    expect(calls).toHaveLength(3);
    expect(calls[0].timeoutMs).toBe(60_000);
    expect(calls[1].timeoutMs).toBe(60_000);
    expect(calls[2].providerAllowlist).toEqual(["deepinfra"]);
    expect(calls[2].timeoutMs).toBe(180_000);
  });

  /** A caller that has not measured its standby is no worse off than before. */
  it("falls back to the primary's budget when none is given", async () => {
    failThenSucceed();
    await generateAiText({ role: "supervisor", request, timeoutMs: 60_000 });

    const calls = mocks.generateOpenRouterText.mock.calls.map(([options]) => options);
    expect(calls[2].timeoutMs).toBe(60_000);
  });

  /** The deadline still wins: a standby cannot outlive the whole marking. */
  it("never lets the standby run past the deadline", async () => {
    failThenSucceed();
    await generateAiText({
      role: "supervisor",
      request,
      timeoutMs: 60_000,
      fallbackTimeoutMs: 180_000,
      deadlineAt: Date.now() + 20_000,
    });

    const calls = mocks.generateOpenRouterText.mock.calls.map(([options]) => options);
    expect(calls[2].timeoutMs).toBeLessThanOrEqual(20_000);
  });
});
