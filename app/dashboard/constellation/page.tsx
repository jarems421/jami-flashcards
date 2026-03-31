"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { useUser } from "@/lib/user-context";
import { db } from "@/services/firebase";
import {
  buildConstellationProgressMap,
  getActiveConstellation,
  getFallbackConstellation,
  type Constellation,
  type ConstellationProgress,
} from "@/lib/constellations";
import {
  createConstellation,
  ensureConstellationSetup,
  finishConstellation,
} from "@/services/constellations";
import type { DustParticle } from "@/lib/dust";
import { normalizeDust } from "@/lib/dust";
import {
  setConstellationBackgroundConstellationId,
  setConstellationBackgroundEnabled,
  readConstellationBackgroundEnabled,
  readConstellationBackgroundConstellationId,
} from "@/lib/constellation-background";
import {
  parseStarData,
  spreadBackfilledStars,
  type NormalizedStar,
} from "@/lib/stars";
import { backfillStarPositions, saveStarPosition } from "@/services/stars";
import ConstellationDust from "@/components/ConstellationDust";
import ConstellationStar from "@/components/constellation-star";
import Refreshable, { RefreshIconButton } from "@/components/Refreshable";

function clampPercentage(value: number) {
  return Math.max(0, Math.min(100, value));
}

type Feedback = { type: "success" | "error"; message: string };

