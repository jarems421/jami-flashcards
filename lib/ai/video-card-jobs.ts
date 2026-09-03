export const VIDEO_MAX_BYTES = 500 * 1024 * 1024;
export const VIDEO_MAX_SECONDS = 90 * 60;

export type VideoCoverage = "focused" | "standard" | "thorough";
export type VideoVisualType = "diagram" | "table" | "graph" | "equation" | "slide" | "worked_example";
export type VideoVisualClassification = "core_teaching" | "worked_example" | "practice_question" | "contextual_support" | "decorative_administrative" | "uncertain";
export type VideoJobStatus = "queued" | "running" | "ready" | "approved" | "failed" | "cancelled";
export type VideoJobStage = "preparing" | "reading_video" | "creating_cards" | "ready";

export type VideoCardDraft = {
  id: string;
  front: string;
  back: string;
  selected: boolean;
  timestampSeconds?: number;
  visualType?: VideoVisualType;
  evidenceIds: string[];
};

export type VideoCardWarning = {
  id: string;
  message: string;
  timestampSeconds?: number;
  visualType?: VideoVisualType;
};

export type VideoCardJob = {
  id: string;
  status: VideoJobStatus;
  stage: VideoJobStage;
  progress: number;
  title: string;
  deckId: string;
  topicIds: string[];
  coverage: VideoCoverage;
  focus?: string;
  durationSeconds: number;
  sourceKind: "youtube" | "upload";
  drafts: VideoCardDraft[];
  warnings: VideoCardWarning[];
  provider?: string;
  fallbackReason?: string;
  createdAt: number;
  updatedAt: number;
  failureMessage?: string;
};

const COVERAGE_COUNTS: Record<VideoCoverage, { min: number; max: number; target: number }> = {
  focused: { min: 8, max: 12, target: 10 },
  standard: { min: 12, max: 20, target: 16 },
  thorough: { min: 20, max: 35, target: 28 },
};

export function getVideoCoverageCounts(coverage: VideoCoverage) {
  return COVERAGE_COUNTS[coverage];
}

export function parseVideoCoverage(value: unknown): VideoCoverage | null {
  return value === "focused" || value === "standard" || value === "thorough" ? value : null;
}

export function chooseVideoRoute(input: { sourceKind: "youtube" | "upload"; isPublic: boolean; durationSeconds: number; qwenEnabled: boolean }) {
  const short = Number(process.env.VIDEO_QWEN_MAX_SECONDS ?? 300);
  const medium = Number(process.env.VIDEO_GEMINI_LITE_MAX_SECONDS ?? 1200);
  if (input.sourceKind === "youtube" && input.isPublic && input.qwenEnabled && input.durationSeconds <= short) {
    return { provider: "openrouter" as const, model: process.env.VIDEO_QWEN_MODEL?.trim() || "qwen/qwen3.7-flash", agentic: false };
  }
  if (input.durationSeconds <= medium) {
    return { provider: "gemini" as const, model: process.env.VIDEO_GEMINI_SHORT_MODEL?.trim() || "gemini-2.5-flash-lite", agentic: false };
  }
  return { provider: "gemini" as const, model: process.env.VIDEO_GEMINI_LONG_MODEL?.trim() || "gemini-3.5-flash-lite", agentic: true };
}

function cleanText(value: unknown, limit: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
}

export function mapVideoCardJobData(id: string, raw: Record<string, unknown>): VideoCardJob {
  const drafts = Array.isArray(raw.drafts) ? raw.drafts.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    const front = cleanText(value.front, 500);
    const back = cleanText(value.back, 4000);
    if (!front || !back) return [];
    return [{
      id: typeof value.id === "string" ? value.id : `card-${index + 1}`,
      front,
      back,
      selected: value.selected !== false,
      ...(typeof value.timestampSeconds === "number" ? { timestampSeconds: value.timestampSeconds } : {}),
      ...(typeof value.visualType === "string" ? { visualType: value.visualType as VideoVisualType } : {}),
      evidenceIds: Array.isArray(value.evidenceIds) ? value.evidenceIds.filter((entry): entry is string => typeof entry === "string").slice(0, 12) : [],
    }];
  }) : [];
  const warnings = Array.isArray(raw.warnings) ? raw.warnings.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    const message = cleanText(value.message, 300);
    return message ? [{ id: typeof value.id === "string" ? value.id : `warning-${index + 1}`, message,
      ...(typeof value.timestampSeconds === "number" ? { timestampSeconds: value.timestampSeconds } : {}),
      ...(typeof value.visualType === "string" ? { visualType: value.visualType as VideoVisualType } : {}),
    }] : [];
  }) : [];
  return {
    id,
    status: (raw.status as VideoJobStatus) || "queued",
    stage: (raw.stage as VideoJobStage) || "preparing",
    progress: typeof raw.progress === "number" ? raw.progress : 0,
    title: cleanText(raw.title, 160) || "Video import",
    deckId: typeof raw.deckId === "string" ? raw.deckId : "",
    topicIds: Array.isArray(raw.topicIds) ? raw.topicIds.filter((v): v is string => typeof v === "string") : [],
    coverage: parseVideoCoverage(raw.coverage) || "standard",
    ...(cleanText(raw.focus, 500) ? { focus: cleanText(raw.focus, 500) } : {}),
    durationSeconds: typeof raw.durationSeconds === "number" ? raw.durationSeconds : 0,
    sourceKind: raw.sourceKind === "upload" ? "upload" : "youtube",
    drafts,
    warnings,
    ...(typeof raw.provider === "string" ? { provider: raw.provider } : {}),
    ...(typeof raw.fallbackReason === "string" ? { fallbackReason: raw.fallbackReason } : {}),
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : 0,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
    ...(typeof raw.failureMessage === "string" ? { failureMessage: raw.failureMessage } : {}),
  };
}

export function formatVideoTimestamp(seconds?: number) {
  if (seconds === undefined || !Number.isFinite(seconds)) return "";
  const rounded = Math.max(0, Math.floor(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}
