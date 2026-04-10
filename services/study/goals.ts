import {
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
import { getUpdatedGoalAfterAnswer, normalizeGoal } from "@/lib/study/goals";

const QUERY_MS = 30_000;
const UPDATE_MS = 30_000;

export async function applyGoalProgressForAnswer(
  userId: string,
  isCorrect: boolean,
  now = Date.now()
) {
  const goalsCollection = collection(db, "users", userId, "goals");
  const activeGoalsSnapshot = await withTimeout(
    getDocs(query(goalsCollection, where("status", "==", "active"))),
    QUERY_MS,
    "Load active goals"
  );

  const goalUpdates = activeGoalsSnapshot.docs.map(async (goalDoc) => {
    const goal = normalizeGoal(
      goalDoc.id,
      goalDoc.data() as Record<string, unknown>
    );
    const updatedGoal = getUpdatedGoalAfterAnswer(goal, isCorrect, now);

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
      };
    }

    return {
      completedGoals: 0,
      starsEarned: 0,
    };
  });

  const results = await Promise.all(goalUpdates);

  return results.reduce(
    (totals, result) => ({
      completedGoals: totals.completedGoals + result.completedGoals,
      starsEarned: totals.starsEarned + result.starsEarned,
    }),
    { completedGoals: 0, starsEarned: 0 }
  );
}
