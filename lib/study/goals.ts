export type GoalStatus = "active" | "completed" | "failed";

export type GoalProgress = {
  cardsCompleted: number;
  correctAnswers: number;
  totalAnswers: number;
};

export type Goal = {
  id: string;
  targetCards: number;
  targetAccuracy: number;
  deadline: number;
  progress: GoalProgress;
  status: GoalStatus;
  createdAt: number;
};

export function getGoalAccuracy(progress: GoalProgress): number {
  if (progress.totalAnswers <= 0) {
    return 0;
  }

  return progress.correctAnswers / progress.totalAnswers;
}

export function normalizeGoal(
  id: string,
  data: Record<string, unknown>
): Goal {
  const progressData = data.progress as
    | {
        cardsCompleted?: number;
        correctAnswers?: number;
        totalAnswers?: number;
      }
    | undefined;

  return {
    id,
    targetCards: typeof data.targetCards === "number" ? data.targetCards : 0,
    targetAccuracy:
      typeof data.targetAccuracy === "number" ? data.targetAccuracy : 0,
    deadline: typeof data.deadline === "number" ? data.deadline : 0,
    progress: {
      cardsCompleted:
        typeof progressData?.cardsCompleted === "number"
          ? progressData.cardsCompleted
          : 0,
      correctAnswers:
        typeof progressData?.correctAnswers === "number"
          ? progressData.correctAnswers
          : 0,
      totalAnswers:
        typeof progressData?.totalAnswers === "number"
          ? progressData.totalAnswers
          : 0,
    },
    status:
      data.status === "completed" || data.status === "failed"
        ? data.status
        : "active",
    createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
  };
}

export function getGoalStatusAtTime(goal: Goal, now: number): GoalStatus {
  if (goal.status !== "active") {
    return goal.status;
  }

  if (now > goal.deadline) {
    return "failed";
  }

  return "active";
}

export function getUpdatedGoalAfterAnswer(
  goal: Goal,
  isCorrect: boolean,
  now: number
): Goal {
  if (goal.status !== "active") {
    return goal;
  }

  const currentStatus = getGoalStatusAtTime(goal, now);
  if (currentStatus === "failed") {
    return {
      ...goal,
      status: "failed",
    };
  }

  const progress = {
    cardsCompleted: goal.progress.cardsCompleted + 1,
    correctAnswers: goal.progress.correctAnswers + (isCorrect ? 1 : 0),
    totalAnswers: goal.progress.totalAnswers + 1,
  };

  const accuracy = getGoalAccuracy(progress);
  const status: GoalStatus =
    progress.cardsCompleted >= goal.targetCards && accuracy >= goal.targetAccuracy
      ? "completed"
      : "active";

  return {
    ...goal,
    progress,
    status,
  };
}
