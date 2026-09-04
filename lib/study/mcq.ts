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
 * Wrong-but-believable numbers, built by moving the real one.
 *
 * The one kind of card that needs no preparation. The perturbations are the
 * mistakes students actually make -- a factor of ten, a doubling, a near miss --
 * and each is unarguably wrong while looking like the sort of thing that could
 * have been right.
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
 * Build a multiple-choice question, or refuse.
 *
 * Two sources, and only two. Wrong options written *for this card* -- by Jami
 * during preparation, or by the student in the card editor -- and, for a
 * numeric answer, the number moved to somewhere a student might plausibly land.
 *
 * There used to be a third: the answers off other cards in the same deck,
 * ranked by how similar they looked. It produced questions that could be
 * answered without knowing anything, because the one option that actually
 * addressed the question was the right one. Distractors have to be wrong
 * answers *to this question*, and no amount of ranking turns an answer to a
 * different question into one.
 *
 * So a card with nothing prepared and a non-numeric answer gets no question at
 * all, and is asked another way instead.
 */
export function buildMultipleChoiceQuestion(input: {
  card: Card;
  seed?: number;
}): McqQuestion | null {
  const { card } = input;
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

  for (const written of card.studySettings?.mcqDistractors ?? []) {
    push(written);
  }

  if (
    distractors.length < REQUIRED_DISTRACTORS &&
    classifyAnswerShape(answerText) === "numeric"
  ) {
    for (const candidate of numericDistractors(answerText)) {
      if (distractors.length >= REQUIRED_DISTRACTORS) break;
      push(candidate);
    }
  }

  if (distractors.length < REQUIRED_DISTRACTORS) return null;

  const random = createRandom(
    (input.seed ?? 0) ^ seedFrom(card.id + getCardContentHash(card))
  );
  const correctOptionId = "opt-0";
  const chosen = distractors.slice(0, REQUIRED_DISTRACTORS);
  const options = shuffle(
    [
      { id: correctOptionId, text: answerText },
      ...chosen.map((text, position) => ({
        id: `opt-${position + 1}`,
        text,
      })),
    ],
    random
  );

  // Why a student might have picked this one, when Jami worked it out during
  // preparation. Keyed by the distractor's text rather than its option id,
  // because the ids are assigned here and the misconceptions were written
  // before the shuffle.
  const written = card.studySettings?.mcqExplanations ?? {};
  const explanations: Record<string, string> = {
    [correctOptionId]: "That is the answer on this card.",
  };
  for (const option of options) {
    if (option.id === correctOptionId) continue;
    explanations[option.id] =
      written[option.text] ?? "Close, but not what this card asks for.";
  }

  return { options, correctOptionId, explanations };
}
