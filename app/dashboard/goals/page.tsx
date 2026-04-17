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
import { formatTimeRemaining } from "@/lib/study/time";
import AppPage from "@/components/layout/AppPage";
import { Button, Card, EmptyState, FeedbackBanner, Input, ProgressBar, SectionHeader, Skeleton } from "@/components/ui";
import ConstellationStar from "@/components/constellation/ConstellationStar";
import Refreshable, { RefreshIconButton } from "@/components/layout/Refreshable";

type Feedback = { type: "success" | "error"; message: string };

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
  const { user } = useUser();

  const [goals, setGoals] = useState<Goal[]>([]);
  const [showGoalHistory, setShowGoalHistory] = useState(false);
  const [targetCards, setTargetCards] = useState("");
  const [targetAccuracy, setTargetAccuracy] = useState("");
  const [deadlineDate, setDeadlineDate] = useState("");
  const [deadlineTime, setDeadlineTime] = useState("");
  const [isLoadingGoals, setIsLoadingGoals] = useState(true);
  const [isCreatingGoal, setIsCreatingGoal] = useState(false);
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

  const handleCreateGoal = async () => {
    const nextTargetCards = parseTargetCardsInput(targetCards);
    const nextTargetAccuracy = parseTargetAccuracyInput(targetAccuracy);
    const parsedDeadline = Date.parse(`${deadlineDate}T${deadlineTime || "23:59"}`);

    if (
      nextTargetCards === null ||
      nextTargetAccuracy === null ||
      !deadlineDate ||
      !Number.isFinite(parsedDeadline) ||
      parsedDeadline <= Date.now()
    ) {
      setFeedback({ type: "error", message: "Enter a valid goal." });
      return;
    }

    setIsCreatingGoal(true);
    setFeedback(null);

    try {
      const createdAt = Date.now();
      const newGoal = {
        targetCards: nextTargetCards,
        targetAccuracy: nextTargetAccuracy,
        deadline: parsedDeadline,
        progress: { cardsCompleted: 0, correctAnswers: 0, totalAnswers: 0 },
        status: "active" as const,
        createdAt,
      };
      const goalRef = await addDoc(
        collection(db, "users", user.uid, "goals"),
        newGoal
      );

      setGoals((prev) => [{ id: goalRef.id, ...newGoal }, ...prev]);
      setTargetCards("");
      setTargetAccuracy("");
      setDeadlineDate("");
      setDeadlineTime("");
      setFeedback({ type: "success", message: "Goal created." });
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: "Failed to create goal." });
    } finally {
      setIsCreatingGoal(false);
    }
  };

  const activeGoals = goals.filter((goal) => goal.status === "active");
  const historicalGoals = goals.filter((goal) => goal.status !== "active");

  return (
    <Refreshable onRefresh={handleRefresh}>
      <AppPage
        title="Goals"
        backHref="/dashboard"
        backLabel="Dashboard"
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

        <Card tone="warm" padding="lg">
          <SectionHeader
            eyebrow="New goal"
            title="Set a clear target."
            description="Choose a card count, accuracy, date, and time. Completing goals earns stars for your constellation."
          />
          <div className="mt-5 grid gap-3 sm:gap-4 md:grid-cols-2">
            <Input
              type="number"
              min="1"
              placeholder="Target cards"
              value={targetCards}
              onChange={(event) => setTargetCards(event.target.value)}
              label="Target cards"
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
            />
            <div className="md:col-span-2">
              <div className="rounded-[1.6rem] border border-white/[0.10] bg-white/[0.04] p-4">
                <div className="mb-4">
                  <div className="text-sm font-semibold text-white">Deadline</div>
                  <p className="mt-1 text-xs leading-5 text-text-muted">
                    Choose the date and time you want this goal finished by.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:gap-7">
                  <Input
                    type="date"
                    value={deadlineDate}
                    onChange={(event) => setDeadlineDate(event.target.value)}
                    label="Finish by date"
                  />
                  <Input
                    type="time"
                    value={deadlineTime}
                    onChange={(event) => setDeadlineTime(event.target.value)}
                    label="Finish by time"
                  />
                </div>
              </div>
            </div>
            <div className="md:col-span-2">
              <Button
                disabled={isCreatingGoal}
                onClick={() => void handleCreateGoal()}
                variant="warm"
                size="lg"
                className="w-full md:w-auto"
              >
                {isCreatingGoal ? "Creating..." : "Create goal"}
              </Button>
            </div>
          </div>
        </Card>

        <Card tone="warm" padding="lg">
          <SectionHeader
            eyebrow="Reward preview"
            title="See the star before you commit."
            description="The preview updates from your goal details above."
          />

          <div className="mt-5 grid gap-3 sm:gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="space-y-2 text-sm text-text-secondary">
              <div>
                {previewTargetCards}-card goal at{" "}
                {Math.round(previewTargetAccuracy * 100)}% accuracy
              </div>
              <div className="grid gap-2 text-xs text-text-muted sm:grid-cols-2">
                <div>Star size: {getEffectiveStarVisualSize(previewStar).toFixed(1)}px</div>
                <div>Glow: {Math.round(previewStar.glow * 100)}%</div>
              </div>
            </div>

            <div className="relative h-44 overflow-hidden rounded-xl border border-border bg-surface-base sm:h-56">
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(9,7,20,0.12),rgba(9,7,20,0.34))]" />
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
                emoji="🎯"
                eyebrow="No active goals"
                title="No active goals"
                description="Goals give your study sessions a target and turn completed effort into constellation stars."
                helperText="Set a card target, accuracy target, date, and time above to create your first one."
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

                  return (
                    <div
                      key={goal.id}
                      className="app-panel-warm p-4 text-sm transition duration-fast ease-spring hover:-translate-y-0.5 hover:shadow-shell"
                    >
                      <div className="font-semibold">
                        {goal.progress.cardsCompleted} / {goal.targetCards} cards
                      </div>
                      <div className="text-text-muted">
                        {formatGoalAccuracyText(goal)}
                      </div>
                      <div className="text-xs text-text-muted">
                        {formatTimeRemaining(goal.deadline)}
                      </div>
                      <ProgressBar progress={progressPct} size="sm" variant="warm" className="mt-2" />
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
                          className={`rounded-lg px-2 py-1 text-xs ${
                            goal.status === "completed"
                              ? "bg-success-muted text-emerald-100"
                              : "bg-error-muted text-rose-100"
                          }`}
                        >
                          {goal.status === "completed" ? "Completed" : "Expired"}
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