export default function ConstellationDashboardPage() {
  const { user, refreshKey } = useUser();

  const [constellations, setConstellations] = useState<Constellation[]>([]);
  const [constellationProgress, setConstellationProgress] = useState<
    Record<string, ConstellationProgress>
  >({});
  const [allStars, setAllStars] = useState<NormalizedStar[]>([]);
  const [allDustParticles, setAllDustParticles] = useState<DustParticle[]>([]);
  const [selectedConstellationId, setSelectedConstellationId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [draggingStarId, setDraggingStarId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [starsExpanded, setStarsExpanded] = useState(false);

  // Management state
  const [constellationName, setConstellationName] = useState("");
  const [isCreatingConstellation, setIsCreatingConstellation] = useState(false);
  const [isFinishingConstellation, setIsFinishingConstellation] = useState(false);
  const [isConstellationBackgroundEnabled, setIsConstellationBackgroundEnabled] =
    useState(false);
  const [backgroundConstellationId, setBackgroundConstellationId] = useState("");

  const lastForegroundRefreshAtRef = useRef(0);

  useEffect(() => {
    setIsConstellationBackgroundEnabled(readConstellationBackgroundEnabled());
    setBackgroundConstellationId(readConstellationBackgroundConstellationId());
  }, []);

  const loadAll = useCallback(async (uid: string) => {
    setIsLoading(true);
    try {
      const nextConstellations = await ensureConstellationSetup(uid);
      const [starsSnapshot, dustSnapshot] = await Promise.all([
        getDocs(collection(db, "users", uid, "stars")),
        getDocs(collection(db, "users", uid, "dust")),
      ]);

      const normalizedStars = starsSnapshot.docs.map((starDoc) =>
        parseStarData(starDoc.id, starDoc.data() as Record<string, unknown>)
      );
      const adjustedStars = spreadBackfilledStars(normalizedStars).sort(
        (a, b) => b.createdAt - a.createdAt
      );
      const nextDustParticles = dustSnapshot.docs
        .map((dustDoc) =>
          normalizeDust(dustDoc.id, dustDoc.data() as Record<string, unknown>)
        )
        .sort((a, b) => a.createdAt - b.createdAt);

      const progressMap = buildConstellationProgressMap(
        nextConstellations.map((c) => c.id),
        adjustedStars,
        nextDustParticles
      );
      const fallback = getFallbackConstellation(nextConstellations);

      setConstellations(nextConstellations);
      setConstellationProgress(progressMap);
      setAllStars(adjustedStars);
      setAllDustParticles(nextDustParticles);
      setSelectedConstellationId((currentId) => {
        if (currentId && nextConstellations.some((c) => c.id === currentId)) {
          return currentId;
        }
        return fallback?.id ?? "";
      });

      if (adjustedStars.some((star) => star.needsBackfill)) {
        await backfillStarPositions(uid, adjustedStars);
        setAllStars((prev) =>
          prev.map((star) =>
            star.needsBackfill ? { ...star, needsBackfill: false } : star
          )
        );
      }
    } catch (e) {
      console.error(e);
      setConstellations([]);
      setConstellationProgress({});
      setAllStars([]);
      setAllDustParticles([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

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

  // ── Derived state ──
  const selectedConstellation = useMemo(
    () =>
      constellations.find((c) => c.id === selectedConstellationId) ??
      getFallbackConstellation(constellations),
    [constellations, selectedConstellationId]
  );

  const activeConstellation = useMemo(
    () => getActiveConstellation(constellations),
    [constellations]
  );

  const selectedConstellationProg = selectedConstellation
    ? constellationProgress[selectedConstellation.id] ?? { starCount: 0, dustCount: 0 }
    : null;

  const activeConstellationProg = activeConstellation
    ? constellationProgress[activeConstellation.id] ?? { starCount: 0, dustCount: 0 }
    : null;

  const canFinishActiveConstellation =
    activeConstellation &&
    activeConstellationProg &&
    activeConstellationProg.dustCount >= activeConstellation.maxDust &&
    activeConstellationProg.starCount >= activeConstellation.maxStars;

  const visibleStars = useMemo(
    () =>
      selectedConstellation
        ? allStars.filter((s) => s.constellationId === selectedConstellation.id)
        : [],
    [allStars, selectedConstellation]
  );

  const visibleDustParticles = useMemo(
    () =>
      selectedConstellation
        ? allDustParticles.filter(
            (p) => p.constellationId === selectedConstellation.id
          )
        : [],
    [allDustParticles, selectedConstellation]
  );

  const canEditSelectedConstellation =
    selectedConstellation?.status === "active";

  // ── Drag handling ──
  const dragPositionRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!draggingStarId || !canEditSelectedConstellation) return;

    const container = document.getElementById("constellation-container");
    if (!container) return;

    const handleMouseMove = (event: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const x = clampPercentage(
        ((event.clientX - rect.left) / rect.width) * 100
      );
      const y = clampPercentage(
        ((event.clientY - rect.top) / rect.height) * 100
      );
      dragPositionRef.current = { x, y };
      setAllStars((prev) =>
        prev.map((star) =>
          star.id === draggingStarId ? { ...star, position: { x, y } } : star
        )
      );
    };

    const handleTouchMove = (event: TouchEvent) => {
      event.preventDefault();
      const touch = event.touches[0];
      const rect = container.getBoundingClientRect();
      const x = clampPercentage(
        ((touch.clientX - rect.left) / rect.width) * 100
      );
      const y = clampPercentage(
        ((touch.clientY - rect.top) / rect.height) * 100
      );
      dragPositionRef.current = { x, y };
      setAllStars((prev) =>
        prev.map((star) =>
          star.id === draggingStarId ? { ...star, position: { x, y } } : star
        )
      );
    };

    const handleEnd = () => {
      const position = dragPositionRef.current;
      setDraggingStarId(null);
      dragPositionRef.current = null;
      if (!position) return;
      void saveStarPosition(user.uid, draggingStarId, position);
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

  // ── Handlers ──
  const handleCreateConstellation = async () => {
    const trimmed = constellationName.trim();
    if (!trimmed) return;

    setIsCreatingConstellation(true);
    setFeedback(null);

    try {
      await createConstellation(user.uid, trimmed);
      setConstellationName("");
      await loadAll(user.uid);
      setFeedback({ type: "success", message: `Created constellation ${trimmed}.` });
    } catch (e) {
      console.error(e);
      const message = e instanceof Error ? e.message : "Failed to create constellation.";
      setFeedback({ type: "error", message });
    } finally {
      setIsCreatingConstellation(false);
    }
  };

  const handleFinishConstellation = async () => {
    if (!activeConstellation || !canFinishActiveConstellation) return;

    setIsFinishingConstellation(true);
    setFeedback(null);

    try {
      await finishConstellation(user.uid, activeConstellation.id);
      await loadAll(user.uid);
      setFeedback({
        type: "success",
        message: `${activeConstellation.name} is now finished.`,
      });
    } catch (e) {
      console.error(e);
      setFeedback({ type: "error", message: "Failed to finish constellation." });
    } finally {
      setIsFinishingConstellation(false);
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
          <h1 className="text-xl font-bold">Constellation</h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!selectedConstellation}
              onClick={() => {
                if (!selectedConstellation) return;
                setConstellationBackgroundEnabled(true);
                setConstellationBackgroundConstellationId(selectedConstellation.id);
              }}
              className="rounded-md bg-glass-medium px-3 py-2 text-sm hover:bg-glass-strong active:scale-[0.97] disabled:opacity-50"
            >
              Use as BG
            </button>
            <RefreshIconButton refreshing={refreshing} onClick={() => void handleRefresh()} />
          </div>
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

        {/* ── Management: Active constellation card ── */}
        {!isLoading ? (
          activeConstellation ? (
            <div
              className="mb-4 rounded-xl border border-warm-border p-3 sm:p-4"
              style={{ backgroundImage: "var(--gradient-card)" }}
            >
              <div className="mb-3 flex items-start justify-between gap-4">
                <div>
                  <div className="font-medium">{activeConstellation.name}</div>
                  <div className="mt-1 text-sm text-text-muted">Active</div>
                </div>
                <button
                  type="button"
                  disabled={!canFinishActiveConstellation || isFinishingConstellation}
                  onClick={() => void handleFinishConstellation()}
                  className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium active:scale-[0.97] disabled:opacity-50"
                >
                  {isFinishingConstellation ? "Finishing…" : "Finish"}
                </button>
              </div>

              {/* Progress bars */}
              <div className="space-y-2">
                <div>
                  <div className="mb-1 flex justify-between text-xs text-text-muted">
                    <span>Dust</span>
                    <span>
                      {activeConstellationProg?.dustCount ?? 0} / {activeConstellation.maxDust}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-glass-medium">
                    <div
                      className="h-2 rounded-full bg-accent transition-all duration-slow"
                      style={{
                        width: `${Math.min(100, ((activeConstellationProg?.dustCount ?? 0) / activeConstellation.maxDust) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-xs text-text-muted">
                    <span>Stars</span>
                    <span>
                      {activeConstellationProg?.starCount ?? 0} / {activeConstellation.maxStars}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-glass-medium">
                    <div
                      className="h-2 rounded-full bg-success transition-all duration-slow"
                      style={{
                        width: `${Math.min(100, ((activeConstellationProg?.starCount ?? 0) / activeConstellation.maxStars) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              </div>

              {!canFinishActiveConstellation ? (
                <p className="mt-3 text-xs text-text-muted">
                  Collect enough dust and stars to finish this constellation.
                </p>
              ) : null}
            </div>
          ) : (
            <div
              className="mb-4 rounded-xl border border-warm-border bg-warm-glow p-3 sm:p-4"
              style={{ backgroundImage: "var(--gradient-card)" }}
            >
              <p className="mb-3 text-sm text-text-secondary">
                No active constellation. Create one to start collecting stars and dust.
              </p>
              <div className="flex gap-2">
                <input
                  placeholder="Constellation name"
                  value={constellationName}
                  onChange={(e) => setConstellationName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleCreateConstellation();
                  }}
                  className="w-full max-w-xs rounded-md border border-border bg-glass-medium px-3 py-2 text-sm text-white placeholder:text-text-muted outline-none transition duration-fast focus:border-accent focus:ring-2 focus:ring-warm-accent/20"
                />
                <button
                  disabled={isCreatingConstellation || !!activeConstellation || !constellationName.trim()}
                  onClick={() => void handleCreateConstellation()}
                  className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition duration-fast hover:bg-accent-hover active:scale-[0.97] disabled:opacity-50"
                >
                  {isCreatingConstellation ? "Creating…" : "Create"}
                </button>
              </div>
            </div>
          )
        ) : null}

        {/* ── Constellation viewer ── */}
        {isLoading ? (
          <div className="text-sm text-text-muted">Loading constellation…</div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
              <select
                value={selectedConstellation?.id ?? ""}
                onChange={(e) => setSelectedConstellationId(e.target.value)}
                className="rounded-md border border-border bg-glass-medium px-3 py-2 text-white"
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
                    Dust: {selectedConstellationProg?.dustCount ?? 0} /{" "}
                    {selectedConstellation.maxDust}
                  </div>
                  <div>
                    Stars: {selectedConstellationProg?.starCount ?? 0} /{" "}
                    {selectedConstellation.maxStars}
                  </div>
                  {!canEditSelectedConstellation ? (
                    <div className="text-text-muted">
                      Finished constellations are view-only.
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>

            <div
              id="constellation-container"
              className="relative mb-4 h-[60vh] w-full select-none overflow-hidden rounded-xl border border-white/[0.07] bg-surface-base sm:h-[500px]"
              style={{
                backgroundImage: `
                  radial-gradient(circle at 20% 20%, rgba(88, 164, 255, 0.16), transparent 30%),
                  radial-gradient(circle at 80% 30%, rgba(120, 220, 255, 0.1), transparent 28%),
                  radial-gradient(circle at 50% 80%, rgba(120, 180, 255, 0.08), transparent 32%)
                `,
                backgroundSize: "auto",
                backgroundPosition: "center",
              }}
            >
              <ConstellationDust
                particles={visibleDustParticles}
                constellationId={selectedConstellation?.id}
                status={selectedConstellation?.status}
                maxDust={selectedConstellation?.maxDust}
                mode="page"
                className="z-0"
              />
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

            {/* Constellation history */}
            {constellations.length > 1 ||
            (constellations.length === 1 && !activeConstellation) ? (
              <div className="mb-4 grid gap-2.5 sm:gap-3">
                {constellations
                  .filter((c) => c.id !== activeConstellation?.id)
                  .map((constellation) => {
                    const progress = constellationProgress[constellation.id] ?? {
                      starCount: 0,
                      dustCount: 0,
                    };
                    return (
                      <div
                        key={constellation.id}
                        className="rounded-xl border border-white/[0.07] p-2.5 text-sm sm:p-3"
                        style={{ backgroundImage: "var(--gradient-card)" }}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{constellation.name}</span>
                          <span className="rounded-md bg-glass-medium px-2 py-0.5 text-xs capitalize">
                            {constellation.status}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-text-muted">
                          {progress.dustCount} dust · {progress.starCount} stars
                        </div>
                      </div>
                    );
                  })}
              </div>
            ) : null}

            {/* Background toggle */}
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-2 text-text-secondary">
                <input
                  type="checkbox"
                  checked={isConstellationBackgroundEnabled}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    setIsConstellationBackgroundEnabled(enabled);
                    setConstellationBackgroundEnabled(enabled);
                  }}
                  className="h-4 w-4 accent-accent"
                />
                <span>Constellation background</span>
              </label>

              <select
                value={backgroundConstellationId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setBackgroundConstellationId(nextId);
                  setConstellationBackgroundConstellationId(nextId);
                }}
                className="rounded-md border border-border bg-glass-medium px-3 py-1.5 text-sm text-white"
              >
                <option value="" className="text-black">
                  Active or latest
                </option>
                {constellations.map((c) => (
                  <option key={c.id} value={c.id} className="text-black">
                    {c.name} ({c.status})
                  </option>
                ))}
              </select>
            </div>

            {/* ── Earned Stars (collapsible) ── */}
            {allStars.length > 0 ? (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => setStarsExpanded((prev) => !prev)}
                  className="mb-2 flex w-full items-center justify-between rounded-xl border border-warm-border bg-warm-glow p-3 text-sm font-semibold transition duration-fast hover:bg-glass-medium active:scale-[0.98]"
                >
                  <span>Earned Stars ({allStars.length})</span>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`h-4 w-4 transition-transform duration-fast ${starsExpanded ? "rotate-180" : ""}`}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                {starsExpanded ? (
                  <div className="grid gap-2 animate-fade-in">
                    {allStars.map((star) => (
                      <div
                        key={star.id}
                        className="rounded-xl border border-border bg-glass-subtle p-2.5 text-sm"
                        style={{ backgroundImage: "var(--gradient-card)" }}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className="h-3 w-3 rounded-full"
                            style={{
                              backgroundColor: star.color,
                              boxShadow: `0 0 6px ${star.color}`,
                            }}
                          />
                          <span className="text-text-secondary">
                            Size {star.size.toFixed(2)} · Glow{" "}
                            {Math.round(star.glow * 100)}%
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )}
        </div>
      </main>
    </Refreshable>
  );
}
