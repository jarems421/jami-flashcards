"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  updateDoc,
} from "firebase/firestore";
import { useUser } from "@/lib/auth/user-context";
import { db } from "@/services/firebase/client";
import {
  getActiveConstellation,
  type Constellation,
} from "@/lib/constellation/constellations";
import { ensureConstellationSetup } from "@/services/constellation/constellations";
import {
  getGoalStatusAtTime,
  getGoalAccuracy,
  normalizeGoal,
  type Goal,
} from "@/lib/study/goals";
import {
  buildPreviewStar,
  getEffectiveStarVisualSize,
} from "@/lib/constellation/stars";
import { getDeadlineDisplay } from "@/lib/study/time";
import AppPage from "@/components/layout/AppPage";
import { Button, Card, EmptyState, FeedbackBanner, Input, ProgressBar, SectionHeader, Skeleton } from "@/components/ui";
import ConstellationStar from "@/components/constellation/ConstellationStar";
import Refreshable, { RefreshIconButton } from "@/components/layout/Refreshable";

type Feedback = { type: "success" | "error"; message: string };
type GoalPreset = "today-10" | "week-20";

function getDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getGoalDeadlineClass(tone: "neutral" | "urgent" | "overdue") {
  if (tone === "overdue") return "app-danger";
  if (tone === "urgent") return "app-warning";
  return "app-chip";
}

function parseTargetCardsInput(value: string) {
  if (!value.trim()) return null;
  const nextValue = Number(value);
  return Number.isFinite(nextValue) && nextValue > 0 ? nextValue : null;
}

function parseTargetAccuracyInput(value: string) {
  if (!value.trim()) return null;
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) return null;
  const normalizedValue = nextValue > 1 ? nextValue / 100 : nextValue;
  return normalizedValue >= 0 && normalizedValue <= 1 ? normalizedValue : null;
}

