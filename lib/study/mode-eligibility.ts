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
 * Smart Mix, when nothing about the card says otherwise.
 *
 * Type Answer first because producing an answer from nothing is the strongest
 * evidence there is, then Gap Fill, then Multiple Choice, and Classic last as
 * what remains when none of the others can be built honestly. This is only the
 * tie-break: `scoreModesForCard` decides, and reaches for this order when two
 * modes suit a card equally well.
 */
const SMART_MIX_ORDER: StudyMode[] = [
  "type-answer",
  "gap-fill",
  "multiple-choice",
  "classic",
];

/**
 * How far below the best fit a mode may sit and still be reached for.
 *
 * This is the dial between "always the single best way to ask this card" and
 * "a session that mixes". Set to zero, a deck of definitions is nothing but Gap
 * Fill; set wide, it degenerates back into the round-robin that made everything
 * a typing test. Three keeps the two modes that genuinely suit each answer
 * shape in play and leaves the ones that do not out: a number is never gapped,
 * a two-word answer is never gapped, and a page-long answer is never typed.
 */
const MODE_FIT_BAND = 3;

/**
 * How well a mode suits one particular card.
 *
 * Smart Mix used to be a rotation: filter the four modes by eligibility, then
 * take `position % available.length`. It varied the mode, which is what it was
 * asked to do, and it was still the wrong shape -- because which mode a card
 * *can* carry says nothing about which one asks it well, and on an ordinary
 * deck the filter left [Type Answer, Classic] and the rotation alternated
 * between them. A session read as one long typing test with flip cards in
 * between, which is exactly what Smart Mix exists to avoid.
 *
 * So the mode is chosen from the answer instead. The shape of the thing being
 * recalled is what decides how it is best asked:
 *
 *   - A **number** wants Multiple Choice. Its wrong options are the real
 *     mistakes -- a factor of ten, a doubling, a near miss -- and telling 9.8
 *     from 98 is the whole skill. Blanking a word in "9.8 m/s" just prints the
 *     question again, so Gap Fill is refused rather than ranked.
 *   - A **list** wants Type Answer. Producing all four items is the recall; a
 *     gap over one of them is a reasonable second.
 *   - A **term or name** wants Type Answer, then Multiple Choice. There is
 *     little to hide in three words, so Gap Fill ranks last.
 *   - **Prose** -- a definition, a mechanism, an explanation -- wants Gap Fill.
 *     Hiding the load-bearing word tests the one thing the sentence is for,
 *     where typing the whole paragraph back is a transcription exercise.
 *
 * Then the card's own history tilts it. A card being learned or relearned is
 * asked a way it can be recognised before it has to be produced; a card in
 * steady review is asked the harder way. That is the difference between
 * varying the question and choosing it.
 */
export function scoreModesForCard(
  card: Card,
  context: ModeResolutionContext = {}
): Array<{ mode: StudyMode; score: number }> {
  const shape = classifyAnswerShape(card.back ?? "");
  const answerWords = (card.back ?? "").trim().split(/\s+/).filter(Boolean).length;

  const base: Record<StudyMode, number> = {
    "type-answer": 0,
    "gap-fill": 0,
    "multiple-choice": 0,
    // Classic is always last of the eligible modes rather than never chosen:
    // it is what a card falls back to, not something Smart Mix reaches for.
    classic: -10,
  };

  if (shape === "numeric") {
    base["multiple-choice"] += 6;
    base["type-answer"] += 4;
    base["gap-fill"] -= 6;
  } else if (shape === "list") {
    base["type-answer"] += 6;
    base["gap-fill"] += 4;
    base["multiple-choice"] += 1;
  } else if (shape === "short") {
    base["type-answer"] += 6;
    base["multiple-choice"] += 4;
    // A three-word answer has nothing to hide that is not the whole answer.
    base["gap-fill"] += answerWords >= 6 ? 3 : -4;
  } else {
    base["gap-fill"] += 6;
    base["multiple-choice"] += 3;
    // Typing a paragraph back is transcription long before it is recall.
    base["type-answer"] += answerWords > 40 ? -1 : 3;
  }

  /*
   * Recognition before recall, for a card that is not known yet.
   *
   * FSRS state 1 is Learning and 3 is Relearning -- a card seen for the first
   * time today, or one that was just missed. Asking those to be produced from
   * nothing is how a student ends up typing four wrong answers in a row, so
   * they are nudged towards the modes that show the answer's shape. A card in
   * steady review (state 2) has earned the harder question.
   */
  const learning = card.fsrsState === 1 || card.fsrsState === 3;
  const struggling = (card.lapses ?? 0) >= 2;
  if (learning || struggling) {
    base["multiple-choice"] += 3;
    base["gap-fill"] += 2;
    base["type-answer"] -= 2;
  } else if (card.fsrsState === 2) {
    base["type-answer"] += 2;
  }

  return SMART_MIX_ORDER.filter(
    (mode) => getModeEligibility(card, mode, context).eligible
  ).map((mode) => ({ mode, score: base[mode] }));
}

