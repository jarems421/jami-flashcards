import "server-only";

import { getAdminDb } from "@/services/firebase/admin";
import type { ExamDifficulty } from "@/lib/practice/exam-questions";
import { resolveExamDifficulty } from "@/lib/practice/exam-difficulty";

type Stats = {
  attemptCount?: number;
  scoreFractionTotal?: number;
  squaredFractionTotal?: number;
  difficulty?: ExamDifficulty;
  previousDirection?: -1 | 0 | 1;
  reversals?: number;
  answerDurationMsTotal?: number;
};

export async function recordExamDifficultyContribution(input: {
  uid: string;
  attemptId: string;
  questionId: string;
  studyLevel: string;
  fraction: number;
  durationMs?: number;
}) {
  const db = getAdminDb();
  const attemptRef = db.collection("users").doc(input.uid).collection("examAttempts").doc(input.attemptId);
  const statsRef = db.collection("examQuestionStats").doc(`${input.questionId}_${input.studyLevel}`);
  const questionRef = db.collection("examQuestions").doc(input.questionId);
  await db.runTransaction(async (transaction) => {
    const [attemptSnapshot, statsSnapshot, questionSnapshot] = await Promise.all([
      transaction.get(attemptRef), transaction.get(statsRef), transaction.get(questionRef),
    ]);
    if (!attemptSnapshot.exists || !questionSnapshot.exists) return;
    const attempt = attemptSnapshot.data();
    if (attempt?.attemptNumber !== 1 || attempt.status !== "marked" || !attempt.result?.attempted) return;
    if (typeof attemptSnapshot.data()?.statsContributionFraction === "number") return;
    const old = (statsSnapshot.data() ?? {}) as Stats;
    const current = (old.difficulty ?? questionSnapshot.data()?.difficulty ?? "medium") as ExamDifficulty;
    const fraction = Math.max(0, Math.min(1, attempt.result.awardedMarks / attempt.result.maxMarks));
    const count = (old.attemptCount ?? 0) + 1;
    const total = (old.scoreFractionTotal ?? 0) + fraction;
    const squared = (old.squaredFractionTotal ?? 0) + fraction * fraction;
    const mean = total / count;
    const outcome = resolveExamDifficulty({
      current,
      mean,
      attemptCount: count,
      previousDirection: old.previousDirection ?? 0,
      reversals: old.reversals ?? 0,
    });
    transaction.set(statsRef, {
      questionId: input.questionId,
      studyLevel: input.studyLevel,
      attemptCount: count,
      scoreFractionTotal: total,
      squaredFractionTotal: squared,
      answerDurationMsTotal: (old.answerDurationMsTotal ?? 0) + Math.max(0, input.durationMs ?? 0),
      meanScoreFraction: mean,
      difficulty: outcome.difficulty,
      previousDirection: outcome.previousDirection,
      reversals: outcome.reversals,
      updatedAt: Date.now(),
    }, { merge: true });
    transaction.update(attemptRef, { statsContributionFraction: fraction });
    if (outcome.needsReview) transaction.update(questionRef, { status: "needs_review", updatedAt: Date.now() });
    else if (outcome.changed) transaction.update(questionRef, { difficulty: outcome.difficulty, difficultySource: "student_data", updatedAt: Date.now() });
  });
}

/**
 * A reviewed mark, applied to the statistics that mark already fed.
 *
 * The correction used to move the totals and stop there, leaving the tier
 * standing on the old mark. A question whose reviewed scores had risen out of
 * "hard" stayed hard until some other student's first attempt happened to
 * trigger a recalculation -- so the same evidence produced a different tier
 * depending on which order two students finished in.
 */
