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
      // Each fallback carries its own reason so leaving the primary is legible
      // in content-free diagnostics rather than looking like an ordinary call.
      "provider_failover",
      "provider_standby",
    ]);
  });

  it("never downgrades supervisor or juror work to another role", () => {
    const policy = resolveAiProviderPolicy(approved);
    expect(buildAiProviderPlan({
      role: "supervisor",
      hasVisualInput: false,
      policy,
    }).map(({ role }) => role)).toEqual([
      "supervisor",
      "supervisor",
      "supervisor",
      "supervisor",
    ]);
    expect(buildAiProviderPlan({
      role: "juror",
      hasVisualInput: true,
      policy,
    }).map(({ role }) => role)).toEqual(["juror", "juror"]);
  });

  /**
   * The supervisor's model has one compliant endpoint in the entire ZDR
   * catalogue, so it alone carries a standby: a different model held to the
   * identical bar, reached only once the primary has already failed twice.
   */
  describe("supervisor standby", () => {
    it("appends a different model after the primary has been tried twice", () => {
      const plan = buildAiProviderPlan({
        role: "supervisor",
        hasVisualInput: false,
        policy: resolveAiProviderPolicy(approved),
      });
      expect(plan.map(({ model }) => model)).toEqual([
        "minimax/minimax-m3",
        "minimax/minimax-m3",
        // The same model on its second approved endpoint comes first: it is a
        // smaller change than a different model, and during the outage that
        // prompted this it was answering in 1.4 seconds throughout.
        "minimax/minimax-m3",
        "moonshotai/kimi-k3",
      ]);
      expect(plan[2].providerAllowlist).toEqual(["deepinfra"]);
      expect(plan[3].providerAllowlist).toEqual(["deepinfra"]);
    });

    it("holds the standby to the role's own precision and reasoning bar", () => {
      const plan = buildAiProviderPlan({
        role: "supervisor",
        hasVisualInput: false,
        policy: resolveAiProviderPolicy(approved),
      });
      expect(plan[3].quantizations).toEqual(plan[0].quantizations);
      expect(plan[3].quantizations).not.toContain("int4");
      expect(plan[3].thinking).toBe(true);
    });

    it("gives no other role a standby", () => {
      const policy = resolveAiProviderPolicy(approved);
      for (const role of ["worker", "juror", "documentVision"] as const) {
        const plan = buildAiProviderPlan({ role, hasVisualInput: false, policy });
        expect(plan.every((attempt) => attempt.routeReason !== "provider_standby")).toBe(true);
      }
    });

    it("ignores a standby configured as the model it stands in for", () => {
      const plan = buildAiProviderPlan({
        role: "supervisor",
        hasVisualInput: false,
        policy: resolveAiProviderPolicy({
          ...approved,
          OPENROUTER_SUPERVISOR_STANDBY_MODEL: "minimax/minimax-m3",
        }),
      });
      // The primary twice and its failover endpoint; no standby.
      expect(plan).toHaveLength(3);
      expect(plan.every((attempt) => attempt.routeReason !== "provider_standby")).toBe(true);
    });

    it("is overridable without touching code", () => {
      const plan = buildAiProviderPlan({
        role: "supervisor",
        hasVisualInput: false,
        policy: resolveAiProviderPolicy({
          ...approved,
          OPENROUTER_SUPERVISOR_STANDBY_MODEL: "qwen/qwen3.5-397b-a17b",
          OPENROUTER_SUPERVISOR_STANDBY_PROVIDERS: "parasail, deepinfra",
        }),
      });
      expect(plan[3].model).toBe("qwen/qwen3.5-397b-a17b");
      expect(plan[3].providerAllowlist).toEqual(["parasail", "deepinfra"]);
    });
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
