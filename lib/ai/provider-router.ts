import "server-only";

import type { AiContentPart } from "@/lib/ai/content-parts";
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
  buildAiProviderPlan,
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

function planFor(options: AiRouterOptions) {
  return buildAiProviderPlan({
    role: options.role,
    taskClass: options.taskClass,
    routeReason: options.routeReason,
    hasVisualInput: hasVisualAiInput(options.request.contents),
    policy: resolveAiProviderPolicy(process.env),
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
  // require_parameters=true meaningful instead of making the pinned juror
  // route impossible to satisfy.
  return attempt.role === "juror"
    ? { temperature: undefined, topP: undefined }
    : { temperature: config?.temperature, topP: config?.topP };
}

function recordUsage(info: AiResponseDiagnostics) {
  usageLog.info("request.completed", info);
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
      providerAllowlist: attempt.providerAllowlist,
      quantizations: attempt.quantizations,
      request: options.request,
      timeoutMs,
      signal: options.signal,
      reasoning: attempt.thinking,
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

export async function generateAiText(options: AiRouterOptions) {
  const plan = planFor(options);
  if (plan.length === 0) throw new Error("AI providers are not configured");
  let lastError: unknown = null;
  for (let index = 0; index < plan.length; index += 1) {
    const attempt = plan[index];
    const timeoutMs = remainingTimeout(options.timeoutMs, options.deadlineAt);
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

export async function* streamAiText(
  options: AiRouterOptions
): AsyncGenerator<string, void, unknown> {
  const plan = planFor(options);
  if (plan.length === 0) throw new Error("AI providers are not configured");
  let lastError: unknown = null;
  for (let index = 0; index < plan.length; index += 1) {
    const attempt = plan[index];
    const timeoutMs = remainingTimeout(options.timeoutMs, options.deadlineAt);
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
