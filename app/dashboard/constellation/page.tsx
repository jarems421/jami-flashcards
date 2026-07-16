"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { useUser } from "@/lib/auth/user-context";
import { db } from "@/services/firebase/client";
import {
  getActiveConstellation,
  getFallbackConstellation,
  isConstellationReadyToFinish,
  type Constellation,
} from "@/lib/constellation/constellations";
import {
  createConstellation,
  ensureConstellationSetup,
  finishConstellation,
  renameConstellation,
} from "@/services/constellation/constellations";
import {
  readConstellationBackgroundConstellationId,
  readConstellationBackgroundEnabled,
  setConstellationBackgroundConstellationId,
  setConstellationBackgroundEnabled,
} from "@/lib/constellation/background";
import {
  parseStarData,
  spreadBackfilledStars,
  type NormalizedStar,
} from "@/lib/constellation/stars";
import { normalizeGoal, type Goal } from "@/lib/study/goals";
import { backfillStarPositions, saveStarPosition } from "@/services/constellation/stars";
import AppPage from "@/components/layout/AppPage";
import { Button, Card, EmptyState, FeedbackBanner, Input, PageHero, SectionHeader, Skeleton } from "@/components/ui";
import ConstellationStar from "@/components/constellation/ConstellationStar";
import Refreshable, { RefreshIconButton } from "@/components/layout/Refreshable";

type Feedback = { type: "success" | "error"; message: string };

function clampPercentage(value: number) {
  return Math.max(0, Math.min(100, value));
}

function getConstellationProgressPercent(constellation: Constellation | null) {
  if (!constellation || constellation.maxStars <= 0) return 0;
  return Math.min(100, Math.round((constellation.starCount / constellation.maxStars) * 100));
}