export async function correctExamDifficultyContribution(input: {
  uid: string;
  attemptId: string;
  questionId: string;
  studyLevel: string;
  newFraction: number;
}) {
  const db = getAdminDb();
  const attemptRef = db.collection("users").doc(input.uid).collection("examAttempts").doc(input.attemptId);
  const statsRef = db.collection("examQuestionStats").doc(`${input.questionId}_${input.studyLevel}`);
  const questionRef = db.collection("examQuestions").doc(input.questionId);
  await db.runTransaction(async (transaction) => {
    const [attemptSnapshot, statsSnapshot, questionSnapshot] = await Promise.all([
      transaction.get(attemptRef), transaction.get(statsRef), transaction.get(questionRef),
    ]);
    const oldFraction = attemptSnapshot.data()?.statsContributionFraction;
    if (typeof oldFraction !== "number" || !statsSnapshot.exists) return;
    const stats = statsSnapshot.data() as Stats;
    const result = attemptSnapshot.data()?.result;
    if (!result || result.maxMarks <= 0) return;
    const nextFraction = Math.max(0, Math.min(1, result.awardedMarks / result.maxMarks));
    const count = stats.attemptCount ?? 0;
    const total = (stats.scoreFractionTotal ?? 0) - oldFraction + nextFraction;
    const squared = (stats.squaredFractionTotal ?? 0) - oldFraction * oldFraction + nextFraction * nextFraction;
    const mean = count > 0 ? total / count : 0;
    /*
     * The same calibration a first attempt goes through, including its
     * dead band and its reversal cap. Running a different rule on corrections
     * would let a question oscillate through review that could not oscillate
     * through marking.
     */
    const outcome = resolveExamDifficulty({
      current: (stats.difficulty ?? questionSnapshot.data()?.difficulty ?? "medium") as ExamDifficulty,
      mean,
      attemptCount: count,
      previousDirection: stats.previousDirection ?? 0,
      reversals: stats.reversals ?? 0,
    });
    transaction.update(statsRef, {
      scoreFractionTotal: total,
      squaredFractionTotal: squared,
      meanScoreFraction: mean,
      difficulty: outcome.difficulty,
      previousDirection: outcome.previousDirection,
      reversals: outcome.reversals,
      updatedAt: Date.now(),
    });
    transaction.update(attemptRef, { statsContributionFraction: nextFraction });
    if (questionSnapshot.exists) {
      if (outcome.needsReview) transaction.update(questionRef, { status: "needs_review", updatedAt: Date.now() });
      else if (outcome.changed) transaction.update(questionRef, { difficulty: outcome.difficulty, difficultySource: "student_data", updatedAt: Date.now() });
    }
  });
}

/**
 * Contributions that were marked but never counted, driven again.
 *
 * The statistics are written after the marking transaction commits, so a
 * request that dies in between leaves an attempt marked and uncounted with
 * nothing to retry it -- and the question's difficulty then rests on a sample
 * that silently excludes it. There is no separate pending record to keep in
 * step: a first attempt that is marked, attempted, and carries no contribution
 * fraction *is* the pending event, and recording one is idempotent, so this can
 * run as often as it likes.
 */
export async function recoverExamDifficultyContributions(input: {
  uid: string;
  studyLevel: string;
  /** Stored attempts as they come back from Firestore, read defensively. */
  attempts: { id: string; data: Record<string, unknown> }[];
}) {
  const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  const pending = input.attempts.filter(({ data }) => {
    const result = data.result as { attempted?: unknown; maxMarks?: unknown } | undefined;
    return (
      data.status === "marked" &&
      data.attemptNumber === 1 &&
      result?.attempted === true &&
      number(result.maxMarks) > 0 &&
      typeof data.statsContributionFraction !== "number" &&
      typeof data.questionId === "string"
    );
  });
  for (const { id, data } of pending) {
    const result = data.result as { awardedMarks?: unknown; maxMarks?: unknown };
    await recordExamDifficultyContribution({
      uid: input.uid,
      attemptId: id,
      questionId: data.questionId as string,
      studyLevel: input.studyLevel,
      fraction: number(result.awardedMarks) / number(result.maxMarks),
      durationMs: Math.max(0, number(data.submittedAt) - number(data.startedAt)),
    }).catch(() => undefined);
  }
  return pending.length;
}
