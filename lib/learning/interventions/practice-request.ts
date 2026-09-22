import { filterCanonicalConceptIds } from "@/lib/practice/exam-specification-concepts";

/**
 * Asking for practice questions on one concept, and deciding what came back is
 * usable.
 *
 * The same shape as the flashcard generator next door, and deliberately so: a
 * request validated against the catalogue, a draft the student sees before
 * anything is written, and a failure that leaves the intervention honestly
 * open. What differs is what a question has to carry.
 *
 * A flashcard marks itself -- the student says whether they recalled it. A
 * question does not, so one without a mark scheme can never become evidence:
 * it would be work the student did that Jami cannot read. A question here is
 * therefore a prompt *and* the scheme that marks it, and a draft missing
 * either is refused rather than stored as half a question.
 */

export const MIN_PRACTICE_QUESTIONS = 2;
export const MAX_PRACTICE_QUESTIONS = 10;
export const DEFAULT_PRACTICE_QUESTIONS = 5;
/** More than a short targeted question is worth; a whole-paper answer is not this. */
export const MAX_QUESTION_MARKS = 12;
const MAX_PROMPT_LENGTH = 1_200;
const MAX_ANSWER_LENGTH = 1_500;
const MAX_POINT_TEXT = 300;
const MAX_POINTS_PER_QUESTION = 12;

export type PracticeQuestionDraft = {
  prompt: string;
  marks: number;
  /** What a full answer looks like, for the student after marking. */
  answer: string;
  /** One entry per mark, in the order they would be awarded. */
  points: { marks: number; text: string }[];
};

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

export type PracticeDraftRejection = "no_usable_questions" | "schemes_disagree_with_marks";

export type PracticeDraftResult =
  | { ok: true; questions: PracticeQuestionDraft[]; dropped: number }
  | { ok: false; reason: PracticeDraftRejection };

function readPoints(value: unknown): { marks: number; text: string }[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const points: { marks: number; text: string }[] = [];
  for (const candidate of value.slice(0, MAX_POINTS_PER_QUESTION)) {
    if (!candidate || typeof candidate !== "object") return null;
    const record = candidate as Record<string, unknown>;
    const text = trimmed(record.text ?? record.point ?? record.criterion, MAX_POINT_TEXT);
    const marks =
      typeof record.marks === "number" && Number.isFinite(record.marks)
        ? Math.round(record.marks)
        : null;
    if (!text || marks === null || marks < 1) return null;
    points.push({ marks, text });
  }
  return points.length > 0 ? points : null;
}

/**
 * The questions worth showing, or the reason there are none.
 *
 * Fails closed, and the coherence rule is the same one notebook marking uses:
 * a question worth four marks whose scheme awards two has not been written,
 * it has been described. Marking such a question would produce a score out of
 * a total nothing supports, and that score would become evidence.
 */
export function readPracticeDrafts(value: unknown): PracticeDraftResult {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, reason: "no_usable_questions" };
  }

  const questions: PracticeQuestionDraft[] = [];
  let dropped = 0;
  let disagreed = 0;

  for (const candidate of value.slice(0, MAX_PRACTICE_QUESTIONS)) {
    if (!candidate || typeof candidate !== "object") {
      dropped += 1;
      continue;
    }
    const record = candidate as Record<string, unknown>;
    const prompt = trimmed(record.prompt ?? record.question, MAX_PROMPT_LENGTH);
    const answer = trimmed(record.answer, MAX_ANSWER_LENGTH);
    const points = readPoints(record.points ?? record.markScheme);
    const marks =
      typeof record.marks === "number" && Number.isFinite(record.marks)
        ? Math.round(record.marks)
        : null;

    if (!prompt || !answer || !points || marks === null) {
      dropped += 1;
      continue;
    }
    if (marks < 1 || marks > MAX_QUESTION_MARKS) {
      dropped += 1;
      continue;
    }
    // The tariff has to be the scheme's own total, or the marking is fiction.
    const schemeTotal = points.reduce((total, point) => total + point.marks, 0);
    if (schemeTotal !== marks) {
      disagreed += 1;
      continue;
    }
    questions.push({ prompt, marks, answer, points });
  }

  if (questions.length === 0) {
    return {
      ok: false,
      reason: disagreed > 0 ? "schemes_disagree_with_marks" : "no_usable_questions",
    };
  }
  return { ok: true, questions, dropped: dropped + disagreed };
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
