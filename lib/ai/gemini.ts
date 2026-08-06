import "server-only";

import {
  GoogleGenerativeAI,
  type GenerateContentRequest,
  type GenerationConfig,
} from "@google/generative-ai";

const DEFAULT_MODEL_NAMES = ["gemini-2.5-flash", "gemini-2.5-flash-lite"] as const;
const TIMEOUT_MESSAGE = "Request timed out";

type GeminiRetryInfo = {
  error: unknown;
  modelName: string;
  nextModelName: string;
};

export type GeminiResponseDiagnostics = {
  modelName: string;
  finishReason?: string;
  finishMessage?: string;
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
};

type GeminiCallOptions = {
  apiKey: string;
  request: GenerateContentRequest;
  /** Ceiling on a single attempt. */
  timeoutMs: number;
  /**
   * Ceiling on the call as a whole, as an absolute time.
   *
   * Without it `timeoutMs` bounds each attempt separately, so falling back to a
   * second model doubles the longest a caller can be left waiting -- 45 seconds
   * became 90 with nothing on screen. Each attempt now gets whatever is left,
   * and the ladder stops when the deadline does.
   */
  deadlineAt?: number;
  generationConfig?: GenerationConfig;
  modelNames?: readonly string[];
  /** Aborts the call outright, e.g. when the reader has gone away. */
  signal?: AbortSignal;
  onRetry?: (info: GeminiRetryInfo) => void;
  onResponse?: (info: GeminiResponseDiagnostics) => void;
};

/** How long this attempt may take, or null when the deadline has passed. */
function getAttemptTimeout(timeoutMs: number, deadlineAt: number | undefined) {
  if (deadlineAt === undefined) return timeoutMs;
  const remaining = deadlineAt - Date.now();
  return remaining <= 0 ? null : Math.min(timeoutMs, remaining);
}

/**
 * One signal that fires on the attempt timeout, the caller's own abort, or
 * neither. Kept manual rather than using AbortSignal.any so the timeout and the
 * caller's cancellation stay distinguishable to the catch below.
 */
function createAttemptSignal(timeoutMs: number, signal: AbortSignal | undefined) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(TIMEOUT_MESSAGE), timeoutMs);
  const abortFromCaller = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abortFromCaller, { once: true });
  if (signal?.aborted) abortFromCaller();

  return {
    signal: controller.signal,
    release() {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", abortFromCaller);
    },
  };
}

