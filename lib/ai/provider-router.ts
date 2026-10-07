import "server-only";

import type { AiContentPart } from "@/lib/ai/content-parts";
import { AiAbortError } from "@/lib/ai/abort";
import { estimateAiInputTokens } from "@/lib/ai/input-token-estimate";
import { getAiSpendContext } from "@/lib/ai/spend-context";
import { createLogger } from "@/lib/observability/logger";
import {
  generateGeminiText,
  streamGeminiText,
} from "@/lib/ai/gemini";
import {
  generateOpenRouterText,
  streamOpenRouterText,
  type OpenRouterCallOptions,
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
  /** Gemini only: thinking, billed as output. */
  thoughtsTokenCount?: number;
  /** Gemini only: what a tool fetched, billed as input. */
  toolUsePromptTokenCount?: number;
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
   *
   * `none` switches thinking off. It is the only setting between off and the
   * model's full habit that the supervisor's endpoints honour: measured on
   * every Qwen endpoint the role approves, `low`, `minimal` and a 400-token
   * budget each still thought for 1,250 to 2,100 tokens on a one-line equation,
   * where `none` answered in 113.
   */
  reasoningEffort?: AiReasoningEffort | "none";
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
   * Abandon an attempt that goes this long without a token, reasoning included.
   *
   * `timeoutMs` has to fit the longest report a role writes, so on its own it
   * lets a hung endpoint hold a call for minutes before the plan moves on. A
   * caller that sets this has its OpenRouter attempts streamed and watched
   * instead; the caller still receives the whole text at once.
   */
  stallTimeoutMs?: number;
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
    promptTokens: (info.promptTokenCount ?? 0) + (info.toolUsePromptTokenCount ?? 0),
    completionTokens: (info.candidatesTokenCount ?? 0) + (info.thoughtsTokenCount ?? 0),
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
  /*
   * Read from the error's type, never from its wording. Matching prose is what
   * logged two client-side timeouts as provider failures and sent the
   * investigation after an outage that had not happened.
   */
  const abort = error instanceof AiAbortError ? error.kind : undefined;
  const category =
    abort === "cancelled"
      ? "cancelled"
      : abort === "deadline"
        ? "deadline"
        : abort === "call_timeout"
          ? "call_timeout"
          : abort === "stalled"
            ? "stalled"
          : status === 429
            ? "rate_limited"
            : typeof status === "number" && status >= 500
              ? "upstream_failure"
              : typeof status === "number"
                ? "rejected"
                : "provider_error";
  usageLog.warn("request.failed", {
    provider: attempt.provider,
    role: attempt.role,
    routeReason: attempt.routeReason,
    modelName: attempt.model,
    latencyMs,
    ...(status === undefined ? {} : { status }),
    errorCategory: category,
    /*
     * Billing is unknown on every failure, and stays that way until a usage
     * record says otherwise.
     *
     * An earlier version called a 4xx free on the reasoning that the provider
     * had refused before doing work. That is plausible and it is not evidence:
     * nothing here observes the provider's accounting, a rejection can follow
     * work already done, and the only thing this side knows is that no figure
     * came back. `rejected` is recorded as a category so a later lookup can
     * settle it -- not as a licence to price it at zero.
     */
    billing: "unknown",
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

/**
 * What an OpenRouter attempt is sent, whether its answer is awaited or streamed.
 *
 * Reports usage and the endpoint that served it to `usage`, which turns them
 * into the call's diagnostics once the answer is complete.
 */
function openRouterRequest(
  attempt: AiProviderAttempt,
  options: AiRouterOptions,
  timeoutMs: number,
  usage: OpenRouterUsageTracker
): OpenRouterCallOptions {
  const sampling = optionalSamplingParameters(attempt, options.generationConfig);
  return {
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
    maxOutputTokens: cappedOutputTokens(options.generationConfig?.maxOutputTokens, attempt),
    json: options.generationConfig?.responseMimeType === "application/json",
    jsonSchema: options.generationConfig?.responseSchema,
    onUsage: usage.onUsage,
    onProvider: usage.onProvider,
  };
}

type OpenRouterUsageTracker = ReturnType<typeof trackOpenRouterUsage>;

/** Collects what OpenRouter reports about one call, then records it. */
function trackOpenRouterUsage(
  attempt: AiProviderAttempt,
  options: AiRouterOptions,
  startedAt: number
) {
  let usage: OpenRouterUsage = {};
  let providerEndpoint: string | undefined;
  return {
    onUsage: (value: OpenRouterUsage) => {
      usage = value;
    },
    onProvider: (value: string) => {
      providerEndpoint = value;
    },
    report() {
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
    },
  };
}

/**
 * What a Gemini attempt is sent, whether its answer is awaited or streamed.
 * Gemini reports its own diagnostics once the answer is complete.
 */
function geminiRequest(
  attempt: AiProviderAttempt,
  options: AiRouterOptions,
  timeoutMs: number,
  startedAt: number
): GeminiGenerateOptions {
  return {
    apiKey: process.env.GEMINI_API_KEY?.trim() ?? "",
    request: options.request as GeminiGenerateOptions["request"],
    timeoutMs,
    deadlineAt: options.deadlineAt,
    generationConfig: {
      ...options.generationConfig,
      maxOutputTokens: cappedOutputTokens(options.generationConfig?.maxOutputTokens, attempt),
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
        thoughtsTokenCount: diagnostics.thoughtsTokenCount,
        toolUsePromptTokenCount: diagnostics.toolUsePromptTokenCount,
        finishReason: diagnostics.finishReason,
      };
      recordUsage(info);
      options.onResponse?.(info);
    },
  };
}

async function runBufferedAttempt(
  attempt: AiProviderAttempt,
  options: AiRouterOptions,
  timeoutMs: number
) {
  // Watching for a stall needs tokens as they arrive; the caller still gets
  // one whole, trimmed response exactly as the buffered call returns it.
  if (attempt.provider === "openrouter" && options.stallTimeoutMs !== undefined) {
    return (await runStreamBufferedAttempt(attempt, options, timeoutMs)).trim();
  }
  const startedAt = Date.now();
  if (attempt.provider === "openrouter") {
    const usage = trackOpenRouterUsage(attempt, options, startedAt);
    const text = await generateOpenRouterText(openRouterRequest(attempt, options, timeoutMs, usage));
    usage.report();
    return text;
  }
  return generateGeminiText(geminiRequest(attempt, options, timeoutMs, startedAt));
}

/** One attempt's answer as it arrives, recorded once it is complete. */
async function* streamAttempt(
  attempt: AiProviderAttempt,
  options: AiRouterOptions,
  timeoutMs: number
): AsyncGenerator<string, void, unknown> {
  const startedAt = Date.now();
  if (attempt.provider === "openrouter") {
    const usage = trackOpenRouterUsage(attempt, options, startedAt);
    yield* streamOpenRouterText({
      ...openRouterRequest(attempt, options, timeoutMs, usage),
      stallTimeoutMs: options.stallTimeoutMs,
    });
    usage.report();
    return;
  }
  yield* streamGeminiText(geminiRequest(attempt, options, timeoutMs, startedAt));
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
  const chunks: string[] = [];
  for await (const chunk of streamAttempt(attempt, options, timeoutMs)) {
    chunks.push(chunk);
  }
  return chunks.join("");
}

function planOrThrow(options: AiRouterOptions) {
  const plan = planFor(options);
  if (plan.length === 0) throw new Error("AI providers are not configured");
  return plan;
}

/**
 * Records a failed attempt and announces the next one, or rethrows when the
 * plan has nothing left to try.
 */
function failOver(
  plan: AiProviderAttempt[],
  index: number,
  error: unknown,
  options: AiRouterOptions,
  startedAt: number
) {
  const attempt = plan[index];
  recordFailure(attempt, error, Date.now() - startedAt);
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

/** Works through the plan until an attempt answers, the deadline passes or it runs out. */
async function withFailover(
  options: AiRouterOptions,
  run: (attempt: AiProviderAttempt, timeoutMs: number) => Promise<string>
) {
  const plan = planOrThrow(options);
  let lastError: unknown = null;
  for (let index = 0; index < plan.length; index += 1) {
    const attempt = plan[index];
    const timeoutMs = budgetFor(attempt, options);
    if (timeoutMs <= 0) break;
    const startedAt = Date.now();
    try {
      return await run(attempt, timeoutMs);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      lastError = error;
      failOver(plan, index, error, options, startedAt);
    }
  }
  throw lastError ?? new Error("Request timed out");
}

export async function generateAiText(options: AiRouterOptions) {
  return withFailover(options, (attempt, timeoutMs) =>
    runBufferedAttempt(attempt, options, timeoutMs)
  );
}

export async function generateAiTextBufferedStream(options: AiRouterOptions) {
  return withFailover(options, (attempt, timeoutMs) =>
    runStreamBufferedAttempt(attempt, options, timeoutMs)
  );
}

/**
 * The answer as it arrives. An attempt that fails before saying anything hands
 * over to the next one; once part of an answer has been shown, a failure ends
 * the call, because the student has already read the start of it.
 */
export async function* streamAiText(
  options: AiRouterOptions
): AsyncGenerator<string, void, unknown> {
  const plan = planOrThrow(options);
  let lastError: unknown = null;
  for (let index = 0; index < plan.length; index += 1) {
    const attempt = plan[index];
    const timeoutMs = budgetFor(attempt, options);
    if (timeoutMs <= 0) break;
    let yielded = false;
    const startedAt = Date.now();
    try {
      for await (const chunk of streamAttempt(attempt, options, timeoutMs)) {
        yielded = true;
        yield chunk;
      }
      return;
    } catch (error) {
      if (options.signal?.aborted || yielded) throw error;
      lastError = error;
      failOver(plan, index, error, options, startedAt);
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
  // selected provider still enforces its own context window. Images are counted
  // by their pixels, not their bytes -- see `estimateAiInputTokens`.
  return estimateAiInputTokens(input.request);
}
