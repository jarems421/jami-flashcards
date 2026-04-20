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

type GenerateGeminiTextInput = {
  apiKey: string;
  request: GenerateContentRequest;
  timeoutMs: number;
  generationConfig?: GenerationConfig;
  modelNames?: readonly string[];
  onRetry?: (info: GeminiRetryInfo) => void;
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

async function withRequestTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(TIMEOUT_MESSAGE)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
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
        model.generateContent(request),
        timeoutMs,
      );
      return result.response.text();
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
