import "server-only";

import type { AiContentPart } from "@/lib/ai/content-parts";
import { getAiSpendContext } from "@/lib/ai/spend-context";
import { createLogger } from "@/lib/observability/logger";
import {
  generateGeminiText,
  streamGeminiText,
} from "@/lib/ai/gemini";
import {
  generateOpenRouterText,
  streamOpenRouterText,
  type OpenRouterUsage,
} from "@/lib/ai/openrouter";
import {
  type AiReasoningEffort,
  buildAiProviderPlan,
  failoverProvidersFor,
  hasVisualAiInput,
  resolveAiProviderPolicy,
  type AiGenerationRole,
  type AiProvider,
  type AiProviderAttempt,
  type AiRouteReason,
  type AiTaskClass,
} from "@/lib/ai/provider-policy";

const usageLog = createLogger({ route: "ai.provider" });

export type AiResponseDiagnostics = {
  provider: AiProvider;
  role: AiGenerationRole;
  routeReason: AiRouteReason;
  modelName: string;
  providerEndpoint?: string;
  latencyMs: number;
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  estimatedCostUsd?: number;
  finishReason?: string;
};

type RouterRequest = {
  systemInstruction?: string;
  contents: Array<{
    role: "user" | "model";
    parts: AiContentPart[];
  }>;
};

type GeminiGenerateOptions = Parameters<typeof generateGeminiText>[0];
type RouterGenerationConfig = NonNullable<GeminiGenerateOptions["generationConfig"]>;

export type AiRouterOptions = {
  /** Logical capability; provider/model resolution remains registry-owned. */
  role?: AiGenerationRole;
  /** Stable, provider-neutral reason recorded in content-free diagnostics. */
  routeReason?: AiRouteReason;
  /** Compatibility classifier while older routes migrate to `role`. */
  taskClass?: AiTaskClass;
  request: RouterRequest;
  timeoutMs: number;
  deadlineAt?: number;
  generationConfig?: RouterGenerationConfig;
  signal?: AbortSignal;
  /**
   * How hard to think, when the caller knows better than the role does.
   *
   * A student can raise this for themselves in settings; it never lowers what
   * the role already requires. Left unset, the role's own level applies.
   */
  reasoningEffort?: AiReasoningEffort;
  /**
   * Send this call to a specific approved endpoint instead of the role's usual
   * one. Rejected unless the role actually lists it as a failover, so this
   * cannot be used to route around the allowlist.
   */
  providerOverride?: readonly string[];
  /**
   * What an attempt gets once it leaves the role's usual endpoint.
   *
   * `timeoutMs` is measured against the primary. Both fallbacks run somewhere
   * else -- the supervisor's on DeepInfra, measured on real marking prompts at
   * p50 34s against MiniMax's own p90 of ten -- so handing them the primary's
   * budget means that during an outage, exactly when they are reached, they
   * die at the ceiling instead of answering. A fallback that cannot finish is
   * not a fallback.
   *
   * Defaults to `timeoutMs`, so a caller that has not measured its fallbacks
   * is no worse off than before.
   */
  fallbackTimeoutMs?: number;
  /**
   * Let a worker call end on the supervisor. True unless a caller says not to.
   *
   * The bulk study-asset route sets this false: a batch that quietly escalates
   * is a batch whose cost nobody predicted.
   */
  allowRoleEscalation?: boolean;
  onRetry?: (info: {
    error: unknown;
    provider: AiProvider;
    role: AiGenerationRole;
    modelName: string;
    nextProvider?: AiProvider;
    nextRole?: AiGenerationRole;
    nextModelName?: string;
  }) => void;
  onResponse?: (info: AiResponseDiagnostics) => void;
};

function remainingTimeout(timeoutMs: number, deadlineAt?: number) {
  if (deadlineAt === undefined) return timeoutMs;
  return Math.max(0, Math.min(timeoutMs, deadlineAt - Date.now()));
}

/** What one attempt gets, which is not the same once it leaves the primary. */
function budgetFor(attempt: AiProviderAttempt, options: AiRouterOptions) {
  const elsewhere =
    attempt.routeReason === "provider_failover" ||
    attempt.routeReason === "provider_standby";
  const budget = elsewhere
    ? options.fallbackTimeoutMs ?? options.timeoutMs
    : options.timeoutMs;
  return remainingTimeout(budget, options.deadlineAt);
}

