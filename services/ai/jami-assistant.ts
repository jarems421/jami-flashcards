import type {
  JamiAssistantRequest,
  JamiAssistantResponse,
  JamiAssistantSourceFailure,
} from "@/lib/ai/jami-assistant";
import {
  normalizeFollowUps,
  normalizeUsedContext,
} from "@/lib/ai/jami-assistant-normalize";
import { auth } from "@/services/firebase/client";

function getFriendlyAssistantError(
  status: number,
  message?: string,
  code?: string
) {
  if (status === 401) return "Sign in again to ask Jami.";
  if (status === 404) return message || "Jami could not find the current study item.";
  if (status === 413) return message || "That context is too large for Jami to read at once.";
  if (status === 429) {
    return code === "burst_limit"
      ? message || "Jami is receiving requests too quickly. Try again in a moment."
      : "Jami has reached today's AI limit. Try again tomorrow.";
  }
  if (status === 503) {
    return code === "budget_unavailable"
      ? message || "AI usage limits are temporarily unavailable. Try again shortly."
      : "Jami AI is not configured in this deployment yet.";
  }
  if (status >= 500) return message || "Jami could not answer just now. Try again in a moment.";
  return message || "Jami could not answer that just now.";
}

function normalizeSourceFailures(value: unknown): JamiAssistantSourceFailure[] {
  if (!Array.isArray(value)) return [];
  const normalized: JamiAssistantSourceFailure[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const item = candidate as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id.trim().slice(0, 160) : "";
    const title =
      typeof item.title === "string" ? item.title.trim().slice(0, 160) : "";
    const reason =
      typeof item.reason === "string" ? item.reason.trim().slice(0, 500) : "";
    if (id && title && reason) normalized.push({ id, title, reason });
  }
  return normalized;
}

/**
 * Reads the newline-delimited stream the assistant route returns.
 *
 * Text events carry the answer as it is generated and are forwarded to
 * onChunk; the single terminal event carries the validated receipt, or an
 * error raised after the response had already started.
 */
async function readAssistantStream(
  response: Response,
  onChunk?: (textSoFar: string) => void
): Promise<Record<string, unknown> | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;

  const decoder = new TextDecoder();
  let pending = "";
  let textSoFar = "";
  let result: Record<string, unknown> | null = null;

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      // Ignore one malformed SSE event so later valid events can still finish
      // the streamed answer.
      return;
    }

    if (event.type === "text" && typeof event.value === "string") {
      textSoFar += event.value;
      onChunk?.(textSoFar);
      return;
    }
    if (event.type === "error") {
      throw new Error(
        typeof event.error === "string"
          ? event.error
          : "Jami could not finish that answer just now."
      );
    }
    if (event.type === "done") {
      result = event;
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    pending += decoder.decode(value, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    lines.forEach(handleLine);
  }
  handleLine(pending);

  return result;
}

export async function sendJamiAssistantMessage(
  input: JamiAssistantRequest,
  onChunk?: (textSoFar: string) => void,
  /**
   * Abandons the answer. Dropping the request is what tells the route to stop
   * generating, so without one a closed drawer left the provider running to the
   * end and the student paying for an answer they would never see.
   */
  signal?: AbortSignal
): Promise<JamiAssistantResponse> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  const token = await user.getIdToken();

  const response = await fetch("/api/ai/assistant", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
    ...(signal ? { signal } : {}),
  });

  // Everything that can fail before generation starts still answers with JSON,
  // so a non-ok response is read the same way it always was.
  if (!response.ok) {
    const failure = (await response.json().catch(() => {
      // Infrastructure may replace the JSON API error body; status-based
      // fallback copy remains actionable without exposing that payload.
      return null;
    })) as Record<
      string,
      unknown
    > | null;
    throw new Error(
      getFriendlyAssistantError(
        response.status,
        typeof failure?.error === "string" ? failure.error : undefined,
        typeof failure?.code === "string" ? failure.code : undefined
      )
    );
  }

  const data = await readAssistantStream(response, onChunk);

  const reply = typeof data?.reply === "string" ? data.reply.trim() : "";
  const used = normalizeUsedContext(data?.used);
  if (!reply || used.length === 0) {
    throw new Error("Jami returned an incomplete answer. Try again.");
  }

  const sourceFailures = normalizeSourceFailures(data?.sourceFailures);
  const followUps = normalizeFollowUps(data?.followUps);
  return {
    reply,
    used,
    ...(followUps.length > 0 ? { followUps } : {}),
    ...(sourceFailures.length > 0 ? { sourceFailures } : {}),
  };
}
