import type { ExamDifficulty } from "@/lib/practice/exam-questions";

/**
 * Where a question's difficulty settles once real students have answered it.
 *
 * The bands deliberately overlap. An easy question has to fall below 0.7 to
 * become medium, but a medium one has to reach 0.8 to become easy -- so a
 * question sitting at 0.75 stays where it is instead of flipping back and
 * forth every few attempts. The same gap sits between medium and hard.
 */
export const EXAM_DIFFICULTY_MIN_ATTEMPTS = 12;
export const EXAM_DIFFICULTY_MAX_REVERSALS = 3;

export function nextExamDifficulty(current: ExamDifficulty, mean: number): ExamDifficulty {
  if (current === "easy") return mean < 0.7 ? "medium" : "easy";
  if (current === "hard") return mean >= 0.5 ? "medium" : "hard";
  if (mean >= 0.8) return "easy";
  if (mean < 0.4) return "hard";
  return "medium";
}

export function examDifficultyDirection(from: ExamDifficulty, to: ExamDifficulty): -1 | 0 | 1 {
  const rank = { easy: 0, medium: 1, hard: 2 } as const;
  return Math.sign(rank[to] - rank[from]) as -1 | 0 | 1;
}

/**
 * The tier a question should now carry, and whether it has flapped too often.
 *
 * A question that has changed direction three times does not have a difficulty
 * problem; it has a mark scheme problem, and the right response is to send it
 * back for review rather than keep moving it.
 */
export function resolveExamDifficulty(input: {
  current: ExamDifficulty;
  mean: number;
  attemptCount: number;
  previousDirection: -1 | 0 | 1;
  reversals: number;
}) {
  const proposed = input.attemptCount >= EXAM_DIFFICULTY_MIN_ATTEMPTS
    ? nextExamDifficulty(input.current, input.mean)
    : input.current;
  const move = examDifficultyDirection(input.current, proposed);
  const reversed = move !== 0 && input.previousDirection !== 0 && move !== input.previousDirection;
  const reversals = input.reversals + (reversed ? 1 : 0);
  return {
    difficulty: proposed,
    changed: proposed !== input.current,
    previousDirection: (move || input.previousDirection) as -1 | 0 | 1,
    reversals,
    needsReview: reversals >= EXAM_DIFFICULTY_MAX_REVERSALS,
  };
}
