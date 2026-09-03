import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Timestamp } from "firebase-admin/firestore";
import {
  VIDEO_MAX_SECONDS,
  chooseVideoRoute,
  getVideoCoverageCounts,
  type VideoCardDraft,
  type VideoCardWarning,
  type VideoCoverage,
  type VideoVisualClassification,
  type VideoVisualType,
} from "@/lib/ai/video-card-jobs";
import { getAdminDb, getAdminStorageBucket } from "@/services/firebase/admin";
import { deleteTemporaryGeminiVideo, generateGeminiVideoText, uploadTemporaryGeminiVideo } from "@/lib/ai/gemini";
import { generateAiText } from "@/lib/ai/provider-router";

type Evidence = {
  id: string;
  timestampSeconds: number;
  kind: "concept" | "visual";
  visualType?: VideoVisualType;
  classification?: VideoVisualClassification;
  referenced: boolean;
  summary: string;
  facts: string[];
  exclusionReason?: string;
};

type Generation = {
  title: string;
  evidence: Evidence[];
  cards: VideoCardDraft[];
  warnings: VideoCardWarning[];
};

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(candidate) as Record<string, unknown>;
}

function valueText(value: unknown, limit: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
}

function safeUsage(value: unknown) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])));
}

const VISUAL_TYPES = new Set<VideoVisualType>(["diagram", "table", "graph", "equation", "slide", "worked_example"]);
const CLASSIFICATIONS = new Set<VideoVisualClassification>(["core_teaching", "worked_example", "practice_question", "contextual_support", "decorative_administrative", "uncertain"]);

export function parseAndValidateVideoGeneration(text: string, coverage: VideoCoverage): Generation {
  const raw = extractJson(text);
  const evidence: Evidence[] = Array.isArray(raw.evidence) ? raw.evidence.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    const summary = valueText(value.summary, 500);
    if (!summary) return [];
    const visualType = VISUAL_TYPES.has(value.visualType as VideoVisualType) ? value.visualType as VideoVisualType : undefined;
    const classification = CLASSIFICATIONS.has(value.classification as VideoVisualClassification) ? value.classification as VideoVisualClassification : undefined;
    return [{ id: valueText(value.id, 80) || `evidence-${index + 1}`, timestampSeconds: Math.max(0, Number(value.timestampSeconds) || 0), kind: value.kind === "visual" ? "visual" : "concept", ...(visualType ? { visualType } : {}), ...(classification ? { classification } : {}), referenced: value.referenced === true, summary, facts: Array.isArray(value.facts) ? value.facts.map((fact) => valueText(fact, 500)).filter(Boolean).slice(0, 12) : [], ...(valueText(value.exclusionReason, 300) ? { exclusionReason: valueText(value.exclusionReason, 300) } : {}) }];
  }) : [];
  const ids = new Set(evidence.map((entry) => entry.id));
  const seen = new Set<string>();
  const cards: VideoCardDraft[] = Array.isArray(raw.cards) ? raw.cards.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    const front = valueText(value.front, 500);
    const back = valueText(value.back, 4000);
    const key = front.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const evidenceIds = Array.isArray(value.evidenceIds) ? value.evidenceIds.filter((id): id is string => typeof id === "string" && ids.has(id)).slice(0, 12) : [];
    if (!front || !back || !evidenceIds.length || seen.has(key)) return [];
    seen.add(key);
    const visualType = VISUAL_TYPES.has(value.visualType as VideoVisualType) ? value.visualType as VideoVisualType : undefined;
    return [{ id: valueText(value.id, 80) || `card-${index + 1}`, front, back, selected: true, evidenceIds, ...(typeof value.timestampSeconds === "number" ? { timestampSeconds: Math.max(0, value.timestampSeconds) } : {}), ...(visualType ? { visualType } : {}) }];
  }) : [];
  const covered = new Set(cards.flatMap((card) => card.evidenceIds));
  const warnings: VideoCardWarning[] = Array.isArray(raw.warnings) ? raw.warnings.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    const message = valueText(value.message, 300);
    return message ? [{ id: `warning-${index + 1}`, message, ...(typeof value.timestampSeconds === "number" ? { timestampSeconds: value.timestampSeconds } : {}), ...(VISUAL_TYPES.has(value.visualType as VideoVisualType) ? { visualType: value.visualType as VideoVisualType } : {}) }] : [];
  }) : [];
  for (const visual of evidence.filter((entry) => entry.kind === "visual" && entry.referenced)) {
    const intentionallyExcluded = ["practice_question", "contextual_support", "decorative_administrative"].includes(visual.classification ?? "") && Boolean(visual.exclusionReason);
    if (!covered.has(visual.id) && !intentionallyExcluded && !warnings.some((warning) => warning.timestampSeconds === visual.timestampSeconds)) {
      warnings.push({ id: `warning-visual-${visual.id}`, message: "A potentially important visual could not be turned into a reliable text card.", timestampSeconds: visual.timestampSeconds, ...(visual.visualType ? { visualType: visual.visualType } : {}) });
    }
  }
  const { min, max } = getVideoCoverageCounts(coverage);
  if (cards.length < min || cards.length > max) throw new Error("card_count_out_of_range");
  return { title: valueText(raw.title, 160) || "Video import", evidence, cards: cards.slice(0, max), warnings: warnings.slice(0, 12) };
}

