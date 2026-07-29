import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";
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

export async function getGoalsWithCurrentStatuses(
  userId: string,
  now = Date.now()
): Promise<Goal[]> {
  const goals = await getGoals(userId);
  const statusUpdates: Promise<void>[] = [];
  const currentGoals = goals.map((goal) => {
    const status = getGoalStatusAtTime(goal, now);

    if (status !== goal.status) {
      statusUpdates.push(
        updateDoc(doc(db, "users", userId, "goals", goal.id), { status })
      );
      return { ...goal, status };
    }

    return goal;
  });

  if (statusUpdates.length > 0) {
    await Promise.all(statusUpdates);
  }

  return currentGoals.sort((left, right) => right.createdAt - left.createdAt);
}

export async function createGoal(
  userId: string,
  goal: Omit<Goal, "id">
): Promise<Goal> {
  const goalRef = await addDoc(goalsCollection(userId), goal);
  return { id: goalRef.id, ...goal };
}

export async function updateGoal(
  userId: string,
  goalId: string,
  updates: Partial<Omit<Goal, "id">>
) {
  await updateDoc(doc(db, "users", userId, "goals", goalId), updates);
}

export async function applyGoalProgressForAnswer(
  userId: string,
  isCorrect: boolean,
  now = Date.now(),
  context: GoalAnswerContext = {}
) {
  const userGoalsCollection = goalsCollection(userId);
  const activeGoalsSnapshot = await withTimeout(
    getDocs(query(userGoalsCollection, where("status", "==", "active"))),
    QUERY_MS,
    "Load active goals"
  );

  const goalUpdates = activeGoalsSnapshot.docs.map(async (goalDoc) => {
    const goal = normalizeGoal(
      goalDoc.id,
      goalDoc.data() as Record<string, unknown>
    );
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

  return results.reduce<GoalProgressResult>(
    (totals, result) => ({
      completedGoals: totals.completedGoals + result.completedGoals,
      starsEarned: totals.starsEarned + result.starsEarned,
      rewards: [...totals.rewards, ...result.rewards],
    }),
    { completedGoals: 0, starsEarned: 0, rewards: [] }
  );
}
