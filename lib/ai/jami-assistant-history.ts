import type {
  JamiAssistantContext,
  JamiAssistantFollowUp,
  JamiAssistantUsedContext,
} from "@/lib/ai/jami-assistant";

export const JAMI_ASSISTANT_MAX_SAVED_THREADS = 50;
export const JAMI_ASSISTANT_MAX_THREAD_TITLE_LENGTH = 80;
export const JAMI_ASSISTANT_MAX_CONTEXT_LABEL_LENGTH = 120;
export const JAMI_ASSISTANT_MAX_SAVED_MESSAGE_LENGTH = 32_000;

export type JamiAssistantSavedContext =
  | {
      surface: "learn";
      cardId: string;
    }
  | {
      surface: "sources";
      sourceIds: string[];
    }
  | {
      surface: "notebook";
      notebookId: string;
      pageId: string;
    };

export type JamiAssistantThread = {
  id: string;
  title: string;
  surface: JamiAssistantSavedContext["surface"];
  contextKey: string;
  contextLabel: string;
  context: JamiAssistantSavedContext;
  lastMessagePreview: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
};

export type JamiAssistantStoredMessage = {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  text: string;
  used?: JamiAssistantUsedContext[];
  followUps?: JamiAssistantFollowUp[];
  createdAt: number;
};

function normalizeText(value: unknown, maxLength: number) {
  return typeof value === "string"
    ? value.trim().slice(0, maxLength)
    : "";
}

function normalizeId(value: unknown) {
  return normalizeText(value, 160);
}

function normalizeStringArray(value: unknown, maxItems: number) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.map((item) => normalizeId(item)).filter(Boolean))
  ).slice(0, maxItems);
}

function normalizeSavedContext(value: unknown): JamiAssistantSavedContext | null {
  if (!value || typeof value !== "object") return null;
  const context = value as Record<string, unknown>;
  if (context.surface === "learn") {
    const cardId = normalizeId(context.cardId);
    return cardId ? { surface: "learn", cardId } : null;
  }
  if (context.surface === "sources") {
    const sourceIds = normalizeStringArray(context.sourceIds, 5).sort();
    return sourceIds.length > 0 ? { surface: "sources", sourceIds } : null;
  }
  if (context.surface === "notebook") {
    const notebookId = normalizeId(context.notebookId);
    const pageId = normalizeId(context.pageId);
    return notebookId && pageId
      ? { surface: "notebook", notebookId, pageId }
      : null;
  }
  return null;
}

function normalizeUsedContext(value: unknown): JamiAssistantUsedContext[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      const item = candidate as Record<string, unknown>;
      const kind: JamiAssistantUsedContext["kind"] | null =
        item.kind === "current-context" ||
        item.kind === "source" ||
        item.kind === "general-knowledge"
          ? item.kind
          : null;
      const label = normalizeText(item.label, 160);
      if (!kind || !label) return [];
      const id = normalizeId(item.id);
      return [{ kind, label, ...(id ? { id } : {}) }];
    })
    .slice(0, 8);
}

function normalizeFollowUps(value: unknown): JamiAssistantFollowUp[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      const item = candidate as Record<string, unknown>;
      const label = normalizeText(item.label, 40);
      const prompt = normalizeText(item.prompt, 240);
      return label && prompt ? [{ label, prompt }] : [];
    })
    .slice(0, 2);
}

export function getJamiAssistantSavedContext(
  context: JamiAssistantContext
): JamiAssistantSavedContext {
  if (context.surface === "learn") {
    return { surface: "learn", cardId: context.cardId };
  }
  if (context.surface === "sources") {
    return { surface: "sources", sourceIds: [...context.sourceIds].sort() };
  }
  return {
    surface: "notebook",
    notebookId: context.notebookId,
    pageId: context.pageId,
  };
}

export function getJamiAssistantContextKey(
  context: JamiAssistantSavedContext | JamiAssistantContext
) {
  if (context.surface === "learn") return `learn:${context.cardId}`;
  if (context.surface === "sources") {
    return `sources:${[...context.sourceIds].sort().join(",")}`;
  }
  return `notebook:${context.notebookId}:page:${context.pageId}`;
}

export function createJamiAssistantThreadTitle(message: string) {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) return "New Jami chat";
  if (normalized.length <= JAMI_ASSISTANT_MAX_THREAD_TITLE_LENGTH) {
    return normalized;
  }
  return `${normalized
    .slice(0, JAMI_ASSISTANT_MAX_THREAD_TITLE_LENGTH - 3)
    .trimEnd()}...`;
}

export function mapJamiAssistantThread(
  id: string,
  data: Record<string, unknown>
): JamiAssistantThread | null {
  const context = normalizeSavedContext(data.context);
  const contextKey = normalizeText(data.contextKey, 520);
  if (!context || !contextKey) return null;
  const canonicalContextKey = getJamiAssistantContextKey(context);
  if (contextKey !== canonicalContextKey) return null;
  return {
    id,
    title:
      normalizeText(data.title, JAMI_ASSISTANT_MAX_THREAD_TITLE_LENGTH) ||
      "Jami chat",
    surface: context.surface,
    contextKey: canonicalContextKey,
    contextLabel:
      normalizeText(data.contextLabel, JAMI_ASSISTANT_MAX_CONTEXT_LABEL_LENGTH) ||
      "Study context",
    context,
    lastMessagePreview: normalizeText(data.lastMessagePreview, 180),
    messageCount:
      typeof data.messageCount === "number" && Number.isFinite(data.messageCount)
        ? Math.max(0, Math.round(data.messageCount))
        : 0,
    createdAt:
      typeof data.createdAt === "number" && Number.isFinite(data.createdAt)
        ? data.createdAt
        : 0,
    updatedAt:
      typeof data.updatedAt === "number" && Number.isFinite(data.updatedAt)
        ? data.updatedAt
        : 0,
  };
}

export function mapJamiAssistantStoredMessage(
  id: string,
  data: Record<string, unknown>
): JamiAssistantStoredMessage | null {
  const threadId = normalizeId(data.threadId);
  const role =
    data.role === "user" || data.role === "assistant" ? data.role : null;
  const text = normalizeText(data.text, JAMI_ASSISTANT_MAX_SAVED_MESSAGE_LENGTH);
  if (!threadId || !role || !text) return null;
  const used = normalizeUsedContext(data.used);
  const followUps = normalizeFollowUps(data.followUps);
  return {
    id,
    threadId,
    role,
    text,
    ...(used.length > 0 ? { used } : {}),
    ...(followUps.length > 0 ? { followUps } : {}),
    createdAt:
      typeof data.createdAt === "number" && Number.isFinite(data.createdAt)
        ? data.createdAt
        : 0,
  };
}
