import type { Card } from "@/lib/study/cards";
import {
  classifyAnswerShape,
  normalizeAnswerText,
  parseNumericAnswer,
} from "@/lib/study/answer-marking";
import { getCardContentHash } from "@/lib/study/study-modes";

export type McqOption = { id: string; text: string };

export type McqQuestion = {
  options: McqOption[];
  correctOptionId: string;
  explanations: Record<string, string>;
};

export const MCQ_OPTION_COUNT = 4;
const REQUIRED_DISTRACTORS = MCQ_OPTION_COUNT - 1;
/** Anything longer is a paragraph, and four of them is a reading test. */
const MAX_OPTION_LENGTH = 160;

/**
 * A small deterministic generator.
 *
 * Option order has to survive a refresh, so it is derived from the session seed
 * and the card rather than from Math.random.
 */
function createRandom(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

function seedFrom(text: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function shuffle<T>(items: T[], random: () => number) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

/**
 * How plausible a sibling answer is as a wrong option.
 *
 * A good distractor looks like it could belong to the same question: same kind
 * of thing, roughly the same length, drawn from the same corner of the subject.
 * A distractor that is obviously the wrong *shape* -- a date against a
 * definition -- teaches students to answer by elimination rather than by
 * knowing.
 */
function scoreDistractor(candidate: Card, answer: Card) {
  const candidateText = candidate.back.trim();
  if (!candidateText || candidateText.length > MAX_OPTION_LENGTH) return -1;
  if (normalizeAnswerText(candidateText) === normalizeAnswerText(answer.back)) {
    return -1;
  }

  let score = 0;
  if (candidate.deckId === answer.deckId) score += 4;

  const answerTopics = new Set(answer.topicIds ?? []);
  const sharedTopics = (candidate.topicIds ?? []).filter((id) => answerTopics.has(id));
  score += Math.min(sharedTopics.length, 3) * 3;

  if (classifyAnswerShape(candidateText) === classifyAnswerShape(answer.back)) {
    score += 5;
  }

  const lengthRatio =
    Math.min(candidateText.length, answer.back.length) /
    Math.max(candidateText.length, answer.back.length, 1);
  score += Math.round(lengthRatio * 5);

  // Ending the same way -- both plural, both a verb phrase -- reads as the same
  // grammatical answer to the same question.
  if (candidateText.slice(-2).toLowerCase() === answer.back.slice(-2).toLowerCase()) {
    score += 2;
  }

  return score;
}

/**
 * Wrong-but-believable numbers, built by moving the real one.
 *
 * Only for numeric answers, where sibling cards rarely supply anything near the
 * right magnitude. The perturbations are the mistakes students actually make:
 * a factor of ten, a transposed pair, a near miss.
 */
function numericDistractors(answer: string) {
  const parsed = parseNumericAnswer(answer);
  if (!parsed) return [];

  const { value, unit } = parsed;
  const suffix = unit ? ` ${unit}` : "";
  const decimals = (answer.split(".")[1] ?? "").replace(/[^\d].*$/, "").length;
  const format = (next: number) =>
    `${decimals > 0 ? next.toFixed(decimals) : Math.round(next)}${suffix}`;

  const candidates = [
    value * 10,
    value / 10,
    value * 2,
    value + Math.max(1, Math.abs(value) * 0.1),
    value - Math.max(1, Math.abs(value) * 0.1),
  ];

  const seen = new Set([normalizeAnswerText(answer)]);
  const distractors: string[] = [];
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate)) continue;
    const text = format(candidate);
    const key = normalizeAnswerText(text);
    if (seen.has(key)) continue;
    seen.add(key);
    distractors.push(text);
  }
  return distractors;
}

/**
 * Build a multiple-choice question from what is already on hand.
 *
 * Author distractors first, then numeric perturbation for numeric answers, then
 * the best sibling answers. Returns null rather than padding: three weak
 * options make a question that can be answered without knowing anything, which
 * is worse than not offering the mode.
 */
export function buildMultipleChoiceQuestion(input: {
  card: Card;
  siblings: Card[];
  seed?: number;
}): McqQuestion | null {
  const { card, siblings } = input;
  const answerText = card.back.trim();
  if (!answerText || answerText.length > MAX_OPTION_LENGTH) return null;

  const seen = new Set([normalizeAnswerText(answerText)]);
  const distractors: string[] = [];

  const push = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > MAX_OPTION_LENGTH) return;
    const key = normalizeAnswerText(trimmed);
    if (!key || seen.has(key)) return;
    seen.add(key);
    distractors.push(trimmed);
  };

  for (const authored of card.studySettings?.mcqDistractors ?? []) {
    push(authored);
  }

  if (distractors.length < REQUIRED_DISTRACTORS && classifyAnswerShape(answerText) === "numeric") {
    for (const candidate of numericDistractors(answerText)) {
      if (distractors.length >= REQUIRED_DISTRACTORS) break;
      push(candidate);
    }
  }

  if (distractors.length < REQUIRED_DISTRACTORS) {
    const ranked = siblings
      .filter((sibling) => sibling.id !== card.id)
      .map((sibling) => ({ sibling, score: scoreDistractor(sibling, card) }))
      .filter((entry) => entry.score >= 0)
      // Card id breaks ties so the same deck always yields the same question.
      .sort(
        (left, right) =>
          right.score - left.score || left.sibling.id.localeCompare(right.sibling.id)
      );
    for (const entry of ranked) {
      if (distractors.length >= REQUIRED_DISTRACTORS) break;
      push(entry.sibling.back);
    }
  }

  if (distractors.length < REQUIRED_DISTRACTORS) return null;

  const random = createRandom(
    (input.seed ?? 0) ^ seedFrom(card.id + getCardContentHash(card))
  );
  const correctOptionId = "opt-0";
  const options = shuffle(
    [
      { id: correctOptionId, text: answerText },
      ...distractors
        .slice(0, REQUIRED_DISTRACTORS)
        .map((text, position) => ({ id: `opt-${position + 1}`, text })),
    ],
    random
  );

  const explanations: Record<string, string> = {
    [correctOptionId]: "That is the answer on this card.",
  };
  for (const option of options) {
    if (option.id === correctOptionId) continue;
    explanations[option.id] =
      "That is the answer to a different card in this deck, not this one.";
  }

  return { options, correctOptionId, explanations };
}
