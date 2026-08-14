import type { AiContentPart } from "@/lib/ai/content-parts";

export type AiProvider = "openrouter" | "gemini";

export type AiRole =
  | "worker"
  | "supervisor"
  | "juror"
  | "research"
  | "documentVision"
  | "tutorImage"
  | "paperImage"
  | "embedding";

export type AiGenerationRole = Extract<
  AiRole,
  "worker" | "supervisor" | "juror" | "research" | "documentVision"
>;

export type AiTaskClass = "standard" | "important" | "visual";

export type AiRouteReason =
  | "routine"
  | "complex_request"
  | "many_sources"
  | "long_request"
  | "student_correction"
  | "second_correction"
  | "repeated_concept"
  | "routing_preflight"
  | "low_confidence"
  | "insufficient_reasoning"
  | "explicit_role"
  | "provider_escalation"
  | "visual_specialist";

export type AiRouteDecision = {
  role: "worker" | "supervisor" | "juror";
  reason: AiRouteReason;
  taskClass: Exclude<AiTaskClass, "visual">;
};

export type AiCapability = {
  role: AiRole;
  provider: AiProvider;
  modelId: string;
  providerAllowlist: readonly string[];
  /** OpenRouter endpoint precision allowlist; empty for Google roles. */
  quantizations: readonly string[];
  modalities: readonly ("text" | "image" | "document" | "embedding")[];
  maxContextTokens: number;
  maxOutputTokens: number;
  reasoning: boolean;
};

export type AiUsage = {
  role: AiGenerationRole;
  provider: AiProvider;
  modelId: string;
  providerEndpoint?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  latencyMs: number;
};

export type AiFailure = {
  role: AiGenerationRole;
  provider: AiProvider;
  code: "not_configured" | "timeout" | "provider_error" | "invalid_response";
  retryable: boolean;
  status?: number;
};

export type AiProviderAttempt = {
  provider: AiProvider;
  role: AiGenerationRole;
  model: string;
  providerAllowlist: readonly string[];
  quantizations: readonly string[];
  thinking: boolean;
  routeReason: AiRouteReason;
};

export type AiProviderPolicy = {
  openRouterReady: boolean;
  geminiReady: boolean;
  jurorReady: boolean;
  capabilities: Readonly<Record<AiRole, AiCapability>>;
};

const DEFAULT_MODELS = {
  worker: "xiaomi/mimo-v2.5",
  supervisor: "minimax/minimax-m3",
  juror: "moonshotai/kimi-k2.6",
  research: "gemini-3.5-flash-lite",
  documentVision: "gemini-3.5-flash-lite",
  tutorImage: "gemini-3.1-flash-lite-image",
  paperImage: "gemini-3.1-flash-image",
  embedding: "gemini-embedding-2",
} satisfies Record<AiRole, string>;

const DEFAULT_PROVIDERS = {
  // These defaults are intentionally limited to current full-context ZDR
  // endpoints. The live release check rejects stale entries before cutover.
  worker: ["novita", "parasail"],
  // The supervisor always returns validated JSON. Of the current full-context
  // FP8 ZDR endpoints, Parasail advertises structured response support.
  supervisor: ["parasail"],
  // Moonshot's own endpoint serves Kimi at INT4; SiliconFlow serves the same
  // model at FP8 on an equally full-context ZDR endpoint, so the juror is no
  // longer pinned to a single provider or to the lowest precision available.
  juror: ["moonshotai", "siliconflow", "parasail"],
} as const;

const QUALITY_QUANTIZATIONS = ["fp32", "fp16", "bf16", "fp8"] as const;
const JUROR_QUANTIZATIONS = [
  "fp32",
  "fp16",
  "bf16",
  "fp8",
  "int8",
  "int4",
] as const;

function envValue(
  env: Record<string, string | undefined>,
  key: string,
  fallback: string
) {
  return env[key]?.trim() || fallback;
}

function providerList(
  value: string | undefined,
  fallback: readonly string[]
) {
  const parsed = value?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
  return parsed.length > 0 ? parsed : [...fallback];
}

