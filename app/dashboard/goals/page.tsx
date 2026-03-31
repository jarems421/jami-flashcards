"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  updateDoc,
} from "firebase/firestore";
import { useUser } from "@/lib/user-context";
import { db } from "@/services/firebase";
import {
  getActiveConstellation,
  buildConstellationProgressMap,
  type Constellation,
  type ConstellationProgress,
} from "@/lib/constellations";
import { ensureConstellationSetup } from "@/services/constellations";
import { normalizeDust } from "@/lib/dust";
import {
  getGoalStatusAtTime,
  getGoalAccuracy,
  normalizeGoal,
  type Goal,
} from "@/lib/goals";
import {
  buildPreviewStar,
  parseStarData,
  resolveStarPresetId,
  spreadBackfilledStars,
} from "@/lib/stars";
import { formatTimeRemaining } from "@/lib/time";
import ConstellationDust from "@/components/ConstellationDust";
import ConstellationStar from "@/components/constellation-star";
import Refreshable, { RefreshIconButton } from "@/components/Refreshable";

type Feedback = { type: "success" | "error"; message: string };

function parseTargetCardsInput(value: string) {
  if (!value.trim()) return null;
  const v = Number(value);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function parseTargetAccuracyInput(value: string) {
  if (!value.trim()) return null;
  const v = Number(value);
  if (!Number.isFinite(v)) return null;
  const n = v > 1 ? v / 100 : v;
  return n >= 0 && n <= 1 ? n : null;
}

export default function GoalsPage() {
  const { user, refreshKey } = useUser();

  const [goals, setGoals] = useState<Goal[]>([]);
  const [showGoalHistory, setShowGoalHistory] = useState(false);
  const [targetCards, setTargetCards] = useState("");
  const [targetAccuracy, setTargetAccuracy] = useState("");
  const [deadlineDate, setDeadlineDate] = useState("");
  const [deadlineTime, setDeadlineTime] = useState("");
  const [previewDustCount, setPreviewDustCount] = useState<number | null>(null);
  const [isLoadingGoals, setIsLoadingGoals] = useState(true);
  const [isCreatingGoal, setIsCreatingGoal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  // Constellation data for reward preview
  const [activeConstellation, setActiveConstellation] = useState<Constellation | null>(null);
  const [activeConstellationProgress, setActiveConstellationProgress] = useState<ConstellationProgress | null>(null);

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

      if (updates.length > 0) await Promise.all(updates);
      nextGoals.sort((a, b) => b.createdAt - a.createdAt);
      setGoals(nextGoals);
    } catch (e) {
      console.error(e);
      setGoals([]);
    } finally {
      setIsLoadingGoals(false);
    }
  }, []);

  const loadConstellationSummary = useCallback(async (uid: string) => {
    try {
      const constellations = await ensureConstellationSetup(uid);
      const active = getActiveConstellation(constellations);
      setActiveConstellation(active);

      if (active) {
        const [starsSnap, dustSnap] = await Promise.all([
          getDocs(collection(db, "users", uid, "stars")),
          getDocs(collection(db, "users", uid, "dust")),
        ]);
        const stars = spreadBackfilledStars(
          starsSnap.docs.map((d) =>
            parseStarData(d.id, d.data() as Record<string, unknown>)
          )
        );
        const dust = dustSnap.docs.map((d) =>
          normalizeDust(d.id, d.data() as Record<string, unknown>)
        );
        const progressMap = buildConstellationProgressMap(
          constellations.map((c) => c.id),
          stars,
          dust
        );
        setActiveConstellationProgress(
          progressMap[active.id] ?? { starCount: 0, dustCount: 0 }
        );
      } else {
        setActiveConstellationProgress(null);
      }
    } catch (e) {
      console.error(e);
      setActiveConstellation(null);
      setActiveConstellationProgress(null);
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
  }, [user.uid, loadAll, refreshKey]);

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

  // ── Derived preview state ──
  const completedGoalsCount = goals.filter((g) => g.status === "completed").length;
  const parsedGoalTargetCards = parseTargetCardsInput(targetCards);
  const parsedGoalTargetAccuracy = parseTargetAccuracyInput(targetAccuracy);
  const previewTargetCards = parsedGoalTargetCards ?? 10;
  const previewTargetAccuracy = parsedGoalTargetAccuracy ?? 1;
  const previewMaxDust = activeConstellation?.maxDust ?? 400;
  const previewDustValue = Math.max(
    0,
    Math.min(
      previewMaxDust,
      previewDustCount ?? activeConstellationProgress?.dustCount ?? 0
    )
  );
  const previewConstellationId = activeConstellation?.id ?? "preview-constellation";
  const previewPresetId = resolveStarPresetId({
    id: "preview-goal",
    targetCards: previewTargetCards,
    targetAccuracy: previewTargetAccuracy,
    deadline: 0,
    progress: { cardsCompleted: 0, correctAnswers: 0, totalAnswers: 0 },
    status: "active",
    createdAt: 0,
  });
  const previewStar = buildPreviewStar({
    targetCards: previewTargetCards,
    targetAccuracy: previewTargetAccuracy,
    completedGoalsCount: completedGoalsCount + 1,
    constellationId: previewConstellationId,
    position: { x: 50, y: 52 },
    presetId: previewPresetId,
  });
  const previewNebulaStatus = previewDustValue >= previewMaxDust ? "finished" : "active";

  const formatGoalAccuracyText = (goal: Goal) => {
    if (goal.progress.totalAnswers === 0) {
      return `Current accuracy: -- | Target: ${Math.round(goal.targetAccuracy * 100)}%`;
    }
    return `Current accuracy: ${Math.round(getGoalAccuracy(goal.progress) * 100)}% | Target: ${Math.round(goal.targetAccuracy * 100)}%`;
  };

  const handleCreateGoal = async () => {
    const parsedTargetCards2 = parseTargetCardsInput(targetCards);
    const parsedTargetAccuracy2 = parseTargetAccuracyInput(targetAccuracy);
    const parsedDeadline = Date.parse(`${deadlineDate}T${deadlineTime || "23:59"}`);

    if (
      parsedTargetCards2 === null ||
      parsedTargetAccuracy2 === null ||
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
        targetCards: parsedTargetCards2,
        targetAccuracy: parsedTargetAccuracy2,
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
    } catch (e) {
      console.error(e);
      setFeedback({ type: "error", message: "Failed to create goal." });
    } finally {
      setIsCreatingGoal(false);
    }
  };

  return (
    <Refreshable onRefresh={handleRefresh}>
      <main
        data-app-surface="true"
        className="min-h-screen px-3 py-2 text-white sm:px-4 sm:py-3 md:px-6 md:py-4"
      >
        <div className="mx-auto max-w-3xl">
        {/* ── Header ── */}
        <div className="mb-3 flex items-center justify-between sm:mb-4">
          <h1 className="text-xl font-bold">Goals</h1>
          <RefreshIconButton refreshing={refreshing} onClick={() => void handleRefresh()} />
        </div>

        {/* ── Feedback ── */}
        {feedback ? (
          <div
            className={`mb-3 flex items-center justify-between gap-4 rounded-xl p-2.5 text-sm sm:mb-4 sm:p-3 ${
              feedback.type === "error"
                ? "bg-error-muted text-red-200"
                : "bg-success-muted text-emerald-200"
            }`}
          >
            <div>{feedback.message}</div>
            <button
              onClick={() => setFeedback(null)}
              className="rounded-md bg-glass-medium px-3 py-1 text-xs hover:bg-glass-strong active:scale-[0.97]"
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {/* ── Goal creation form ── */}
        <div
          className="mb-4 rounded-xl border border-warm-border p-3 sm:p-4"
          style={{ backgroundImage: "var(--gradient-card)" }}
        >
          <h3 className="mb-3 text-sm font-semibold">New goal</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap">
            <input
              type="number"
              min="1"
              placeholder="Target cards"
              value={targetCards}
              onChange={(e) => setTargetCards(e.target.value)}
              className="w-full rounded-md border border-border bg-glass-medium px-3 py-2 text-sm text-white placeholder:text-text-muted outline-none focus:border-accent focus:ring-2 focus:ring-warm-accent/20 sm:w-auto"
            />
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              placeholder="Accuracy %"
              value={targetAccuracy}
              onChange={(e) => setTargetAccuracy(e.target.value)}
              className="w-full rounded-md border border-border bg-glass-medium px-3 py-2 text-sm text-white placeholder:text-text-muted outline-none focus:border-accent focus:ring-2 focus:ring-warm-accent/20 sm:w-auto"
            />
            <input
              type="date"
              value={deadlineDate}
              onChange={(e) => setDeadlineDate(e.target.value)}
              className="w-full rounded-md border border-border bg-glass-medium px-3 py-2 text-sm text-white outline-none focus:border-accent focus:ring-2 focus:ring-warm-accent/20 sm:w-auto"
            />
            <input
              type="time"
              value={deadlineTime}
              onChange={(e) => setDeadlineTime(e.target.value)}
              className="w-full rounded-md border border-border bg-glass-medium px-3 py-2 text-sm text-white outline-none focus:border-accent focus:ring-2 focus:ring-warm-accent/20 sm:w-auto"
            />
            <button
              disabled={isCreatingGoal}
              onClick={() => void handleCreateGoal()}
              className="rounded-md bg-warm-accent px-4 py-2 text-sm font-semibold text-surface-base transition duration-fast hover:brightness-110 active:scale-[0.97] disabled:opacity-50"
            >
              {isCreatingGoal ? "Creating…" : "Create goal"}
            </button>
          </div>
        </div>

        {/* ── Reward preview ── */}
        <div
          className="mb-4 rounded-xl border border-warm-border p-3 sm:p-4"
          style={{ backgroundImage: "var(--gradient-card)" }}
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-medium">Reward preview</h3>
            <p className="text-xs text-text-muted">
              Based on goal inputs. Defaults: 10 cards, 100% accuracy.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="space-y-2 text-sm text-text-secondary">
              <div>
                {previewTargetCards}-card goal at{" "}
                {Math.round(previewTargetAccuracy * 100)}% accuracy
              </div>
              <div>
                Star color: {previewStar.color} · Style:{" "}
                {previewStar.presetId?.replace(/-/g, " ") ?? "classic"}
              </div>
              <div>
                Nebula dust: {previewDustValue} / {previewMaxDust}
              </div>
              <input
                type="range"
                min="0"
                max={previewMaxDust}
                value={previewDustValue}
                onChange={(e) => setPreviewDustCount(Number(e.target.value))}
                className="w-full accent-accent"
              />
              <div className="grid gap-2 text-xs text-text-muted sm:grid-cols-3">
                <div>Glow: {Math.round(previewStar.glow * 100)}%</div>
                <div>State: {previewNebulaStatus}</div>
                <div>Larger goals produce more dramatic stars.</div>
              </div>
            </div>

            <div className="relative h-56 overflow-hidden rounded-lg border border-border bg-surface-base">
              <ConstellationDust
                particles={[]}
                particleCount={previewDustValue}
                constellationId={previewConstellationId}
                status={previewNebulaStatus}
                maxDust={previewMaxDust}
                mode="page"
                className="z-0"
              />
              <div className="absolute inset-0 z-10">
                <ConstellationStar star={previewStar} />
              </div>
            </div>
          </div>
        </div>

        {/* ── Active goals ── */}
        {isLoadingGoals ? (
          <p className="text-sm text-text-muted">Loading goals…</p>
        ) : (
          <>
            {goals.filter((g) => g.status === "active").length === 0 ? (
              <div
                className="mb-3 rounded-xl border border-warm-border bg-warm-glow p-4 text-center"
                style={{ backgroundImage: "var(--gradient-card)" }}
              >
                <p className="text-sm text-text-secondary">
                  No active goals — create one to start earning stars.
                </p>
              </div>
            ) : (
              <div className="mb-4 grid gap-2.5 sm:gap-3">
                {goals
                  .filter((g) => g.status === "active")
                  .map((goal) => {
                    const progressPct = goal.targetCards > 0
                      ? Math.min(100, Math.round((goal.progress.cardsCompleted / goal.targetCards) * 100))
                      : 0;
                    return (
                      <div
                        key={goal.id}
                        className="rounded-xl border border-warm-border p-2.5 text-sm sm:p-3"
                        style={{ backgroundImage: "var(--gradient-card)" }}
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
                        <div className="mt-2 h-1.5 rounded-full bg-glass-medium">
                          <div
                            className="h-1.5 rounded-full bg-gradient-to-r from-warm-accent to-success transition-all duration-slow"
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}

            {/* Goal history */}
            <button
              type="button"
              onClick={() => setShowGoalHistory((v) => !v)}
              className="mb-3 rounded-md bg-glass-medium px-3 py-1.5 text-sm transition duration-fast hover:bg-glass-strong active:scale-[0.97]"
            >
              {showGoalHistory ? "Hide goal history" : "Show goal history"}
            </button>

            {showGoalHistory ? (
              goals.filter((g) => g.status !== "active").length === 0 ? (
                <p className="text-sm text-text-muted">No past goals yet.</p>
              ) : (
                <div className="grid gap-2.5 sm:gap-3">
                  {goals
                    .filter((g) => g.status !== "active")
                    .map((goal) => (
                      <div
                        key={goal.id}
                        className="rounded-xl border border-white/[0.07] p-2.5 text-sm sm:p-3"
                        style={{ backgroundImage: "var(--gradient-card)" }}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold">
                            {goal.progress.cardsCompleted} / {goal.targetCards} cards
                          </span>
                          <span
                            className={`rounded-md px-2 py-0.5 text-xs ${
                              goal.status === "completed"
                                ? "bg-success-muted text-emerald-200"
                                : "bg-error-muted text-red-200"
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
        </div>
      </main>
    </Refreshable>
  );
}
