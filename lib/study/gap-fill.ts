import { splitMathRichText } from "@/lib/study/math-text";
import { markTypedAnswer } from "@/lib/study/answer-marking";
import type { CardStudySettings, StudyGap } from "@/lib/study/study-modes";

export type ClozeSpan = {
  start: number;
  end: number;
  answer: string;
};

function validPreparedGap(back: string, gap: StudyGap, ranges: Array<[number, number]>) {
  return Number.isInteger(gap.start) && Number.isInteger(gap.end) && gap.start >= 0 &&
    gap.end > gap.start && gap.end <= back.length && back.slice(gap.start, gap.end) === gap.answer &&
    !(gap.start > 0 && /[\p{L}\p{N}]/u.test(back[gap.start - 1]) && /[\p{L}\p{N}]/u.test(back[gap.start])) &&
    !(gap.end < back.length && /[\p{L}\p{N}]/u.test(back[gap.end - 1]) && /[\p{L}\p{N}]/u.test(back[gap.end])) &&
    !overlapsProtected(ranges, gap.start, gap.end);
}

/**
 * Resolve one stable, validated set of one to three gaps. Prepared variants are
 * rotated by presentation; author-pinned spans come next; the conservative
 * local chooser is only a fallback.
 */
export function selectClozeGaps(input: {
  front: string;
  back: string;
  settings?: CardStudySettings;
  variantIndex?: number;
  recentVariantIds?: string[];
}): StudyGap[] {
  const back = input.back ?? "";
  const ranges = protectedRanges(back);
  const variants = (input.settings?.generatedStudy?.gapVariants ?? []).filter(
    (variant) => !input.settings?.generatedStudy?.retiredVariantIds?.includes(variant.id)
  );
  if (input.settings?.pinnedGaps === undefined && variants.length > 0) {
    const fresh = variants.filter((variant) => !(input.recentVariantIds ?? []).slice(-2).includes(variant.id));
    const pool = fresh.length > 0 ? fresh : variants;
    const variant = pool[(input.variantIndex ?? 0) % pool.length];
    const gaps = variant.gaps
      .filter((gap) => validPreparedGap(back, gap, ranges))
      .sort((a, b) => a.start - b.start)
      .slice(0, 3);
    if (gaps.length !== variant.gaps.length) return [];
    const hidden = gaps.reduce((sum, gap) => sum + gap.answer.trim().split(/\s+/).length, 0);
    const words = back.trim().split(/\s+/).filter(Boolean).length;
    const overlap = gaps.some((gap, index) => index > 0 && gap.start < gaps[index - 1].end);
    if (gaps.length > 0 && !overlap && hidden / Math.max(1, words) <= 1 / 3) return gaps;
  }

  const pins = input.settings?.pinnedGaps;
  if (pins !== undefined) {
    const pinned: StudyGap[] = [];
    let cursor = 0;
    for (const raw of pins.slice(0, 3)) {
      const answer = raw.trim();
      const start = answer ? back.indexOf(answer, cursor) : -1;
      if (start < 0 || overlapsProtected(ranges, start, start + answer.length)) continue;
      pinned.push({ id: `author-${start}`, start, end: start + answer.length, answer, acceptedAnswers: [], concept: answer });
      cursor = start + answer.length;
    }
    const totalWords = back.trim().split(/\s+/).filter(Boolean).length;
    const maxGaps = totalWords < 4 ? 0 : totalWords <= 12 ? 1 : totalWords <= 35 ? 2 : 3;
    const hiddenWords = pinned.reduce((sum, gap) => sum + gap.answer.split(/\s+/).filter(Boolean).length, 0);
    // An explicitly empty or structurally unsafe author list disables gaps.
    if (pinned.length > 0 && pinned.length <= maxGaps && hiddenWords / Math.max(1, totalWords) <= 1 / 3) return pinned;
    return [];
  }

  // Local word-shape heuristics cannot know which phrase carries the idea.
  // Without an author choice or a validated prepared variant, Gap Fill waits.
  return [];
}

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

/**
 * One blank per missing word, so the gap says how much is missing.
 *
 * A single `_____` for a two- or three-word answer reads as one word, and a
 * student answers with one word and is marked wrong for something the prompt
 * never told them. Drawing a blank per word, separated by an ordinary space,
 * makes the shape of the answer visible without giving any of it away.
 *
 * Word count comes from the hidden text itself rather than from a stored
 * number, so a pinned multi-word gap gets the same treatment as a chosen one.
 */
export function renderClozeBlank(answer: string, blank = "_____") {
  const words = answer.trim().split(/\s+/).filter(Boolean).length;
  return Array.from({ length: Math.max(1, words) }, () => blank).join(" ");
}

/** The answer with the span replaced by a blank, for display. */
export function renderClozePrompt(back: string, span: ClozeSpan, blank = "_____") {
  return `${back.slice(0, span.start)}${renderClozeBlank(span.answer, blank)}${back.slice(span.end)}`;
}

export function renderMultiClozePrompt(back: string, gaps: StudyGap[], blank = "_____") {
  let cursor = 0;
  let rendered = "";
  for (const gap of [...gaps].sort((a, b) => a.start - b.start)) {
    rendered += back.slice(cursor, gap.start);
    rendered += renderClozeBlank(gap.answer, blank);
    cursor = gap.end;
  }
  return rendered + back.slice(cursor);
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


export function markClozeAnswers(
  responses: Record<string, string>,
  gaps: StudyGap[]
) {
  const outcomes = gaps.map((gap) => ({
    gapId: gap.id,
    ...markTypedAnswer({
      response: responses[gap.id] ?? "",
      expectedAnswer: gap.answer,
      settings: {
        acceptedAnswers: gap.acceptedAnswers,
        ...(gap.requireUnits === undefined ? {} : { requireUnits: gap.requireUnits }),
      },
    }),
  }));
  const verdict = outcomes.every((outcome) => outcome.verdict === "correct")
    ? "correct"
    : outcomes.some((outcome) => outcome.verdict === "needs-self-grade" || outcome.verdict === "close")
      ? "needs-self-grade"
      : outcomes.some((outcome) => outcome.verdict === "correct" || outcome.verdict === "close" || outcome.verdict === "partial")
        ? "partial"
        : "incorrect";
  return { verdict, outcomes } as const;
}
