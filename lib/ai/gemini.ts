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

type GenerateGeminiTextInput = {
  apiKey: string;
  request: GenerateContentRequest;
  timeoutMs: number;
  generationConfig?: GenerationConfig;
  modelNames?: readonly string[];
  onRetry?: (info: GeminiRetryInfo) => void;
  onResponse?: (info: GeminiResponseDiagnostics) => void;
};

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

async function withRequestTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(TIMEOUT_MESSAGE), timeoutMs);

  try {
    return await run(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) throw new Error(TIMEOUT_MESSAGE);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function isGeminiTimeoutError(error: unknown) {
  return error instanceof Error && error.message === TIMEOUT_MESSAGE;
}

export async function generateGeminiText({
  apiKey,
  request,
  timeoutMs,
  generationConfig,
  modelNames = DEFAULT_MODEL_NAMES,
  onRetry,
  onResponse,
}: GenerateGeminiTextInput) {
  const genAI = new GoogleGenerativeAI(apiKey);
  let lastError: unknown = null;

  for (let index = 0; index < modelNames.length; index += 1) {
    const modelName = modelNames[index];
    const nextModelName = modelNames[index + 1];
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig,
    });

    try {
      const result = await withRequestTimeout(
        (signal) => model.generateContent(request, { signal }),
        timeoutMs
      );
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
      lastError = error;

      if (!nextModelName || !shouldTryNextModel(error)) {
        throw error;
      }

      onRetry?.({ error, modelName, nextModelName });
    }
  }

  throw lastError ?? new Error("Gemini request failed");
}