export default function GoalsPage() {
  const { user, isDemoUser } = useUser();

  const [goals, setGoals] = useState<Goal[]>([]);
  const [showGoalHistory, setShowGoalHistory] = useState(false);
  const [targetCards, setTargetCards] = useState("");
  const [targetAccuracy, setTargetAccuracy] = useState("");
  const [deadlineDate, setDeadlineDate] = useState("");
  const [deadlineTime, setDeadlineTime] = useState("");
  const [isLoadingGoals, setIsLoadingGoals] = useState(true);
  const [isCreatingGoal, setIsCreatingGoal] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [cancellingGoalId, setCancellingGoalId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [activeConstellation, setActiveConstellation] =
    useState<Constellation | null>(null);

  const lastForegroundRefreshAtRef = useRef(0);

  const loadGoals = useCallback(async (uid: string) => {
    setIsLoadingGoals(true);
    try {
      const now = Date.now();
      const snapshot = await getDocs(collection(db, "users", uid, "goals"));
      const updates: Promise<void>[] = [];

      const nextGoals: Goal[] = snapshot.docs.map((goalDoc) => {
        const goal = normalizeGoal(
          goalDoc.id,
          goalDoc.data() as Record<string, unknown>
        );
        const statusAtTime = getGoalStatusAtTime(goal, now);

        if (statusAtTime !== goal.status) {
          updates.push(
            updateDoc(doc(db, "users", uid, "goals", goal.id), {
              status: statusAtTime,
            })
          );
          return { ...goal, status: statusAtTime };
        }

        return goal;
      });

      if (updates.length > 0) {
        await Promise.all(updates);
      }

      nextGoals.sort((left, right) => right.createdAt - left.createdAt);
      setGoals(nextGoals);
    } catch (error) {
      console.error(error);
      setGoals([]);
    } finally {
      setIsLoadingGoals(false);
    }
  }, []);

  const loadConstellationSummary = useCallback(async (uid: string) => {
    try {
      const constellations = await ensureConstellationSetup(uid);
      setActiveConstellation(getActiveConstellation(constellations));
    } catch (error) {
      console.error(error);
      setActiveConstellation(null);
    }
  }, []);

  const loadAll = useCallback(
    async (uid: string) => {
      await Promise.all([loadGoals(uid), loadConstellationSummary(uid)]);
    },
    [loadGoals, loadConstellationSummary]
  );

  useEffect(() => {
    void loadAll(user.uid);
  }, [user.uid, loadAll]);

  useEffect(() => {
    const handleFocus = () => {
      const now = Date.now();
      if (
        document.visibilityState !== "hidden" &&
        now - lastForegroundRefreshAtRef.current > 15_000
      ) {
        lastForegroundRefreshAtRef.current = now;
        void loadAll(user.uid);
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
    };
  }, [user.uid, loadAll]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setFeedback(null);
    try {
      await loadAll(user.uid);
    } finally {
      setRefreshing(false);
    }
  }, [user.uid, loadAll]);

  const completedGoalsCount = goals.filter(
    (goal) => goal.status === "completed"
  ).length;
  const parsedGoalTargetCards = parseTargetCardsInput(targetCards);
  const parsedGoalTargetAccuracy = parseTargetAccuracyInput(targetAccuracy);
  const previewTargetCards = parsedGoalTargetCards ?? 10;
  const previewTargetAccuracy = parsedGoalTargetAccuracy ?? 1;
  const previewConstellationId =
    activeConstellation?.id ?? "preview-constellation";
  const previewStar = buildPreviewStar({
    targetCards: previewTargetCards,
    targetAccuracy: previewTargetAccuracy,
    completedGoalsCount: completedGoalsCount + 1,
    constellationId: previewConstellationId,
    position: { x: 50, y: 52 },
  });

  const formatGoalAccuracyText = (goal: Goal) => {
    if (goal.progress.totalAnswers === 0) {
      return `Current accuracy: -- | Target: ${Math.round(goal.targetAccuracy * 100)}%`;
    }

    return `Current accuracy: ${Math.round(
      getGoalAccuracy(goal.progress) * 100
    )}% | Target: ${Math.round(goal.targetAccuracy * 100)}%`;
  };

  const deadlineTimestamp = deadlineDate
    ? Date.parse(`${deadlineDate}T${deadlineTime || "23:59"}`)
    : 0;
  const deadlineIsValid =
    !deadlineDate ||
    (Number.isFinite(deadlineTimestamp) && deadlineTimestamp > Date.now());
  const canSaveGoal =
    parsedGoalTargetCards !== null &&
    parsedGoalTargetAccuracy !== null &&
    deadlineIsValid &&
    !isDemoUser &&
    !isCreatingGoal;
  const disabledReason = isDemoUser
    ? "Goal editing is disabled in the shared demo."
    : parsedGoalTargetCards === null
      ? "Enter a target of at least one card."
      : parsedGoalTargetAccuracy === null
        ? "Enter an accuracy target from 0 to 100%."
        : !deadlineIsValid
          ? "Choose a future deadline, or leave it blank."
          : null;

  const resetGoalForm = () => {
    setTargetCards("");
    setTargetAccuracy("");
    setDeadlineDate("");
    setDeadlineTime("");
    setEditingGoalId(null);
  };

  const applyPreset = (preset: GoalPreset) => {
    const deadline = new Date();

    if (preset === "today-10") {
      setTargetCards("10");
      setTargetAccuracy("80");
      setDeadlineDate(getDateInputValue(deadline));
      setDeadlineTime("23:59");
    } else if (preset === "week-20") {
      deadline.setDate(deadline.getDate() + 7);
      setTargetCards("20");
      setTargetAccuracy("80");
      setDeadlineDate(getDateInputValue(deadline));
      setDeadlineTime("23:59");
    }

    setEditingGoalId(null);
    setFeedback(null);
  };

  const startEditingGoal = (goal: Goal) => {
    setEditingGoalId(goal.id);
    setTargetCards(String(goal.targetCards));
    setTargetAccuracy(String(Math.round(goal.targetAccuracy * 100)));
    if (goal.deadline > 0) {
      const deadline = new Date(goal.deadline);
      setDeadlineDate(getDateInputValue(deadline));
      setDeadlineTime(
        `${String(deadline.getHours()).padStart(2, "0")}:${String(
          deadline.getMinutes()
        ).padStart(2, "0")}`
      );
    } else {
      setDeadlineDate("");
      setDeadlineTime("");
    }
    setFeedback(null);
    window.requestAnimationFrame(() => {
      document.getElementById("new-goal")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  const handleSaveGoal = async () => {
    if (isDemoUser) {
      setFeedback({ type: "error", message: "Goal creation is disabled in the shared demo account." });
      return;
    }

    const nextTargetCards = parseTargetCardsInput(targetCards);
    const nextTargetAccuracy = parseTargetAccuracyInput(targetAccuracy);
    const parsedDeadline = deadlineDate
      ? Date.parse(`${deadlineDate}T${deadlineTime || "23:59"}`)
      : 0;

    if (
      nextTargetCards === null ||
      nextTargetAccuracy === null ||
      (deadlineDate &&
        (!Number.isFinite(parsedDeadline) || parsedDeadline <= Date.now()))
    ) {
      setFeedback({
        type: "error",
        message: "Enter valid targets and choose a future deadline, or leave it blank.",
      });
      return;
    }

    setIsCreatingGoal(true);
    setFeedback(null);

    try {
      const goalUpdates = {
        targetCards: nextTargetCards,
        targetAccuracy: nextTargetAccuracy,
        deadline: parsedDeadline,
      };

      if (editingGoalId) {
        await updateDoc(doc(db, "users", user.uid, "goals", editingGoalId), goalUpdates);
        setGoals((prev) =>
          prev.map((goal) =>
            goal.id === editingGoalId ? { ...goal, ...goalUpdates } : goal
          )
        );
        setFeedback({ type: "success", message: "Goal saved." });
      } else {
        const createdAt = Date.now();
        const newGoal = {
          ...goalUpdates,
        progress: { cardsCompleted: 0, correctAnswers: 0, totalAnswers: 0 },
        status: "active" as const,
        createdAt,
        };
        const goalRef = await addDoc(
          collection(db, "users", user.uid, "goals"),
          newGoal
        );

        setGoals((prev) => [{ id: goalRef.id, ...newGoal }, ...prev]);
        setFeedback({ type: "success", message: "Goal created." });
      }

      resetGoalForm();
    } catch (error) {
      console.error(error);
      setFeedback({
        type: "error",
        message: editingGoalId ? "Failed to save goal." : "Failed to create goal.",
      });
    } finally {
      setIsCreatingGoal(false);
    }
  };

  const handleCancelGoal = async (goal: Goal) => {
    if (
      isDemoUser ||
      !window.confirm(
        `Cancel this ${goal.targetCards}-card goal? Its progress will stay in goal history.`
      )
    ) {
      return;
    }

    setCancellingGoalId(goal.id);
    setFeedback(null);
    try {
      await updateDoc(doc(db, "users", user.uid, "goals", goal.id), {
        status: "cancelled",
      });
      setGoals((prev) =>
        prev.map((item) =>
          item.id === goal.id ? { ...item, status: "cancelled" } : item
        )
      );
      if (editingGoalId === goal.id) resetGoalForm();
      setFeedback({ type: "success", message: "Goal moved to history." });
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: "Failed to cancel goal." });
    } finally {
      setCancellingGoalId(null);
    }
  };

  const activeGoals = goals.filter((goal) => goal.status === "active");
  const historicalGoals = goals.filter((goal) => goal.status !== "active");

  return (
    <Refreshable onRefresh={handleRefresh}>
      <AppPage
        title="Goals"
        backHref="/dashboard"
        backLabel="Today"
        width="2xl"
        action={
          <RefreshIconButton
            refreshing={refreshing}
            onClick={() => void handleRefresh()}
          />
        }
        contentClassName="space-y-4 sm:space-y-6"
      >
        {feedback ? (
          <FeedbackBanner type={feedback.type} message={feedback.message} onDismiss={() => setFeedback(null)} />
        ) : null}

        <Card id="new-goal" tone="warm" padding="lg">
          <SectionHeader
            eyebrow={editingGoalId ? "Edit goal" : "New goal"}
            title={editingGoalId ? "Adjust this target." : "Set a clear target."}
            action={
              editingGoalId ? (
                <Button type="button" variant="ghost" onClick={resetGoalForm}>
                  Cancel edit
                </Button>
              ) : null
            }
          />
          {isDemoUser ? (
            <p className="mt-3 text-sm leading-6 text-text-secondary">
              Goal creation is locked in the shared demo.
            </p>
          ) : null}
          <div className="mt-5">
            <div className="mb-4 flex flex-wrap gap-2" aria-label="Goal presets">
              <Button type="button" size="sm" variant="secondary" onClick={() => applyPreset("today-10")}>
                Review 10 today
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => applyPreset("week-20")}>
                Review 20 this week
              </Button>
            </div>
          </div>
          <div className="grid gap-3 sm:gap-4 md:grid-cols-2">
            <Input
              type="number"
              min="1"
              placeholder="Target cards"
              value={targetCards}
              onChange={(event) => setTargetCards(event.target.value)}
              label="Target cards"
              className="min-h-11 min-w-0 !rounded-[1.15rem] !px-4 !py-2.5"
            />
            <Input
              type="number"
              min="0"
              max="100"
              step="1"
              placeholder="Accuracy %"
              value={targetAccuracy}
              onChange={(event) => setTargetAccuracy(event.target.value)}
              label="Accuracy %"
              className="min-h-11 min-w-0 !rounded-[1.15rem] !px-4 !py-2.5"
            />
            <div className="md:col-span-2">
              <div className="app-subtle-panel rounded-[1.3rem] p-3.5">
                <div className="mb-3">
                  <div className="text-sm font-medium text-text-primary">Deadline</div>
                  <p className="mt-1 text-xs leading-5 text-text-muted">
                    Optional. Leave both fields blank for an open-ended goal.
                  </p>
                </div>
                <div className="grid min-w-0 gap-3 xl:grid-cols-2">
                  <Input
                    type="date"
                    value={deadlineDate}
                    onChange={(event) => {
                      setDeadlineDate(event.target.value);
                      if (!event.target.value) setDeadlineTime("");
                    }}
                    label="Finish by date"
                    containerClassName="min-w-0 overflow-hidden"
                    className="min-h-11 min-w-0 max-w-full !rounded-[1.15rem] !px-4 !py-2.5"
                  />
                  <Input
                    type="time"
                    value={deadlineTime}
                    onChange={(event) => setDeadlineTime(event.target.value)}
                    label="Finish by time"
                    containerClassName="min-w-0 overflow-hidden"
                    className="min-h-11 min-w-0 max-w-full !rounded-[1.15rem] !px-4 !py-2.5"
                  />
                </div>
              </div>
            </div>
            <div className="md:col-span-2">
              <Button
                disabled={!canSaveGoal}
                onClick={() => void handleSaveGoal()}
                variant="warm"
                size="lg"
                className="w-full md:w-auto"
              >
                {isCreatingGoal
                  ? editingGoalId
                    ? "Saving..."
                    : "Creating..."
                  : editingGoalId
                    ? "Save goal"
                    : "Create goal"}
              </Button>
              {disabledReason ? (
                <p className="mt-2 text-xs leading-5 text-text-muted">{disabledReason}</p>
              ) : null}
            </div>
          </div>
        </Card>

        <Card tone="warm" padding="lg">
          <SectionHeader
            eyebrow="Reward preview"
            title="See the star before you commit."
          />

          <div className="mt-5 grid gap-3 sm:gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="space-y-2 text-sm text-text-secondary">
              <div>
                {previewTargetCards}-card goal at{" "}
                {Math.round(previewTargetAccuracy * 100)}% accuracy
              </div>
              <div className="grid gap-2 text-xs text-text-muted sm:grid-cols-2">
                <div>Reward scale: {getEffectiveStarVisualSize(previewStar) >= 18 ? "large" : "subtle"}</div>
                <div>Star glow: {previewStar.glow >= 0.8 ? "bright" : "soft"}</div>
              </div>
            </div>

              <div className="relative h-44 overflow-hidden rounded-xl border border-[rgba(238,225,255,0.18)] bg-[linear-gradient(180deg,#080416_0%,#060311_58%,#030108_100%)] shadow-[inset_0_0_34px_rgba(143,125,232,0.14)] sm:h-56">
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(143,125,232,0.16),rgba(6,3,17,0.66))]" />
              <div className="absolute inset-0 z-10">
                <ConstellationStar star={previewStar} variant="preview" />
              </div>
            </div>
          </div>
        </Card>

        {isLoadingGoals ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        ) : (
          <>
            {activeGoals.length === 0 ? (
              <EmptyState
                emoji="Goal"
                eyebrow="No active goals"
                title="No active goals"
                description="Create a goal to earn stars."
                action={
                  <a
                    href="#new-goal"
                    className="app-button-primary inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl px-4 py-2 text-sm font-medium"
                  >
                    Create your first goal
                  </a>
                }
              />
            ) : (
              <div className="grid animate-slide-up gap-3 sm:gap-4 lg:grid-cols-2">
                {activeGoals.map((goal) => {
                  const progressPct =
                    goal.targetCards > 0
                      ? Math.min(
                          100,
                          Math.round(
                            (goal.progress.cardsCompleted / goal.targetCards) * 100
                          )
                        )
                      : 0;
                  const deadline = getDeadlineDisplay(goal.deadline);

                  return (
                    <div
                      key={goal.id}
                      className="app-panel-warm p-4 text-sm transition duration-fast ease-spring hover:-translate-y-0.5 hover:shadow-shell"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold">
                            {goal.progress.cardsCompleted} / {goal.targetCards} cards
                          </div>
                          <div className="mt-1 text-text-muted">
                            {formatGoalAccuracyText(goal)}
                          </div>
                        </div>
                        <span
                          className={`${getGoalDeadlineClass(deadline.tone)} max-w-full rounded-full px-3 py-1.5 text-xs font-semibold`}
                        >
                          {deadline.label}
                        </span>
                      </div>
                      <ProgressBar progress={progressPct} size="sm" variant="warm" className="mt-4" />
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={isDemoUser || cancellingGoalId === goal.id}
                          onClick={() => startEditingGoal(goal)}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="danger"
                          disabled={isDemoUser || cancellingGoalId === goal.id}
                          onClick={() => void handleCancelGoal(goal)}
                        >
                          {cancellingGoalId === goal.id ? "Cancelling..." : "Cancel goal"}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <Button
              type="button"
              onClick={() => setShowGoalHistory((value) => !value)}
              variant="secondary"
            >
              {showGoalHistory ? "Hide goal history" : "Show goal history"}
            </Button>

            {showGoalHistory ? (
              historicalGoals.length === 0 ? (
                <EmptyState
                  emoji="History"
                  eyebrow="Goal history"
                  title="No past goals yet"
                  description="Completed and expired goals will appear here once you have run a few targets."
                  variant="compact"
                />
              ) : (
                <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
                  {historicalGoals.map((goal) => (
                    <div
                      key={goal.id}
                      className="app-panel p-4 text-sm"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">
                          {goal.progress.cardsCompleted} / {goal.targetCards} cards
                        </span>
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${
                            goal.status === "completed"
                              ? "app-success"
                              : goal.status === "cancelled"
                                ? "app-chip"
                                : "app-danger"
                          }`}
                        >
                          {goal.status === "completed"
                            ? "Completed"
                            : goal.status === "cancelled"
                              ? "Cancelled"
                              : "Expired"}
                        </span>
                      </div>
                      <div className="text-text-muted">
                        {formatGoalAccuracyText(goal)}
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : null}
          </>
        )}
      </AppPage>
    </Refreshable>
  );
}