function planFor(options: AiRouterOptions) {
  return buildAiProviderPlan({
    role: options.role,
    taskClass: options.taskClass,
    routeReason: options.routeReason,
    hasVisualInput: hasVisualAiInput(options.request.contents),
    policy: resolveAiProviderPolicy(process.env),
    allowRoleEscalation: options.allowRoleEscalation,
  });
}

export function isAnyAiProviderConfigured(
  role: AiGenerationRole = "worker"
) {
  const policy = resolveAiProviderPolicy(process.env);
  if (role === "juror") return policy.jurorReady;
  return policy.capabilities[role].provider === "openrouter"
    ? policy.openRouterReady
    : policy.geminiReady;
}

function cappedOutputTokens(
  requested: number | undefined,
  attempt: AiProviderAttempt
) {
  const roleLimit = resolveAiProviderPolicy(process.env)
    .capabilities[attempt.role].maxOutputTokens;
  return requested === undefined ? roleLimit : Math.min(requested, roleLimit);
}

function optionalSamplingParameters(
  attempt: AiProviderAttempt,
  config: RouterGenerationConfig | undefined
) {
  // Moonshot's first-party Kimi endpoint deliberately owns its sampling. It
  // does not advertise temperature/top_p; omitting them keeps
  // require_parameters=true meaningful whether Kimi is the pinned juror or a
  // temporary supervisor standby during a provider outage.
  return attempt.model.startsWith("moonshotai/kimi-")
    ? { temperature: undefined, topP: undefined }
    : { temperature: config?.temperature, topP: config?.topP };
}

function recordUsage(info: AiResponseDiagnostics) {
  usageLog.info("request.completed", info);

  /*
   * Metered against whoever the route said it was for. Fire-and-forget on
   * purpose: what this records is useful, and never useful enough to be worth
   * failing a student's request over.
   */
  const spend = getAiSpendContext();
  if (!spend) return;
  spend.record({
    provider: info.provider,
    model: info.modelName,
    promptTokens: info.promptTokenCount,
    completionTokens: info.candidatesTokenCount,
    ...(info.estimatedCostUsd === undefined
      ? {}
      : { reportedCostUsd: info.estimatedCostUsd }),
  });
}

function recordFailure(attempt: AiProviderAttempt, error: unknown, latencyMs: number) {
  const status =
    error && typeof error === "object" && "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
      ? (error as { status: number }).status
      : undefined;
  usageLog.warn("request.failed", {
    provider: attempt.provider,
    role: attempt.role,
    routeReason: attempt.routeReason,
    modelName: attempt.model,
    latencyMs,
    ...(status === undefined ? {} : { status }),
    errorCategory:
      status === 429
        ? "rate_limited"
        : typeof status === "number" && status >= 500
          ? "upstream_failure"
          : error instanceof Error && /timed?\s*out|timeout/i.test(error.message)
            ? "timeout"
            : "provider_error",
  });
}

/**
 * The endpoints one attempt may use.
 *
 * An override is honoured only when the role actually lists it as a failover.
 * The allowlist is the whole safety property here — it is what keeps traffic
 * on endpoints someone checked for zero retention and precision — so a caller
 * naming an arbitrary provider is refused rather than obeyed.
 */
function resolveProviderAllowlist(
  attempt: AiProviderAttempt,
  options: AiRouterOptions
): readonly string[] {
  const override = options.providerOverride ?? [];
  if (override.length === 0) return attempt.providerAllowlist;
  const approved = failoverProvidersFor(attempt.role);
  const permitted = override.filter((provider) => approved.includes(provider));
  if (permitted.length === 0) {
    throw new Error(
      `Provider override [${override.join(", ")}] is not an approved failover for ${attempt.role}.`
    );
  }
  return permitted;
}

