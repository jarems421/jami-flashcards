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
  invalidateLegacyActiveRecords,
  loadCachedLegacyActiveRecords,
} from "@/services/study/active-compatibility";
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

export type GoalHistoryCursor =
  | { phase: "modern"; createdAt: number; id: string }
  | { phase: "legacy"; id: string | null };

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

function isPersistedGoalStatus(value: unknown) {
  return (
    value === "active" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  );
}

function isHistoricalGoalStatus(value: unknown) {
  return value === "completed" || value === "failed" || value === "cancelled";
}

function invalidateGoalCompatibility(userId: string) {
  invalidateLegacyActiveRecords(userId, "goals");
  invalidateLegacyActiveRecords(userId, "goals-history");
}

async function loadActiveGoalsIncludingLegacy(userId: string) {
  const userGoals = goalsCollection(userId);
  const [activeSnapshot, legacyRecords] = await Promise.all([
    getDocs(query(userGoals, where("status", "==", "active"))),
    loadCachedLegacyActiveRecords(userId, "goals", async () => {
      const snapshot = await getDocs(userGoals);
      return snapshot.docs
        .map((goalDoc) => ({
          id: goalDoc.id,
          data: goalDoc.data() as Record<string, unknown>,
        }))
        .filter((record) => !isPersistedGoalStatus(record.data.status));
    }),
  ]);
  const activeGoalsById = new Map<string, Goal>();

  legacyRecords.forEach((record) => {
    activeGoalsById.set(record.id, normalizeGoal(record.id, record.data));
  });
  activeSnapshot.docs.forEach((goalDoc) => {
    activeGoalsById.set(
      goalDoc.id,
      normalizeGoal(goalDoc.id, goalDoc.data() as Record<string, unknown>)
    );
  });

  return Array.from(activeGoalsById.values());
}

export async function getDashboardGoalSummary(
  userId: string,
  now = Date.now()
): Promise<DashboardGoalSummary> {
  const [activeGoals, completedSnapshot] = await Promise.all([
    loadActiveGoalsIncludingLegacy(userId),
    getDocs(
      query(
        goalsCollection(userId),
        where("status", "==", "completed"),
        limit(1)
      )
    ),
  ]);

  return {
    activeGoals: activeGoals
      .filter(
        (goal) =>
          goal.status === "active" &&
          (goal.deadline <= 0 || goal.deadline > now)
      )
      .sort((left, right) => right.createdAt - left.createdAt),
    hasEarnedStars: !completedSnapshot.empty,
  };
}

export async function getActiveGoalsWithCurrentStatuses(
  userId: string,
  now = Date.now()
) {
  const goals = await loadActiveGoalsIncludingLegacy(userId);
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
    invalidateGoalCompatibility(userId);
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
  const legacyGoals = await loadCachedLegacyActiveRecords(
    userId,
    "goals-history",
    async () => {
      const snapshot = await getDocs(goalsCollection(userId));
      return snapshot.docs
        .map((goalDoc) => ({
          id: goalDoc.id,
          data: goalDoc.data() as Record<string, unknown>,
        }))
        .filter(
          (record) =>
            isHistoricalGoalStatus(record.data.status) &&
            typeof record.data.createdAt !== "number"
        );
    }
  );
  const normalizedLegacyGoals = legacyGoals
    .map((record) => normalizeGoal(record.id, record.data))
    .sort((left, right) => right.id.localeCompare(left.id));

  if (options.cursor?.phase === "legacy") {
    const startIndex = options.cursor.id
      ? normalizedLegacyGoals.findIndex((goal) => goal.id === options.cursor?.id) + 1
      : 0;
    const safeStartIndex = Math.max(0, startIndex);
    const items = normalizedLegacyGoals.slice(
      safeStartIndex,
      safeStartIndex + pageSize
    );
    const hasMore =
      safeStartIndex + items.length < normalizedLegacyGoals.length;
    return {
      items,
      nextCursor: hasMore
        ? ({ phase: "legacy", id: items[items.length - 1]?.id ?? null } as const)
        : null,
    };
  }

  const snapshot = await getDocs(
    query(
      goalsCollection(userId),
      where("status", "in", ["completed", "failed", "cancelled"]),
      orderBy("createdAt", "desc"),
      orderBy(documentId(), "desc"),
      ...(options.cursor?.phase === "modern"
        ? [startAfter(options.cursor.createdAt, options.cursor.id)]
        : []),
      limit(pageSize + 1)
    )
  );
  const pageDocs = snapshot.docs.slice(0, pageSize);

  const items = pageDocs.map((goalDoc) =>
      normalizeGoal(goalDoc.id, goalDoc.data() as Record<string, unknown>)
    );

  if (snapshot.docs.length > pageSize && pageDocs.length > 0) {
    return {
      items,
      nextCursor: {
        phase: "modern" as const,
        createdAt: pageDocs[pageDocs.length - 1].data().createdAt as number,
        id: pageDocs[pageDocs.length - 1].id,
      },
    };
  }

  const legacyCapacity = pageSize - items.length;
  const appendedLegacy = normalizedLegacyGoals.slice(0, legacyCapacity);
  const combinedItems = [...items, ...appendedLegacy];
  const hasMoreLegacy = appendedLegacy.length < normalizedLegacyGoals.length;

  return {
    items: combinedItems,
    nextCursor: hasMoreLegacy
      ? {
          phase: "legacy" as const,
          id: appendedLegacy[appendedLegacy.length - 1]?.id ?? null,
        }
      : null,
  };
}

export async function createGoal(
  userId: string,
  goal: Omit<Goal, "id">
): Promise<Goal> {
  const goalRef = await addDoc(goalsCollection(userId), goal);
  invalidateGoalCompatibility(userId);
  invalidateDashboardData(userId);
  return { id: goalRef.id, ...goal };
}

export async function updateGoal(
  userId: string,
  goalId: string,
  updates: Partial<Omit<Goal, "id">>
) {
  await updateDoc(doc(db, "users", userId, "goals", goalId), updates);
  invalidateGoalCompatibility(userId);
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
    loadActiveGoalsIncludingLegacy(userId),
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
    invalidateGoalCompatibility(userId);
    invalidateDashboardData(userId);
  } else if (activeGoals.length > 0) {
    // An active goal can gain card progress without completing.
    invalidateGoalCompatibility(userId);
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
