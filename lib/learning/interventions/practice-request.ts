import { filterCanonicalConceptIds } from "@/lib/practice/exam-specification-concepts";
import {
  MAX_PRACTICE_QUESTIONS,
  MAX_QUESTION_MARKS,
} from "@/lib/learning/interventions/practice-question-shape";

/**
 * Asking for practice questions on one concept, and deciding what came back is
 * usable.
 *
 * The same shape as the flashcard generator next door, and deliberately so: a
 * request validated against the catalogue, a draft the student sees before
 * anything is written, and a failure that leaves the intervention honestly
 * open. What differs is what a question has to carry -- a prompt *and* the
 * scheme that marks it -- and that judgement lives in
 * `practice-question-shape.ts`, re-exported here for the callers that know it
 * by this name.
 */

export {
  MAX_PRACTICE_QUESTIONS,
  MAX_QUESTION_MARKS,
  readPracticeDrafts,
  type PracticeDraftRejection,
  type PracticeQuestionDraft,
} from "@/lib/learning/interventions/practice-question-shape";

export const MIN_PRACTICE_QUESTIONS = 2;
export const DEFAULT_PRACTICE_QUESTIONS = 5;

export type PracticeInterventionRequest = {
  conceptId: string;
  conceptLabel: string;
  specificationId: string;
  requestedCount: number;
  interventionId: string;
};

export type PracticeRequestRejection =
  | "unknown_concept"
  | "missing_intervention"
  | "no_specification";

export type PracticeRequestResult =
  | { ok: true; request: PracticeInterventionRequest }
  | { ok: false; reason: PracticeRequestRejection };

function trimmed(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * A request, or the reason there isn't one.
 *
 * The concept must be one the course's catalogue actually holds. A question
 * generated against an invented heading would be tagged with it, counted as
 * coverage for it, and marked as evidence about it -- three wrong answers from
 * one unchecked string.
 */
export function buildPracticeRequest(input: {
  conceptId: string;
  conceptLabel: string;
  specificationId: string;
  requestedCount?: number;
  interventionId: string;
}): PracticeRequestResult {
  const specificationId = trimmed(input.specificationId, 80);
  if (!specificationId) return { ok: false, reason: "no_specification" };

  const interventionId = trimmed(input.interventionId, 400);
  if (!interventionId) return { ok: false, reason: "missing_intervention" };

  const { conceptIds } = filterCanonicalConceptIds(specificationId, [
    trimmed(input.conceptId, 160),
  ]);
  const conceptId = conceptIds[0];
  if (!conceptId) return { ok: false, reason: "unknown_concept" };

  const requested = Math.round(input.requestedCount ?? DEFAULT_PRACTICE_QUESTIONS);
  return {
    ok: true,
    request: {
      conceptId,
      conceptLabel: trimmed(input.conceptLabel, 200) || conceptId,
      specificationId,
      requestedCount: Math.max(
        MIN_PRACTICE_QUESTIONS,
        Math.min(MAX_PRACTICE_QUESTIONS, requested)
      ),
      interventionId,
    },
  };
}

/** What the model is told, beside the validation that judges its answer. */
export function practiceGenerationPrompt(request: PracticeInterventionRequest) {
  return (
    `Write up to ${request.requestedCount} exam-style questions on one concept from a course ` +
    `specification: "${request.conceptLabel}".\n\n` +
    `Each question must carry its own mark scheme. Give the question prompt, the marks it is ` +
    `worth (at most ${MAX_QUESTION_MARKS}), a full worked answer, and one scheme point per mark ` +
    `saying what earns it. The marks across your scheme points must add up exactly to the marks ` +
    `you gave the question -- a question whose scheme does not account for its own tariff cannot ` +
    `be marked, and will be discarded.\n\n` +
    `Ask the kinds of things this concept is actually examined on. Write fewer questions if the ` +
    `concept does not warrant more; a question that tests nothing wastes the student's time and ` +
    `teaches Jami nothing about them.`
  );
}