async function runBufferedAttempt(
  attempt: AiProviderAttempt,
  options: AiRouterOptions,
  timeoutMs: number
) {
  const startedAt = Date.now();
  if (attempt.provider === "openrouter") {
    const sampling = optionalSamplingParameters(attempt, options.generationConfig);
    let usage: OpenRouterUsage = {};
    let providerEndpoint: string | undefined;
    const text = await generateOpenRouterText({
      apiKey: process.env.OPENROUTER_API_KEY?.trim() ?? "",
      model: attempt.model,
      providerAllowlist: resolveProviderAllowlist(attempt, options),
      quantizations: attempt.quantizations,
      request: options.request,
      timeoutMs,
      signal: options.signal,
      reasoning: attempt.thinking,
      reasoningEffort: options.reasoningEffort ?? attempt.reasoningEffort,
      temperature: sampling.temperature,
      topP: sampling.topP,
      maxOutputTokens: cappedOutputTokens(
        options.generationConfig?.maxOutputTokens,
        attempt
      ),
      json: options.generationConfig?.responseMimeType === "application/json",
      jsonSchema: options.generationConfig?.responseSchema,
      onUsage: (value) => { usage = value; },
      onProvider: (value) => { providerEndpoint = value; },
    });
    const diagnostics: AiResponseDiagnostics = {
      provider: "openrouter",
      role: attempt.role,
      routeReason: attempt.routeReason,
      modelName: attempt.model,
      ...(providerEndpoint ? { providerEndpoint } : {}),
      latencyMs: Date.now() - startedAt,
      promptTokenCount: usage.promptTokens,
      candidatesTokenCount: usage.completionTokens,
      totalTokenCount: usage.totalTokens,
      estimatedCostUsd: usage.estimatedCostUsd,
    };
    recordUsage(diagnostics);
    options.onResponse?.(diagnostics);
    return text;
  }

  return generateGeminiText({
    apiKey: process.env.GEMINI_API_KEY?.trim() ?? "",
    request: options.request as GeminiGenerateOptions["request"],
    timeoutMs,
    deadlineAt: options.deadlineAt,
    generationConfig: {
      ...options.generationConfig,
      maxOutputTokens: cappedOutputTokens(
        options.generationConfig?.maxOutputTokens,
        attempt
      ),
    },
    modelNames: [attempt.model],
    signal: options.signal,
    onResponse: (diagnostics) => {
      const info: AiResponseDiagnostics = {
        provider: "gemini",
        role: attempt.role,
        routeReason: attempt.routeReason,
        modelName: diagnostics.modelName,
        latencyMs: Date.now() - startedAt,
        promptTokenCount: diagnostics.promptTokenCount,
        candidatesTokenCount: diagnostics.candidatesTokenCount,
        totalTokenCount: diagnostics.totalTokenCount,
        finishReason: diagnostics.finishReason,
      };
      recordUsage(info);
      options.onResponse?.(info);
    },
  });
}

/**
 * Collect a provider stream without exposing partial output to the caller.
 *
 * Large durable artifacts can take several minutes to finish. Streaming keeps
 * the upstream connection active, while buffering here preserves the same
 * atomic contract as `generateAiText`: an incomplete attempt can be discarded
 * and a different approved endpoint can be tried safely.
 */
