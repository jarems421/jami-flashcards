import { createHash } from "node:crypto";
import type { CardStudySettings } from "@/lib/study/study-modes";

/**
 * Everything a model is asked to add to one card, in one document.
 *
 * One combined asset rather than four calls: the aliases, the concepts, the
 * safe gaps and the distractors all depend on reading the same answer, and
 * asking four times would pay for that reading four times.
 */
export type StudyAsset = {
  cardId: string;
  answerShape: "numeric" | "list" | "short" | "prose";
  acceptedAliases: string[];
  requiredConcepts: string[];
  clozeCandidates: string[];
  distractors: string[];
  misconceptions: Record<string, string>;
  confidence: number;
  ambiguous: boolean;
};

export const STUDY_ASSET_SCHEMA_VERSION = 1;
export const STUDY_ASSET_PROMPT_VERSION = 1;

/** Below this the asset is discarded rather than used with a warning. */
export const MIN_ASSET_CONFIDENCE = 0.6;

export const MAX_CARDS_PER_JOB = 100;
export const MAX_CARDS_PER_BATCH = 20;

const MAX_ALIASES = 6;
const MAX_CONCEPTS = 5;
const MAX_CLOZE_CANDIDATES = 4;
const MAX_DISTRACTORS = 6;
const MIN_DISTRACTORS = 5;
const MAX_FIELD_LENGTH = 200;

/**
 * The cache key.
 *
 * Includes both version numbers, so changing the prompt or the shape of the
 * asset invalidates every cached document rather than mixing two generations of
 * output in one deck. Author settings are in the key too: a card whose accepted
 * answers changed is, for this purpose, a different card.
 */
export function getStudyAssetCacheKey(input: {
  front: string;
  back: string;
  studySettings?: CardStudySettings;
}) {
  const material = JSON.stringify({
    front: input.front.normalize("NFKC").trim(),
    back: input.back.normalize("NFKC").trim(),
    settings: input.studySettings ?? null,
    schema: STUDY_ASSET_SCHEMA_VERSION,
    prompt: STUDY_ASSET_PROMPT_VERSION,
  });
  return createHash("sha256").update(material).digest("hex");
}

export const STUDY_ASSET_SYSTEM_PROMPT = `You prepare study material for flashcards a student already wrote.

Return ONLY a JSON object. No prose, no markdown fence.

For each card you are given, produce one entry:
{
  "cardId": string,
  "answerShape": "numeric" | "list" | "short" | "prose",
  "acceptedAliases": string[],
  "requiredConcepts": string[],
  "clozeCandidates": string[],
  "distractors": string[],
  "misconceptions": { "<distractor text>": "<one short sentence on why a student might pick it>" },
  "confidence": number between 0 and 1,
  "ambiguous": boolean
}

Rules you must not break:
- NEVER rewrite, correct, improve or replace the card's answer. You are adding to it, not editing it.
- acceptedAliases are other ways to write THE SAME answer. Not related answers. Not broader answers.
- requiredConcepts are the ideas a correct answer must contain, each a short noun phrase.
- clozeCandidates must be exact substrings of the card's answer, copied character for character.
- distractors must be plausible and DEFINITELY WRONG. Never a second correct answer, never a synonym of the answer.
- Give ${MIN_DISTRACTORS} or ${MAX_DISTRACTORS} distractors so weak ones can be discarded.
- Match the answer's length and grammatical form: a one-word answer gets one-word distractors.
- Set ambiguous true and confidence low when the card is unclear, has more than one defensible answer, or you are guessing.
- An honest low confidence is worth more than a confident invention.

Respond as: { "assets": [ ... ] }`;

export function buildStudyAssetUserPrompt(
  cards: Array<{ id: string; front: string; back: string }>
) {
  return cards
    .map(
      (card, index) =>
        `--- Card ${index + 1} (id: ${card.id}) ---\nQuestion: ${card.front}\nAnswer: ${card.back}`
    )
    .join("\n\n");
}

function cleanStrings(value: unknown, limit: number) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim().slice(0, MAX_FIELD_LENGTH);
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    cleaned.push(trimmed);
    if (cleaned.length >= limit) break;
  }
  return cleaned;
}