/**
 * The mode this card is asked in.
 *
 * Best fit wins, and ties break towards variety: `position` rotates among the
 * modes that suit the card *equally well*, so a deck of one kind of answer
 * still moves between the two or three good ways of asking it rather than
 * settling on one. It never promotes a mode the card is poorly suited to just
 * to be different -- variety that asks a definition by making the student
 * retype it is not variety worth having.
 *
 * `position` is the card's index in the queue, so the choice stays a pure
 * function of where the card sits: a resumed session resolves every card to
 * exactly the mode it had before, with nothing extra persisted.
 */
export function resolveSmartMixMode(
  card: Card,
  position: number,
  context: ModeResolutionContext = {}
): StudyMode {
  const scored = scoreModesForCard(card, context);
  if (scored.length === 0) return "classic";

  const best = Math.max(...scored.map((entry) => entry.score));
  // Best fit first, so a card seen once is asked the way that suits it rather
  // than the way that happens to come first in the preference order. Ties fall
  // back to that order, which is why the sort has to be stable.
  const contenders = scored
    .filter((entry) => entry.score >= best - MODE_FIT_BAND)
    .sort((left, right) => right.score - left.score);
  return contenders[position % contenders.length].mode;
}

/**
 * Whether a card is out of this mode for good, or only until Jami has read it.
 *
 * The distinction is the whole difference between a session that works and one
 * that does not. Preparation waits for the first few cards and reads the rest
 * behind the student, so at the moment a session is built almost every card in
 * a fresh queue is un-prepared -- and a fresh queue is exactly when somebody
 * picks Multiple Choice. Treating "no distractors yet" the same as "this card
 * can never be asked this way" dropped the whole queue on the first run and
 * left the mode working only on the second, once the background pass had
 * cached everything.
 *
 * Everything else here is a property of the card that no amount of waiting
 * changes: an empty card, an author's decision, an answer that is a formula or
 * a paragraph, a sentence with no word safe to hide.
 */
export function isAwaitingPreparation(eligibility: ModeEligibility) {
  return !eligibility.eligible && eligibility.reason === "needs-preparation";
}

/**
 * Whether this card belongs in a session pinned to this mode.
 *
 * Eligible now, or eligible once its assets land. A card that will never carry
 * the mode is still dropped at the door and counted, so the student is told
 * rather than finding Classic cards in the middle of a typing session.
 */
export function canCarryModeEventually(
  card: Card,
  mode: StudyMode,
  context: ModeResolutionContext = {}
) {
  const eligibility = getModeEligibility(card, mode, context);
  return eligibility.eligible || isAwaitingPreparation(eligibility);
}

export function resolveExerciseMode(
  card: Card,
  policy: { kind: "smart" } | { kind: "fixed"; mode: StudyMode },
  position: number,
  context: ModeResolutionContext = {}
): StudyMode | null {
  if (policy.kind === "smart") return resolveSmartMixMode(card, position, context);

  const eligibility = getModeEligibility(card, policy.mode, context);
  if (eligibility.eligible) return policy.mode;
  /*
   * Reached before its assets did.
   *
   * The alternative is what used to happen: no exercise at all, which falls
   * through to the Classic flip card without saying so -- the quiet degradation
   * this was written to avoid. Asking the card the best way it *can* be asked
   * right now is the honest version of the same recovery, and the background
   * pass usually lands before the student gets here at all.
   */
  if (isAwaitingPreparation(eligibility)) {
    return resolveSmartMixMode(card, position, context);
  }
  // A card that can never carry the mode is dropped from the session and
  // counted, rather than shown as Classic.
  return null;
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
