import { LEARNING_ERROR_CATEGORIES, type LearningErrorCategory } from "@/lib/learning/types";
import {
  REVISION_MISTAKES,
  type RevisionLesson,
  type RevisionMistake,
  type RevisionTask,
  type RevisionVerdict,
} from "@/lib/revision/types";

/**
 * What the model writes for a Revision Session, read without trusting it.
 *
 * Every field is required, trimmed and length-capped, and a lesson missing any
 * part of itself is refused whole rather than patched: a session that teaches
 * an idea and then has nothing to ask about it is worse than one that says it
 * could not be prepared. The caps are generous against what the prompt asks
 * for, so a model that runs a little long is not thrown away, while one that
 * writes an essay is.
 */

export const REVISION_TEXT_LIMITS = {
  goal: 120,
  orientation: 400,
  explanation: 1_400,
  exampleProblem: 300,
  exampleStep: 300,
  prompt: 700,
  hint: 300,
  answer: 300,
  markPoint: 240,
  solution: 1_000,
  feedback: 300,
} as const;

const GOAL_COUNT = 3;
const MAX_EXAMPLE_STEPS = 6;
const MAX_MARK_POINTS = 4;

function readText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\r\n?/g, "\n").trim();
  if (!text || text.length > max) return null;
  return text;
}

function readTextList(value: unknown, max: number, limit: number): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value
    .map((item) => readText(item, max))
    .filter((item): item is string => item !== null)
    .slice(0, limit);
  return items.length > 0 ? items : null;
}

export function readRevisionTask(value: unknown): RevisionTask | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const prompt = readText(record.prompt, REVISION_TEXT_LIMITS.prompt);
  const hint = readText(record.hint, REVISION_TEXT_LIMITS.hint);
  const answer = readText(record.answer, REVISION_TEXT_LIMITS.answer);
  const markScheme = readTextList(record.markScheme, REVISION_TEXT_LIMITS.markPoint, MAX_MARK_POINTS);
  const solution = readText(record.solution, REVISION_TEXT_LIMITS.solution);
  if (!prompt || !hint || !answer || !markScheme || !solution) return null;
  return { prompt, hint, answer, markScheme, solution };
}

/** The lesson, or null if any part of it is missing, empty or too long. */
export function readRevisionLesson(value: unknown): RevisionLesson | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const goals = readTextList(record.goals, REVISION_TEXT_LIMITS.goal, GOAL_COUNT);
  const orientation = readText(record.orientation, REVISION_TEXT_LIMITS.orientation);
  const explanation =
    record.explanation && typeof record.explanation === "object"
      ? (record.explanation as Record<string, unknown>)
      : null;
  const body = readText(explanation?.body, REVISION_TEXT_LIMITS.explanation);
  const example =
    explanation?.example && typeof explanation.example === "object"
      ? (explanation.example as Record<string, unknown>)
      : null;
  const problem = readText(example?.problem, REVISION_TEXT_LIMITS.exampleProblem);
  const steps = readTextList(example?.steps, REVISION_TEXT_LIMITS.exampleStep, MAX_EXAMPLE_STEPS);
  const guided = readRevisionTask(record.guided);
  const independent = readRevisionTask(record.independent);
  const apply = readRevisionTask(record.apply);
  const retrieve = readRevisionTask(record.retrieve);

  if (
    !goals ||
    goals.length < GOAL_COUNT ||
    !orientation ||
    !body ||
    !problem ||
    !steps ||
    !guided ||
    !independent ||
    !apply ||
    !retrieve
  ) {
    return null;
  }
  return {
    goals,
    orientation,
    explanation: { body, example: { problem, steps } },
    guided,
    independent,
    apply,
    retrieve,
  };
}

/** The second go at the guided step: a different way in, and a new question. */
export function readRevisionRetry(value: unknown): RevisionLesson["retry"] | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const explanation = readText(record.explanation, REVISION_TEXT_LIMITS.explanation);
  const task = readRevisionTask(record.task);
  return explanation && task ? { explanation, task } : null;
}

export type RevisionMarking = {
  verdict: RevisionVerdict;
  score: number;
  feedback: string;
  errorCategory?: LearningErrorCategory;
  /** What kind of mistake it was, when it was one. Never set on a correct answer. */
  mistake?: RevisionMistake;
};

const SCORE_RANGE: Record<RevisionVerdict, [number, number]> = {
  correct: [0.8, 1],
  partial: [0.2, 0.8],
  incorrect: [0, 0.2],
};
const DEFAULT_SCORE: Record<RevisionVerdict, number> = {
  correct: 1,
  partial: 0.5,
  incorrect: 0,
};

function isVerdict(value: unknown): value is RevisionVerdict {
  return value === "correct" || value === "partial" || value === "incorrect";
}

function isErrorCategory(value: unknown): value is LearningErrorCategory {
  return LEARNING_ERROR_CATEGORIES.some((category) => category === value);
}

function isMistake(value: unknown): value is RevisionMistake {
  return REVISION_MISTAKES.some((mistake) => mistake === value);
}

/**
 * A mark, or null when the marker did not give one.
 *
 * The score is held inside the band its verdict allows, so "correct, 0.1" and
 * "incorrect, 0.9" cannot reach the engine. An error category outside the
 * engine's fixed list is dropped rather than refused: the verdict still
 * stands, and inventing categories is exactly what the fixed list prevents.
 */
export function readRevisionMarking(value: unknown): RevisionMarking | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (!isVerdict(record.verdict)) return null;
  const verdict = record.verdict;
  const feedback = readText(record.feedback, REVISION_TEXT_LIMITS.feedback);
  if (!feedback) return null;
  const [low, high] = SCORE_RANGE[verdict];
  const raw = typeof record.score === "number" && Number.isFinite(record.score)
    ? record.score
    : DEFAULT_SCORE[verdict];
  const score = Math.min(high, Math.max(low, raw));
  return {
    verdict,
    score,
    feedback,
    ...(verdict !== "correct" && isErrorCategory(record.errorCategory)
      ? { errorCategory: record.errorCategory }
      : {}),
    ...(verdict !== "correct" && isMistake(record.mistake) ? { mistake: record.mistake } : {}),
  };
}

/** Spacing, case and the harmless ways of writing the same symbol, removed. */
function normaliseAnswer(value: string) {
  return value
    .toLowerCase()
    .replace(/\$/g, "")
    .replace(/\\left|\\right/g, "")
    .replace(/[−–]/g, "-")
    .replace(/×|\\times/g, "*")
    .replace(/\^\{?2\}?|²/g, "^2")
    .replace(/\^\{?3\}?|³/g, "^3")
    .replace(/\s+/g, "")
    .replace(/[.,;]+$/, "");
}

/**
 * Whether an answer is the expected answer, character for character once
 * spacing and notation are set aside.
 *
 * Only ever says yes. An exact match needs no model to mark it -- saving the
 * student a wait on the answers they get cleanly right -- but a mismatch
 * proves nothing, since a correct answer can be written a hundred ways, so a
 * mismatch always goes to the marker.
 */
export function matchesExpectedAnswer(answer: string, expected: string) {
  const given = normaliseAnswer(answer);
  return given.length > 0 && given === normaliseAnswer(expected);
}