export function buildAiCapabilityRegistry(
  env: Record<string, string | undefined>
): Readonly<Record<AiRole, AiCapability>> {
  return {
    worker: {
      role: "worker",
      provider: "openrouter",
      modelId: envValue(env, "OPENROUTER_WORKER_MODEL", DEFAULT_MODELS.worker),
      providerAllowlist: providerList(
        env.OPENROUTER_WORKER_PROVIDERS,
        DEFAULT_PROVIDERS.worker
      ),
      quantizations: QUALITY_QUANTIZATIONS,
      modalities: ["text", "image"],
      maxContextTokens: 1_048_576,
      maxOutputTokens: 16_384,
      reasoning: false,
    },
    supervisor: {
      role: "supervisor",
      provider: "openrouter",
      modelId: envValue(
        env,
        "OPENROUTER_SUPERVISOR_MODEL",
        DEFAULT_MODELS.supervisor
      ),
      providerAllowlist: providerList(
        env.OPENROUTER_SUPERVISOR_PROVIDERS,
        DEFAULT_PROVIDERS.supervisor
      ),
      quantizations: QUALITY_QUANTIZATIONS,
      modalities: ["text", "image"],
      maxContextTokens: 1_000_000,
      maxOutputTokens: 32_768,
      reasoning: true,
    },
    juror: {
      role: "juror",
      provider: "openrouter",
      modelId: envValue(env, "OPENROUTER_JUROR_MODEL", DEFAULT_MODELS.juror),
      providerAllowlist: providerList(
        env.OPENROUTER_JUROR_PROVIDERS,
        DEFAULT_PROVIDERS.juror
      ),
      // Moonshot's first-party Kimi endpoint is currently INT4. The juror is
      // pinned to that endpoint by provider allowlist rather than inheriting
      // the FP8-or-better requirement used for the main worker/supervisor.
      quantizations: JUROR_QUANTIZATIONS,
      modalities: ["text", "image"],
      maxContextTokens: 262_144,
      maxOutputTokens: 16_384,
      reasoning: true,
    },
    research: {
      role: "research",
      provider: "gemini",
      modelId: envValue(env, "GEMINI_RESEARCH_MODEL", DEFAULT_MODELS.research),
      providerAllowlist: [],
      quantizations: [],
      modalities: ["text", "document"],
      maxContextTokens: 1_000_000,
      maxOutputTokens: 16_384,
      reasoning: false,
    },
    documentVision: {
      role: "documentVision",
      provider: "gemini",
      modelId: envValue(
        env,
        "GEMINI_DOCUMENT_MODEL",
        DEFAULT_MODELS.documentVision
      ),
      providerAllowlist: [],
      quantizations: [],
      modalities: ["text", "image", "document"],
      maxContextTokens: 1_000_000,
      maxOutputTokens: 16_384,
      reasoning: false,
    },
    tutorImage: {
      role: "tutorImage",
      provider: "gemini",
      modelId: envValue(env, "GEMINI_TUTOR_IMAGE_MODEL", DEFAULT_MODELS.tutorImage),
      providerAllowlist: [],
      quantizations: [],
      modalities: ["text", "image"],
      maxContextTokens: 65_536,
      maxOutputTokens: 8_192,
      reasoning: false,
    },
    paperImage: {
      role: "paperImage",
      provider: "gemini",
      modelId: envValue(env, "GEMINI_PAPER_IMAGE_MODEL", DEFAULT_MODELS.paperImage),
      providerAllowlist: [],
      quantizations: [],
      modalities: ["text", "image"],
      maxContextTokens: 65_536,
      maxOutputTokens: 8_192,
      reasoning: false,
    },
    embedding: {
      role: "embedding",
      provider: "gemini",
      modelId: DEFAULT_MODELS.embedding,
      providerAllowlist: [],
      quantizations: [],
      modalities: ["text", "image", "embedding"],
      maxContextTokens: 8_192,
      maxOutputTokens: 0,
      reasoning: false,
    },
  };
}

export function resolveAiProviderPolicy(
  env: Record<string, string | undefined>
): AiProviderPolicy {
  const openRouterReady = Boolean(
    env.OPENROUTER_API_KEY?.trim() &&
      env.OPENROUTER_ENABLED === "true" &&
      env.OPENROUTER_PRIVACY_APPROVED === "true" &&
      env.OPENROUTER_QUALITY_GATE_PASSED === "true" &&
      env.OPENROUTER_KILL_SWITCH !== "true"
  );
  const geminiReady = Boolean(
    env.GEMINI_API_KEY?.trim() &&
      env.GEMINI_ENABLED === "true" &&
      env.GEMINI_PRIVACY_APPROVED === "true" &&
      env.GEMINI_QUALITY_GATE_PASSED === "true" &&
      env.GEMINI_KILL_SWITCH !== "true"
  );
  return {
    openRouterReady,
    geminiReady,
    jurorReady: openRouterReady && env.OPENROUTER_JUROR_KILL_SWITCH !== "true",
    capabilities: buildAiCapabilityRegistry(env),
  };
}

