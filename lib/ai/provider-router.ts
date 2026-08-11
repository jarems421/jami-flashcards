import "server-only";

import type { AiContentPart } from "@/lib/ai/content-parts";
import {
  generateDeepSeekText,
  streamDeepSeekText,
  type DeepSeekUsage,
} from "@/lib/ai/deepseek";
import {
  generateGeminiText,
  streamGeminiText,
} from "@/lib/ai/gemini";
import {
  buildAiProviderPlan,
  hasVisualAiInput,
  resolveAiProviderPolicy,
  type AiProviderAttempt,
  type AiProviderModel,
  type AiTaskClass,
} from "@/lib/ai/provider-policy";

export type AiResponseDiagnostics = {
  provider: "deepseek" | "gemini";
  modelName: string;
  latencyMs: number;
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  estimatedCostUsd?: number;
  finishReason?: string;
  finishMessage?: string;
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

type RouterOptions = {
  taskClass: AiTaskClass;
  request: RouterRequest;
  timeoutMs: number;
  deadlineAt?: number;
  generationConfig?: RouterGenerationConfig;
  signal?: AbortSignal;
  forceModel?: AiProviderModel;
  onRetry?: (info: {
    error: unknown;
    provider: "deepseek" | "gemini";
    modelName: string;
    nextProvider?: "deepseek" | "gemini";
    nextModelName?: string;
  }) => void;
  onResponse?: (info: AiResponseDiagnostics) => void;
};

const DEEPSEEK_FLASH_INPUT = 0.14 / 1_000_000;
const DEEPSEEK_FLASH_INPUT_CACHE_HIT = 0.0028 / 1_000_000;
const DEEPSEEK_FLASH_OUTPUT = 0.28 / 1_000_000;
const DEEPSEEK_PRO_INPUT = 0.435 / 1_000_000;
const DEEPSEEK_PRO_INPUT_CACHE_HIT = 0.003625 / 1_000_000;
const DEEPSEEK_PRO_OUTPUT = 0.87 / 1_000_000;

function remainingTimeout(timeoutMs: number, deadlineAt?: number) {
  if (deadlineAt === undefined) return timeoutMs;
  return Math.max(0, Math.min(timeoutMs, deadlineAt - Date.now()));
}

function estimateDeepSeekCost(model: string, usage: DeepSeekUsage) {
  const inputRate = model === "deepseek-v4-pro"
    ? DEEPSEEK_PRO_INPUT
    : DEEPSEEK_FLASH_INPUT;
  const outputRate = model === "deepseek-v4-pro"
    ? DEEPSEEK_PRO_OUTPUT
    : DEEPSEEK_FLASH_OUTPUT;
  const cacheHitRate = model === "deepseek-v4-pro"
    ? DEEPSEEK_PRO_INPUT_CACHE_HIT
    : DEEPSEEK_FLASH_INPUT_CACHE_HIT;
  const cacheHitTokens = usage.promptCacheHitTokens ?? 0;
  const cacheMissTokens = usage.promptCacheMissTokens ??
    Math.max(0, (usage.promptTokens ?? 0) - cacheHitTokens);
  return cacheMissTokens * inputRate +
    cacheHitTokens * cacheHitRate +
    (usage.completionTokens ?? 0) * outputRate;
}

function planFor(options: RouterOptions) {
  return buildAiProviderPlan({
    taskClass: options.taskClass,
    hasVisualInput: hasVisualAiInput(options.request.contents),
    policy: resolveAiProviderPolicy(process.env),
    forceModel: options.forceModel,
  });
}

export function isAnyAiProviderConfigured() {
  const policy = resolveAiProviderPolicy(process.env);
  return policy.deepSeekReady || policy.geminiReady;
}

async function runBufferedAttempt(
  attempt: AiProviderAttempt,
  options: RouterOptions,
  timeoutMs: number
) {
  const startedAt = Date.now();
  if (attempt.provider === "deepseek") {
    let usage: DeepSeekUsage = {};
    const text = await generateDeepSeekText({
      apiKey: process.env.DEEPSEEK_API_KEY?.trim() ?? "",
      model: attempt.model as "deepseek-v4-flash" | "deepseek-v4-pro",
      request: options.request,
      timeoutMs,
      signal: options.signal,
      thinking: attempt.thinking,
      temperature: options.generationConfig?.temperature,
      topP: options.generationConfig?.topP,
      maxOutputTokens: options.generationConfig?.maxOutputTokens,
      json: options.generationConfig?.responseMimeType === "application/json",
      onUsage: (value) => { usage = value; },
    });
    options.onResponse?.({
      provider: "deepseek",
      modelName: attempt.model,
      latencyMs: Date.now() - startedAt,
      promptTokenCount: usage.promptTokens,
      candidatesTokenCount: usage.completionTokens,
      totalTokenCount: usage.totalTokens,
      estimatedCostUsd: estimateDeepSeekCost(attempt.model, usage),
    });
    return text;
  }

  return generateGeminiText({
    apiKey: process.env.GEMINI_API_KEY?.trim() ?? "",
    request: options.request as GeminiGenerateOptions["request"],
    timeoutMs,
    deadlineAt: options.deadlineAt,
    generationConfig: options.generationConfig,
    modelNames: [attempt.model],
    signal: options.signal,
    onResponse: (diagnostics) => options.onResponse?.({
      provider: "gemini",
      modelName: diagnostics.modelName,
      latencyMs: Date.now() - startedAt,
      promptTokenCount: diagnostics.promptTokenCount,
      candidatesTokenCount: diagnostics.candidatesTokenCount,
      totalTokenCount: diagnostics.totalTokenCount,
      finishReason: diagnostics.finishReason,
      finishMessage: diagnostics.finishMessage,
    }),
  });
}

export async function generateAiText(options: RouterOptions) {
  const plan = planFor(options);
  if (plan.length === 0) throw new Error("AI providers are not configured");
  let lastError: unknown = null;
  for (let index = 0; index < plan.length; index += 1) {
    const attempt = plan[index];
    const timeoutMs = remainingTimeout(options.timeoutMs, options.deadlineAt);
    if (timeoutMs <= 0) break;
    try {
      return await runBufferedAttempt(attempt, options, timeoutMs);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      lastError = error;
      const next = plan[index + 1];
      if (!next) throw error;
      options.onRetry?.({
        error,
        provider: attempt.provider,
        modelName: attempt.model,
        nextProvider: next.provider,
        nextModelName: next.model,
      });
    }
  }
  throw lastError ?? new Error("Request timed out");
}

export async function* streamAiText(
  options: RouterOptions
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
      if (attempt.provider === "deepseek") {
        let usage: DeepSeekUsage = {};
        for await (const chunk of streamDeepSeekText({
          apiKey: process.env.DEEPSEEK_API_KEY?.trim() ?? "",
          model: attempt.model as "deepseek-v4-flash" | "deepseek-v4-pro",
          request: options.request,
          timeoutMs,
          signal: options.signal,
          thinking: attempt.thinking,
          temperature: options.generationConfig?.temperature,
          topP: options.generationConfig?.topP,
          maxOutputTokens: options.generationConfig?.maxOutputTokens,
          json: options.generationConfig?.responseMimeType === "application/json",
          onUsage: (value) => { usage = value; },
        })) {
          yielded = true;
          yield chunk;
        }
        options.onResponse?.({
          provider: "deepseek",
          modelName: attempt.model,
          latencyMs: Date.now() - startedAt,
          promptTokenCount: usage.promptTokens,
          candidatesTokenCount: usage.completionTokens,
          totalTokenCount: usage.totalTokens,
          estimatedCostUsd: estimateDeepSeekCost(attempt.model, usage),
        });
      } else {
        for await (const chunk of streamGeminiText({
          apiKey: process.env.GEMINI_API_KEY?.trim() ?? "",
          request: options.request as GeminiGenerateOptions["request"],
          timeoutMs,
          deadlineAt: options.deadlineAt,
          generationConfig: options.generationConfig,
          modelNames: [attempt.model],
          signal: options.signal,
          onResponse: (diagnostics) => options.onResponse?.({
            provider: "gemini",
            modelName: diagnostics.modelName,
            latencyMs: Date.now() - startedAt,
            promptTokenCount: diagnostics.promptTokenCount,
            candidatesTokenCount: diagnostics.candidatesTokenCount,
            totalTokenCount: diagnostics.totalTokenCount,
            finishReason: diagnostics.finishReason,
            finishMessage: diagnostics.finishMessage,
          }),
        })) {
          yielded = true;
          yield chunk;
        }
      }
      return;
    } catch (error) {
      if (options.signal?.aborted || yielded) throw error;
      lastError = error;
      const next = plan[index + 1];
      if (!next) throw error;
      options.onRetry?.({
        error,
        provider: attempt.provider,
        modelName: attempt.model,
        nextProvider: next.provider,
        nextModelName: next.model,
      });
    }
  }
  throw lastError ?? new Error("Request timed out");
}

export async function countAiInputTokens(input: {
  request: RouterRequest;
  taskClass: AiTaskClass;
}) {
  // DeepSeek has no separate count endpoint. This conservative estimate is
  // only a preflight guard; the provider still enforces its context window.
  const characters = (input.request.systemInstruction?.length ?? 0) +
    input.request.contents.reduce((total, message) => total +
      message.parts.reduce((sum, part) => sum +
        ("text" in part ? part.text.length : Math.ceil(part.inlineData.data.length * 0.75)), 0), 0);
  return Math.ceil(characters / 3.5);
}
