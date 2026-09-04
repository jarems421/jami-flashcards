import type { Card } from "@/lib/study/cards";
import { selectClozeSpan } from "@/lib/study/gap-fill";
import { buildMultipleChoiceQuestion } from "@/lib/study/mcq";
import { hasMathDelimiters, splitMathRichText } from "@/lib/study/math-text";
import { classifyAnswerShape } from "@/lib/study/answer-marking";
import {
  isStudyMode,
  type ResolvedExercise,
  type StudyMode,
  type StudyModePolicy,
} from "@/lib/study/study-modes";

/**
 * Why a card cannot be put in a given mode.
 *
 * Stable codes rather than sentences: tests assert on them and the wording
 * shown above them can change without breaking either.
 */
export type ModeIneligibilityReason =
  | "empty-card"
  | "disabled-by-author"
  | "answer-is-maths"
  | "answer-too-long"
  | "no-safe-gap"
  | "needs-preparation";

export type ModeEligibility =
  | { eligible: true }
  | { eligible: false; reason: ModeIneligibilityReason };

const ELIGIBLE: ModeEligibility = { eligible: true };

/**
 * Beyond this, typing the answer is a transcription exercise rather than a
 * recall one. Prose explanations still qualify; essays do not.
 */
const MAX_TYPEABLE_ANSWER_LENGTH = 320;

/**
 * The share of an answer that may be maths before typing it becomes unfair.
 *
 * A definition that mentions one symbol is fine. An answer that *is* a formula
 * cannot be entered as plain text by anyone, and marking it would come down to
 * whether the student guessed the same LaTeX.
 */
const MAX_MATHS_SHARE_OF_ANSWER = 0.25;

function mathsShare(text: string) {
  if (!hasMathDelimiters(text)) return 0;
  const segments = splitMathRichText(text);
  const total = segments.reduce((sum, segment) => sum + segment.value.length, 0);
  if (total === 0) return 0;
  const maths = segments
    .filter((segment) => segment.type === "math")
    .reduce((sum, segment) => sum + segment.value.length, 0);
  return maths / total;
}

function authorDisabled(card: Card, mode: StudyMode) {
  return (card.studySettings?.disabledModes ?? [])
    .filter(isStudyMode)
    .includes(mode);
}

function hasContent(card: Card) {
  return Boolean(card.front?.trim() && card.back?.trim());
}

export function getTypeAnswerEligibility(card: Card): ModeEligibility {
  if (!hasContent(card)) return { eligible: false, reason: "empty-card" };
  if (authorDisabled(card, "type-answer")) {
    return { eligible: false, reason: "disabled-by-author" };
  }
  if (mathsShare(card.back) > MAX_MATHS_SHARE_OF_ANSWER) {
    return { eligible: false, reason: "answer-is-maths" };
  }
  if (card.back.trim().length > MAX_TYPEABLE_ANSWER_LENGTH) {
    return { eligible: false, reason: "answer-too-long" };
  }
  return ELIGIBLE;
}

export function getGapFillEligibility(card: Card): ModeEligibility {
  if (!hasContent(card)) return { eligible: false, reason: "empty-card" };
  if (authorDisabled(card, "gap-fill")) {
    return { eligible: false, reason: "disabled-by-author" };
  }
  const span = selectClozeSpan({
    front: card.front,
    back: card.back,
    settings: card.studySettings,
  });
  return span ? ELIGIBLE : { eligible: false, reason: "no-safe-gap" };
}

export function getClassicEligibility(card: Card): ModeEligibility {
  return hasContent(card) ? ELIGIBLE : { eligible: false, reason: "empty-card" };
}

/**
 * What the resolver is allowed to look at beyond the card itself.
 *
 * Only the session seed now. Multiple choice used to want the card's
 * neighbours, back when its wrong options were borrowed from them; it builds
 * from material written for the card itself instead, so nothing here needs the
 * rest of the library.
 */
export type ModeResolutionContext = {
  seed?: number;
};

export function getMultipleChoiceEligibility(
  card: Card,
  context: ModeResolutionContext = {}
): ModeEligibility {
  if (!hasContent(card)) return { eligible: false, reason: "empty-card" };
  if (authorDisabled(card, "multiple-choice")) {
    return { eligible: false, reason: "disabled-by-author" };
  }
  const question = buildMultipleChoiceQuestion({ card, seed: context.seed });
  // Three believable wrong answers or nothing. Padding the list would make a
  // question answerable by elimination, which teaches the wrong skill.
  return question ? ELIGIBLE : { eligible: false, reason: "needs-preparation" };
}

export function getModeEligibility(
  card: Card,
  mode: StudyMode,
  context: ModeResolutionContext = {}
): ModeEligibility {
  switch (mode) {
    case "type-answer":
      return getTypeAnswerEligibility(card);
    case "gap-fill":
      return getGapFillEligibility(card);
    case "multiple-choice":
      return getMultipleChoiceEligibility(card, context);
    case "classic":
    default:
      return getClassicEligibility(card);
  }
}

