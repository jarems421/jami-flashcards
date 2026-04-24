import {
  cleanGeneratedCardBack,
  cleanGeneratedStudyText,
} from "@/lib/ai/card-autocomplete";
import {
  MAX_BACK_LENGTH,
  MAX_FRONT_LENGTH,
  normalizeCardContentInput,
} from "@/lib/study/cards";

export const MIN_NOTES_FOR_CARD_GENERATION = 80;
export const MAX_NOTES_FOR_CARD_GENERATION = 12_000;
export const MIN_GENERATED_CARDS = 3;
export const MAX_GENERATED_CARDS = 24;

export type GeneratedCardDraft = {
  front: string;
  back: string;
};

function clampGeneratedCardCount(value: unknown) {
  const count = typeof value === "number" && Number.isFinite(value) ? value : 8;
  return Math.max(MIN_GENERATED_CARDS, Math.min(MAX_GENERATED_CARDS, Math.round(count)));
}

export function getGeneratedCardCount(value: unknown) {
  return clampGeneratedCardCount(value);
}

function extractJsonArray(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    return trimmed;
  }

  const match = trimmed.match(/\[[\s\S]*\]/);
  return match ? match[0] : trimmed;
}

function normalizeGeneratedDraft(value: unknown): GeneratedCardDraft | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const frontValue = record.front ?? record.question ?? record.prompt;
  const backValue = record.back ?? record.answer ?? record.definition;
  const front =
    typeof frontValue === "string"
      ? normalizeCardContentInput(
          cleanGeneratedStudyText(frontValue, { stripLeadingLabel: true })
        )
      : "";
  const back =
    typeof backValue === "string"
      ? normalizeCardContentInput(cleanGeneratedCardBack(backValue))
      : "";

  if (!front || !back) {
    return null;
  }

  return {
    front: front.slice(0, MAX_FRONT_LENGTH),
    back: back.slice(0, MAX_BACK_LENGTH),
  };
}

function parseFallbackDrafts(text: string): GeneratedCardDraft[] {
  return text
    .split(/\n{2,}/)
    .map((block) => {
      const frontMatch = block.match(/(?:front|question|prompt)\s*:\s*(.+)/i);
      const backMatch = block.match(/(?:back|answer|definition)\s*:\s*([\s\S]+)/i);
      return normalizeGeneratedDraft({
        front: frontMatch?.[1],
        back: backMatch?.[1],
      });
    })
    .filter((draft): draft is GeneratedCardDraft => draft !== null);
}

export function parseGeneratedCardDrafts(text: string): GeneratedCardDraft[] {
  try {
    const parsed = JSON.parse(extractJsonArray(text)) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map(normalizeGeneratedDraft)
      .filter((draft): draft is GeneratedCardDraft => draft !== null);
  } catch {
    return parseFallbackDrafts(text);
  }
}