export default function ConstellationDashboardPage() {
  const { user } = useUser();

  const [constellations, setConstellations] = useState<Constellation[]>([]);
  const [allStars, setAllStars] = useState<NormalizedStar[]>([]);
  const [goalsById, setGoalsById] = useState<Record<string, Goal>>({});
  const [selectedConstellationId, setSelectedConstellationId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [draggingStarId, setDraggingStarId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [constellationName, setConstellationName] = useState("");
  const [isCreatingConstellation, setIsCreatingConstellation] = useState(false);
  const [isFinishingConstellation, setIsFinishingConstellation] = useState(false);
  const [renamingConstellationId, setRenamingConstellationId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [isConstellationBackgroundEnabled, setIsConstellationBackgroundEnabled] =
    useState(false);
  const [backgroundConstellationId, setBackgroundConstellationId] = useState("");

  const lastForegroundRefreshAtRef = useRef(0);
  const dragPositionRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setIsConstellationBackgroundEnabled(readConstellationBackgroundEnabled());
    setBackgroundConstellationId(readConstellationBackgroundConstellationId());
  }, []);

  const loadAll = useCallback(async (uid: string) => {
    setIsLoading(true);
    try {
      const nextConstellations = await ensureConstellationSetup(uid);
      const [starsSnapshot, goalsSnapshot] = await Promise.all([
        getDocs(collection(db, "users", uid, "stars")),
        getDocs(collection(db, "users", uid, "goals")),
      ]);
      const adjustedStars = spreadBackfilledStars(
        starsSnapshot.docs.map((starDoc) =>
          parseStarData(starDoc.id, starDoc.data() as Record<string, unknown>)
        )
      ).sort((left, right) => right.createdAt - left.createdAt);
      const fallbackConstellation = getFallbackConstellation(nextConstellations);

      setConstellations(nextConstellations);
      setAllStars(adjustedStars);
      setGoalsById(
        Object.fromEntries(
          goalsSnapshot.docs.map((goalDoc) => [
            goalDoc.id,
            normalizeGoal(
              goalDoc.id,
              goalDoc.data() as Record<string, unknown>
            ),
          ])
        )
      );
      setSelectedConstellationId((currentId) => {
        if (currentId && nextConstellations.some((constellation) => constellation.id === currentId)) {
          return currentId;
        }

        return fallbackConstellation?.id ?? "";
      });

      if (adjustedStars.some((star) => star.needsBackfill)) {
        await backfillStarPositions(uid, adjustedStars);
        setAllStars((prev) =>
          prev.map((star) =>
            star.needsBackfill ? { ...star, needsBackfill: false } : star
          )
        );
      }
    } catch (error) {
      console.error(error);
      setConstellations([]);
      setAllStars([]);
      setGoalsById({});
      setSelectedConstellationId("");
      setFeedback({
        type: "error",
        message: "Failed to load your constellation.",
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll(user.uid);
  }, [loadAll, user.uid]);

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
  }, [loadAll, user.uid]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setFeedback(null);
    try {
      await loadAll(user.uid);
    } finally {
      setRefreshing(false);
    }
  }, [loadAll, user.uid]);

  const selectedConstellation = useMemo(
    () =>
      constellations.find((constellation) => constellation.id === selectedConstellationId) ??
      getFallbackConstellation(constellations),
    [constellations, selectedConstellationId]
  );

  const activeConstellation = useMemo(
    () => getActiveConstellation(constellations),
    [constellations]
  );

  const canFinishActiveConstellation = activeConstellation
    ? isConstellationReadyToFinish(activeConstellation)
    : false;
  const canEditSelectedConstellation =
    selectedConstellation?.status === "active";

  const visibleStars = useMemo(
    () =>
      selectedConstellation
        ? allStars.filter(
            (star) => star.constellationId === selectedConstellation.id
          )
        : [],
    [allStars, selectedConstellation]
  );
  const selectedProgressPercent = getConstellationProgressPercent(selectedConstellation);
  const isSelectedConstellationBackground =
    Boolean(selectedConstellation) &&
    isConstellationBackgroundEnabled &&
    backgroundConstellationId === selectedConstellation?.id;

  const handleToggleSelectedBackground = () => {
    if (!selectedConstellation) {
      return;
    }

    if (isSelectedConstellationBackground) {
      setIsConstellationBackgroundEnabled(false);
      setConstellationBackgroundEnabled(false);
      return;
    }

    setBackgroundConstellationId(selectedConstellation.id);
    setConstellationBackgroundConstellationId(selectedConstellation.id);
    setIsConstellationBackgroundEnabled(true);
    setConstellationBackgroundEnabled(true);
  };

  useEffect(() => {
    if (!draggingStarId || !canEditSelectedConstellation) {
      return;
    }

    const container = document.getElementById("constellation-container");
    if (!container) {
      return;
    }

    const updateDragPosition = (clientX: number, clientY: number) => {
      const rect = container.getBoundingClientRect();
      const x = clampPercentage(((clientX - rect.left) / rect.width) * 100);
      const y = clampPercentage(((clientY - rect.top) / rect.height) * 100);

      dragPositionRef.current = { x, y };
      setAllStars((prev) =>
        prev.map((star) =>
          star.id === draggingStarId ? { ...star, position: { x, y } } : star
        )
      );
    };

    const handleMouseMove = (event: MouseEvent) => {
      updateDragPosition(event.clientX, event.clientY);
    };

    const handleTouchMove = (event: TouchEvent) => {
      event.preventDefault();
      const touch = event.touches[0];
      updateDragPosition(touch.clientX, touch.clientY);
    };

    const handleEnd = () => {
      const position = dragPositionRef.current;
      const starId = draggingStarId;
      setDraggingStarId(null);
      dragPositionRef.current = null;

      if (!position || !starId) {
        return;
      }

      void saveStarPosition(user.uid, starId, position);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleEnd);
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleEnd);
    window.addEventListener("touchcancel", handleEnd);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleEnd);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleEnd);
      window.removeEventListener("touchcancel", handleEnd);
    };
  }, [canEditSelectedConstellation, draggingStarId, user.uid]);

  const handleCreateConstellation = async () => {
    const trimmedName = constellationName.trim();
    if (!trimmedName) {
      return;
    }

    setIsCreatingConstellation(true);
    setFeedback(null);

    try {
      await createConstellation(user.uid, trimmedName);
      setConstellationName("");
      await loadAll(user.uid);
      setFeedback({
        type: "success",
        message: `Created constellation ${trimmedName}.`,
      });
    } catch (error) {
      console.error(error);
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to create constellation.",
      });
    } finally {
      setIsCreatingConstellation(false);
    }
  };

  const handleFinishConstellation = async () => {
    if (!activeConstellation || !canFinishActiveConstellation) {
      return;
    }

    setIsFinishingConstellation(true);
    setFeedback(null);

    try {
      await finishConstellation(user.uid, activeConstellation.id);
      await loadAll(user.uid);
      setFeedback({
        type: "success",
        message: `${activeConstellation.name} is now finished.`,
      });
    } catch (error) {
      console.error(error);
      setFeedback({
        type: "error",
        message: "Failed to finish constellation.",
      });
    } finally {
      setIsFinishingConstellation(false);
    }
  };

  const startRename = (constellation: Constellation) => {
    setRenamingConstellationId(constellation.id);
    setRenameValue(constellation.name);
  };

  const handleRename = async () => {
    if (!renamingConstellationId) return;
    const trimmed = renameValue.trim();
    if (!trimmed) return;

    try {
      const finalName = await renameConstellation(user.uid, renamingConstellationId, trimmed);
      setConstellations((prev) =>
        prev.map((c) =>
          c.id === renamingConstellationId ? { ...c, name: finalName } : c
        )
      );
      setRenamingConstellationId(null);
      setRenameValue("");
    } catch (error) {
      console.error(error);
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to rename constellation.",
      });
    }
  };

  const cancelRename = () => {
    setRenamingConstellationId(null);
    setRenameValue("");
  };

  return (
    <Refreshable onRefresh={handleRefresh}>
      <AppPage
        title="Stars"
        backHref="/dashboard/progress"
        backLabel="Progress"
        width="3xl"
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

        {!isLoading && activeConstellation ? (
          <PageHero
            compact
            eyebrow="Goal rewards"
            title={
              renamingConstellationId === activeConstellation.id ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <Input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleRename();
                      if (e.key === "Escape") cancelRename();
                    }}
                    containerClassName="w-full max-w-sm"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => void handleRename()} disabled={!renameValue.trim()}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={cancelRename}>Cancel</Button>
                  </div>
                </div>
              ) : (
                activeConstellation.name
              )
            }
            description={
              <>
                <p>
                  Constellations are your reward space. Complete goals to earn stars, then arrange the active sky so your progress feels visible.
                </p>
              </>
            }
            action={
              renamingConstellationId === activeConstellation.id ? null : <Button type="button" variant="secondary" onClick={() => startRename(activeConstellation)}>
                Rename
              </Button>
            }
            secondaryAction={
              <Button
                type="button"
                disabled={!canFinishActiveConstellation || isFinishingConstellation}
                onClick={() => void handleFinishConstellation()}
              >
                {isFinishingConstellation ? "Finishing..." : canFinishActiveConstellation ? "Finish constellation" : "Finish at 40 stars"}
              </Button>
            }
          />
        ) : null}

        {!isLoading && !activeConstellation ? (
          <Card tone="warm" padding="md">
            <SectionHeader
              eyebrow="Reward space"
              title="Create a constellation"
              description="Stars from completed goals need somewhere to live. Make a constellation now, then let rewards fill it over time."
            />
            <div className="mt-4 flex flex-wrap gap-3">
              <Input
                placeholder="Constellation name"
                value={constellationName}
                onChange={(event) => setConstellationName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void handleCreateConstellation();
                  }
                }}
                containerClassName="w-full max-w-xs"
              />
              <Button
                type="button"
                disabled={isCreatingConstellation || !constellationName.trim()}
                onClick={() => void handleCreateConstellation()}
              >
                {isCreatingConstellation ? "Creating..." : "Create"}
              </Button>
            </div>
          </Card>
        ) : null}

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-12 w-48" />
            <Skeleton className="h-80" />
            <Skeleton className="h-36" />
          </div>
        ) : (
          <>
            <Card padding="md" className="space-y-4">
              <SectionHeader
                title="Your sky"
                description="View your reward stars here. The active constellation can be arranged; finished constellations stay as calm records of past progress."
              />
              <div className="app-subtle-panel flex flex-col gap-3 rounded-[1.5rem] p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-semibold uppercase tracking-[0.16em] text-text-muted sm:max-w-xs">
                  Constellation
                  <span className="relative mt-1 block">
                    <select
                      value={selectedConstellation?.id ?? ""}
                      onChange={(event) =>
                        setSelectedConstellationId(event.target.value)
                      }
                      className="app-field w-full appearance-none truncate rounded-2xl py-3 pl-4 pr-12 text-sm font-medium normal-case tracking-normal"
                    >
                      {constellations.map((constellation) => (
                        <option
                          key={constellation.id}
                          value={constellation.id}
                        >
                          {constellation.name}
                        </option>
                      ))}
                    </select>
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 20 20"
                      fill="none"
                      className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary"
                    >
                      <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </label>

                {selectedConstellation ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="app-chip rounded-full px-3 py-1.5 text-xs font-semibold capitalize">
                      {selectedConstellation.status === "active" ? "Active sky" : "Finished sky"}
                    </span>
                    <span className="app-chip rounded-full px-3 py-1.5 text-xs font-semibold">
                      {selectedConstellation.starCount} / {selectedConstellation.maxStars} stars
                    </span>
                    {!canEditSelectedConstellation ? (
                      <span className="app-chip rounded-full px-3 py-1.5 text-xs font-medium">
                        View only
                      </span>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      variant={isSelectedConstellationBackground ? "secondary" : "primary"}
                      onClick={handleToggleSelectedBackground}
                    >
                      {isSelectedConstellationBackground
                        ? "Remove background"
                        : "Use as background"}
                    </Button>
                  </div>
                ) : null}
              </div>

              <div
                id="constellation-container"
                className="relative h-[60vh] w-full select-none overflow-hidden rounded-[2rem] border border-[var(--color-border)] bg-surface-base sm:h-[560px]"
                style={{
                  backgroundColor: "#090413",
                }}
              >
                <div className="absolute inset-0 z-10">
                  {visibleStars.map((star) => (
                    <ConstellationStar
                      key={star.id}
                      star={star}
                      label={
                        goalsById[star.goalId]
                          ? `Earned for a ${goalsById[star.goalId].targetCards}-card goal`
                          : "Earned star"
                      }
                      onDragStart={
                        canEditSelectedConstellation
                          ? () => setDraggingStarId(star.id)
                          : undefined
                      }
                    />
                  ))}
                </div>
                {visibleStars.length === 0 ? (
                  <div className="absolute inset-0 z-20 flex items-center justify-center p-5">
                    <div className="max-w-md">
                      <EmptyState
                        variant="plain"
                        emoji="Stars"
                        eyebrow="No stars yet"
                        title="Complete goals to fill this sky"
                        description="Constellations are rewards, not another task list. Finish a study goal and its star will appear here."
                        action={
                          <Link
                            href="/dashboard/goals"
                            className="app-button-primary inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl px-4 py-2 text-sm font-medium"
                          >
                            Create a goal
                          </Link>
                        }
                      />
                    </div>
                  </div>
                ) : null}
              </div>
              {selectedConstellation ? (
                <div>
                  <div className="mb-2 flex justify-between text-xs text-text-muted">
                    <span>{selectedConstellation.name}</span>
                    <span>{selectedProgressPercent}% filled</span>
                  </div>
                  <div className="h-2 rounded-full bg-glass-medium">
                    <div
                      className="h-2 rounded-full bg-accent transition-all duration-slow"
                      style={{ width: `${selectedProgressPercent}%` }}
                    />
                  </div>
                </div>
              ) : null}
            </Card>

            {constellations.length > 1 ? (
              <Card padding="md" className="space-y-4">
                <SectionHeader
                  title="Past skies"
                  description="Finished constellations stay here as a simple archive."
                />
                <div className="grid gap-3 lg:grid-cols-2">
                  {constellations
                    .filter((constellation) => constellation.id !== activeConstellation?.id)
                    .map((constellation) => (
                      <div key={constellation.id} className="app-panel p-4 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          {renamingConstellationId === constellation.id ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <Input
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") void handleRename();
                                  if (e.key === "Escape") cancelRename();
                                }}
                                containerClassName="w-full max-w-[10rem]"
                                autoFocus
                              />
                              <Button size="sm" onClick={() => void handleRename()} disabled={!renameValue.trim()}>Save</Button>
                              <Button size="sm" variant="ghost" onClick={cancelRename}>Cancel</Button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="group flex min-w-0 items-center gap-2 font-medium transition-colors hover:text-accent"
                              onClick={() => startRename(constellation)}
                            >
                              <span className="truncate">{constellation.name}</span>
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-text-muted transition-colors group-hover:text-accent" aria-label="Rename">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                                <span>Rename</span>
                              </span>
                            </button>
                          )}
                          <span className="app-chip shrink-0 rounded-full px-2.5 py-1 text-xs capitalize">
                            {constellation.status}
                          </span>
                        </div>
                        <div className="mt-2 text-xs text-text-muted">
                          {constellation.starCount} star{constellation.starCount === 1 ? "" : "s"}
                        </div>
                      </div>
                    ))}
                </div>
              </Card>
            ) : null}

          </>
        )}
      </AppPage>
    </Refreshable>
  );
}
