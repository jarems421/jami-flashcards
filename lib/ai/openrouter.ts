import "server-only";

import type { AiContentPart } from "@/lib/ai/content-parts";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MESSAGE = "Request timed out";

export type OpenRouterUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
};

export type OpenRouterRequest = {
  systemInstruction?: string;
  contents: readonly {
    role: "user" | "model";
    parts: readonly AiContentPart[];
  }[];
};

export type OpenRouterCallOptions = {
  apiKey: string;
  model: string;
  providerAllowlist: readonly string[];
  quantizations: readonly string[];
  request: OpenRouterRequest;
  timeoutMs: number;
  signal?: AbortSignal;
  reasoning: boolean;
  /** How hard to let it think. Defaults to a bounded `medium`. */
  reasoningEffort?: "low" | "medium" | "high";
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  json?: boolean;
  jsonSchema?: unknown;
  onUsage?: (usage: OpenRouterUsage) => void;
  onProvider?: (provider: string) => void;
};

export class OpenRouterApiError extends Error {
  status: number;
  errorType?: string;

  constructor(message: string, status: number, errorType?: string) {
    super(message);
    this.name = "OpenRouterApiError";
    this.status = status;
    this.errorType = errorType;
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

type OpenRouterContent =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

function toContent(parts: readonly AiContentPart[]): OpenRouterContent[] {
  return parts.map((part) => {
    if ("text" in part) return { type: "text", text: part.text };
    if (!part.inlineData.mimeType.startsWith("image/")) {
      throw new Error(
        "OpenRouter text roles accept text and images only. Parse documents before routing them."
      );
    }
    return {
      type: "image_url",
      image_url: {
        url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
      },
    };
  });
}

function toMessages(request: OpenRouterRequest) {
  const messages: Array<{
    role: "system" | "user" | "assistant";
    content: OpenRouterContent[];
  }> = [];
  if (request.systemInstruction?.trim()) {
    messages.push({
      role: "system",
      content: [{ type: "text", text: request.systemInstruction.trim() }],
    });
  }
  for (const message of request.contents) {
    messages.push({
      role: message.role === "model" ? "assistant" : "user",
      content: toContent(message.parts),
    });
  }
  return messages;
}

export function buildOpenRouterRequestBody(
  options: OpenRouterCallOptions,
  stream: boolean
) {
  if (options.providerAllowlist.length === 0) {
    throw new Error("An explicit OpenRouter provider allowlist is required.");
  }
  if (options.quantizations.length === 0) {
    throw new Error("An explicit OpenRouter precision allowlist is required.");
  }
  return {
    model: options.model,
    messages: toMessages(options.request),
    stream,
    provider: {
      only: [...options.providerAllowlist],
      allow_fallbacks: true,
      require_parameters: true,
      data_collection: "deny" as const,
      zdr: true,
      quantizations: [...options.quantizations],
    },
    /**
     * Reasoning, bounded.
     *
     * This asked for reasoning with no effort ceiling. Thinking tokens are
     * still tokens: they consume the output budget and the clock, and
     * `exclude: true` only hides them from the reply. A model willing to think
     * at length will do exactly that.
     *
     * Measured against the paper design pass, which asks for a 20,000 token
     * structured paper. The same model, provider and prompt answered in one to
     * three seconds with effort capped, and in a direct streaming test finished
     * in 46 seconds. Through this path, uncapped, it spent the full 600-second
     * ceiling thinking and returned nothing -- three runs, no paper, and a
     * timeout that looked like a provider fault.
     *
     * `medium` is the cap because it is what was measured working, not because
     * it is tuned. A caller wanting more should have to say so.
     */
    ...(options.reasoning
      ? { reasoning: { enabled: true, exclude: true, effort: options.reasoningEffort ?? "medium" } }
      : {}),
    ...(options.jsonSchema
      ? {
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "jami_response",
              strict: true,
              schema: toOpenRouterJsonSchema(options.jsonSchema),
            },
          },
        }
      : options.json
        ? { response_format: { type: "json_object" } }
        : {}),
    ...(options.temperature === undefined
      ? {}
      : { temperature: options.temperature }),
    ...(options.topP === undefined ? {} : { top_p: options.topP }),
    ...(options.maxOutputTokens === undefined
      ? {}
      : { max_tokens: options.maxOutputTokens }),
  };
}

function toOpenRouterJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toOpenRouterJsonSchema);
  if (!value || typeof value !== "object") return value;
  const input = value as Record<string, unknown>;
  const converted = Object.fromEntries(
    Object.entries(input).flatMap(([key, item]) => {
      if (item === undefined) return [];
      if (key === "format" && item === "enum") return [];
      if (key === "type" && typeof item === "string") {
        return [[key, item.toLowerCase()]];
      }
      return [[key, toOpenRouterJsonSchema(item)]];
    })
  );
  if (converted.type === "object" && converted.additionalProperties === undefined) {
    converted.additionalProperties = false;
  }
  return converted;
}

function numberOrUndefined(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeUsage(value: unknown): OpenRouterUsage {
  const usage = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  return {
    promptTokens: numberOrUndefined(usage.prompt_tokens),
    completionTokens: numberOrUndefined(usage.completion_tokens),
    totalTokens: numberOrUndefined(usage.total_tokens),
    estimatedCostUsd: numberOrUndefined(usage.cost),
  };
}

function safeErrorType(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const error = value as {
    error?: { metadata?: { error_type?: unknown } };
    metadata?: { error_type?: unknown };
  };
  const candidate = error.error?.metadata?.error_type ?? error.metadata?.error_type;
  return typeof candidate === "string" ? candidate.slice(0, 80) : undefined;
}

async function createResponse(options: OpenRouterCallOptions, stream: boolean) {
  const attempt = createAttemptSignal(options.timeoutMs, options.signal);
  try {
    const response = await fetch(OPENROUTER_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-OpenRouter-Cache": "false",
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://jami.app",
        "X-Title": "Jami",
      },
      body: JSON.stringify(buildOpenRouterRequestBody(options, stream)),
      signal: attempt.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      let errorType: string | undefined;
      try {
        errorType = safeErrorType(await response.json());
      } catch {
        // Provider response bodies are deliberately not echoed or logged.
      }
      throw new OpenRouterApiError(
        `OpenRouter request failed with status ${response.status}.`,
        response.status,
        errorType
      );
    }
    return { response, release: attempt.release };
  } catch (error) {
    attempt.release();
    if (options.signal?.aborted) throw error;
    if (attempt.signal.aborted) throw new Error(TIMEOUT_MESSAGE);
    throw error;
  }
}

type CompletionPayload = {
  provider?: unknown;
  choices?: Array<{
    message?: { content?: unknown };
    delta?: { content?: unknown };
    finish_reason?: unknown;
  }>;
  usage?: unknown;
  error?: unknown;
};

function textFromContent(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (!part || typeof part !== "object") return "";
    const candidate = part as { type?: unknown; text?: unknown };
    return candidate.type === "text" && typeof candidate.text === "string"
      ? candidate.text
      : "";
  }).join("");
}

function handleMetadata(payload: CompletionPayload, options: OpenRouterCallOptions) {
  if (payload.usage) options.onUsage?.(normalizeUsage(payload.usage));
  if (typeof payload.provider === "string") {
    options.onProvider?.(payload.provider.slice(0, 100));
  }
}

export async function generateOpenRouterText(options: OpenRouterCallOptions) {
  const { response, release } = await createResponse(options, false);
  try {
    const body = await response.json() as CompletionPayload;
    handleMetadata(body, options);
    if (body.error) {
      throw new OpenRouterApiError(
        "OpenRouter could not complete the request.",
        502,
        safeErrorType(body)
      );
    }
    const text = textFromContent(body.choices?.[0]?.message?.content).trim();
    if (!text) {
      throw new OpenRouterApiError("OpenRouter returned an empty response.", 502);
    }
    return text;
  } finally {
    release();
  }
}

function parseSseEvent(event: string) {
  const data = event
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
  if (!data || data === "[DONE]") return null;
  return JSON.parse(data) as CompletionPayload;
}

export async function* streamOpenRouterText(
  options: OpenRouterCallOptions
): AsyncGenerator<string, void, unknown> {
  const { response, release } = await createResponse(options, true);
  const reader = response.body?.getReader();
  if (!reader) {
    release();
    throw new OpenRouterApiError("OpenRouter returned no response stream.", 502);
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let receivedText = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? "";
      if (done && buffer.trim()) {
        events.push(buffer);
        buffer = "";
      }
      for (const event of events) {
        const parsed = parseSseEvent(event);
        if (!parsed) continue;
        handleMetadata(parsed, options);
        if (parsed.error) {
          throw new OpenRouterApiError(
            "OpenRouter stream ended with a provider error.",
            502,
            safeErrorType(parsed)
          );
        }
        const text = textFromContent(parsed.choices?.[0]?.delta?.content);
        if (text) {
          receivedText = true;
          yield text;
        }
      }
      if (done) break;
    }
    if (!receivedText) {
      throw new OpenRouterApiError("OpenRouter returned an empty response.", 502);
    }
  } finally {
    release();
    reader.releaseLock();
  }
}
