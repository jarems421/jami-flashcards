"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useUser } from "@/components/providers/UserProvider";
import { useFeedback } from "@/hooks/useFeedback";
import { useDashboardData } from "@/hooks/useDashboardData";
import {
  getActiveConstellation,
  type Constellation,
} from "@/lib/constellation/constellations";
import { ensureConstellationSetup } from "@/services/constellation/constellations";
import {
  getGoalAccuracy,
  getGoalDisplayName,
  type Goal,
  type GoalScopeType,
} from "@/lib/study/goals";
import {
  buildPreviewStar,
} from "@/lib/constellation/stars";
import { getDeadlineDisplay } from "@/lib/study/time";
import AppPage from "@/components/layout/AppPage";
import { Button, Card, EmptyState, FeedbackBanner, Input, ProgressBar, SectionHeader, Skeleton } from "@/components/ui";
import ConstellationStar from "@/components/constellation/ConstellationStar";
import Refreshable, { RefreshIconButton } from "@/components/layout/Refreshable";
import { getDecks } from "@/services/study/decks";
import type { Deck } from "@/lib/study/decks";
import { getActiveTopics } from "@/services/study/topics";
import { getActiveStudyFolders } from "@/services/study/folders";
import {
  createGoal,
  getActiveGoalsWithCurrentStatuses,
  getCompletedGoalCount,
  getGoalHistoryPage,
  type GoalHistoryCursor,
  updateGoal,
} from "@/services/study/goals";
import type { Topic } from "@/lib/material/topics";
import type { StudyFolder } from "@/lib/workspace/study-folders";

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

type GoalDeadlineFieldProps = {
  type: "date" | "time";
  label: string;
  value: string;
  placeholder: string;
  onValueChange: (value: string) => void;
};

function formatGoalDeadlineValue(type: "date" | "time", value: string) {
  if (!value) return "";
  if (type === "time") return value;

  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function GoalDeadlineIcon({ type }: { type: "date" | "time" }) {
  if (type === "time") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-[1.125rem]"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <circle cx="12" cy="12" r="8.25" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.75v4.7l3.1 1.8" />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-[1.125rem]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <rect x="4" y="5.5" width="16" height="14" rx="2.25" />
      <path strokeLinecap="round" d="M8 3.75v3.5M16 3.75v3.5M4 9.25h16" />
    </svg>
  );
}

function GoalDeadlineField({
  type,
  label,
  value,
  placeholder,
  onValueChange,
}: GoalDeadlineFieldProps) {
  const id = useId();
  const displayValue = formatGoalDeadlineValue(type, value);

  return (
    <div className="goal-deadline-field min-w-0">
      <label
        htmlFor={id}
        className="mb-2 block text-sm font-medium tracking-[0.01em] text-text-secondary"
      >
        {label}
      </label>
      <div className="app-field relative flex min-h-11 min-w-0 items-center gap-3 overflow-hidden rounded-lg px-4 py-2.5">
        <span
          aria-hidden="true"
          className={`min-w-0 flex-1 truncate text-sm ${
            value
              ? "text-[var(--color-field-text)]"
              : "text-[var(--color-field-placeholder)]"
          }`}
        >
          {displayValue || placeholder}
        </span>
        <span
          aria-hidden="true"
          className="pointer-events-none flex shrink-0 text-[var(--color-field-placeholder)]"
        >
          <GoalDeadlineIcon type={type} />
        </span>
        <input
          id={id}
          type={type}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          className="goal-deadline-native absolute inset-0 z-10 h-full w-full cursor-pointer opacity-[0.001]"
        />
      </div>
    </div>
  );
}

