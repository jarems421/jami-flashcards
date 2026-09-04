import { splitMathRichText } from "@/lib/study/math-text";
import { markTypedAnswer } from "@/lib/study/answer-marking";
import type { CardStudySettings } from "@/lib/study/study-modes";

export type ClozeSpan = {
  start: number;
  end: number;
  answer: string;
};

/**
 * Words too common to be worth hiding. Blanking "the" tests nothing and reads
 * as a bug, so the whole class is refused rather than scored low.
 */
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "because", "been", "but", "by",
  "can", "do", "does", "for", "from", "had", "has", "have", "how", "if", "in",
  "into", "is", "it", "its", "may", "more", "most", "must", "not", "of", "on",
  "or", "over", "same", "should", "so", "some", "such", "than", "that", "the",
  "their", "them", "then", "there", "these", "they", "this", "through", "to",
  "under", "up", "was", "were", "what", "when", "where", "which", "while",
  "who", "why", "will", "with", "within", "would", "you", "your",
]);

const MIN_ANSWER_WORDS = 4;
const MIN_CANDIDATE_LENGTH = 3;
/** A gap that swallows most of the answer is not a gap, it is Type Answer. */
const MAX_GAP_SHARE_OF_ANSWER = 0.5;

const WORD_PATTERN = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

type Candidate = {
  start: number;
  end: number;
  text: string;
  score: number;
};

/**
 * Regions the blank must never touch: maths, inline code and fenced code.
 *
 * Hiding half of `$E = mc^2$` leaves markup that cannot render, and hiding part
 * of a code span changes what the code means. Both are refused outright rather
 * than repaired.
 */
function protectedRanges(text: string) {
  const ranges: Array<[number, number]> = [];

  let cursor = 0;
  for (const segment of splitMathRichText(text)) {
    if (segment.type === "math") {
      // The splitter reports the inner value, so find the delimited run that
      // produced it rather than trusting a reconstructed length.
      const index = text.indexOf(segment.value, cursor);
      if (index >= 0) {
        ranges.push([Math.max(0, index - 2), index + segment.value.length + 2]);
        cursor = index + segment.value.length;
      }
    } else {
      cursor += segment.value.length;
    }
  }

  for (const match of text.matchAll(/```[\s\S]*?```|`[^`\n]+`/g)) {
    const index = match.index ?? -1;
    if (index >= 0) ranges.push([index, index + match[0].length]);
  }

  return ranges;
}

function overlapsProtected(
  ranges: Array<[number, number]>,
  start: number,
  end: number
) {
  return ranges.some(([from, to]) => start < to && end > from);
}

function scoreCandidate(word: string, questionWords: Set<string>) {
  const lower = word.toLowerCase();
  if (STOP_WORDS.has(lower)) return 0;
  if (questionWords.has(lower)) return 0;

  const isNumber = /^\d/.test(word);
  if (!isNumber && word.length < MIN_CANDIDATE_LENGTH) return 0;

  let score = Math.min(word.length, 14);
  // A number is usually the whole point of the sentence it sits in.
  if (isNumber) score += 8;
  // A capital mid-sentence is a name or a defined term.
  if (/^[A-Z]/.test(word)) score += 5;
  if (word.length > 7) score += 3;
  return score;
}

/**
 * Choose one span of the answer to hide.
 *
 * Deterministic: the same card always yields the same blank, so a resumed
 * session shows the student the gap they were already looking at. Returns null
 * when nothing safe presents itself, and a card with no safe gap is simply not
 * offered Gap Fill.
 */
export function selectClozeSpan(input: {
  front: string;
  back: string;
  settings?: CardStudySettings;
}): ClozeSpan | null {
  const back = input.back ?? "";
  if (!back.trim()) return null;

  const ranges = protectedRanges(back);
  const questionWords = new Set(
    (input.front ?? "").toLowerCase().match(WORD_PATTERN) ?? []
  );

  const words = [...back.matchAll(WORD_PATTERN)];
  const totalWords = words.filter(
    (match) => !overlapsProtected(ranges, match.index ?? 0, (match.index ?? 0) + match[0].length)
  ).length;
  if (totalWords < MIN_ANSWER_WORDS) return null;

  const pinned = (input.settings?.pinnedGaps ?? [])
    .map((value) => value.trim())
    .filter(Boolean);
  for (const pin of pinned) {
    const index = back.indexOf(pin);
    if (index >= 0 && !overlapsProtected(ranges, index, index + pin.length)) {
      return { start: index, end: index + pin.length, answer: pin };
    }
  }

  const candidates: Candidate[] = [];
  for (const match of words) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (overlapsProtected(ranges, start, end)) continue;
    const score = scoreCandidate(match[0], questionWords);
    if (score <= 0) continue;
    candidates.push({ start, end, text: match[0], score });
  }
  if (candidates.length === 0) return null;

  // Ties break on position so the choice never depends on sort stability.
  candidates.sort((left, right) =>
    right.score - left.score || left.start - right.start
  );

  const best = candidates[0];
  const gapWords = best.text.trim().split(/\s+/).length;
  if (gapWords / totalWords > MAX_GAP_SHARE_OF_ANSWER) return null;

  return { start: best.start, end: best.end, answer: best.text };
}

/** The answer with the span replaced by a blank, for display. */
export function renderClozePrompt(back: string, span: ClozeSpan, blank = "_____") {
  return `${back.slice(0, span.start)}${blank}${back.slice(span.end)}`;
}

/**
 * Mark the blank.
 *
 * Delegates rather than comparing strings itself, so a one-letter slip in a
 * long term lands in the same `close` tier it would in Type Answer -- and
 * therefore goes to the student rather than straight to `Again`.
 */
export function markClozeAnswer(
  response: string,
  span: ClozeSpan,
  settings?: CardStudySettings
) {
  return markTypedAnswer({
    response,
    expectedAnswer: span.answer,
    settings,
  });
}
