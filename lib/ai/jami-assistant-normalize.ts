import type {
  JamiAssistantCitation,
  JamiAssistantFollowUp,
  JamiAssistantUsedContext,
} from "@/lib/ai/jami-assistant";

export function normalizeAssistantText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function normalizeAssistantId(value: unknown) {
  return normalizeAssistantText(value, 160);
}

/**
 * `maxItems` caps the list when a thread is written to history, so a saved
 * thread cannot grow without bound. The live response path passes no cap.
 */
export function normalizeUsedContext(
  value: unknown,
  options: { maxItems?: number } = {}
): JamiAssistantUsedContext[] {
  if (!Array.isArray(value)) return [];

  const normalized = value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Record<string, unknown>;
    const kind: JamiAssistantUsedContext["kind"] | null =
      item.kind === "current-context" ||
      item.kind === "source" ||
      item.kind === "web" ||
      item.kind === "general-knowledge"
        ? item.kind
        : null;
    const label = normalizeAssistantText(item.label, 160);
    if (!kind || !label) return [];
    const id = normalizeAssistantId(item.id);
    return [{ kind, label, ...(id ? { id } : {}) }];
  });

  return options.maxItems === undefined
    ? normalized
    : normalized.slice(0, options.maxItems);
}

export function normalizeAssistantCitations(value: unknown): JamiAssistantCitation[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Record<string, unknown>;
    const title = normalizeAssistantText(item.title, 200);
    const rawUrl = normalizeAssistantText(item.url, 2_000);
    if (!title || !rawUrl) return [];
    try {
      const url = new URL(rawUrl);
      if ((url.protocol !== "https:" && url.protocol !== "http:") || seen.has(url.href)) {
        return [];
      }
      seen.add(url.href);
      return [{ title, url: url.href }];
    } catch {
      return [];
    }
  }).slice(0, 8);
}

export function normalizeFollowUps(value: unknown): JamiAssistantFollowUp[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      const item = candidate as Record<string, unknown>;
      const label = normalizeAssistantText(item.label, 40);
      const prompt = normalizeAssistantText(item.prompt, 240);
      return label && prompt ? [{ label, prompt }] : [];
    })
    .slice(0, 2);
}
