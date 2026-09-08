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
 * How far the correct answer's length may stray from the wrong ones.
 *
 * The single loudest tell in a multiple-choice question is length. When the
 * real answer is the full sentence off the back of the card and the three wrong
 * ones are the phrases a model wrote, the question is answerable without
 * reading it: pick the long one. It is answerable the other way too -- a
 * two-word answer sat under three written-out clauses is just as obvious.
 *
 * So the correct answer has to sit inside this band of at least one distractor,
 * measured in words. A question where it is an outlier against all three is not
 * a hard question with a formatting problem, it is a question that tests
 * nothing, and it is refused rather than shown.
 */
const OPTION_LENGTH_BAND = { min: 0.5, max: 2 };

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

function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * How much an option *looks* like the answer, ignoring what it says.
 *
 * Nothing here reads meaning -- that is the model's job during preparation, and
 * the student's when they write their own. This measures only the surface tells
 * a student uses to skip the question: length, whether it is written as a
 * sentence, whether it is capitalised like a term, whether it leads with a
 * number. Lower is a better match.
 *
 * It exists because preparation returns five or six distractors and a question
 * only needs three. Taking the first three wastes the choice; taking the three
 * that wear the same clothes as the answer is what makes the four options
 * indistinguishable until you actually know the material.
 */
function shapeDistance(answer: string, option: string) {
  const answerWords = wordCount(answer);
  const optionWords = wordCount(option);
  // Ratio rather than difference: two words against four is a real mismatch,
  // twenty against twenty-two is not.
  const lengthRatio =
    Math.max(answerWords, optionWords) / Math.max(1, Math.min(answerWords, optionWords));

  let distance = (lengthRatio - 1) * 4;
  const endsSentence = (text: string) => /[.!?]$/.test(text.trim());
  if (endsSentence(answer) !== endsSentence(option)) distance += 1.5;
  const startsUpper = (text: string) => /^[A-Z]/.test(text.trim());
  if (startsUpper(answer) !== startsUpper(option)) distance += 1;
  const startsNumber = (text: string) => /^[+-]?\d/.test(text.trim());
  if (startsNumber(answer) !== startsNumber(option)) distance += 2;
  return distance;
}

/**
 * Whether the right answer hides among these three, or stands out from them.
 *
 * Only length is checked, because length is the tell that survives everything
 * else: a student who cannot read the subject can still count words. One
 * distractor in the same band is enough -- the question is guessable when the
 * answer is an outlier against *all* of them, not when it happens to be the
 * longest.
 */
function answerBlendsIn(answer: string, distractors: string[]) {
  const answerWords = wordCount(answer);
  if (answerWords === 0) return false;
  return distractors.some((distractor) => {
    const ratio = wordCount(distractor) / answerWords;
    return ratio >= OPTION_LENGTH_BAND.min && ratio <= OPTION_LENGTH_BAND.max;
  });
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
 * all, and is asked another way instead. Nor does having three wrong options
 * settle it: they have to be three the answer can hide among, or the question
 * is refused here and the card is asked a way that cannot be guessed.
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
  /*
   * Preparation is asked for five or six so the weakest can be dropped, and
   * this is where that choice is spent. Ties break on the original order, which
   * is the order they were written in: author distractors first, then the
   * model's, so a student's own wrong answers keep their priority.
   */
  const chosen = distractors
    .map((text, position) => ({ text, position }))
    .sort(
      (left, right) =>
        shapeDistance(answerText, left.text) - shapeDistance(answerText, right.text) ||
        left.position - right.position
    )
    .slice(0, REQUIRED_DISTRACTORS)
    .map((entry) => entry.text);

  if (!answerBlendsIn(answerText, chosen)) return null;

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
