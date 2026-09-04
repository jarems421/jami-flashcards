import type { Card } from "@/lib/study/cards";
import { selectClozeSpan } from "@/lib/study/gap-fill";
import { buildMultipleChoiceQuestion } from "@/lib/study/mcq";
import { hasMathDelimiters, splitMathRichText } from "@/lib/study/math-text";
import {
  isStudyMode,
  type ResolvedExercise,
  type StudyMode,
} from "@/lib/study/study-modes";

/**
 * Why a card cannot be put in a given mode.
 *
 * Stable codes rather than sentences: the readiness panel counts them, tests
 * assert on them, and the wording above them can change without breaking either.
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
 * Multiple choice is the only mode that needs neighbours: its wrong answers
 * come from other cards. Everything else ignores this.
 */
export type ModeResolutionContext = {
  siblings?: Card[];
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
  const question = buildMultipleChoiceQuestion({
    card,
    siblings: context.siblings ?? [],
    seed: context.seed,
  });
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
 * Gap Fill before Type Answer before Classic: a blank in a sentence is the
 * cheapest true recall test, typing the whole answer is the strongest, and
 * Classic is what is left when neither can be built honestly. Multiple choice
 * is not in the list -- it cannot complete a scheduled card, so it never
 * appears in a mix that might be running Daily Review.
 */
const SMART_MIX_ORDER: StudyMode[] = ["gap-fill", "type-answer", "classic"];

/**
 * Vary the mode across a session so it does not become one long typing test.
 *
 * `position` is the card's index in the queue, so the rotation is a pure
 * function of where the card sits: a resumed session resolves every card to
 * exactly the mode it had before, with nothing extra persisted.
 */
export function resolveSmartMixMode(card: Card, position: number): StudyMode {
  const available = SMART_MIX_ORDER.filter(
    (mode) => getModeEligibility(card, mode).eligible
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
  if (policy.kind === "smart") return resolveSmartMixMode(card, position);
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
    const question = buildMultipleChoiceQuestion({
      card,
      siblings: context.siblings ?? [],
      seed: context.seed,
    });
    if (!question) return null;
    return { ...base, mode, prompt: card.front, mcq: question };
  }

  if (mode === "type-answer" || mode === "classic") {
    return { ...base, mode, prompt: card.front };
  }

  return null;
}
