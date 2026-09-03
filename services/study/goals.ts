import {
  addDoc,
  collection,
  doc,
  documentId,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";
import { invalidateDashboardData } from "@/services/dashboard/cache";
import { createStarForGoalIfMissing } from "@/services/constellation/stars";
import {
  getGoalDisplayName,
  getGoalStatusAtTime,
  getUpdatedGoalAfterAnswer,
  normalizeGoal,
  type Goal,
  type GoalAnswerContext,
} from "@/lib/study/goals";
import type { Star } from "@/lib/constellation/stars";

/** A finished goal and the star it earned, for the session to celebrate. */
export type GoalReward = { star: Star; goalName: string };

export type GoalProgressResult = {
  completedGoals: number;
  starsEarned: number;
  rewards: GoalReward[];
};

export type DashboardGoalSummary = {
  activeGoals: Goal[];
  hasEarnedStars: boolean;
};

export type GoalHistoryCursor = { createdAt: number; id: string };

const QUERY_MS = 30_000;
const UPDATE_MS = 30_000;

function goalsCollection(userId: string) {
  return collection(db, "users", userId, "goals");
}

export async function getGoals(userId: string): Promise<Goal[]> {
  const snapshot = await getDocs(goalsCollection(userId));

  return snapshot.docs.map((goalDoc) =>
    normalizeGoal(goalDoc.id, goalDoc.data() as Record<string, unknown>)
  );
}

async function loadActiveGoals(userId: string) {
  const snapshot = await getDocs(
    query(goalsCollection(userId), where("status", "==", "active"))
  );
  return snapshot.docs.map((goalDoc) =>
    normalizeGoal(goalDoc.id, goalDoc.data() as Record<string, unknown>)
  );
}

export async function getDashboardGoalSummary(
  userId: string,
  now = Date.now()
): Promise<DashboardGoalSummary> {
  /*
   * Whether a star exists, not whether a goal was completed.
   *
   * This asked for one completed goal and reported it as an earned star, and
   * the two are not the same: a goal that completes while the constellation is
   * full mints nothing (createStarForGoalIfMissing returns null at its
   * starCount check). Today then told the student "Your latest goal reward is
   * waiting" and sent them to a sky that had not changed.
   *
   * lib/study/study-feedback.ts already draws this distinction correctly, and
   * acknowledges that case in words instead.
   */
  const [activeGoals, starSnapshot] = await Promise.all([
    loadActiveGoals(userId),
    getDocs(query(collection(db, "users", userId, "stars"), limit(1))),
  ]);

  return {
    activeGoals: activeGoals
      .filter(
        (goal) =>
          goal.status === "active" &&
          (goal.deadline <= 0 || goal.deadline > now)
      )
      .sort((left, right) => right.createdAt - left.createdAt),
    hasEarnedStars: !starSnapshot.empty,
  };
}

export async function getActiveGoalsWithCurrentStatuses(
  userId: string,
  now = Date.now()
) {
  const goals = await loadActiveGoals(userId);
  const updates: Promise<void>[] = [];
  const currentGoals = goals.map((goal) => {
    const status = getGoalStatusAtTime(goal, now);
    if (status === goal.status) return goal;
    updates.push(
      updateDoc(doc(db, "users", userId, "goals", goal.id), { status })
    );
    return { ...goal, status };
  });

  if (updates.length > 0) {
    await Promise.all(updates);
    invalidateDashboardData(userId);
  }

  return currentGoals
    .filter((goal) => goal.status === "active")
    .sort((left, right) => right.createdAt - left.createdAt);
}

export async function getCompletedGoalCount(userId: string) {
  const snapshot = await getCountFromServer(
    query(goalsCollection(userId), where("status", "==", "completed"))
  );
  return snapshot.data().count;
}

export async function getGoalHistoryPage(
  userId: string,
  options: { cursor?: GoalHistoryCursor | null; pageSize?: number } = {}
) {
  const pageSize = Math.max(1, Math.min(100, options.pageSize ?? 30));
  const snapshot = await getDocs(
    query(
      goalsCollection(userId),
      where("status", "in", ["completed", "failed", "cancelled"]),
      orderBy("createdAt", "desc"),
      orderBy(documentId(), "desc"),
      ...(options.cursor
        ? [startAfter(options.cursor.createdAt, options.cursor.id)]
        : []),
      limit(pageSize + 1)
    )
  );
  const pageDocs = snapshot.docs.slice(0, pageSize);

  const items = pageDocs.map((goalDoc) =>
      normalizeGoal(goalDoc.id, goalDoc.data() as Record<string, unknown>)
    );

  const finalDoc = pageDocs[pageDocs.length - 1];

  return {
    items,
    nextCursor:
      snapshot.docs.length > pageSize && finalDoc
        ? {
            createdAt: finalDoc.data().createdAt as number,
            id: finalDoc.id,
          }
        : null,
  };
}

export async function createGoal(
  userId: string,
  goal: Omit<Goal, "id">
): Promise<Goal> {
  const goalRef = await addDoc(goalsCollection(userId), goal);
  invalidateDashboardData(userId);
  return { id: goalRef.id, ...goal };
}

export async function updateGoal(
  userId: string,
  goalId: string,
  updates: Partial<Omit<Goal, "id">>
) {
  await updateDoc(doc(db, "users", userId, "goals", goalId), updates);
  invalidateDashboardData(userId);
}

export async function applyGoalProgressForAnswer(
  userId: string,
  isCorrect: boolean,
  now = Date.now(),
  context: GoalAnswerContext = {}
) {
  // Use the same compatibility-aware active set as the read surfaces. A goal
  // created before `status` was persisted must not appear active in Today and
  // then silently miss answer progress.
  const activeGoals = await withTimeout(
    loadActiveGoals(userId),
    QUERY_MS,
    "Load active goals"
  );

  const goalUpdates = activeGoals.map(async (goal) => {
    const updatedGoal = getUpdatedGoalAfterAnswer(goal, isCorrect, now, context);

    if (updatedGoal === goal) {
      return {
        completedGoals: 0,
        starsEarned: 0,
        rewards: [] as GoalReward[],
      };
    }

    await withTimeout(
      updateDoc(doc(db, "users", userId, "goals", goal.id), {
        progress: updatedGoal.progress,
        status: updatedGoal.status,
      }),
      UPDATE_MS,
      "Update goal progress"
    );

    if (goal.status === "active" && updatedGoal.status === "completed") {
      const createdStar = await createStarForGoalIfMissing(userId, updatedGoal);
      return {
        completedGoals: 1,
        starsEarned: createdStar ? 1 : 0,
        // Carried back so the session can show the star that was actually
        // written, with its own colour and shape, rather than a stand-in.
        rewards: createdStar
          ? [{ star: createdStar, goalName: getGoalDisplayName(updatedGoal) }]
          : [],
      };
    }

    return {
      completedGoals: 0,
      starsEarned: 0,
      rewards: [] as GoalReward[],
    };
  });

  const results = await Promise.all(goalUpdates);
  if (results.some((result) => result.completedGoals > 0 || result.starsEarned > 0)) {
    invalidateDashboardData(userId);
  } else if (activeGoals.length > 0) {
    // An active goal can gain card progress without completing.
    invalidateDashboardData(userId);
  }

  return results.reduce<GoalProgressResult>(
    (totals, result) => ({
      completedGoals: totals.completedGoals + result.completedGoals,
      starsEarned: totals.starsEarned + result.starsEarned,
      rewards: [...totals.rewards, ...result.rewards],
    }),
    { completedGoals: 0, starsEarned: 0, rewards: [] }
  );
}