async function runStreamBufferedAttempt(
  attempt: AiProviderAttempt,
  options: AiRouterOptions,
  timeoutMs: number
) {
  const startedAt = Date.now();
  const chunks: string[] = [];
  if (attempt.provider === "openrouter") {
    const sampling = optionalSamplingParameters(attempt, options.generationConfig);
    let usage: OpenRouterUsage = {};
    let providerEndpoint: string | undefined;
    for await (const chunk of streamOpenRouterText({
      apiKey: process.env.OPENROUTER_API_KEY?.trim() ?? "",
      model: attempt.model,
      providerAllowlist: resolveProviderAllowlist(attempt, options),
      quantizations: attempt.quantizations,
      request: options.request,
      timeoutMs,
      signal: options.signal,
      reasoning: attempt.thinking,
      reasoningEffort: options.reasoningEffort ?? attempt.reasoningEffort,
      temperature: sampling.temperature,
      topP: sampling.topP,
      maxOutputTokens: cappedOutputTokens(
        options.generationConfig?.maxOutputTokens,
        attempt
      ),
      json: options.generationConfig?.responseMimeType === "application/json",
      jsonSchema: options.generationConfig?.responseSchema,
      onUsage: (value) => { usage = value; },
      onProvider: (value) => { providerEndpoint = value; },
    })) {
      chunks.push(chunk);
    }
    const diagnostics: AiResponseDiagnostics = {
      provider: "openrouter",
      role: attempt.role,
      routeReason: attempt.routeReason,
      modelName: attempt.model,
      ...(providerEndpoint ? { providerEndpoint } : {}),
      latencyMs: Date.now() - startedAt,
      promptTokenCount: usage.promptTokens,
      candidatesTokenCount: usage.completionTokens,
      totalTokenCount: usage.totalTokens,
      estimatedCostUsd: usage.estimatedCostUsd,
    };
    recordUsage(diagnostics);
    options.onResponse?.(diagnostics);
    return chunks.join("");
  }

  for await (const chunk of streamGeminiText({
    apiKey: process.env.GEMINI_API_KEY?.trim() ?? "",
    request: options.request as GeminiGenerateOptions["request"],
    timeoutMs,
    deadlineAt: options.deadlineAt,
    generationConfig: {
      ...options.generationConfig,
      maxOutputTokens: cappedOutputTokens(
        options.generationConfig?.maxOutputTokens,
        attempt
      ),
    },
    modelNames: [attempt.model],
    signal: options.signal,
    onResponse: (diagnostics) => {
      const info: AiResponseDiagnostics = {
        provider: "gemini",
        role: attempt.role,
        routeReason: attempt.routeReason,
        modelName: diagnostics.modelName,
        latencyMs: Date.now() - startedAt,
        promptTokenCount: diagnostics.promptTokenCount,
        candidatesTokenCount: diagnostics.candidatesTokenCount,
        totalTokenCount: diagnostics.totalTokenCount,
        finishReason: diagnostics.finishReason,
      };
      recordUsage(info);
      options.onResponse?.(info);
    },
  })) {
    chunks.push(chunk);
  }
  return chunks.join("");
}

export async function generateAiText(options: AiRouterOptions) {
  const plan = planFor(options);
  if (plan.length === 0) throw new Error("AI providers are not configured");
  let lastError: unknown = null;
  for (let index = 0; index < plan.length; index += 1) {
    const attempt = plan[index];
    const timeoutMs = budgetFor(attempt, options);
    if (timeoutMs <= 0) break;
    const startedAt = Date.now();
    try {
      return await runBufferedAttempt(attempt, options, timeoutMs);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      recordFailure(attempt, error, Date.now() - startedAt);
      lastError = error;
      const next = plan[index + 1];
      if (!next) throw error;
      options.onRetry?.({
        error,
        provider: attempt.provider,
        role: attempt.role,
        modelName: attempt.model,
        nextProvider: next.provider,
        nextRole: next.role,
        nextModelName: next.model,
      });
    }
  }
  throw lastError ?? new Error("Request timed out");
}

export async function generateAiTextBufferedStream(options: AiRouterOptions) {
  const plan = planFor(options);
  if (plan.length === 0) throw new Error("AI providers are not configured");
  let lastError: unknown = null;
  for (let index = 0; index < plan.length; index += 1) {
    const attempt = plan[index];
    const timeoutMs = budgetFor(attempt, options);
    if (timeoutMs <= 0) break;
    const startedAt = Date.now();
    try {
      return await runStreamBufferedAttempt(attempt, options, timeoutMs);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      recordFailure(attempt, error, Date.now() - startedAt);
      lastError = error;
      const next = plan[index + 1];
      if (!next) throw error;
      options.onRetry?.({
        error,
        provider: attempt.provider,
        role: attempt.role,
        modelName: attempt.model,
        nextProvider: next.provider,
        nextRole: next.role,
        nextModelName: next.model,
      });
    }
  }
  throw lastError ?? new Error("Request timed out");
}