function promptFor(coverage: VideoCoverage, focus?: string) {
  const range = getVideoCoverageCounts(coverage);
  return `Study the entire video and return JSON only with title, evidence, cards, warnings. Create ${range.min}-${range.max} self-contained, detailed flashcards${focus ? ` focused on: ${focus}` : ""}. Evidence entries need id, timestampSeconds, kind (concept or visual), summary, facts, referenced, and for visuals visualType plus classification. Inventory every diagram, table, graph, equation, teaching slide, and worked example. Classifications: core_teaching, worked_example, practice_question, contextual_support, decorative_administrative, uncertain. Core teaching needs cards. Worked examples need reusable-method cards, not details tied only to the example. Practice questions may contribute the explanation but do not copy the question by default. Contextual/decorative items must have exclusionReason. If speech says “this graph/table/diagram shows”, inspect and account for it. Warnings are only for uncertain potentially important content. Each card needs id, front, back, evidenceIds, and useful timestampSeconds/visualType where relevant. Use only facts supported by evidence. Cards must be answerable without the video or an image.`;
}

async function callQwen(url: string, prompt: string) {
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "www.youtube.com" || !/^[A-Za-z0-9_-]{11}$/.test(parsedUrl.searchParams.get("v") || "")) {
    throw new Error("qwen_public_youtube_only");
  }
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("openrouter_not_configured");
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", cache: "no-store", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-OpenRouter-Cache": "false" }, body: JSON.stringify({ model: process.env.VIDEO_QWEN_MODEL?.trim() || "qwen/qwen3.7-flash", messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "video_url", video_url: { url } }] }], response_format: { type: "json_object" }, max_tokens: 16000, provider: { only: [process.env.VIDEO_QWEN_PROVIDER?.trim() || "Alibaba"], allow_fallbacks: false, require_parameters: true, data_collection: "deny", zdr: false } }) });
  if (!response.ok) throw new Error(`qwen_${response.status}`);
  const body = await response.json() as { choices?: Array<{ message?: { content?: unknown } }>; provider?: string; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number } };
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("qwen_empty");
  return { text: content, provider: body.provider || "Alibaba", usage: body.usage };
}

