import type { GeneratedCardDraft } from "@/lib/ai/card-generation";
import type { GeneratedQuestionDraft } from "@/lib/ai/question-generation";

export type SourceDraftKind = "flashcard" | "practice-question";

export const SOURCE_FLASHCARD_DRAFT_LIMIT = 8;
export const SOURCE_PRACTICE_DRAFT_LIMIT = 5;
export const DEFAULT_SOURCE_FLASHCARD_DRAFT_COUNT = 5;
export const DEFAULT_SOURCE_PRACTICE_DRAFT_COUNT = 3;

const GENERIC_PROMPTS = [
  "summarise this source",
  "summarize this source",
  "what is this source about",
  "what does the source say",
  "explain this source",
  "key ideas in this source",
];

function compact(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isGenericPrompt(value: string) {
  const normalized = compact(value);
  return GENERIC_PROMPTS.some((prompt) => normalized === prompt || normalized.includes(prompt));
}

function isUsefulText(value: string | undefined, minimumLength: number) {
  return Boolean(value && value.trim().length >= minimumLength);
}

export function clampSourceDraftCount(kind: SourceDraftKind, value: unknown) {
  const fallback =
    kind === "flashcard" ? DEFAULT_SOURCE_FLASHCARD_DRAFT_COUNT : DEFAULT_SOURCE_PRACTICE_DRAFT_COUNT;
  const limit = kind === "flashcard" ? SOURCE_FLASHCARD_DRAFT_LIMIT : SOURCE_PRACTICE_DRAFT_LIMIT;
  const requested = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;

  return Math.max(1, Math.min(limit, requested));
}

export function filterSourceFlashcardDrafts(drafts: GeneratedCardDraft[], maxCount: number) {
  const seen = new Set<string>();
  const safeCount = Math.max(1, Math.min(SOURCE_FLASHCARD_DRAFT_LIMIT, maxCount));

  return drafts
    .filter((draft) => {
      if (!isUsefulText(draft.front, 8) || !isUsefulText(draft.back, 1)) return false;
      if (isGenericPrompt(draft.front)) return false;
      if (compact(draft.front) === compact(draft.back)) return false;

      const key = `${compact(draft.front)}::${compact(draft.back)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, safeCount);
}

export function filterSourceQuestionDrafts(drafts: GeneratedQuestionDraft[], maxCount: number) {
  const seen = new Set<string>();
  const safeCount = Math.max(1, Math.min(SOURCE_PRACTICE_DRAFT_LIMIT, maxCount));

  return drafts
    .filter((draft) => {
      if (!isUsefulText(draft.questionText, 10)) return false;
      if (!isUsefulText(draft.answerText, 1)) return false;
      if (isGenericPrompt(draft.questionText)) return false;

      const key = compact(draft.questionText);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, safeCount);
}