export async function* streamAiText(
  options: AiRouterOptions
): AsyncGenerator<string, void, unknown> {
  const plan = planFor(options);
  if (plan.length === 0) throw new Error("AI providers are not configured");
  let lastError: unknown = null;
  for (let index = 0; index < plan.length; index += 1) {
    const attempt = plan[index];
    const timeoutMs = budgetFor(attempt, options);
    if (timeoutMs <= 0) break;
    let yielded = false;
    const startedAt = Date.now();
    try {
      if (attempt.provider === "openrouter") {
        const sampling = optionalSamplingParameters(attempt, options.generationConfig);
        let usage: OpenRouterUsage = {};
        let providerEndpoint: string | undefined;
        for await (const chunk of streamOpenRouterText({
          apiKey: process.env.OPENROUTER_API_KEY?.trim() ?? "",
          model: attempt.model,
          providerAllowlist: attempt.providerAllowlist,
          quantizations: attempt.quantizations,
          request: options.request,
          timeoutMs,
          signal: options.signal,
          reasoning: attempt.thinking,
          reasoningEffort: options.reasoningEffort ?? attempt.reasoningEffort,
          temperature: sampling.temperature,
          topP: sampling.topP,
          maxOutputTokens: cappedOutputTokens(
            options.generationConfig?.maxOutputTokens,
            attempt
          ),
          json: options.generationConfig?.responseMimeType === "application/json",
          jsonSchema: options.generationConfig?.responseSchema,
          onUsage: (value) => { usage = value; },
          onProvider: (value) => { providerEndpoint = value; },
        })) {
          yielded = true;
          yield chunk;
        }
        const diagnostics: AiResponseDiagnostics = {
          provider: "openrouter",
          role: attempt.role,
          routeReason: attempt.routeReason,
          modelName: attempt.model,
          ...(providerEndpoint ? { providerEndpoint } : {}),
          latencyMs: Date.now() - startedAt,
          promptTokenCount: usage.promptTokens,
          candidatesTokenCount: usage.completionTokens,
          totalTokenCount: usage.totalTokens,
          estimatedCostUsd: usage.estimatedCostUsd,
        };
        recordUsage(diagnostics);
        options.onResponse?.(diagnostics);
      } else {
        for await (const chunk of streamGeminiText({
          apiKey: process.env.GEMINI_API_KEY?.trim() ?? "",
          request: options.request as GeminiGenerateOptions["request"],
          timeoutMs,
          deadlineAt: options.deadlineAt,
          generationConfig: {
            ...options.generationConfig,
            maxOutputTokens: cappedOutputTokens(
              options.generationConfig?.maxOutputTokens,
              attempt
            ),
          },
          modelNames: [attempt.model],
          signal: options.signal,
          onResponse: (diagnostics) => {
            const info: AiResponseDiagnostics = {
              provider: "gemini",
              role: attempt.role,
              routeReason: attempt.routeReason,
              modelName: diagnostics.modelName,
              latencyMs: Date.now() - startedAt,
              promptTokenCount: diagnostics.promptTokenCount,
              candidatesTokenCount: diagnostics.candidatesTokenCount,
              totalTokenCount: diagnostics.totalTokenCount,
              finishReason: diagnostics.finishReason,
            };
            recordUsage(info);
            options.onResponse?.(info);
          },
        })) {
          yielded = true;
          yield chunk;
        }
      }
      return;
    } catch (error) {
      if (options.signal?.aborted || yielded) throw error;
      recordFailure(attempt, error, Date.now() - startedAt);
      lastError = error;
      const next = plan[index + 1];
      if (!next) throw error;
      options.onRetry?.({
        error,
        provider: attempt.provider,
        role: attempt.role,
        modelName: attempt.model,
        nextProvider: next.provider,
        nextRole: next.role,
        nextModelName: next.model,
      });
    }
  }
  throw lastError ?? new Error("Request timed out");
}

export async function countAiInputTokens(input: {
  request: RouterRequest;
  taskClass?: AiTaskClass;
  role?: AiGenerationRole;
}) {
  // This conservative provider-neutral estimate is a preflight guard. The
  // selected provider still enforces its own context window.
  const characters = (input.request.systemInstruction?.length ?? 0) +
    input.request.contents.reduce((total, message) => total +
      message.parts.reduce((sum, part) => sum +
        ("text" in part
          ? part.text.length
          : Math.ceil(part.inlineData.data.length * 0.75)), 0), 0);
  return Math.ceil(characters / 3.5);
}