export function decideTutorRoute(input: {
  message: string;
  sourceCount: number;
  repeatedConcept?: boolean;
  priorAnswerChallenged?: boolean;
  repeatedSupervisorChallenge?: boolean;
}): AiRouteDecision {
  if (input.repeatedSupervisorChallenge) {
    return { role: "juror", reason: "student_correction", taskClass: "important" };
  }
  if (input.repeatedConcept) {
    return { role: "supervisor", reason: "repeated_concept", taskClass: "important" };
  }
  const message = input.message.toLowerCase();
  if (
    input.priorAnswerChallenged ||
    /\b(that(?:'s| is) (?:wrong|incorrect)|you(?:'re| are) wrong|not correct|check again|recheck|you made (?:a|an) (?:mistake|error)|i disagree)\b/.test(message)
  ) {
    return { role: "supervisor", reason: "student_correction", taskClass: "important" };
  }
  if (input.sourceCount >= 8) {
    return { role: "supervisor", reason: "many_sources", taskClass: "important" };
  }
  if (message.length >= 1_200) {
    return { role: "supervisor", reason: "long_request", taskClass: "important" };
  }
  if (
    /\b(full solution|step[- ]by[- ]step|prove|proof|derive|evaluate|critique|mark my|assess my|compare and contrast|synthesi[sz]e|research question|dissertation|examiner)\b/.test(
      message
    )
  ) {
    return { role: "supervisor", reason: "complex_request", taskClass: "important" };
  }
  return { role: "worker", reason: "routine", taskClass: "standard" };
}

/** Compatibility wrapper for existing callers while they adopt route roles. */
export function classifyTutorTaskClass(input: {
  message: string;
  sourceCount: number;
}): AiTaskClass {
  return decideTutorRoute(input).taskClass;
}

export function hasVisualAiInput(contents: readonly {
  parts: readonly AiContentPart[];
}[]) {
  return contents.some((message) =>
    message.parts.some((part) => "inlineData" in part)
  );
}

function capabilityIsReady(role: AiGenerationRole, policy: AiProviderPolicy) {
  if (role === "juror") return policy.jurorReady;
  return policy.capabilities[role].provider === "openrouter"
    ? policy.openRouterReady
    : policy.geminiReady;
}

function attemptFor(
  role: AiGenerationRole,
  policy: AiProviderPolicy,
  routeReason: AiRouteReason
): AiProviderAttempt {
  const capability = policy.capabilities[role];
  return {
    provider: capability.provider,
    role,
    model: capability.modelId,
    providerAllowlist: capability.providerAllowlist,
    quantizations: capability.quantizations,
    thinking: capability.reasoning,
    routeReason,
  };
}

export function buildAiProviderPlan(input: {
  role?: AiGenerationRole;
  taskClass?: AiTaskClass;
  routeReason?: AiRouteReason;
  hasVisualInput: boolean;
  policy: AiProviderPolicy;
}): AiProviderAttempt[] {
  let role: AiGenerationRole;
  let reason: AiRouteReason;
  if (input.role) {
    role = input.role;
    reason = input.routeReason ?? "explicit_role";
  } else if (input.taskClass === "visual") {
    role = "documentVision";
    reason = "visual_specialist";
  } else {
    role = input.taskClass === "important" ? "supervisor" : "worker";
    reason = input.taskClass === "important" ? "complex_request" : "routine";
  }

  if (!capabilityIsReady(role, input.policy)) return [];
  const primary = attemptFor(role, input.policy, reason);
  if (role === "worker") {
    const attempts = [primary, { ...primary }];
    if (capabilityIsReady("supervisor", input.policy)) {
      attempts.push(attemptFor("supervisor", input.policy, "provider_escalation"));
    }
    return attempts;
  }
  return [primary, { ...primary }];
}
