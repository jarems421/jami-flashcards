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
  await db.runTransaction(async (transaction) => {
    const [attemptSnapshot, statsSnapshot] = await Promise.all([
      transaction.get(attemptRef), transaction.get(statsRef),
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
    transaction.update(statsRef, {
      scoreFractionTotal: total,
      squaredFractionTotal: squared,
      meanScoreFraction: count > 0 ? total / count : 0,
      updatedAt: Date.now(),
    });
    transaction.update(attemptRef, { statsContributionFraction: nextFraction });
  });
}
