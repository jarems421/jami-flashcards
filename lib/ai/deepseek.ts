import "server-only";

import type { AiContentPart } from "@/lib/ai/content-parts";

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const TIMEOUT_MESSAGE = "Request timed out";

export type DeepSeekModel = "deepseek-v4-flash" | "deepseek-v4-pro";

export type DeepSeekUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
};

type DeepSeekMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type DeepSeekRequest = {
  systemInstruction?: string;
  contents: readonly {
    role: "user" | "model";
    parts: readonly AiContentPart[];
  }[];
};

export type DeepSeekCallOptions = {
  apiKey: string;
  model: DeepSeekModel;
  request: DeepSeekRequest;
  timeoutMs: number;
  signal?: AbortSignal;
  thinking: boolean;
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  json?: boolean;
  onUsage?: (usage: DeepSeekUsage) => void;
};

export class DeepSeekApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "DeepSeekApiError";
    this.status = status;
  }
}

function createAttemptSignal(timeoutMs: number, signal?: AbortSignal) {
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

function toMessages(request: DeepSeekRequest): DeepSeekMessage[] {
  const messages: DeepSeekMessage[] = [];
  if (request.systemInstruction?.trim()) {
    messages.push({ role: "system", content: request.systemInstruction.trim() });
  }
  for (const message of request.contents) {
    const text = message.parts.map((part) => {
      if ("inlineData" in part) {
        throw new Error("DeepSeek text models cannot receive visual input.");
      }
      return part.text;
    }).join("\n");
    messages.push({
      role: message.role === "model" ? "assistant" : "user",
      content: text,
    });
  }
  return messages;
}

function requestBody(options: DeepSeekCallOptions, stream: boolean) {
  return {
    model: options.model,
    messages: toMessages(options.request),
    thinking: { type: options.thinking ? "enabled" : "disabled" },
    stream,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
    ...(options.json ? { response_format: { type: "json_object" } } : {}),
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options.topP === undefined ? {} : { top_p: options.topP }),
    ...(options.maxOutputTokens === undefined
      ? {}
      : { max_tokens: options.maxOutputTokens }),
  };
}

async function createResponse(options: DeepSeekCallOptions, stream: boolean) {
  const attempt = createAttemptSignal(options.timeoutMs, options.signal);
  try {
    const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody(options, stream)),
      signal: attempt.signal,
    });
    if (!response.ok) {
      let detail = "DeepSeek request failed";
      try {
        const body = await response.json() as { error?: { message?: string } };
        detail = body.error?.message?.slice(0, 300) || detail;
      } catch {
        // Do not echo a provider body that was not valid JSON.
      }
      throw new DeepSeekApiError(detail, response.status);
    }
    return { response, release: attempt.release };
  } catch (error) {
    attempt.release();
    if (options.signal?.aborted) throw error;
    if (attempt.signal.aborted) throw new Error(TIMEOUT_MESSAGE);
    throw error;
  }
}

function normalizeUsage(value: unknown): DeepSeekUsage {
  const usage = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const number = (candidate: unknown) =>
    typeof candidate === "number" && Number.isFinite(candidate)
      ? candidate
      : undefined;
  return {
    promptTokens: number(usage.prompt_tokens),
    completionTokens: number(usage.completion_tokens),
    totalTokens: number(usage.total_tokens),
    promptCacheHitTokens: number(usage.prompt_cache_hit_tokens),
    promptCacheMissTokens: number(usage.prompt_cache_miss_tokens),
  };
}

export async function generateDeepSeekText(options: DeepSeekCallOptions) {
  const { response, release } = await createResponse(options, false);
  try {
    const body = await response.json() as {
      choices?: Array<{ message?: { content?: string | null } }>;
      usage?: unknown;
    };
    options.onUsage?.(normalizeUsage(body.usage));
    const text = body.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) throw new DeepSeekApiError("DeepSeek returned an empty response", 502);
    return text;
  } finally {
    release();
  }
}

export async function* streamDeepSeekText(
  options: DeepSeekCallOptions
): AsyncGenerator<string, void, unknown> {
  const { response, release } = await createResponse(options, true);
  const reader = response.body?.getReader();
  if (!reader) {
    release();
    throw new DeepSeekApiError("DeepSeek returned no response stream", 502);
  }
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const event of events) {
        const data = event
          .split("\n")
          .find((line) => line.startsWith("data:"))
          ?.slice(5)
          .trim();
        if (!data || data === "[DONE]") continue;
        const parsed = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string | null } }>;
          usage?: unknown;
        };
        if (parsed.usage) options.onUsage?.(normalizeUsage(parsed.usage));
        const text = parsed.choices?.[0]?.delta?.content ?? "";
        if (text) yield text;
      }
    }
  } finally {
    release();
    reader.releaseLock();
  }
}
