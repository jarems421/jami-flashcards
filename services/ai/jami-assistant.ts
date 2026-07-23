import type {
  JamiAssistantRequest,
  JamiAssistantResponse,
  JamiAssistantSourceFailure,
  JamiAssistantUsedContext,
} from "@/lib/ai/jami-assistant";
import { auth } from "@/services/firebase/client";

function getFriendlyAssistantError(status: number, message?: string) {
  if (status === 401) return "Sign in again to ask Jami.";
  if (status === 404) return message || "Jami could not find the current study item.";
  if (status === 413) return message || "That context is too large for Jami to read at once.";
  if (status === 429) return "Jami has reached today's AI limit. Try again tomorrow.";
  if (status === 503) return "Jami AI is not configured in this deployment yet.";
  if (status >= 500) return message || "Jami could not answer just now. Try again in a moment.";
  return message || "Jami could not answer that just now.";
}

function normalizeUsedContext(value: unknown): JamiAssistantUsedContext[] {
  if (!Array.isArray(value)) return [];
  const normalized: JamiAssistantUsedContext[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const item = candidate as Record<string, unknown>;
    const kind =
      item.kind === "current-context" ||
      item.kind === "source" ||
      item.kind === "general-knowledge"
        ? item.kind
        : null;
    const label =
      typeof item.label === "string" ? item.label.trim().slice(0, 160) : "";
    if (!kind || !label) continue;
    normalized.push({
      kind,
      label,
      ...(typeof item.id === "string" && item.id.trim()
        ? { id: item.id.trim().slice(0, 160) }
        : {}),
    });
  }
  return normalized;
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

export async function sendJamiAssistantMessage(
  input: JamiAssistantRequest
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
  });
  const data = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!response.ok) {
    throw new Error(
      getFriendlyAssistantError(
        response.status,
        typeof data?.error === "string" ? data.error : undefined
      )
    );
  }

  const reply = typeof data?.reply === "string" ? data.reply.trim() : "";
  const used = normalizeUsedContext(data?.used);
  if (!reply || used.length === 0) {
    throw new Error("Jami returned an incomplete answer. Try again.");
  }

  const sourceFailures = normalizeSourceFailures(data?.sourceFailures);
  return {
    reply,
    used,
    ...(sourceFailures.length > 0 ? { sourceFailures } : {}),
  };
}
