/**
 * The numbers the learner model is made of, in one place so they can be fitted.
 *
 * Every value here was chosen by hand and reasoned about in the comments below.
 * That is a decent starting point and not evidence: the reasoning says why a
 * number is plausible, never that it is right. Gathering them into one object
 * lets `scripts/eval/learner-model-fit.ts` replay a student's real history
 * under candidate values and report which ones actually predicted their answers.
 *
 * Nothing here may import from the scoring modules -- they import from this --
 * so the tuning object stays a plain description of the model's constants.
 */

import type { LearningEvidenceKind } from "@/lib/learning/types";

export type LearningTuning = {
  /** How quickly old evidence fades, in days, as a half-life. */
  masteryRecencyHalfLifeDays: number;
  /** Where a mastery estimate starts before there is any evidence. */
  masteryPrior: number;
  /** How many answers' worth of weight that starting point carries. */
  masteryPriorWeight: number;
  /** How many answers' worth of recent evidence it takes to be fairly sure. */
  confidenceEvidenceScale: number;
  /** The most one item may count for, as a multiple of its heaviest answer. */
  maxEvidencePerItem: number;
  /** A change in accuracy smaller than this is noise rather than a trend. */
  trendThreshold: number;
  /** How much of a card's recall score comes from its lapse rate; the rest comes from FSRS difficulty. */
  flashcardLapseWeight: number;
  /** The most a card currently in relearning may score, whatever its history says. */
  flashcardRelearningCap: number;
  /**
   * How far ahead the memory model is read when scoring a card, in days.
   * Zero asks "could they recall it this second", which is 1.0 for every card
   * just reviewed however shaky it is.
   */
  masteryHorizonDays: number;
  /**
   * How far a topic's prior is allowed to move from the neutral 0.5 towards
   * how this student does across the whole scope. Zero never pools.
   */
  studentPriorStrength: number;
  /**
   * What an answer is worth according to where it came from, before its size
   * and its age are considered.
   *
   * Every source already scaled with the marks at stake, and nothing scaled
   * with how much the source could be trusted -- so a six-mark question Jami
   * wrote, marked by a scheme Jami also wrote, counted exactly as much as a
   * six-mark question from a real paper marked against the board's own scheme.
   * Twelve generated questions then outweighed three real ones, which is the
   * wrong way round: volume is the one thing generated practice has in
   * unlimited supply.
   */
  evidenceSourceWeight: Record<LearningEvidenceKind, number>;
};

/**
 * Today's hand-set values, and why each was chosen.
 *
 * `masteryRecencyHalfLifeDays`: forty-five days keeps last term's work relevant
 * while letting this month's outweigh it; a year-old answer still counts, just
 * for very little.
 *
 * `masteryPrior` / `masteryPriorWeight`: without a prior, one wrong answer is 0%
 * mastery and one right answer is 100%. The prior pulls thin evidence towards
 * the middle, so a topic only reads as very weak or very strong once enough work
 * says so.
 *
 * `confidenceEvidenceScale`: with a scale of six, three answers give about 39%
 * confidence, seventeen give about 94%, and eighty give effectively certain.
 * "33% from 3 questions" and "58% across 84" should not read as the same kind of
 * claim, and this is the number that tells them apart.
 *
 * `maxEvidencePerItem`: retrying a question, or reviewing the same card every day
 * for a month, is not that many independent pieces of evidence about a topic. At
 * 1.5 a past-paper question plus its guided retry (which counts half) sits exactly
 * at the cap, so the cap only bites on genuine repetition.
 *
 * `trendThreshold`: below twelve points of accuracy, a difference between two
 * windows is as likely to be which questions came up as a change in the student.
 *
 * `flashcardLapseWeight` / `flashcardRelearningCap`: the share of reviews that were
 * not lapses, blended with FSRS difficulty, and capped low for a card that was
 * forgotten on its last review. Only the fallback path for cards carrying no
 * FSRS stability still uses these; see `memory-model.ts`.
 *
 * `masteryHorizonDays`: a week. Read at zero days the memory model answers 1.0
 * for every card reviewed today -- one with a stability of a single day and one
 * with a stability of two hundred read exactly alike, which is the opposite of
 * what mastery is meant to say. A week out they read 0.73 and 0.99. Far enough
 * to tell a fragile memory from a durable one, near enough that it is still a
 * statement about what the student knows now rather than a forecast.
 *
 * `studentPriorStrength`: fully on. A flat 0.5 says every student begins every
 * topic as a coin toss, which is not what anyone believes about a student who
 * is at 85% across the folder. Pooling is bounded by how much the scope
 * actually shows, so a new student is unaffected -- see `learner-prior.ts`.
 */
export const DEFAULT_LEARNING_TUNING: LearningTuning = {
  masteryRecencyHalfLifeDays: 45,
  masteryPrior: 0.5,
  masteryPriorWeight: 1.5,
  confidenceEvidenceScale: 6,
  maxEvidencePerItem: 1.5,
  trendThreshold: 0.12,
  flashcardLapseWeight: 0.7,
  flashcardRelearningCap: 0.25,
  masteryHorizonDays: 7,
  studentPriorStrength: 1,
  /*
   * A real exam question is the reference at 1: a question a board set, marked
   * against a scheme a board published.
   *
   * `past-paper` 1. The thing everything else is measured against.
   *
   * `practice` 0.6. A generated question testing a real concept, marked by a
   * generated scheme. Genuine evidence about application -- it is the student's
   * own work on a question they could not see the answer to -- but the question
   * and the marking are both Jami's, and there is no shortage of them. At 0.6
   * it takes five generated questions to say what three real ones say.
   *
   * `flashcards` 1, deliberately. A flashcard answered is a flashcard
   * answered: there is nothing untrustworthy about the source. Recall is a
   * different *claim* from application, not a less reliable one, and that
   * distinction is already carried by the concept hierarchy -- cards sit on
   * the broad Topic, exam answers on the concept beneath it, and the two never
   * merge. Trying to express it here as well was both wrong and harmful:
   * scaling every card down uniformly strengthens the prior against them,
   * which flattened nothing and made `fitLearningTuning` start reporting a
   * half-life that is really noise. The fitting harness caught it.
   *
   * `notebook` 0.35, and this is the one that also changes shape: it used to be
   * a flat third regardless of how much work was marked, so a twenty-mark page
   * and a two-mark aside counted alike. It now scales with the marks like every
   * other marked source, and carries its own low multiplier instead.
   */
  evidenceSourceWeight: {
    "past-paper": 1,
    practice: 0.6,
    flashcards: 1,
    notebook: 0.35,
  },
};
