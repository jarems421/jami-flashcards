"use client";

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
import { Button, Card, FeedbackBanner, Input, Skeleton } from "@/components/ui";
import ConstellationStar from "@/components/constellation/ConstellationStar";
import Refreshable, { RefreshIconButton } from "@/components/layout/Refreshable";

type Feedback = { type: "success" | "error"; message: string };

function clampPercentage(value: number) {
  return Math.max(0, Math.min(100, value));
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
  const [starsExpanded, setStarsExpanded] = useState(false);
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
        contentClassName="space-y-6"
      >
        {feedback ? (
          <FeedbackBanner type={feedback.type} message={feedback.message} onDismiss={() => setFeedback(null)} />
        ) : null}

        {!isLoading && activeConstellation ? (
          <Card tone="warm" padding="md">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
              <div>
                {renamingConstellationId === activeConstellation.id ? (
                  <div className="flex items-center gap-2">
                    <Input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleRename();
                        if (e.key === "Escape") cancelRename();
                      }}
                      containerClassName="w-full max-w-[12rem]"
                      autoFocus
                    />
                    <Button size="sm" onClick={() => void handleRename()} disabled={!renameValue.trim()}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={cancelRename}>Cancel</Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="flex items-center gap-1.5 font-medium hover:text-accent focus:text-accent transition-colors"
                    onClick={() => startRename(activeConstellation)}
                    aria-label="Rename constellation"
                  >
                    {activeConstellation.name}
                    <span className="text-text-muted" aria-label="Rename">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline', verticalAlign: 'middle' }}><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                    </span>
                  </button>
                )}
                <div className="mt-1 text-sm text-text-muted">Active</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={
                    !canFinishActiveConstellation || isFinishingConstellation
                  }
                  onClick={() => void handleFinishConstellation()}
                >
                  {isFinishingConstellation ? "Finishing..." : "Finish"}
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <div className="mb-1 flex justify-between text-xs text-text-muted">
                  <span>Stars</span>
                  <span>
                    {activeConstellation.starCount} / {activeConstellation.maxStars}
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-glass-medium">
                  <div
                    className="h-2.5 rounded-full bg-success transition-all duration-slow"
                    style={{
                      width: `${Math.min(
                        100,
                        (activeConstellation.starCount /
                          activeConstellation.maxStars) *
                          100
                      )}%`,
                    }}
                  />
                </div>
              </div>
            </div>

            {!canFinishActiveConstellation ? (
              <p className="mt-3 text-xs text-text-muted">
                Earn stars from goals to finish it.
              </p>
            ) : null}
          </Card>
        ) : null}

        {!isLoading && !activeConstellation ? (
          <Card tone="warm" padding="md">
            <p className="mb-3 text-sm text-text-secondary">
              Create one to start collecting stars.
            </p>
            <div className="flex flex-wrap gap-3">
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
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <select
                  value={selectedConstellation?.id ?? ""}
                  onChange={(event) =>
                    setSelectedConstellationId(event.target.value)
                  }
                  className="max-w-[14rem] truncate rounded-2xl border border-border bg-surface-panel py-3 pr-8 pl-4 text-white appearance-none bg-[length:1rem] bg-[position:right_0.6rem_center] bg-no-repeat"
                  style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
                >
                  {constellations.map((constellation) => (
                    <option
                      key={constellation.id}
                      value={constellation.id}
                      className="text-black"
                    >
                      {constellation.name} ({constellation.status})
                    </option>
                  ))}
                </select>

                {selectedConstellation ? (
                  <>
                    <div>Status: {selectedConstellation.status}</div>
                    <div>
                      Stars: {selectedConstellation.starCount} /{" "}
                      {selectedConstellation.maxStars}
                    </div>
                    {!canEditSelectedConstellation ? (
                      <div className="text-text-muted">
                        View-only.
                      </div>
                    ) : null}
                  </>
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
              </div>
            </Card>

            {constellations.length > 1 ? (
              <div className="grid gap-4 lg:grid-cols-2">
                {constellations
                  .filter((constellation) => constellation.id !== activeConstellation?.id)
                  .map((constellation) => (
                    <div key={constellation.id} className="app-panel p-4 text-sm">
                      <div className="flex items-center justify-between">
                        {renamingConstellationId === constellation.id ? (
                          <div className="flex items-center gap-2">
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
                            className="group flex items-center gap-1.5 font-medium"
                            onClick={() => startRename(constellation)}
                          >
                            {constellation.name}
                            <span className="text-text-muted opacity-0 transition-opacity group-hover:opacity-100" aria-label="Rename">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                            </span>
                          </button>
                        )}
                        <span className="rounded-lg bg-glass-medium px-2 py-1 text-xs capitalize">
                          {constellation.status}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-text-muted">
                        {constellation.starCount} stars
                      </div>
                    </div>
                  ))}
              </div>
            ) : null}

            <Card
              padding="md"
              className="space-y-4 text-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="font-medium text-white">Background</div>
                  <p className="mt-1 text-xs text-text-muted">
                    Show a constellation behind the app.
                  </p>
                </div>

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
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={backgroundConstellationId}
                  onChange={(event) => {
                    const nextId = event.target.value;
                    setBackgroundConstellationId(nextId);
                    setConstellationBackgroundConstellationId(nextId);
                  }}
                  className="max-w-[14rem] truncate rounded-[1.7rem] border border-border bg-surface-panel py-3 pr-8 pl-4 text-sm text-white appearance-none bg-[length:1rem] bg-[position:right_0.6rem_center] bg-no-repeat"
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
                      {constellation.name} ({constellation.status})
                    </option>
                  ))}
                </select>

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

            {allStars.length > 0 ? (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => setStarsExpanded((prev) => !prev)}
                  className="mb-2 flex w-full items-center justify-between rounded-[1.7rem] border border-warm-border bg-warm-glow p-4 text-sm font-semibold transition duration-fast hover:bg-glass-medium active:scale-[0.98]"
                >
                  <span>Earned Stars ({allStars.length})</span>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`h-4 w-4 transition-transform duration-fast ${
                      starsExpanded ? "rotate-180" : ""
                    }`}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                {starsExpanded ? (
                  <div className="grid gap-3 animate-fade-in lg:grid-cols-2">
                    {allStars.map((star) => (
                      <div key={star.id} className="app-panel p-4 text-sm">
                        <div className="flex items-center gap-3">
                          <div
                            className="h-3 w-3 rounded-full"
                            style={{
                              backgroundColor: star.color,
                              boxShadow: `0 0 6px ${star.color}`,
                            }}
                          />
                          <span className="text-text-secondary">Earned star</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </AppPage>
    </Refreshable>
  );
}