function getErrorStatus(error: unknown) {
  if (!error || typeof error !== "object" || !("status" in error)) {
    return null;
  }

  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

function shouldTryNextModel(error: unknown) {
  if (isGeminiTimeoutError(error)) {
    return true;
  }

  const status = getErrorStatus(error);
  return status === 429 || (typeof status === "number" && status >= 500);
}

export function isGeminiTimeoutError(error: unknown) {
  return error instanceof Error && error.message === TIMEOUT_MESSAGE;
}

/**
 * Counts what a request would cost to send, without sending it.
 *
 * The output cap is enforced by the provider; nothing bounded the input, which
 * is the larger half when a student attaches several PDFs. This is a separate,
 * cheap call, so callers should reach for it only when a request looks big
 * enough to be worth checking.
 */
export async function countGeminiTokens(input: {
  apiKey: string;
  request: GenerateContentRequest;
  modelName?: string;
}) {
  const genAI = new GoogleGenerativeAI(input.apiKey);
  const model = genAI.getGenerativeModel({
    model: input.modelName ?? DEFAULT_MODEL_NAMES[0],
  });
  const { totalTokens } = await model.countTokens({
    contents: input.request.contents,
    ...(input.request.systemInstruction
      ? { systemInstruction: input.request.systemInstruction }
      : {}),
  });
  return totalTokens;
}

/**
 * Same contract as generateGeminiText, but yields the response as it arrives.
 *
 * Falls back to the next model only while nothing has been yielded yet. Once a
 * chunk has reached the caller it has already been shown to the student, and a
 * second model would have to contradict it, so a mid-stream failure is rethrown
 * and the caller decides what to say.
 *
 * That still covers the common case: providers reject an overloaded model when
 * the stream is opened, before any text exists.
 */
export async function* streamGeminiText({
  apiKey,
  request,
  timeoutMs,
  deadlineAt,
  generationConfig,
  modelNames = DEFAULT_MODEL_NAMES,
  signal,
  onRetry,
  onResponse,
}: GeminiCallOptions): AsyncGenerator<string, void, unknown> {
  const genAI = new GoogleGenerativeAI(apiKey);
  let lastError: unknown = null;

  for (let index = 0; index < modelNames.length; index += 1) {
    const modelName = modelNames[index];
    const attemptTimeout = getAttemptTimeout(timeoutMs, deadlineAt);
    if (attemptTimeout === null) break;
    const nextModelName = modelNames[index + 1];
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig,
    });

    const attempt = createAttemptSignal(attemptTimeout, signal);
    let hasYielded = false;

    try {
      const result = await model.generateContentStream(request, {
        signal: attempt.signal,
      });

      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
          hasYielded = true;
          yield text;
        }
      }

      const final = await result.response;
      const candidate = final.candidates?.[0];
      const usage = final.usageMetadata;
      onResponse?.({
        modelName,
        ...(candidate?.finishReason ? { finishReason: candidate.finishReason } : {}),
        ...(candidate?.finishMessage ? { finishMessage: candidate.finishMessage } : {}),
        ...(usage
          ? {
              promptTokenCount: usage.promptTokenCount,
              candidatesTokenCount: usage.candidatesTokenCount,
              totalTokenCount: usage.totalTokenCount,
            }
          : {}),
      });
      return;
    } catch (error) {
      // A caller who has gone away is not a provider fault, and must not be
      // retried on a second model.
      if (signal?.aborted) throw error;
      const failure = attempt.signal.aborted ? new Error(TIMEOUT_MESSAGE) : error;
      lastError = failure;

      if (hasYielded || !nextModelName || !shouldTryNextModel(failure)) {
        throw failure;
      }

      onRetry?.({ error: failure, modelName, nextModelName });
    } finally {
      attempt.release();
    }
  }

  throw lastError ?? new Error(TIMEOUT_MESSAGE);
}

export async function generateGeminiText({
  apiKey,
  request,
  timeoutMs,
  deadlineAt,
  generationConfig,
  modelNames = DEFAULT_MODEL_NAMES,
  signal,
  onRetry,
  onResponse,
}: GeminiCallOptions) {
  const genAI = new GoogleGenerativeAI(apiKey);
  let lastError: unknown = null;

  for (let index = 0; index < modelNames.length; index += 1) {
    const modelName = modelNames[index];
    const attemptTimeout = getAttemptTimeout(timeoutMs, deadlineAt);
    if (attemptTimeout === null) break;
    const nextModelName = modelNames[index + 1];
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig,
    });
    const attempt = createAttemptSignal(attemptTimeout, signal);

    try {
      const result = await model.generateContent(request, {
        signal: attempt.signal,
      });
      const text = result.response.text();
      const candidate = result.response.candidates?.[0];
      const usage = result.response.usageMetadata;
      onResponse?.({
        modelName,
        ...(candidate?.finishReason
          ? { finishReason: candidate.finishReason }
          : {}),
        ...(candidate?.finishMessage
          ? { finishMessage: candidate.finishMessage }
          : {}),
        ...(usage
          ? {
              promptTokenCount: usage.promptTokenCount,
              candidatesTokenCount: usage.candidatesTokenCount,
              totalTokenCount: usage.totalTokenCount,
            }
          : {}),
      });
      return text;
    } catch (error) {
      if (signal?.aborted) throw error;
      const failure = attempt.signal.aborted ? new Error(TIMEOUT_MESSAGE) : error;
      lastError = failure;

      if (!nextModelName || !shouldTryNextModel(failure)) {
        throw failure;
      }

      onRetry?.({ error: failure, modelName, nextModelName });
    } finally {
      attempt.release();
    }
  }

  throw lastError ?? new Error(TIMEOUT_MESSAGE);
}
