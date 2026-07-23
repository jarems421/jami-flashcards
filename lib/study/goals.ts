export type GoalStatus = "active" | "completed" | "failed" | "cancelled";
export type GoalScopeType = "all" | "deck" | "topic" | "folder";

export type GoalScope = {
  type: GoalScopeType;
  id?: string;
  label?: string;
};

export type GoalAnswerContext = {
  deckId?: string;
  topicIds?: string[];
  folderIds?: string[];
};

export type GoalProgress = {
  cardsCompleted: number;
  correctAnswers: number;
  totalAnswers: number;
};

export type Goal = {
  id: string;
  name: string;
  scope: GoalScope;
  targetCards: number;
  targetAccuracy: number;
  deadline: number;
  progress: GoalProgress;
  status: GoalStatus;
  createdAt: number;
};

function normalizeGoalScope(value: unknown): GoalScope {
  if (!value || typeof value !== "object") return { type: "all" };
  const data = value as Record<string, unknown>;
  const type: GoalScopeType =
    data.type === "deck" || data.type === "topic" || data.type === "folder"
      ? data.type
      : "all";
  const id = typeof data.id === "string" ? data.id.trim().slice(0, 160) : "";
  const label = typeof data.label === "string" ? data.label.trim().slice(0, 120) : "";
  if (type === "all" || !id) return { type: "all" };
  return {
    type,
    id,
    ...(label ? { label } : {}),
  };
}

export function getGoalDisplayName(goal: Pick<Goal, "name" | "targetCards">) {
  return goal.name.trim() || `Review ${goal.targetCards} cards`;
}

export function doesGoalMatchAnswer(goal: Goal, context: GoalAnswerContext = {}) {
  if (goal.scope.type === "all") return true;
  if (!goal.scope.id) return false;
  if (goal.scope.type === "deck") return context.deckId === goal.scope.id;
  if (goal.scope.type === "topic") return context.topicIds?.includes(goal.scope.id) === true;
  return context.folderIds?.includes(goal.scope.id) === true;
}

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
    name:
      typeof data.name === "string" && data.name.trim()
        ? data.name.trim().slice(0, 120)
        : `Review ${typeof data.targetCards === "number" ? data.targetCards : 0} cards`,
    scope: normalizeGoalScope(data.scope),
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
      data.status === "completed" ||
      data.status === "failed" ||
      data.status === "cancelled"
        ? data.status
        : "active",
    createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
  };
}

export function getGoalStatusAtTime(goal: Goal, now: number): GoalStatus {
  if (goal.status !== "active") {
    return goal.status;
  }

  if (goal.deadline > 0 && now > goal.deadline) {
    return "failed";
  }

  return "active";
}

export function getUpdatedGoalAfterAnswer(
  goal: Goal,
  isCorrect: boolean,
  now: number,
  context: GoalAnswerContext = {}
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

  if (!doesGoalMatchAnswer(goal, context)) {
    return goal;
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