export default function GoalsPage() {
  const { user } = useUser();

  const [goals, setGoals] = useState<Goal[]>([]);
  const [showGoalComposer, setShowGoalComposer] = useState(false);
  const [showGoalHistory, setShowGoalHistory] = useState(false);
  const [goalName, setGoalName] = useState("");
  const [goalScopeType, setGoalScopeType] = useState<GoalScopeType>("all");
  const [goalScopeId, setGoalScopeId] = useState("");
  const [targetCards, setTargetCards] = useState("");
  const [targetAccuracy, setTargetAccuracy] = useState("");
  const [deadlineDate, setDeadlineDate] = useState("");
  const [deadlineTime, setDeadlineTime] = useState("");
  const [isCreatingGoal, setIsCreatingGoal] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [cancellingGoalId, setCancellingGoalId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const {
    feedback,
    success,
    showError,
    clear: clearFeedback,
  } = useFeedback();
  const [activeConstellation, setActiveConstellation] =
    useState<Constellation | null>(null);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [folders, setFolders] = useState<StudyFolder[]>([]);
  const [historicalGoals, setHistoricalGoals] = useState<Goal[]>([]);
  const [historyCursor, setHistoryCursor] =
    useState<GoalHistoryCursor | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyUnavailable, setHistoryUnavailable] = useState(false);
  const [completedGoalsCount, setCompletedGoalsCount] = useState(0);
  const [goalsUnavailable, setGoalsUnavailable] = useState(false);

  const lastForegroundRefreshAtRef = useRef(0);

  const loadGoalData = useCallback(
    async () => {
      const [activeGoals, completedCount] = await Promise.all([
        getActiveGoalsWithCurrentStatuses(user.uid),
        getCompletedGoalCount(user.uid),
      ]);
      return { activeGoals, completedCount };
    },
    [user.uid]
  );

  const applyGoalData = useCallback((data: {
    activeGoals: Goal[];
    completedCount: number;
  }) => {
    setGoals(data.activeGoals);
    setCompletedGoalsCount(data.completedCount);
    setGoalsUnavailable(false);
  }, []);

  const handleGoalLoadError = useCallback((error: unknown) => {
    console.error("Failed to load goals.", error);
    setGoalsUnavailable(true);
    showError("Failed to load goals.");
  }, [showError]);

  const { loading: isLoadingGoals, reload: reloadGoals } = useDashboardData({
    requestKey: user.uid,
    load: loadGoalData,
    apply: applyGoalData,
    onError: handleGoalLoadError,
  });

  const loadConstellationSummaryData = useCallback(
    () => ensureConstellationSetup(user.uid),
    [user.uid]
  );

  const applyConstellationSummaryData = useCallback(
    (constellations: Constellation[]) => {
      setActiveConstellation(getActiveConstellation(constellations));
    },
    []
  );

  const handleConstellationSummaryLoadError = useCallback((error: unknown) => {
    console.error("Failed to load the goal constellation summary.", error);
    setActiveConstellation(null);
  }, []);

  const { reload: reloadConstellationSummary } = useDashboardData({
    requestKey: user.uid,
    load: loadConstellationSummaryData,
    apply: applyConstellationSummaryData,
    onError: handleConstellationSummaryLoadError,
  });

  const loadGoalHistory = useCallback(
    async (options: { append?: boolean } = {}) => {
      if (historyLoading) return;
      setHistoryLoading(true);
      setHistoryUnavailable(false);
      try {
        const page = await getGoalHistoryPage(user.uid, {
          cursor: options.append ? historyCursor : null,
          pageSize: 30,
        });
        setHistoricalGoals((current) => {
          const next = options.append ? [...current, ...page.items] : page.items;
          return Array.from(
            new Map(next.map((goal) => [goal.id, goal])).values()
          ).sort((left, right) => right.createdAt - left.createdAt);
        });
        setHistoryCursor(page.nextCursor);
        setHistoryLoaded(true);
      } catch (error) {
        console.error("Failed to load goal history.", error);
        setHistoryUnavailable(true);
        showError("Could not load goal history. Try again in a moment.");
      } finally {
        setHistoryLoading(false);
      }
    }, [historyCursor, historyLoading, showError, user.uid]
  );

  const reloadGoalWorkspace = useCallback(async () => {
    await Promise.all([
      reloadGoals(),
      reloadConstellationSummary(),
      historyLoaded ? loadGoalHistory() : Promise.resolve(),
    ]);
  }, [historyLoaded, loadGoalHistory, reloadConstellationSummary, reloadGoals]);

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([
      getDecks(user.uid),
      getActiveTopics(user.uid),
      getActiveStudyFolders(user.uid),
    ]).then(([decksResult, topicsResult, foldersResult]) => {
      if (cancelled) return;
      if (decksResult.status === "fulfilled") setDecks(decksResult.value);
      if (topicsResult.status === "fulfilled") setTopics(topicsResult.value);
      if (foldersResult.status === "fulfilled") setFolders(foldersResult.value);

      const failedScopes = [
        ["decks", decksResult] as const,
        ["topics", topicsResult] as const,
        ["folders", foldersResult] as const,
      ].filter(([, result]) => result.status === "rejected");
      if (failedScopes.length > 0) {
        console.warn("Some goal scope options failed to load.", {
          scopes: failedScopes.map(([scope]) => scope),
          errors: failedScopes.map(([, result]) =>
            result.status === "rejected" ? result.reason : undefined
          ),
        });
        showError("Some goal options could not load. Refresh to try again.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [showError, user.uid]);

  useEffect(() => {
    const handleFocus = () => {
      const now = Date.now();
      if (
        document.visibilityState !== "hidden" &&
        now - lastForegroundRefreshAtRef.current > 15_000
      ) {
        lastForegroundRefreshAtRef.current = now;
        void reloadGoalWorkspace();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
    };
  }, [reloadGoalWorkspace]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    clearFeedback();
    try {
      await reloadGoalWorkspace();
    } finally {
      setRefreshing(false);
    }
  }, [clearFeedback, reloadGoalWorkspace]);

  const parsedGoalTargetCards = parseTargetCardsInput(targetCards);
  const parsedGoalTargetAccuracy = parseTargetAccuracyInput(targetAccuracy);
  const previewTargetCards = parsedGoalTargetCards ?? 10;
  const previewTargetAccuracy = parsedGoalTargetAccuracy ?? 0.8;
  const previewConstellationId =
    activeConstellation?.id ?? "preview-constellation";
  const previewStar = buildPreviewStar({
    targetCards: previewTargetCards,
    targetAccuracy: previewTargetAccuracy,
    completedGoalsCount: completedGoalsCount + 1,
    constellationId: previewConstellationId,
    position: { x: 50, y: 50 },
  });
  const scopeOptions = useMemo(() => {
    if (goalScopeType === "deck") {
      return decks.map((deck) => ({ id: deck.id, label: deck.name }));
    }
    if (goalScopeType === "topic") {
      return topics.map((topic) => ({ id: topic.id, label: topic.name }));
    }
    if (goalScopeType === "folder") {
      return folders.map((folder) => ({ id: folder.id, label: folder.name }));
    }
    return [];
  }, [decks, folders, goalScopeType, topics]);
  const selectedScopeLabel =
    scopeOptions.find((option) => option.id === goalScopeId)?.label ?? "";

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
    goalName.trim().length > 0 &&
    (goalScopeType === "all" || Boolean(goalScopeId && selectedScopeLabel)) &&
    parsedGoalTargetCards !== null &&
    parsedGoalTargetAccuracy !== null &&
    deadlineIsValid &&
    !isCreatingGoal;
  const disabledReason =
    !goalName.trim()
      ? "Give this goal a short name."
      : goalScopeType !== "all" && (!goalScopeId || !selectedScopeLabel)
        ? `Choose a ${goalScopeType} for this goal.`
        : parsedGoalTargetCards === null
      ? "Enter a card target greater than zero."
      : parsedGoalTargetAccuracy === null
        ? "Enter an accuracy target from 0 to 100%."
        : !deadlineIsValid
          ? "Choose a future deadline, or leave it blank."
          : null;

  const resetGoalForm = () => {
    setGoalName("");
    setGoalScopeType("all");
    setGoalScopeId("");
    setTargetCards("");
    setTargetAccuracy("");
    setDeadlineDate("");
    setDeadlineTime("");
    setEditingGoalId(null);
    setShowGoalComposer(false);
  };
  const formatGoalScopeText = (goal: Goal) =>
    goal.scope.type === "all"
      ? "All study"
      : goal.scope.label || `${goal.scope.type[0].toUpperCase()}${goal.scope.type.slice(1)}`;

  const applyPreset = (preset: GoalPreset) => {
    const deadline = new Date();

    if (preset === "today-10") {
      setGoalName("Today’s review");
      setTargetCards("10");
      setTargetAccuracy("80");
      setDeadlineDate(getDateInputValue(deadline));
      setDeadlineTime("23:59");
    } else if (preset === "week-20") {
      setGoalName("This week’s review");
      deadline.setDate(deadline.getDate() + 7);
      setTargetCards("20");
      setTargetAccuracy("80");
      setDeadlineDate(getDateInputValue(deadline));
      setDeadlineTime("23:59");
    }

    setEditingGoalId(null);
    setShowGoalComposer(true);
    clearFeedback();
  };

  const startEditingGoal = (goal: Goal) => {
    setEditingGoalId(goal.id);
    setShowGoalComposer(true);
    setGoalName(getGoalDisplayName(goal));
    setGoalScopeType(goal.scope.type);
    setGoalScopeId(goal.scope.id ?? "");
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
    clearFeedback();
    window.requestAnimationFrame(() => {
      document.getElementById("new-goal")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  const handleSaveGoal = async () => {
    const nextName = goalName.trim().slice(0, 120);
    const nextTargetCards = parseTargetCardsInput(targetCards);
    const nextTargetAccuracy = parseTargetAccuracyInput(targetAccuracy);
    const parsedDeadline = deadlineDate
      ? Date.parse(`${deadlineDate}T${deadlineTime || "23:59"}`)
      : 0;

    if (
      !nextName ||
      (goalScopeType !== "all" && (!goalScopeId || !selectedScopeLabel)) ||
      nextTargetCards === null ||
      nextTargetAccuracy === null ||
      (deadlineDate &&
        (!Number.isFinite(parsedDeadline) || parsedDeadline <= Date.now()))
    ) {
      showError("Name the goal, choose its study scope, and enter valid targets.");
      return;
    }

    setIsCreatingGoal(true);
    clearFeedback();

    try {
      const goalUpdates = {
        name: nextName,
        scope:
          goalScopeType === "all"
            ? { type: "all" as const }
            : {
                type: goalScopeType,
                id: goalScopeId,
                label: selectedScopeLabel,
              },
        targetCards: nextTargetCards,
        targetAccuracy: nextTargetAccuracy,
        deadline: parsedDeadline,
      };

      if (editingGoalId) {
        await updateGoal(user.uid, editingGoalId, goalUpdates);
        setGoals((prev) =>
          prev.map((goal) =>
            goal.id === editingGoalId ? { ...goal, ...goalUpdates } : goal
          )
        );
        success("Goal saved.");
      } else {
        const createdAt = Date.now();
        const newGoal = {
          ...goalUpdates,
        progress: { cardsCompleted: 0, correctAnswers: 0, totalAnswers: 0 },
        status: "active" as const,
        createdAt,
        };
        const createdGoal = await createGoal(user.uid, newGoal);

        setGoals((prev) => [createdGoal, ...prev]);
        success("Goal created.");
      }

      resetGoalForm();
    } catch (error) {
      console.error("Failed to save a goal.", error);
      showError(editingGoalId ? "Failed to save goal." : "Failed to create goal.");
    } finally {
      setIsCreatingGoal(false);
    }
  };

  const handleCancelGoal = async (goal: Goal) => {
    if (
      !window.confirm(
        `Cancel this ${goal.targetCards}-card goal? Its progress will stay in goal history.`
      )
    ) {
      return;
    }

    setCancellingGoalId(goal.id);
    clearFeedback();
    try {
      await updateGoal(user.uid, goal.id, {
        status: "cancelled",
      });
      setGoals((prev) => prev.filter((item) => item.id !== goal.id));
      if (historyLoaded) {
        setHistoricalGoals((current) => [
          { ...goal, status: "cancelled" },
          ...current.filter((item) => item.id !== goal.id),
        ]);
      }
      if (editingGoalId === goal.id) resetGoalForm();
      success("Goal moved to history.");
    } catch (error) {
      console.error("Failed to cancel a goal.", error);
      showError("Failed to cancel goal.");
    } finally {
      setCancellingGoalId(null);
    }
  };

  const activeGoals = goals;

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
          <FeedbackBanner type={feedback.type} message={feedback.message} onDismiss={() => clearFeedback()} />
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <SectionHeader
            eyebrow="Current targets"
            title={activeGoals.length === 0 ? "No active goals" : `${activeGoals.length} active goal${activeGoals.length === 1 ? "" : "s"}`}
          />
          {!showGoalComposer ? (
            <Button
              type="button"
              variant="warm"
              onClick={() => {
                setEditingGoalId(null);
                setShowGoalComposer(true);
                clearFeedback();
              }}
            >
              New goal
            </Button>
          ) : null}
        </div>

        {showGoalComposer ? (
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
          <div className="goal-form-layout min-w-0">
            <div className="goal-form-grid grid min-w-0 gap-3 sm:gap-4">
              <Input
                value={goalName}
                maxLength={120}
                onChange={(event) => setGoalName(event.target.value)}
                label="Goal name"
                placeholder="For example, Biology review"
                containerClassName="goal-form-span-all min-w-0"
                className="min-h-11 min-w-0 !rounded-lg !px-4 !py-2.5"
              />
              <label className="min-w-0 text-sm font-medium text-text-secondary">
                Counts study from
                <select
                  value={goalScopeType}
                  onChange={(event) => {
                    setGoalScopeType(event.target.value as GoalScopeType);
                    setGoalScopeId("");
                  }}
                  className="app-field mt-2 min-h-11 w-full rounded-lg px-4 py-2.5 text-sm"
                >
                  <option value="all">All study</option>
                  <option value="deck">One deck</option>
                  <option value="topic">One topic</option>
                  <option value="folder">One folder</option>
                </select>
              </label>
              {goalScopeType !== "all" ? (
                <label className="min-w-0 text-sm font-medium text-text-secondary">
                  {goalScopeType[0].toUpperCase() + goalScopeType.slice(1)}
                  <select
                    value={goalScopeId}
                    onChange={(event) => setGoalScopeId(event.target.value)}
                    className="app-field mt-2 min-h-11 w-full rounded-lg px-4 py-2.5 text-sm"
                  >
                    <option value="">Choose {goalScopeType}</option>
                    {scopeOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="app-subtle-panel flex min-h-11 items-center rounded-lg px-4 py-2.5 text-sm text-text-secondary">
                  Every reviewed card counts toward this goal.
                </div>
              )}
              <Input
                type="number"
                min="1"
                value={targetCards}
                onChange={(event) => setTargetCards(event.target.value)}
                label="Target cards"
                containerClassName="min-w-0"
                className="min-h-11 min-w-0 !rounded-lg !px-4 !py-2.5"
              />
              <Input
                type="number"
                min="0"
                max="100"
                step="1"
                value={targetAccuracy}
                onChange={(event) => setTargetAccuracy(event.target.value)}
                label="Accuracy %"
                containerClassName="min-w-0"
                className="min-h-11 min-w-0 !rounded-lg !px-4 !py-2.5"
              />
              <div className="goal-form-span-all min-w-0 border-t border-[var(--color-border)] pt-4">
                <div className="text-sm font-medium text-text-primary">Deadline</div>
                <p className="mt-1 text-xs leading-5 text-text-muted">
                  Optional. Leave both fields blank for an open-ended goal.
                </p>
              </div>
              <GoalDeadlineField
                type="date"
                value={deadlineDate}
                onValueChange={(value) => {
                  setDeadlineDate(value);
                  if (!value) setDeadlineTime("");
                }}
                label="Finish by date"
                placeholder="Choose a date"
              />
              <GoalDeadlineField
                type="time"
                value={deadlineTime}
                onValueChange={setDeadlineTime}
                label="Finish by time"
                placeholder="Choose a time"
              />
              <div className="goal-form-span-all grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center">
                <div className="flex flex-col items-start">
                  <p className="order-3 mt-4 text-sm font-medium text-text-secondary lg:order-1 lg:mb-4 lg:mt-0">
                    Complete this goal to earn this star.
                  </p>
                  <Button
                    disabled={!canSaveGoal}
                    onClick={() => void handleSaveGoal()}
                    variant="warm"
                    size="lg"
                    className="order-1 w-full md:w-auto lg:order-2"
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
                    <p className="order-2 mt-2 text-xs leading-5 text-text-muted lg:order-3">
                      {disabledReason}
                    </p>
                  ) : null}
                </div>
                {/*
                  An inner glow, which is the opposite of elevation: it pushes
                  light into the panel rather than lifting the panel off the
                  page. No height on the scale describes a hollow.
                */}
                <div
                  // eslint-disable-next-line no-restricted-syntax
                  className="relative h-40 overflow-hidden rounded-xl border border-[rgba(238,225,255,0.18)] bg-[linear-gradient(180deg,#080416_0%,#060311_58%,#030108_100%)] shadow-[inset_0_0_34px_rgba(143,125,232,0.14)] sm:h-44 lg:w-[230px] lg:max-w-full lg:justify-self-start lg:-translate-x-2"
                >
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(143,125,232,0.16),rgba(6,3,17,0.66))]" />
                  <div className="absolute inset-0 z-10">
                    <ConstellationStar star={previewStar} variant="preview" />
                  </div>
                </div>
              </div>
            </div>
          </div>
          </Card>
        ) : null}

        {isLoadingGoals ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        ) : goalsUnavailable ? (
          <EmptyState
            emoji="Retry"
            eyebrow="Goals unavailable"
            title="Your goals could not load"
            description="Nothing has been replaced with an empty list. Try loading this section again."
            action={
              <Button type="button" variant="secondary" onClick={() => void reloadGoals()}>
                Retry goals
              </Button>
            }
          />
        ) : (
          <>
            {activeGoals.length === 0 ? (
              <EmptyState
                emoji="Goal"
                eyebrow="No active goals"
                title="No active goals"
                description="Create a goal to earn stars."
                action={
                  <Button
                    type="button"
                    variant="warm"
                    onClick={() => setShowGoalComposer(true)}
                  >
                    Create your first goal
                  </Button>
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
                          <div className="text-base font-semibold text-text-primary">
                            {getGoalDisplayName(goal)}
                          </div>
                          <div className="mt-1 text-xs font-medium text-text-muted">
                            {formatGoalScopeText(goal)}
                          </div>
                          <div className="mt-3 font-semibold">
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
                          disabled={cancellingGoalId === goal.id}
                          onClick={() => startEditingGoal(goal)}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="danger"
                          disabled={cancellingGoalId === goal.id}
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
              onClick={() => {
                const nextVisible = !showGoalHistory;
                setShowGoalHistory(nextVisible);
                if (nextVisible && !historyLoaded) void loadGoalHistory();
              }}
              variant="secondary"
              disabled={historyLoading && !historyLoaded}
            >
              {historyLoading && !historyLoaded
                ? "Loading goal history..."
                : showGoalHistory
                  ? "Hide goal history"
                  : "Show goal history"}
            </Button>

            {showGoalHistory ? (
              historyLoading && !historyLoaded ? (
                <div aria-label="Loading goal history" className="grid gap-3 sm:grid-cols-2">
                  <Skeleton className="h-32 rounded-2xl" />
                  <Skeleton className="h-32 rounded-2xl" />
                </div>
              ) : historyUnavailable ? (
                <EmptyState
                  emoji="Retry"
                  eyebrow="Goal history unavailable"
                  title="Your past goals could not load"
                  description="Try this section again without refreshing the rest of the page."
                  action={
                    <Button type="button" variant="secondary" onClick={() => void loadGoalHistory()}>
                      Retry history
                    </Button>
                  }
                  variant="compact"
                />
              ) : historicalGoals.length === 0 ? (
                <EmptyState
                  emoji="History"
                  eyebrow="Goal history"
                  title="No past goals yet"
                  description="Completed and expired goals will appear here once you have run a few targets."
                  variant="compact"
                />
              ) : (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
                    {historicalGoals.map((goal) => (
                      <div key={goal.id} className="app-panel p-4 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="min-w-0 pr-3">
                          <span className="block truncate font-semibold">{getGoalDisplayName(goal)}</span>
                          <span className="mt-1 block text-xs text-text-muted">{formatGoalScopeText(goal)}</span>
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
                        {goal.progress.cardsCompleted} / {goal.targetCards} cards ·{" "}
                        {formatGoalAccuracyText(goal)}
                      </div>
                      </div>
                    ))}
                  </div>
                  {historyCursor ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={historyLoading}
                      onClick={() => void loadGoalHistory({ append: true })}
                    >
                      {historyLoading ? "Loading more..." : "Load more history"}
                    </Button>
                  ) : null}
                </div>
              )
            ) : null}
          </>
        )}
      </AppPage>
    </Refreshable>
  );
}
