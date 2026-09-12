import type { CardRating } from "@/lib/study/scheduler";

/**
 * The ways a card can be put to a student.
 *
 * Classic is the card as it has always been: read it, turn it over, say how it
 * went. The rest ask for an answer before showing one.
 */
export type StudyMode =
  | "classic"
  | "type-answer"
  | "gap-fill"
  | "multiple-choice";

export const STUDY_MODES: StudyMode[] = [
  "classic",
  "type-answer",
  "gap-fill",
  "multiple-choice",
];

/**
 * What each mode is called in front of a student.
 *
 * Beside the modes rather than in the page that happened to render them first:
 * the name of a mode is domain vocabulary, and a second surface needing it
 * should not have to import a page component to find out.
 */
export const STUDY_MODE_LABELS: Record<StudyMode, string> = {
  classic: "Classic",
  "type-answer": "Type Answer",
  "gap-fill": "Gap Fill",
  "multiple-choice": "Multiple Choice",
};

export function isStudyMode(value: unknown): value is StudyMode {
  return (
    typeof value === "string" && STUDY_MODES.includes(value as StudyMode)
  );
}

/**
 * Optional per-card overrides. Every field is optional and nothing is written
 * to existing cards, so this needs no migration: a card without it is marked
 * exactly as it would have been.
 *
 * Author settings beat anything generated. Someone who has said what counts as
 * a right answer should not be argued with by a model.
 */
export type CardStudySettings = {
  acceptedAnswers?: string[];
  requiredConcepts?: string[];
  numericTolerance?: number;
  requireUnits?: boolean;
  caseSensitive?: boolean;
  listOrder?: "fixed" | "any";
  pinnedGaps?: string[];
  disabledModes?: StudyMode[];
  mcqDistractors?: string[];
  /** Why a student might pick a given wrong option, keyed by its text. */
  mcqExplanations?: Record<string, string>;
  /** Prepared, versioned exercise material. Never written back to the card. */
  generatedStudy?: {
    bundleVersion: number;
    sourceHash: string;
    bundleRevision?: string;
    validatorVersion?: number;
    taskProfile?: import("@/lib/study/learning-task").StudyTaskProfile;
    gapVariants: StudyGapVariant[];
    mcqVariants: StudyMcqVariant[];
    retiredVariantIds?: string[];
  };
};

export type StudyGap = {
  id: string;
  start: number;
  end: number;
  answer: string;
  acceptedAnswers: string[];
  concept: string;
  requireUnits?: boolean;
};

export type StudyGapVariant = { id: string; gaps: StudyGap[] };
export type StudyMcqVariant = {
  id: string;
  correctAnswer: string;
  distractors: string[];
  explanations: Record<string, string>;
};

/** Smart Mix picks per card; a fixed policy pins the whole session to one mode. */
export type StudyModePolicy =
  | { kind: "smart" }
  | { kind: "fixed"; mode: StudyMode };

export const SMART_STUDY_MODE_POLICY: StudyModePolicy = { kind: "smart" };

/**
 * How an answer was judged.
 *
 * `needs-self-grade` is not a failure state. It is the honest verdict whenever
 * the marker cannot tell, and it is reached far more often than the others:
 * see `resolveAttemptOutcome`.
 */
export type ExerciseVerdict =
  | "correct"
  | "close"
  | "partial"
  | "incorrect"
  | "needs-self-grade";

export type ResolvedExercise = {
  presentationId?: string;
  cardId: string;
  cardContentHash: string;
  mode: StudyMode;
  prompt: string;
  expectedAnswer: string;
  gaps?: StudyGap[];
  /** Read compatibility for sessions saved before multi-gap support. */
  cloze?: { start: number; end: number; answer: string };
  variantId?: string;
  /** Frozen with the presentation so late preparation cannot move the rubric. */
  markingSettings?: CardStudySettings;
  mcq?: {
    options: Array<{ id: string; text: string }>;
    correctOptionId: string;
    explanations: Record<string, string>;
  };
  source: "deterministic" | "author" | "cached-ai";
};

/**
 * What a marked answer does next.
 *
 * `commit` sends a rating through the study controller in the usual way.
 * `self-grade` reveals the answer and hands the four-point scale back to the
 * student, exactly as Classic does.
 */
export type AttemptOutcome =
  | { kind: "commit"; rating: CardRating; verdict: ExerciseVerdict }
  | { kind: "revisit"; verdict: ExerciseVerdict }
  | { kind: "self-grade"; verdict: ExerciseVerdict };

/**
 * The marking contract: commit only what is unambiguous, ask about the rest.
 *
 * FSRS grades felt difficulty, not correctness. A marker knows correctness and
 * nothing else, so any mapping from one to the other is a guess -- and the
 * guesses go the wrong way. `Hard` in FSRS is a *successful* recall that still
 * grows the interval, so awarding it for a hinted or half-right answer pushes
 * the card the student is struggling with further away, and teaches them not to
 * press Hint.
 *
 * So there are exactly three rules:
 *
 *   - A clean match, unaided, is `Good`.
 *   - A wrong answer is `Again`, hint or no hint: they did not know it.
 *   - Everything else -- close, partial, hinted-and-right, or a marker that is
 *     not sure -- reveals the answer and lets the student rate it.
 *
 * The ambiguity only ever exists on the success side, which is why a hint
 * changes the outcome of a right answer and not a wrong one.
 */
export function resolveAttemptOutcome(
  verdict: ExerciseVerdict,
  options: { hintUsed?: boolean } = {}
): AttemptOutcome {
  if (verdict === "incorrect" || verdict === "partial") {
    return { kind: "commit", rating: "again", verdict };
  }
  if (verdict === "correct") {
    return options.hintUsed
      ? { kind: "revisit", verdict }
      : { kind: "commit", rating: "good", verdict };
  }
  return { kind: "self-grade", verdict };
}

/**
 * Every mode schedules. The quality bar moved instead.
 *
 * Multiple choice used to be practice-only on the grounds that recognising an
 * answer among four is weaker evidence than producing it. That is true of a
 * *bad* question, and it was the honest call while the wrong options were
 * assembled from whatever other cards happened to be in the deck -- those are
 * answerable by elimination, and letting them move a schedule would have been
 * scheduling on a coin flip.
 *
 * So rather than discount the mode, the questions had to get good enough to
 * count: `buildMultipleChoiceQuestion` now refuses to build at all unless the
 * wrong options were written for this card, by Jami or by the student. A
 * question whose distractors are all individually believable is real evidence,
 * and a card that cannot get one simply is not asked this way.
 */

/**
 * A cheap, stable fingerprint of everything that decides how a card is asked.
 *
 * FNV-1a rather than SHA-256 because this one runs in the browser for every
 * card and only ever answers "is this still the card I built the exercise
 * from?". The AI cache key, which has to survive being shared between sessions,
 * is hashed properly on the server.
 */
export function getCardContentHash(input: {
  front: string;
  back: string;
  studySettings?: CardStudySettings;
}) {
  const material = [
    (input.front ?? "").trim(),
    (input.back ?? "").trim(),
    input.studySettings ? JSON.stringify(input.studySettings) : "",
  ].join("\0");

  let hash = 0x811c9dc5;
  for (let index = 0; index < material.length; index += 1) {
    hash ^= material.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
