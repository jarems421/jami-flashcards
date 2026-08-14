import { describe, expect, it } from "vitest";
import {
  buildAiCapabilityRegistry,
  buildAiProviderPlan,
  classifyTutorTaskClass,
  decideTutorRoute,
  resolveAiProviderPolicy,
} from "@/lib/ai/provider-policy";

const approved = {
  OPENROUTER_API_KEY: "test-key",
  OPENROUTER_ENABLED: "true",
  OPENROUTER_PRIVACY_APPROVED: "true",
  OPENROUTER_QUALITY_GATE_PASSED: "true",
  GEMINI_API_KEY: "gemini-key",
  GEMINI_ENABLED: "true",
  GEMINI_PRIVACY_APPROVED: "true",
  GEMINI_QUALITY_GATE_PASSED: "true",
};

describe("AI provider policy", () => {
  it("does not enable OpenRouter from an API key alone", () => {
    expect(resolveAiProviderPolicy({
      OPENROUTER_API_KEY: "test-key",
      GEMINI_API_KEY: "gemini-key",
    })).toMatchObject({
      openRouterReady: false,
      geminiReady: false,
      jurorReady: false,
    });
  });

  it("uses logical capabilities with pinned model and endpoint defaults", () => {
    const registry = buildAiCapabilityRegistry({});
    expect(registry.worker).toMatchObject({
      provider: "openrouter",
      modelId: "xiaomi/mimo-v2.5",
      providerAllowlist: ["novita", "parasail"],
      quantizations: ["fp32", "fp16", "bf16", "fp8"],
    });
    expect(registry.supervisor).toMatchObject({
      provider: "openrouter",
      modelId: "minimax/minimax-m3",
    });
    expect(registry.juror).toMatchObject({
      provider: "openrouter",
      modelId: "moonshotai/kimi-k2.6",
      // More than one approved endpoint, so a single provider outage does not
      // take the independent third view down with it.
      providerAllowlist: ["moonshotai", "siliconflow", "parasail"],
      quantizations: expect.arrayContaining(["int4"]),
    });
    expect(registry.embedding.modelId).toBe("gemini-embedding-2");
  });

  it("allows server environment overrides without exposing model selection", () => {
    const registry = buildAiCapabilityRegistry({
      OPENROUTER_WORKER_MODEL: "approved/worker-version",
      OPENROUTER_WORKER_PROVIDERS: "Approved One, Approved Two",
    });
    expect(registry.worker.modelId).toBe("approved/worker-version");
    expect(registry.worker.providerAllowlist).toEqual([
      "Approved One",
      "Approved Two",
    ]);
  });

  it("routes routine text through the worker before supervisor escalation", () => {
    const plan = buildAiProviderPlan({
      role: "worker",
      hasVisualInput: false,
      policy: resolveAiProviderPolicy(approved),
    });
    expect(plan.map(({ role, model }) => `${role}:${model}`)).toEqual([
      "worker:xiaomi/mimo-v2.5",
      "worker:xiaomi/mimo-v2.5",
      "supervisor:minimax/minimax-m3",
    ]);
    expect(plan[2].routeReason).toBe("provider_escalation");
  });

  it("preserves provider-neutral route reasons in diagnostics plans", () => {
    const plan = buildAiProviderPlan({
      role: "supervisor",
      routeReason: "low_confidence",
      hasVisualInput: false,
      policy: resolveAiProviderPolicy(approved),
    });
    expect(plan.map((attempt) => attempt.routeReason)).toEqual([
      "low_confidence",
      "low_confidence",
    ]);
  });

  it("never downgrades supervisor or juror work to another role", () => {
    const policy = resolveAiProviderPolicy(approved);
    expect(buildAiProviderPlan({
      role: "supervisor",
      hasVisualInput: false,
      policy,
    }).map(({ role }) => role)).toEqual(["supervisor", "supervisor"]);
    expect(buildAiProviderPlan({
      role: "juror",
      hasVisualInput: true,
      policy,
    }).map(({ role }) => role)).toEqual(["juror", "juror"]);
  });

  it("uses Gemini only for an explicit specialist role", () => {
    const policy = resolveAiProviderPolicy(approved);
    const plan = buildAiProviderPlan({
      role: "documentVision",
      hasVisualInput: true,
      policy,
    });
    expect(plan.map(({ provider, role, model }) =>
      `${provider}:${role}:${model}`
    )).toEqual([
      "gemini:documentVision:gemini-3.5-flash-lite",
      "gemini:documentVision:gemini-3.5-flash-lite",
    ]);
  });

  it("honours global and juror kill switches immediately", () => {
    expect(resolveAiProviderPolicy({
      ...approved,
      OPENROUTER_KILL_SWITCH: "true",
    })).toMatchObject({ openRouterReady: false, jurorReady: false });
    const jurorOff = resolveAiProviderPolicy({
      ...approved,
      OPENROUTER_JUROR_KILL_SWITCH: "true",
    });
    expect(jurorOff.openRouterReady).toBe(true);
    expect(buildAiProviderPlan({
      role: "juror",
      hasVisualInput: false,
      policy: jurorOff,
    })).toEqual([]);
  });

  it("escalates difficult, corrected, and repeatedly disputed Tutor work", () => {
    expect(classifyTutorTaskClass({
      message: "Can you remind me what mitosis means?",
      sourceCount: 2,
    })).toBe("standard");
    expect(classifyTutorTaskClass({
      message: "Give me a full solution and derive the result step by step.",
      sourceCount: 2,
    })).toBe("important");
    expect(decideTutorRoute({
      message: "That is wrong, please check again.",
      sourceCount: 1,
    })).toMatchObject({ role: "supervisor", reason: "student_correction" });
    expect(decideTutorRoute({
      message: "I still disagree.",
      sourceCount: 1,
      repeatedSupervisorChallenge: true,
    })).toMatchObject({ role: "juror", reason: "student_correction" });
  });
});