/**
 * Smart Mix, in preference order.
 *
 * Type Answer first because producing an answer from nothing is the strongest
 * evidence there is, then Gap Fill, then Multiple Choice, and Classic last as
 * what remains when none of the others can be built honestly.
 *
 * Multiple choice is in the list now that it schedules, but it sits below the
 * two recall modes on purpose: picking the right answer out of four is real
 * evidence when the four are good, and still less than writing it down. It only
 * ever reaches a card that has prepared distractors or a numeric answer, so an
 * unprepared deck mixes exactly as it did before.
 */
const SMART_MIX_ORDER: StudyMode[] = [
  "type-answer",
  "gap-fill",
  "multiple-choice",
  "classic",
];

/**
 * Vary the mode across a session so it does not become one long typing test.
 *
 * `position` is the card's index in the queue, so the rotation is a pure
 * function of where the card sits: a resumed session resolves every card to
 * exactly the mode it had before, with nothing extra persisted.
 */
export function resolveSmartMixMode(
  card: Card,
  position: number,
  context: ModeResolutionContext = {}
): StudyMode {
  const available = SMART_MIX_ORDER.filter(
    (mode) => getModeEligibility(card, mode, context).eligible
  );
  if (available.length === 0) return "classic";
  return available[position % available.length];
}

export function resolveExerciseMode(
  card: Card,
  policy: { kind: "smart" } | { kind: "fixed"; mode: StudyMode },
  position: number,
  context: ModeResolutionContext = {}
): StudyMode | null {
  if (policy.kind === "smart") return resolveSmartMixMode(card, position, context);
  // A fixed mode never quietly degrades: a card that cannot carry it is
  // dropped from the session and counted, rather than shown as Classic.
  return getModeEligibility(card, policy.mode, context).eligible
    ? policy.mode
    : null;
}

/**
 * Build the exercise a student actually sees.
 *
 * Deterministic only. Anything needing prepared assets returns null here and is
 * filled in by the preparation step.
 */
export function buildDeterministicExercise(
  card: Card,
  mode: StudyMode,
  cardContentHash: string,
  context: ModeResolutionContext = {}
): ResolvedExercise | null {
  if (!getModeEligibility(card, mode, context).eligible) return null;

  const base = {
    cardId: card.id,
    cardContentHash,
    expectedAnswer: card.back,
    source: card.studySettings ? ("author" as const) : ("deterministic" as const),
  };

  if (mode === "gap-fill") {
    const cloze = selectClozeSpan({
      front: card.front,
      back: card.back,
      settings: card.studySettings,
    });
    if (!cloze) return null;
    return {
      ...base,
      mode,
      prompt: card.front,
      expectedAnswer: cloze.answer,
      cloze,
    };
  }

  if (mode === "multiple-choice") {
    const question = buildMultipleChoiceQuestion({ card, seed: context.seed });
    if (!question) return null;
    return { ...base, mode, prompt: card.front, mcq: question };
  }

  if (mode === "type-answer" || mode === "classic") {
    return { ...base, mode, prompt: card.front };
  }

  return null;
}

/**
 * Whether sending this card to a model would actually buy anything.
 *
 * Preparation is not free -- it is the only thing between pressing Start and
 * the first card -- so a card that the deterministic path already handles well
 * should never be sent. Two whole categories qualify, and they are the ones a
 * flashcard app is full of:
 *
 * A **numeric** answer needs nothing. Its wrong options come from moving the
 * number, which lands on the mistakes students actually make; its marking is
 * exact within a tolerance; and blanking a word in "9.8 m/s" is just the
 * question again.
 *
 * A **maths-heavy** answer needs nothing either, and more than that should not
 * be sent. A model writing plausible wrong formulas is the case where a
 * hallucination is most convincing and least checkable: nothing downstream can
 * tell "confidently wrong" from "subtly right", so the honest move is to leave
 * formula cards on Classic rather than invent options for them.
 *
 * Then it comes down to the mode. **Type Answer needs no preparation at all** --
 * showing the front and asking for the back is entirely deterministic, and the
 * only thing a model adds is judging prose, which the runtime check already
 * does on demand for a fraction of the tokens and only when local marking is
 * genuinely stuck. **Gap Fill** wants help choosing which word to hide, but only
 * on an answer long enough for that to be a choice. **Multiple Choice** is the
 * real dependency: without written distractors there is no question to ask.
 */
export function needsStudyAssetPreparation(
  card: Card,
  policy: StudyModePolicy
): boolean {
  if (!hasContent(card)) return false;

  const answer = card.back.trim();
  if (classifyAnswerShape(answer) === "numeric") return false;
  if (mathsShare(answer) > MAX_MATHS_SHARE_OF_ANSWER) return false;

  const mcqIsMissing = () => buildMultipleChoiceQuestion({ card }) === null;
  // A one-word answer has no choice of word to hide, so nothing to improve.
  const gapHasOptions = () => answer.split(/\s+/).length > 2;

  if (policy.kind === "smart") return mcqIsMissing() || gapHasOptions();
  switch (policy.mode) {
    case "multiple-choice":
      return mcqIsMissing();
    case "gap-fill":
      return gapHasOptions();
    case "type-answer":
    case "classic":
    default:
      return false;
  }
}
