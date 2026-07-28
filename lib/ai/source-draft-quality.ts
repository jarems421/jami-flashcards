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

/**
 * How thoroughly a source should be turned into study material.
 *
 * Depth rather than a raw number, because a student knows whether they want
 * the main ideas or full coverage, not whether they want six cards or nine.
 * It drives both how many drafts are asked for and how granular each one is,
 * so it is a real setting rather than a renamed count, and the ceiling keeps
 * the most expensive option bounded.
 */
export type SourceDraftDepth = "low" | "medium" | "high";

const DEPTH_COUNTS: Record<SourceDraftKind, Record<SourceDraftDepth, number>> = {
  flashcard: { low: 3, medium: 5, high: SOURCE_FLASHCARD_DRAFT_LIMIT },
  "practice-question": { low: 2, medium: 3, high: SOURCE_PRACTICE_DRAFT_LIMIT },
};

const DEPTH_PROMPTS: Record<SourceDraftDepth, string> = {
  low: "Depth: brief. Cover only the ideas the student cannot do without, one per draft. Leave out supporting detail, edge cases and anything peripheral.",
  medium:
    "Depth: standard. Cover the main ideas and the supporting detail that matters for recall. Skip edge cases unless the source stresses them.",
  high: "Depth: thorough. Work through the source closely: definitions, distinctions between similar ideas, conditions and exceptions, and any worked detail. Prefer several precise drafts over one broad one.",
};

export function isSourceDraftDepth(value: unknown): value is SourceDraftDepth {
  return value === "low" || value === "medium" || value === "high";
}

export function normalizeSourceDraftDepth(value: unknown): SourceDraftDepth {
  return isSourceDraftDepth(value) ? value : "medium";
}

export function getSourceDraftCountForDepth(kind: SourceDraftKind, depth: SourceDraftDepth) {
  return DEPTH_COUNTS[kind][depth];
}

export function getSourceDraftDepthPrompt(depth: SourceDraftDepth) {
  return DEPTH_PROMPTS[depth];
}

export function clampSourceDraftCount(kind: SourceDraftKind, value: unknown) {
  const fallback =
    kind === "flashcard" ? DEFAULT_SOURCE_FLASHCARD_DRAFT_COUNT : DEFAULT_SOURCE_PRACTICE_DRAFT_COUNT;
  const limit = kind === "flashcard" ? SOURCE_FLASHCARD_DRAFT_LIMIT : SOURCE_PRACTICE_DRAFT_LIMIT;
  const requested = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;

  return Math.max(1, Math.min(limit, requested));
}

/**
 * The prompt a draft asks, reduced to something two wordings can be compared on.
 *
 * Pressing Make twice on the same source asks the model the same thing twice, so
 * it tends to answer the same way. Comparing on the question alone rather than
 * the whole draft is deliberate: the same question with a differently worded
 * answer is still a second copy for the student to read and reject.
 */
export function getSourceDraftPromptKey(value: string) {
  return compact(value);
}

/**
 * Words that carry no meaning for telling two questions apart, so "what is the
 * name of" and "what is another name for" compare as the same question.
 */
const PROMPT_STOP_WORDS = new Set([
  "a", "an", "and", "another", "are", "as", "at", "be", "by", "do", "does", "for",
  "from", "in", "into", "is", "it", "its", "of", "on", "or", "state", "that",
  "the", "their", "them", "there", "these", "they", "this", "to", "what", "when",
  "where", "which", "who", "why", "with", "you", "your",
]);

function promptTerms(value: string) {
  return new Set(
    compact(value)
      .split(" ")
      .filter((word) => word.length > 1 && !PROMPT_STOP_WORDS.has(word))
  );
}

/**
 * How near two questions have to be before the second is not worth reviewing.
 *
 * Jaccard overlap of the meaningful words. Tuned against real repeats: "main
 * products" against "key products" scores about 0.71 and is the same card,
 * while "light-dependent reactions" against "light-independent reactions"
 * scores about 0.6 and is genuinely a different one.
 *
 * Erring towards dropping is safe here in a way it would not be elsewhere: a
 * draft is only ever discarded because an equivalent one is already sitting in
 * the review queue, so the concept is still in front of the student.
 */
const NEAR_DUPLICATE_THRESHOLD = 0.7;

function isNearDuplicate(candidate: Set<string>, existing: Set<string>) {
  if (candidate.size === 0 || existing.size === 0) return false;

  let shared = 0;
  for (const term of candidate) if (existing.has(term)) shared += 1;

  const union = candidate.size + existing.size - shared;
  return union > 0 && shared / union >= NEAR_DUPLICATE_THRESHOLD;
}

/** Tracks which questions have been kept, by exact key and by meaning. */
function createPromptMatcher(existingPromptKeys: readonly string[]) {
  const keys = new Set(existingPromptKeys);
  const termSets = existingPromptKeys.map(promptTerms);

  return {
    seen(prompt: string) {
      const key = getSourceDraftPromptKey(prompt);
      if (keys.has(key)) return true;
      const terms = promptTerms(prompt);
      return termSets.some((existing) => isNearDuplicate(terms, existing));
    },
    remember(prompt: string) {
      keys.add(getSourceDraftPromptKey(prompt));
      termSets.push(promptTerms(prompt));
    },
  };
}

export function filterSourceFlashcardDrafts(
  drafts: GeneratedCardDraft[],
  maxCount: number,
  existingPromptKeys: readonly string[] = []
) {
  const matcher = createPromptMatcher(existingPromptKeys);
  const safeCount = Math.max(1, Math.min(SOURCE_FLASHCARD_DRAFT_LIMIT, maxCount));

  return drafts
    .filter((draft) => {
      if (!isUsefulText(draft.front, 8) || !isUsefulText(draft.back, 1)) return false;
      if (isGenericPrompt(draft.front)) return false;
      if (compact(draft.front) === compact(draft.back)) return false;

      if (matcher.seen(draft.front)) return false;
      matcher.remember(draft.front);
      return true;
    })
    .slice(0, safeCount);
}

export function filterSourceQuestionDrafts(
  drafts: GeneratedQuestionDraft[],
  maxCount: number,
  existingPromptKeys: readonly string[] = []
) {
  const matcher = createPromptMatcher(existingPromptKeys);
  const safeCount = Math.max(1, Math.min(SOURCE_PRACTICE_DRAFT_LIMIT, maxCount));

  return drafts
    .filter((draft) => {
      if (!isUsefulText(draft.questionText, 10)) return false;
      if (!isUsefulText(draft.answerText, 1)) return false;
      if (isGenericPrompt(draft.questionText)) return false;

      if (matcher.seen(draft.questionText)) return false;
      matcher.remember(draft.questionText);
      return true;
    })
    .slice(0, safeCount);
}