async function prepareGeminiUpload(storagePath: string, mimeType: string) {
  const directory = join(tmpdir(), `jami-video-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const path = join(directory, "upload");
  await getAdminStorageBucket().file(storagePath).download({ destination: path });
  const uploaded = await uploadTemporaryGeminiVideo({ path, mimeType });
  return { uri: uploaded.uri, name: uploaded.name, cleanup: async () => { await deleteTemporaryGeminiVideo(uploaded.name); await rm(directory, { recursive: true, force: true }); } };
}

async function refineCardsWithPrivateRouter(generation: Generation, coverage: VideoCoverage) {
  try {
    const text = await generateAiText({
      role: "worker",
      routeReason: "routine",
      timeoutMs: 45_000,
      request: { contents: [{ role: "user", parts: [{ text: [
        "Quality-check this grounded video flashcard batch. Return the same JSON shape only.",
        "Remove duplicates, vague prompts, unsupported claims, and cards that depend on seeing the original video.",
        "Preserve evidence IDs exactly. Do not add facts. Keep every referenced visual accounted for.",
        JSON.stringify(generation),
      ].join("\n\n") }] }] },
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: 12_000 },
    });
    return parseAndValidateVideoGeneration(text, coverage);
  } catch {
    // The grounded provider result has already passed deterministic checks;
    // refinement is a quality pass, not a reason to discard a usable import.
    return generation;
  }
}

export async function generateVideoCardsForJob(uid: string, jobId: string) {
  const ref = getAdminDb().collection("users").doc(uid).collection("videoCardJobs").doc(jobId);
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.data()?.cancellationRequested) return;
  const job = snapshot.data() ?? {};
  await ref.update({ status: "running", stage: "reading_video", progress: 30, providerStartedAt: Date.now(), updatedAt: Date.now() });
  const sourceKind = job.sourceKind === "upload" ? "upload" : "youtube";
  const durationSeconds = Number(job.durationSeconds) || 0;
  if (durationSeconds <= 0 || durationSeconds > VIDEO_MAX_SECONDS) throw new Error("invalid_duration");
  const route = chooseVideoRoute({ sourceKind, isPublic: job.youtubePublic === true, durationSeconds, qwenEnabled: process.env.VIDEO_QWEN_ENABLED === "true" });
  const prompt = promptFor(job.coverage as VideoCoverage, typeof job.focus === "string" ? job.focus : undefined);
  let cleanup: () => Promise<void> = async () => {};
  let uri = typeof job.youtubeUrl === "string" ? job.youtubeUrl : "";
  let mimeType = "video/mp4";
  if (sourceKind === "upload") {
    const prepared = await prepareGeminiUpload(String(job.storagePath), String(job.mimeType || "video/mp4"));
    uri = prepared.uri;
    mimeType = String(job.mimeType || "video/mp4");
    cleanup = prepared.cleanup;
  }
  let result: { text: string; provider: string; usage?: unknown };
  let fallbackReason: string | undefined;
  try {
    if (route.provider === "openrouter") {
      try {
        result = await callQwen(uri, prompt);
        parseAndValidateVideoGeneration(result.text, job.coverage as VideoCoverage);
      } catch (error) {
        fallbackReason = error instanceof Error ? error.message.slice(0, 120) : "qwen_quality_failure";
        result = await generateGeminiVideoText({ uri, mimeType, model: process.env.VIDEO_GEMINI_SHORT_MODEL?.trim() || "gemini-2.5-flash-lite", agentic: false, prompt });
      }
    } else result = await generateGeminiVideoText({ uri, mimeType, model: route.model, agentic: route.agentic, prompt });
    if ((await ref.get()).data()?.cancellationRequested) return;
    await ref.update({ stage: "creating_cards", progress: 75, updatedAt: Date.now() });
    const initial = parseAndValidateVideoGeneration(result.text, job.coverage as VideoCoverage);
    const parsed = await refineCardsWithPrivateRouter(initial, job.coverage as VideoCoverage);
    const now = Date.now();
    const visualIds = new Set(parsed.evidence.filter((item) => item.kind === "visual").map((item) => item.id));
    await ref.update({ status: "ready", stage: "ready", progress: 100, title: parsed.title, drafts: parsed.cards, warnings: parsed.warnings, evidence: parsed.evidence, provider: result.provider, model: route.provider === "openrouter" && fallbackReason ? (process.env.VIDEO_GEMINI_SHORT_MODEL?.trim() || "gemini-2.5-flash-lite") : route.model, ...(fallbackReason ? { fallbackReason } : {}), usage: safeUsage(result.usage), detectedVisuals: visualIds.size, coveredVisuals: new Set(parsed.cards.flatMap((card) => card.evidenceIds).filter((id) => visualIds.has(id))).size, completedAt: now, expiresAt: Timestamp.fromMillis(now + 24 * 60 * 60_000), updatedAt: now });
  } finally {
    await cleanup();
    if (sourceKind === "upload" && typeof job.storagePath === "string") await getAdminStorageBucket().file(job.storagePath).delete({ ignoreNotFound: true }).catch(() => undefined);
  }
}
