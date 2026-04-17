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
      const starsSnapshot = await getDocs(collection(db, "users", uid, "stars"));
      const adjustedStars = spreadBackfilledStars(
        starsSnapshot.docs.map((starDoc) =>
          parseStarData(starDoc.id, starDoc.data() as Record<string, unknown>)
        )
      ).sort((left, right) => right.createdAt - left.createdAt);
      const fallbackConstellation = getFallbackConstellation(nextConstellations);

      setConstellations(nextConstellations);
      setAllStars(adjustedStars);
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
  const activeProgressPercent = getConstellationProgressPercent(activeConstellation);
  const selectedProgressPercent = getConstellationProgressPercent(selectedConstellation);

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
        title="Constellation"
        backHref="/dashboard"
        backLabel="Dashboard"
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
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="rounded-full border border-white/[0.10] bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-text-secondary">
                    Stars come from completed goals
                  </span>
                  <span className="rounded-full border border-white/[0.10] bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-text-secondary">
                    Active stars can be dragged
                  </span>
                  <span className="rounded-full border border-white/[0.10] bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-text-secondary">
                    Optional app background
                  </span>
                </div>
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
            aside={
              <div className="min-w-[15rem] rounded-[1.7rem] border border-white/[0.10] bg-white/[0.045] p-4">
                <div className="flex items-baseline justify-between gap-4">
                  <div>
                    <div className="text-xs text-text-muted">Stars earned</div>
                    <div className="mt-1 text-xl font-medium text-white sm:text-2xl">
                      {activeConstellation.starCount}
                    </div>
                  </div>
                  <div className="rounded-full border border-white/[0.10] bg-white/[0.06] px-3 py-1 text-xs font-semibold text-text-secondary">
                    Active
                  </div>
                </div>
                <div className="mt-4">
                  <div className="mb-2 flex justify-between text-xs text-text-muted">
                    <span>Constellation capacity</span>
                    <span>{activeConstellation.starCount} / {activeConstellation.maxStars}</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-glass-medium">
                    <div
                      className="h-2.5 rounded-full bg-success transition-all duration-slow"
                      style={{ width: `${activeProgressPercent}%` }}
                    />
                  </div>
                  <p className="mt-3 text-xs leading-5 text-text-muted">
                    {canFinishActiveConstellation
                      ? "This constellation is full and ready to finish."
                      : "Keep completing goals to add more stars."}
                  </p>
                </div>
              </div>
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
              <div className="flex flex-col gap-3 rounded-[1.5rem] border border-white/[0.08] bg-white/[0.035] p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-semibold uppercase tracking-[0.16em] text-text-muted sm:max-w-xs">
                  Constellation
                  <select
                    value={selectedConstellation?.id ?? ""}
                    onChange={(event) =>
                      setSelectedConstellationId(event.target.value)
                    }
                    className="mt-1 w-full appearance-none truncate rounded-2xl border border-border bg-surface-panel py-3 pl-4 pr-8 text-sm font-medium normal-case tracking-normal text-white bg-[length:1rem] bg-[position:right_0.6rem_center] bg-no-repeat"
                    style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
                  >
                    {constellations.map((constellation) => (
                      <option
                        key={constellation.id}
                        value={constellation.id}
                        className="text-black"
                      >
                        {constellation.name}
                      </option>
                    ))}
                  </select>
                </label>

                {selectedConstellation ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-white/[0.10] bg-white/[0.05] px-3 py-1.5 text-xs font-semibold capitalize text-text-secondary">
                      {selectedConstellation.status === "active" ? "Active sky" : "Finished sky"}
                    </span>
                    <span className="rounded-full border border-white/[0.10] bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-text-secondary">
                      {selectedConstellation.starCount} / {selectedConstellation.maxStars} stars
                    </span>
                    {!canEditSelectedConstellation ? (
                      <span className="rounded-full border border-white/[0.10] bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-text-muted">
                        View only
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div
                id="constellation-container"
                className="relative h-[60vh] w-full select-none overflow-hidden rounded-[2rem] border border-white/[0.07] bg-surface-base sm:h-[560px]"
                style={{
                  backgroundColor: "#090413",
                }}
              >
                <div className="absolute inset-0 z-10">
                  {visibleStars.map((star) => (
                    <ConstellationStar
                      key={star.id}
                      star={star}
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
                            className="inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl bg-accent px-4 py-2 text-sm font-medium text-white shadow-[var(--shadow-accent)] transition duration-fast hover:bg-accent-hover"
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
                              className="group flex min-w-0 items-center gap-1.5 font-medium transition-colors hover:text-accent"
                              onClick={() => startRename(constellation)}
                            >
                              <span className="truncate">{constellation.name}</span>
                              <span className="text-text-muted opacity-0 transition-opacity group-hover:opacity-100" aria-label="Rename">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                              </span>
                            </button>
                          )}
                          <span className="shrink-0 rounded-full border border-white/[0.10] bg-white/[0.05] px-2.5 py-1 text-xs capitalize text-text-secondary">
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

            <Card
              padding="md"
              className="space-y-4 text-sm"
            >
              <SectionHeader
                title="Background"
                description="Use your selected constellation as a subtle app background. Turn it off any time."
                action={
                  <Button
                    type="button"
                    variant={isConstellationBackgroundEnabled ? "secondary" : "primary"}
                    onClick={() => {
                      if (isConstellationBackgroundEnabled) {
                        setIsConstellationBackgroundEnabled(false);
                        setConstellationBackgroundEnabled(false);
                        return;
                      }

                      const nextId =
                        backgroundConstellationId ||
                        selectedConstellation?.id ||
                        activeConstellation?.id ||
                        "";

                      setBackgroundConstellationId(nextId);
                      setConstellationBackgroundConstellationId(nextId);
                      setIsConstellationBackgroundEnabled(true);
                      setConstellationBackgroundEnabled(true);
                    }}
                  >
                    {isConstellationBackgroundEnabled
                      ? "Turn off"
                      : "Use background"}
                  </Button>
                }
              />

              <div className="flex flex-wrap items-center gap-3">
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-semibold uppercase tracking-[0.16em] text-text-muted sm:max-w-xs">
                  Background sky
                  <select
                    value={backgroundConstellationId}
                    onChange={(event) => {
                      const nextId = event.target.value;
                      setBackgroundConstellationId(nextId);
                      setConstellationBackgroundConstellationId(nextId);
                    }}
                    className="mt-1 w-full appearance-none truncate rounded-[1.7rem] border border-border bg-surface-panel py-3 pl-4 pr-8 text-sm font-medium normal-case tracking-normal text-white bg-[length:1rem] bg-[position:right_0.6rem_center] bg-no-repeat"
                    style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
                  >
                    <option value="" className="text-black">
                      Active or latest
                    </option>
                    {constellations.map((constellation) => (
                      <option
                        key={constellation.id}
                        value={constellation.id}
                        className="text-black"
                      >
                        {constellation.name}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-2 text-xs font-medium text-text-secondary">
                  {isConstellationBackgroundEnabled
                    ? `Showing ${
                        constellations.find(
                          (constellation) =>
                            constellation.id === backgroundConstellationId
                        )?.name ?? "active constellation"
                      }`
                    : "Off"}
                </div>
              </div>
            </Card>

          </>
        )}
      </AppPage>
    </Refreshable>
  );
}