function isAnswerShape(value: unknown): value is StudyAsset["answerShape"] {
  return (
    value === "numeric" || value === "list" || value === "short" || value === "prose"
  );
}

/**
 * Turn one model entry into an asset, or refuse it.
 *
 * The refusals matter more than the parsing. A cloze candidate that is not
 * actually in the answer would blank text that is not there; a distractor equal
 * to the answer would make a question with two right choices. Both are dropped
 * here rather than weakened into a warning downstream.
 */
export function validateStudyAsset(
  value: unknown,
  card: { id: string; back: string }
): StudyAsset | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (typeof data.cardId !== "string" || data.cardId.trim() !== card.id) return null;

  const confidence =
    typeof data.confidence === "number" && Number.isFinite(data.confidence)
      ? Math.min(1, Math.max(0, data.confidence))
      : 0;
  const ambiguous = data.ambiguous === true;
  if (ambiguous || confidence < MIN_ASSET_CONFIDENCE) return null;

  const answerNormalized = card.back.trim().toLowerCase();
  const clozeCandidates = cleanStrings(data.clozeCandidates, MAX_CLOZE_CANDIDATES)
    // Must exist verbatim in the immutable answer, or the blank would hide text
    // the student never sees.
    .filter((candidate) => card.back.includes(candidate));

  const distractors = cleanStrings(data.distractors, MAX_DISTRACTORS).filter(
    (distractor) => distractor.trim().toLowerCase() !== answerNormalized
  );

  const misconceptions: Record<string, string> = {};
  if (data.misconceptions && typeof data.misconceptions === "object") {
    for (const [key, text] of Object.entries(
      data.misconceptions as Record<string, unknown>
    )) {
      if (typeof text !== "string" || !text.trim()) continue;
      if (!distractors.includes(key)) continue;
      misconceptions[key] = text.trim().slice(0, MAX_FIELD_LENGTH);
    }
  }

  return {
    cardId: card.id,
    answerShape: isAnswerShape(data.answerShape) ? data.answerShape : "short",
    acceptedAliases: cleanStrings(data.acceptedAliases, MAX_ALIASES).filter(
      (alias) => alias.trim().toLowerCase() !== answerNormalized
    ),
    requiredConcepts: cleanStrings(data.requiredConcepts, MAX_CONCEPTS),
    clozeCandidates,
    distractors,
    misconceptions,
    confidence,
    ambiguous: false,
  };
}

export function parseStudyAssetResponse(
  text: string,
  cards: Array<{ id: string; back: string }>
): StudyAsset[] {
  let parsed: unknown;
  try {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
    parsed = JSON.parse((fenced?.[1] ?? text).trim());
  } catch {
    return [];
  }

  const container =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).assets
      : parsed;
  if (!Array.isArray(container)) return [];

  const byId = new Map(cards.map((card) => [card.id, card]));
  const assets: StudyAsset[] = [];
  for (const entry of container) {
    const cardId =
      entry && typeof entry === "object"
        ? (entry as Record<string, unknown>).cardId
        : null;
    const card = typeof cardId === "string" ? byId.get(cardId.trim()) : undefined;
    if (!card) continue;
    const asset = validateStudyAsset(entry, card);
    if (asset) assets.push(asset);
  }
  return assets;
}

/** The asset, folded into the author settings the marker already understands. */
export function applyStudyAssetToSettings(
  asset: StudyAsset,
  settings: CardStudySettings | undefined
): CardStudySettings {
  // Author settings win throughout. Someone who has said what counts as a right
  // answer should not be overruled by a model.
  return {
    ...settings,
    acceptedAnswers:
      settings?.acceptedAnswers && settings.acceptedAnswers.length > 0
        ? settings.acceptedAnswers
        : asset.acceptedAliases,
    requiredConcepts:
      settings?.requiredConcepts && settings.requiredConcepts.length > 0
        ? settings.requiredConcepts
        : asset.requiredConcepts,
    pinnedGaps:
      settings?.pinnedGaps && settings.pinnedGaps.length > 0
        ? settings.pinnedGaps
        : asset.clozeCandidates,
    mcqDistractors:
      settings?.mcqDistractors && settings.mcqDistractors.length > 0
        ? settings.mcqDistractors
        : asset.distractors,
  };
}
