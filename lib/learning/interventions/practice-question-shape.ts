/**
 * What makes a written practice question markable.
 *
 * Split out of `practice-request.ts`, which also validates a request against a
 * course's specification catalogue, so that anything that only needs to judge
 * a question's shape -- Tutor's suggested questions among them -- can do so
 * without carrying the catalogue into the browser.
 *
 * A flashcard marks itself -- the student says whether they recalled it. A
 * question does not, so one without a mark scheme can never become evidence:
 * it would be work the student did that Jami cannot read. A question here is
 * therefore a prompt *and* the scheme that marks it, and a draft missing
 * either is refused rather than stored as half a question.
 */

export const MAX_PRACTICE_QUESTIONS = 10;
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

export type PracticeDraftRejection = "no_usable_questions" | "schemes_disagree_with_marks";

export type PracticeDraftResult =
  | { ok: true; questions: PracticeQuestionDraft[]; dropped: number }
  | { ok: false; reason: PracticeDraftRejection };

function trimmed(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

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
