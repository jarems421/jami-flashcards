import { readFileSync } from "node:fs";
import { MAX_PRACTICE_PAPER_SOURCE_IDS } from "@/lib/practice/practice-papers";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAiCapabilityRegistry,
  buildAiProviderPlan,
  classifyTutorTaskClass,
  decideTutorRoute,
  describeUnmetAiProviderRequirements,
  failoverProvidersFor,
  getReasoningEffort,
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
      modelId: "z-ai/glm-5.3-flash",
      providerAllowlist: ["z-ai", "novita", "modal"],
      quantizations: ["fp32", "fp16", "bf16", "fp8"],
    });
    expect(registry.supervisor).toMatchObject({
      provider: "openrouter",
      modelId: "qwen/qwen3.6-35b-a3b",
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
      "worker:z-ai/glm-5.3-flash",
      "worker:z-ai/glm-5.3-flash",
      "worker:z-ai/glm-5.3-flash",
      "supervisor:qwen/qwen3.6-35b-a3b",
    ]);
    expect(plan[2]).toMatchObject({
      routeReason: "provider_failover",
      providerAllowlist: ["deepinfra"],
    });
    expect(plan[3].routeReason).toBe("provider_escalation");
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
   * The supervisor carries a standby -- a different model held to the identical
   * bar, reached only once the primary has already failed twice. It mattered
   * most when the role ran on a single compliant endpoint; it is kept now that
   * the role has four, because papers and marking are the last work in the app
   * that should stop because one host is busy.
   */
  describe("supervisor standby", () => {
    it("appends a different model after the primary has been tried twice", () => {
      const plan = buildAiProviderPlan({
        role: "supervisor",
        hasVisualInput: false,
        policy: resolveAiProviderPolicy(approved),
      });
      expect(plan.map(({ model }) => model)).toEqual([
        "qwen/qwen3.6-35b-a3b",
        "qwen/qwen3.6-35b-a3b",
        // The same model on its second approved endpoint comes first: it is a
        // smaller change than a different model, and during the outage that
        // prompted this it was answering in 1.4 seconds throughout.
        "qwen/qwen3.6-35b-a3b",
        "moonshotai/kimi-k3",
      ]);
      // [2] is the same model on the endpoint held in reserve; [3] is the
      // standby, which brings its own.
      expect(plan[2].providerAllowlist).toEqual(["parasail"]);
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
          OPENROUTER_SUPERVISOR_STANDBY_MODEL: "qwen/qwen3.6-35b-a3b",
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

/**
 * Production ran with `GEMINI_API_KEY` set and its three flags unset, so every
 * AI route in the app answered 503 and the Tutor told students it was "not
 * configured in this deployment yet" -- while the same code worked on any
 * machine with a full `.env.local`. Nothing was logged, because the check runs
 * before the route builds its logger, and the refusal named none of the eight
 * things that can cause it.
 */
describe("an unconfigured provider says which requirement is unmet", () => {
  it("names a missing flag even when the key is present", () => {
    const unmet = describeUnmetAiProviderRequirements({
      GEMINI_API_KEY: "present",
    });

    // The key is fine, so it must not be blamed.
    expect(unmet).not.toContain("GEMINI_API_KEY");
    expect(unmet).toContain("GEMINI_ENABLED");
    expect(unmet).toContain("GEMINI_PRIVACY_APPROVED");
    expect(unmet).toContain("GEMINI_QUALITY_GATE_PASSED");
  });

  it("reports a kill switch that is on, which no absence would explain", () => {
    expect(
      describeUnmetAiProviderRequirements({
        GEMINI_API_KEY: "present",
        GEMINI_ENABLED: "true",
        GEMINI_PRIVACY_APPROVED: "true",
        GEMINI_QUALITY_GATE_PASSED: "true",
        GEMINI_KILL_SWITCH: "true",
      })
    ).toContain("GEMINI_KILL_SWITCH is on");
  });

  it("is empty for a provider that is actually ready", () => {
    const ready = {
      GEMINI_API_KEY: "present",
      GEMINI_ENABLED: "true",
      GEMINI_PRIVACY_APPROVED: "true",
      GEMINI_QUALITY_GATE_PASSED: "true",
      OPENROUTER_API_KEY: "present",
      OPENROUTER_ENABLED: "true",
      OPENROUTER_PRIVACY_APPROVED: "true",
      OPENROUTER_QUALITY_GATE_PASSED: "true",
    };

    expect(describeUnmetAiProviderRequirements(ready)).toEqual([]);
    expect(resolveAiProviderPolicy(ready).geminiReady).toBe(true);
  });

  it("never returns a value, only a name", () => {
    // This exists to be logged, so a secret must not be able to ride out on it.
    const unmet = describeUnmetAiProviderRequirements({
      GEMINI_API_KEY: "",
      GEMINI_ENABLED: "no-thanks",
    });

    for (const entry of unmet) {
      expect(entry).not.toContain("no-thanks");
    }
  });
});

/**
 * The release gate is a `.mjs` script and the policy is TypeScript, so the
 * gate copies each role's default model rather than importing it. A copy drifts:
 * the app's worker moved to GLM 5.3 Flash while the gate went on validating
 * endpoints for `xiaomi/mimo-v2.5`, and a gate that clears a model the app does
 * not use is worse than no gate, because it reports success.
 */
describe("the release gate validates the models the app actually uses", () => {
  const gate = readFileSync(
    join(__dirname, "..", "scripts", "check-ai-provider-release.mjs"),
    "utf8"
  );

  /** Every `fallbackModel: "..."` in the gate, in the order its ROLES lists them. */
  const gateFallbacks = [...gate.matchAll(/fallbackModel:\s*"([^"]+)"/g)].map(
    (match) => match[1]
  );

  it("finds a fallback model for every role it checks", () => {
    // worker, supervisor, supervisor standby, juror.
    expect(gateFallbacks.length).toBe(4);
  });

  it("agrees with the app about the worker and supervisor models", () => {
    const capabilities = buildAiCapabilityRegistry({});

    expect(gateFallbacks).toContain(capabilities.worker.modelId);
    expect(gateFallbacks).toContain(capabilities.supervisor.modelId);
    expect(gateFallbacks).toContain(capabilities.juror.modelId);
  });
});

/**
 * A role's provider allowlist has to name an endpoint that serves the role's
 * model. `DEFAULT_PROVIDERS.worker` was `["parasail"]` against a model Parasail
 * does not serve, so every routine tutor question failed closed with
 * OpenRouter's "No allowed providers are available for the selected model" --
 * while papers and marking, on the supervisor, kept working.
 *
 * Whether an endpoint currently serves a model is a live fact and belongs to
 * `check:ai-release --live`. What is checkable here is that no role ships with
 * an allowlist that cannot possibly work.
 */
describe("every role ships with a usable allowlist", () => {
  const capabilities = buildAiCapabilityRegistry({});

  it("gives each generation role at least one provider", () => {
    for (const role of ["worker", "supervisor", "juror"] as const) {
      expect(capabilities[role].providerAllowlist.length, role).toBeGreaterThan(
        0
      );
    }
  });

  it("keeps the worker's failover off its own primary allowlist", () => {
    // A failover naming an endpoint that already carries normal traffic is not
    // a failover; it is the same endpoint twice.
    const primary = new Set(capabilities.worker.providerAllowlist);
    const failover = failoverProvidersFor("worker", {} as NodeJS.ProcessEnv);

    expect(failover.length).toBeGreaterThan(0);
    for (const provider of failover) {
      expect(primary.has(provider), provider).toBe(false);
    }
  });
});

/**
 * Thinking time is bought with waiting, so it scales with how hard the question
 * was judged to be rather than being one setting for everything. Measured on
 * the worker model: 12.4s with the model's own default, 4.4s with the least,
 * for an answer four words shorter.
 */
describe("reasoning effort scales with the work", () => {
  it("gives routine work the least and a disputed mark the most", () => {
    expect(getReasoningEffort("worker")).toBe("low");
    expect(getReasoningEffort("supervisor")).toBe("medium");
    expect(getReasoningEffort("juror")).toBe("high");
  });

  it("lets a student ask for more than the role would take", () => {
    expect(getReasoningEffort("worker", "high")).toBe("high");
    expect(getReasoningEffort("worker", "medium")).toBe("medium");
  });

  it("never lets a preference ask for less than the role needs", () => {
    // Otherwise a student could quietly make adjudicating their own disputed
    // mark cheaper than the juror requires.
    expect(getReasoningEffort("juror", "low")).toBe("high");
    expect(getReasoningEffort("supervisor", "low")).toBe("medium");
  });

  it("carries the role's level on every attempt in a plan", () => {
    const plan = buildAiProviderPlan({
      role: "worker",
      hasVisualInput: false,
      policy: resolveAiProviderPolicy(approved),
    });

    expect(plan.length).toBeGreaterThan(0);
    for (const attempt of plan) {
      expect(attempt.reasoningEffort, attempt.role).toBe(
        getReasoningEffort(attempt.role)
      );
    }
  });
});

/**
 * The supervisor's context floor is a measurement, not a habit.
 *
 * It was 1,000,000 -- what the role would need if raw sources reached it. They
 * do not: every source is read by Gemini's documentVision first and arrives as
 * extracted text capped at 30,000 characters, and a paper takes at most
 * MAX_PRACTICE_PAPER_SOURCE_IDS of them. Measured against assessment-shaped
 * prose at 4.67 characters per token, the worst case a supervisor can be handed
 * is around 118,000 tokens including its own output.
 *
 * The old floor was not merely generous, it was harmful: only six models in the
 * whole zero-retention catalogue could clear it, which left paper generation and
 * marking on a single endpoint that was rate-limiting.
 */
describe("the supervisor context floor matches what a paper can actually contain", () => {
  const gate = readFileSync(
    join(__dirname, "..", "scripts", "check-ai-provider-release.mjs"),
    "utf8"
  );

  /** The measured worst case, rebuilt from the caps that produce it. */
  const CHARS_PER_TOKEN = 4.67;
  const worstCaseTokens =
    (MAX_PRACTICE_PAPER_SOURCE_IDS * 30_000 + 12_000 + 15_000) /
      CHARS_PER_TOKEN +
    16_000;

  it("stays above the worst case a paper can hand it", () => {
    const floors = [...gate.matchAll(/minimumContext:\s*([\d_]+)/g)].map((m) =>
      Number(m[1].replace(/_/g, ""))
    );

    expect(floors.length).toBeGreaterThan(0);
    // 118k or so. Every floor in the gate must clear it.
    expect(worstCaseTokens).toBeLessThan(150_000);
    for (const floor of floors) {
      expect(floor).toBeGreaterThan(worstCaseTokens);
    }
  });

  it("does not ask for an order of magnitude more than that", () => {
    // A floor far above the ceiling is not caution, it is an availability risk:
    // it thins the endpoint pool for a role that cannot afford to be on one.
    const supervisorFloor = Number(
      /fallbackModel: "qwen\/qwen3\.6-35b-a3b",[\s\S]*?minimumContext:\s*([\d_]+)/
        .exec(gate)?.[1]
        .replace(/_/g, "") ?? 0
    );

    expect(supervisorFloor).toBeGreaterThan(worstCaseTokens);
    expect(supervisorFloor).toBeLessThan(worstCaseTokens * 4);
  });
});
