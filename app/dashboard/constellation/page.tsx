"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUser } from "@/components/providers/UserProvider";
import { useFeedback } from "@/hooks/useFeedback";
import {
  getActiveConstellation,
  getFallbackConstellation,
  isConstellationReadyToFinish,
  toggleConstellationLine,
  type Constellation,
  type ConstellationLine,
} from "@/lib/constellation/constellations";
import {
  createConstellation,
  ensureConstellationSetup,
  finishConstellation,
  renameConstellation,
  saveConstellationLines,
} from "@/services/constellation/constellations";
import {
  getConstellationBackgroundActionLabel,
  readConstellationBackgroundConstellationId,
  readConstellationBackgroundEnabled,
  setConstellationBackgroundConstellationId,
  setConstellationBackgroundEnabled,
} from "@/lib/constellation/background";
import { useDashboardData } from "@/hooks/useDashboardData";
import {
  clampPercentage,
  spreadBackfilledStars,
  type NormalizedStar,
} from "@/lib/constellation/stars";
import type { Goal } from "@/lib/study/goals";
import {
  backfillStarPositions,
  getStars,
  saveStarPosition,
} from "@/services/constellation/stars";
import { getGoals } from "@/services/study/goals";
import AppPage from "@/components/layout/AppPage";
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  FeedbackBanner,
  Input,
  PageHero,
  SectionHeader,
  Skeleton,
} from "@/components/ui";
import ConstellationStar from "@/components/constellation/ConstellationStar";
import ConstellationLines from "@/components/constellation/ConstellationLines";
import Refreshable, { RefreshIconButton } from "@/components/layout/Refreshable";

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
  const [draggingStarId, setDraggingStarId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const {
    feedback,
    success,
    showError,
    showThrownError,
    clear: clearFeedback,
  } = useFeedback();
  const [constellationName, setConstellationName] = useState("");
  const [isCreatingConstellation, setIsCreatingConstellation] = useState(false);
  const [isFinishingConstellation, setIsFinishingConstellation] = useState(false);
  const [renamingConstellationId, setRenamingConstellationId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [isConstellationBackgroundEnabled, setIsConstellationBackgroundEnabled] =
    useState(false);
  const [backgroundConstellationId, setBackgroundConstellationId] = useState("");

  const lastForegroundRefreshAtRef = useRef(0);
  /*
   * One gesture, two meanings, so the sky has a mode.
   *
   * Dragging a star already moves it, and dragging from a star to another star
   * is the natural way to join them -- the same gesture cannot be both. A
   * visible toggle is the honest way to resolve that: at any moment a drag does
   * exactly one thing and the button says which.
   */
  const [skyMode, setSkyMode] = useState<"arrange" | "connect">("arrange");
  const [linkFromStarId, setLinkFromStarId] = useState<string | null>(null);
  // Clearing every line is one click away from a pattern someone built by
  // hand, so the button asks once before it does it.
  const [isConfirmingClearLines, setIsConfirmingClearLines] = useState(false);
  const [lineRedoHistory, setLineRedoHistory] = useState<{
    constellationId: string;
    lines: ConstellationLine[];
  }>({ constellationId: "", lines: [] });
  const [linkPoint, setLinkPoint] = useState<{ x: number; y: number } | null>(null);
  /**
   * The star the half-drawn line is currently over.
   *
   * Tracked during the drag rather than only read on release, so the line can
   * snap to it and the star can light up. Dropping a line used to be aimed
   * blind: nothing on screen said whether letting go would join anything.
   */
  const [linkHoverStarId, setLinkHoverStarId] = useState<string | null>(null);
  /**
   * Whether the press now in progress already settled what it meant.
   *
   * Pressing a second star finishes the line there and then, so the release
   * that follows has nothing left to do -- and would otherwise draw the same
   * line a second time, which is how a line is taken back. The release reads
   * this and stands down.
   */
  const linkPressResolvedRef = useRef(false);
  /**
   * Whether a finger is currently on a star.
   *
   * A ref rather than state, and read by a listener that is attached for the
   * life of the page, because the ordering is what the whole bug was: both
   * touch blockers used to be attached inside effects keyed on the drag state,
   * so `pointerdown` set state, React scheduled a render, and the first
   * `touchmove` arrived before the listener existed. iOS decides on that first
   * move whether a gesture scrolls the page, and once it has decided, no
   * `touch-action` and no later `preventDefault` takes it back -- which is why
   * dragging a star up, or reaching down to the star below it, took the page
   * with it.
   */
  const starGestureRef = useRef(false);
  const dragPositionRef = useRef<{ x: number; y: number } | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setIsConstellationBackgroundEnabled(readConstellationBackgroundEnabled());
    setBackgroundConstellationId(readConstellationBackgroundConstellationId());
  }, []);

  useEffect(() => {
    if (renamingConstellationId) {
      renameInputRef.current?.focus();
    }
  }, [renamingConstellationId]);

  const loadConstellationData = useCallback(async () => {
    const nextConstellations = await ensureConstellationSetup(user.uid);
    const [stars, goals] = await Promise.all([
      getStars(user.uid),
      getGoals(user.uid),
    ]);
    let adjustedStars = spreadBackfilledStars(stars).sort(
      (left, right) => right.createdAt - left.createdAt
    );

    if (adjustedStars.some((star) => star.needsBackfill)) {
      await backfillStarPositions(user.uid, adjustedStars);
      adjustedStars = adjustedStars.map((star) =>
        star.needsBackfill ? { ...star, needsBackfill: false } : star
      );
    }

    return {
      constellations: nextConstellations,
      stars: adjustedStars,
      goalsById: Object.fromEntries(goals.map((goal) => [goal.id, goal])),
      fallbackConstellationId:
        getFallbackConstellation(nextConstellations)?.id ?? "",
    };
  }, [user.uid]);

  const applyConstellationData = useCallback(
    (data: Awaited<ReturnType<typeof loadConstellationData>>) => {
      setConstellations(data.constellations);
      setAllStars(data.stars);
      setGoalsById(data.goalsById);
      setSelectedConstellationId((currentId) => {
        if (
          currentId &&
          data.constellations.some(
            (constellation) => constellation.id === currentId
          )
        ) {
          return currentId;
        }

        return data.fallbackConstellationId;
      });
    },
    []
  );

  const handleConstellationLoadError = useCallback((error: unknown) => {
    console.error(error);
    setConstellations([]);
    setAllStars([]);
    setGoalsById({});
    setSelectedConstellationId("");
    showError("Failed to load your constellation.");
  }, [showError]);

  const { loading: isLoading, reload: loadAll } = useDashboardData({
    requestKey: user.uid,
    load: loadConstellationData,
    apply: applyConstellationData,
    onError: handleConstellationLoadError,
  });

  useEffect(() => {
    const handleFocus = () => {
      const now = Date.now();
      if (
        document.visibilityState !== "hidden" &&
        now - lastForegroundRefreshAtRef.current > 15_000
      ) {
        lastForegroundRefreshAtRef.current = now;
        void loadAll();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
    };
  }, [loadAll]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    clearFeedback();
    try {
      await loadAll();
    } finally {
      setRefreshing(false);
    }
  }, [clearFeedback, loadAll]);

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
  /*
   * Finishing a sky seals what is in it, not how it is arranged.
   *
   * One flag used to mean both, so finishing a constellation turned it "View
   * only" and the student lost the ability to move stars they had placed. Those
   * are different things: a finished sky takes no new stars -- that is what
   * finishing is for, and the next one starts collecting them -- but where each
   * star sits is personalisation, and there is no reason for it to expire. The
   * arrangement is also the part someone is most likely to want to revisit,
   * because a finished sky is the one they will actually keep looking at.
   */
  const canArrangeSelectedConstellation = Boolean(selectedConstellation);
  const isConnecting = skyMode === "connect";
  const selectedLines = selectedConstellation?.lines ?? [];
  const redoLines = useMemo(
    () =>
      selectedConstellation?.id === lineRedoHistory.constellationId
        ? lineRedoHistory.lines
        : [],
    [lineRedoHistory, selectedConstellation?.id]
  );

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

  /*
   * The page does not move while a star is being handled.
   *
   * Attached once, for the life of the page, and non-passive so that
   * `preventDefault` actually counts. It only ever refuses the scroll -- the
   * position updates stay in the drag effects below, where they can see the
   * state they need.
   */
  useEffect(() => {
    const container = document.getElementById("constellation-container");
    if (!container) return;

    const refuseScroll = (event: TouchEvent) => {
      if (starGestureRef.current) event.preventDefault();
    };

    // Released anywhere -- on a star, on empty sky, off the page entirely.
    const endGesture = () => { starGestureRef.current = false; };

    container.addEventListener("touchmove", refuseScroll, { passive: false });
    window.addEventListener("pointerup", endGesture);
    window.addEventListener("pointercancel", endGesture);
    window.addEventListener("touchend", endGesture);
    window.addEventListener("touchcancel", endGesture);

    return () => {
      container.removeEventListener("touchmove", refuseScroll);
      window.removeEventListener("pointerup", endGesture);
      window.removeEventListener("pointercancel", endGesture);
      window.removeEventListener("touchend", endGesture);
      window.removeEventListener("touchcancel", endGesture);
    };
  }, []);

  useEffect(() => {
    if (!draggingStarId || !canArrangeSelectedConstellation) {
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
  }, [canArrangeSelectedConstellation, draggingStarId, user.uid]);

  /**
   * Joins two stars, or unjoins them if a line is already there.
   *
   * Writes the whole array rather than a single edge: there are at most 120 of
   * them in one document, and a read-modify-write of the array is what keeps
   * "draw the same line twice to remove it" a single, obvious operation.
   */
  /**
   * The one path every line change goes through: drawing, undo and clear all.
   *
   * They differ only in which array they hand over, so sharing the write keeps
   * the optimistic update, the save and the error handling identical for all
   * three. Bailing when the array is unchanged means a no-op never costs a
   * write.
   */
  const applyLines = useCallback(
    (next: ConstellationLine[]) => {
      const constellation = selectedConstellation;
      if (!constellation || next === constellation.lines) return;

      setConstellations((current) =>
        current.map((entry) =>
          entry.id === constellation.id ? { ...entry, lines: next } : entry
        )
      );
      void saveConstellationLines(user.uid, constellation.id, next).catch(
        (error: unknown) => {
          console.error("Failed to save constellation lines.", error);
          showError("Failed to save your constellation lines.");
        }
      );
    },
    [selectedConstellation, showError, user.uid]
  );

  const handleToggleLine = useCallback(
    (starA: string, starB: string) => {
      if (!selectedConstellation) return;
      setLineRedoHistory({ constellationId: "", lines: [] });
      applyLines(
        toggleConstellationLine(selectedConstellation.lines, starA, starB)
      );
    },
    [applyLines, selectedConstellation]
  );

  const handleUndoLine = useCallback(() => {
    const lastLine = selectedConstellation?.lines.at(-1);
    if (!selectedConstellation || !lastLine) return;

    setLineRedoHistory((current) => ({
      constellationId: selectedConstellation.id,
      lines:
        current.constellationId === selectedConstellation.id
          ? [...current.lines, lastLine]
          : [lastLine],
    }));
    applyLines(selectedConstellation.lines.slice(0, -1));
  }, [applyLines, selectedConstellation]);

  const handleRedoLine = useCallback(() => {
    const restoredLine = redoLines.at(-1);
    if (!selectedConstellation || !restoredLine) return;

    applyLines([...selectedConstellation.lines, restoredLine]);
    setLineRedoHistory((current) => ({
      constellationId: selectedConstellation.id,
      lines: current.lines.slice(0, -1),
    }));
  }, [applyLines, redoLines, selectedConstellation]);

  const handleClearLines = useCallback(() => {
    if (!selectedConstellation?.lines.length) return;
    applyLines([]);
    setLineRedoHistory({ constellationId: "", lines: [] });
    setIsConfirmingClearLines(false);
  }, [applyLines, selectedConstellation]);

  /*
   * Stable, because the drawn figure is memoised on it. An arrow function
   * written inline here would be a new value on every pointer move and would
   * rebuild every line in the sky mid-drag.
   */
  const handleRemoveLine = useCallback(
    (line: ConstellationLine) => handleToggleLine(line.a, line.b),
    [handleToggleLine]
  );

  /**
   * A press on a star in Connect mode.
   *
   * With nothing picked it picks this star, and the gesture carries on -- the
   * drag from here to another star is still the fast way to draw a line. With
   * something already picked, the press is the second half of a tap-and-tap:
   * another star joins the two, and the same star lets go of it. Both finish
   * here rather than waiting for the release, because a tap has no meaningful
   * release position and the hint has always said to choose a second star.
   */
  const beginOrFinishLink = useCallback(
    (star: NormalizedStar) => {
      if (!linkFromStarId) {
        linkPressResolvedRef.current = false;
        setLinkFromStarId(star.id);
        setLinkPoint(star.position);
        return;
      }

      linkPressResolvedRef.current = true;
      if (linkFromStarId !== star.id) {
        handleToggleLine(linkFromStarId, star.id);
      }
      setLinkFromStarId(null);
      setLinkPoint(null);
      setLinkHoverStarId(null);
    },
    [handleToggleLine, linkFromStarId]
  );

  useEffect(() => {
    if (!linkFromStarId) {
      return;
    }

    const container = document.getElementById("constellation-container");
    if (!container) {
      return;
    }

    const trackTo = (clientX: number, clientY: number) => {
      const rect = container.getBoundingClientRect();
      setLinkPoint({
        x: clampPercentage(((clientX - rect.left) / rect.width) * 100),
        y: clampPercentage(((clientY - rect.top) / rect.height) * 100),
      });
    };

    /*
     * Which star is under the pointer, asked of the document rather than
     * tracked with enter and leave handlers.
     *
     * A pointer that is down is captured, so the stars underneath it never
     * receive an enter event -- the only reliable way to know what is beneath
     * the finger is to ask the document directly. It is one hit test per move,
     * which is what buys the snap.
     */
    const starUnder = (clientX: number, clientY: number) => {
      const element = document
        .elementFromPoint(clientX, clientY)
        ?.closest<HTMLElement>("[data-star-id]");

      return element?.dataset.starId ?? null;
    };

    const handleMove = (event: PointerEvent) => {
      trackTo(event.clientX, event.clientY);
      const under = starUnder(event.clientX, event.clientY);
      setLinkHoverStarId(under === linkFromStarId ? null : under);
    };

    /*
     * Safari decides whether a gesture scrolls the page on its first move, and
     * the sky's `touch-action` is what tells it not to. This is the second lock
     * on the same door, for the case where the finger has already left the sky.
     */
    const blockTouchScroll = (event: TouchEvent) => {
      event.preventDefault();
    };

    const clearPick = () => {
      setLinkFromStarId(null);
      setLinkPoint(null);
      setLinkHoverStarId(null);
    };

    /*
     * Where the press ended decides what it meant.
     *
     * Landing on another star joins the two: that is the drag. Ending on the
     * star it began from leaves it picked, so a second star can be tapped
     * instead of dragged to. Ending on empty sky lets go of it -- a pick used
     * to survive that, so the only way out of one was to find another star, and
     * a half-drawn line followed the pointer around with no way to put it down.
     */
    const handleEnd = (event: PointerEvent) => {
      if (linkPressResolvedRef.current) {
        linkPressResolvedRef.current = false;
        return;
      }

      const releasedOn = starUnder(event.clientX, event.clientY);

      if (releasedOn && releasedOn !== linkFromStarId) {
        handleToggleLine(linkFromStarId, releasedOn);
        clearPick();
        return;
      }

      if (releasedOn === linkFromStarId) {
        setLinkPoint(null);
        setLinkHoverStarId(null);
        return;
      }

      clearPick();
    };

    const handleCancelKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setLinkFromStarId(null);
      setLinkPoint(null);
      setLinkHoverStarId(null);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleEnd);
    window.addEventListener("pointercancel", handleEnd);
    window.addEventListener("keydown", handleCancelKey);
    window.addEventListener("touchmove", blockTouchScroll, { passive: false });

    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
      window.removeEventListener("pointercancel", handleEnd);
      window.removeEventListener("keydown", handleCancelKey);
      window.removeEventListener("touchmove", blockTouchScroll);
    };
  }, [handleToggleLine, linkFromStarId]);

  // Leaving Connect mode drops any half-drawn line with it.
  useEffect(() => {
    if (isConnecting) return;
    setLinkFromStarId(null);
    setLinkPoint(null);
    setLinkHoverStarId(null);
    setIsConfirmingClearLines(false);
  }, [isConnecting]);

  const handleKeyboardStarMove = useCallback(
    (starId: string, position: NormalizedStar["position"]) => {
      setAllStars((current) =>
        current.map((star) =>
          star.id === starId ? { ...star, position } : star
        )
      );
      void saveStarPosition(user.uid, starId, position).catch((error) => {
        console.error(error);
        showError("Could not save that star position.");
      });
    },
    [showError, user.uid]
  );

  const handleCreateConstellation = async () => {
    const trimmedName = constellationName.trim();
    if (!trimmedName) {
      return;
    }

    setIsCreatingConstellation(true);
    clearFeedback();

    try {
      await createConstellation(user.uid, trimmedName);
      setConstellationName("");
      await loadAll();
      success(`Created constellation ${trimmedName}.`);
    } catch (error) {
      console.error(error);
      showThrownError(error, "Failed to create constellation.");
    } finally {
      setIsCreatingConstellation(false);
    }
  };

  const handleFinishConstellation = async () => {
    if (!activeConstellation || !canFinishActiveConstellation) {
      return;
    }

    setIsFinishingConstellation(true);
    clearFeedback();

    try {
      await finishConstellation(user.uid, activeConstellation.id);
      await loadAll();
      success(`${activeConstellation.name} is now finished.`);
    } catch (error) {
      console.error(error);
      showError("Failed to finish constellation.");
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
      showThrownError(error, "Failed to rename constellation.");
    }
  };

  const cancelRename = () => {
    setRenamingConstellationId(null);
    setRenameValue("");
  };

  const skyModes = [
    {
      id: "arrange" as const,
      label: "Move",
      hint: "Drag a star to move it. Arrow keys nudge a focused star.",
      icon: "M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3",
    },
    {
      id: "connect" as const,
      label: "Connect",
      hint: "Drag from one star to another to join them. Draw the same line again, or tap it, to remove it.",
      icon: "M6 18 18 6M6 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
    },
  ];
  const activeSkyMode =
    skyModes.find((mode) => mode.id === skyMode) ?? skyModes[0];
  const pastConstellations = constellations.filter(
    (constellation) => constellation.id !== activeConstellation?.id
  );
  const renameField = (widthClassName: string) => (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        ref={renameInputRef}
        value={renameValue}
        onChange={(event) => setRenameValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void handleRename();
          if (event.key === "Escape") cancelRename();
        }}
        containerClassName={widthClassName}
      />
      <Button
        size="sm"
        onClick={() => void handleRename()}
        disabled={!renameValue.trim()}
      >
        Save
      </Button>
      <Button size="sm" variant="ghost" onClick={cancelRename}>
        Cancel
      </Button>
    </div>
  );

  return (
    <Refreshable onRefresh={handleRefresh}>
      <AppPage
        title="Stars"
        backHref="/dashboard"
        backLabel="Today"
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
          <FeedbackBanner
            type={feedback.type}
            message={feedback.message}
            onDismiss={() => clearFeedback()}
          />
        ) : null}

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-28" />
            <Skeleton className="h-[32rem]" />
            <Skeleton className="h-36" />
          </div>
        ) : (
          <>
            {/*
             * The lifecycle, said once, at the top.
             *
             * A sky holds forty stars and only one is ever active -- the
             * service refuses to create a second and always has. That rule was
             * enforced and never explained, so "why can I not make a new
             * constellation" had no answer anywhere on the page. It is the
             * first thing said now.
             */}
            <PageHero
              compact
              eyebrow="Goal rewards"
              title="Your stars"
              description={
                <p>
                  Finishing a goal earns a star. Forty stars fill a sky; finish
                  that sky to keep it as a record, and the next one starts
                  collecting.
                </p>
              }
            />

            {activeConstellation ? null : (
              <Card tone="warm" padding="md">
                <SectionHeader
                  eyebrow={
                    constellations.length ? "Every sky finished" : "Reward space"
                  }
                  title={
                    constellations.length
                      ? "Start your next sky"
                      : "Create your first sky"
                  }
                  description={
                    constellations.length
                      ? "Nothing is collecting stars at the moment. Name the next sky and the stars from your next goals will land in it."
                      : "Stars from completed goals need somewhere to live. Make a sky now and let rewards fill it over time."
                  }
                />
                <div className="mt-4 flex flex-wrap gap-3">
                  <Input
                    placeholder="Sky name"
                    value={constellationName}
                    onChange={(event) =>
                      setConstellationName(event.target.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void handleCreateConstellation();
                      }
                    }}
                    containerClassName="w-full max-w-xs"
                  />
                  <Button
                    type="button"
                    disabled={
                      isCreatingConstellation || !constellationName.trim()
                    }
                    onClick={() => void handleCreateConstellation()}
                  >
                    {isCreatingConstellation ? "Creating..." : "Create sky"}
                  </Button>
                </div>
              </Card>
            )}

            {selectedConstellation ? (
              <Card padding="md" className="space-y-4">
                {/* Which sky, and whether it is the one collecting stars. */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    {renamingConstellationId === selectedConstellation.id ? (
                      renameField("w-full max-w-xs")
                    ) : (
                      <button
                        type="button"
                        className="group flex min-w-0 items-center gap-2 text-left"
                        onClick={() => startRename(selectedConstellation)}
                      >
                        <span className="truncate text-lg font-semibold text-text-primary">
                          {selectedConstellation.name}
                        </span>
                        <span
                          aria-hidden="true"
                          className="shrink-0 text-text-muted transition-colors group-hover:text-accent"
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                          </svg>
                        </span>
                        <span className="sr-only">Rename this sky</span>
                      </button>
                    )}
                    <p className="mt-1 text-xs text-text-muted">
                      {selectedConstellation.status === "active"
                        ? "Collecting stars now"
                        : "Finished - kept as a record"}
                      {" · "}
                      {selectedConstellation.starCount} of{" "}
                      {selectedConstellation.maxStars} stars
                    </p>
                  </div>

                  {constellations.length > 1 ? (
                    <label className="flex shrink-0 flex-col gap-1 text-2xs font-semibold uppercase tracking-[0.16em] text-text-muted sm:items-end">
                      Viewing
                      <span className="relative mt-1 block">
                        <select
                          value={selectedConstellation.id}
                          onChange={(event) =>
                            setSelectedConstellationId(event.target.value)
                          }
                          className="app-field w-full min-w-[12rem] appearance-none truncate rounded-2xl py-2.5 pl-4 pr-10 text-sm font-medium normal-case tracking-normal"
                        >
                          {constellations.map((constellation) => (
                            <option
                              key={constellation.id}
                              value={constellation.id}
                            >
                              {constellation.name}
                              {constellation.id === activeConstellation?.id
                                ? " (active)"
                                : ""}
                            </option>
                          ))}
                        </select>
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 20 20"
                          fill="none"
                          className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary"
                        >
                          <path
                            d="m6 8 4 4 4-4"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                    </label>
                  ) : null}
                </div>

                {/*
                 * The toolbar, which used to be one wrapping row holding the
                 * switcher, two chips, the mode toggle, a sentence of help and
                 * the background button. At most widths it wrapped into
                 * something that read as broken rather than as a toolbar. Two
                 * groups now, at opposite ends, and the help text has a line of
                 * its own so it can never push anything out of place.
                 */}
                <div className="app-subtle-panel flex flex-col gap-3 rounded-2xl p-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <div
                    role="group"
                    aria-label="What dragging a star does"
                    className="flex items-center gap-1 self-start rounded-full bg-glass-subtle p-1"
                  >
                    {skyModes.map((mode) => (
                      <button
                        key={mode.id}
                        type="button"
                        aria-pressed={skyMode === mode.id}
                        onClick={() => setSkyMode(mode.id)}
                        className={`flex min-h-[2.25rem] items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                          skyMode === mode.id
                            ? "bg-selected-bg text-selected-text"
                            : "text-text-muted hover:text-text-primary"
                        }`}
                      >
                        <svg
                          aria-hidden="true"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.9"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d={mode.icon} />
                        </svg>
                        {mode.label}
                      </button>
                    ))}
                  </div>

                  <Button
                    type="button"
                    size="sm"
                    variant={
                      isSelectedConstellationBackground ? "secondary" : "surface"
                    }
                    className="self-start sm:self-auto"
                    aria-pressed={isSelectedConstellationBackground}
                    onClick={handleToggleSelectedBackground}
                  >
                    {getConstellationBackgroundActionLabel(
                      isSelectedConstellationBackground
                    )}
                  </Button>
                </div>

                {/*
                  * The hint changes mid-gesture, so it holds its own height.
                  *
                  * On iPad the connect hint wrapped to two lines and the one
                  * that replaced it fitted on one, so touching a star pulled
                  * the entire sky up by a line and dropped it back on release
                  * -- the page moving under the finger, halfway through a drag.
                  * The longest wording is rendered invisibly underneath at
                  * whatever width the page is, which reserves exactly the right
                  * space without anyone having to guess a min-height.
                  */}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="relative min-w-0 flex-1 text-xs text-text-muted">
                    <span aria-hidden="true" className="invisible block">
                      {skyModes
                        .map((mode) => mode.hint)
                        .reduce((longest, hint) =>
                          hint.length > longest.length ? hint : longest
                        )}
                    </span>
                    <span className="absolute inset-0 block" aria-live="polite">
                      {isConnecting && linkFromStarId
                        ? linkHoverStarId
                          ? "Let go to join these two."
                          : "Now choose another star to join it to. Escape cancels."
                        : activeSkyMode.hint}
                    </span>
                  </div>

                  {isConnecting && (selectedLines.length || redoLines.length) ? (
                    <div
                      role="toolbar"
                      aria-label="Line editing"
                      className="flex shrink-0 items-center gap-1 rounded-full border border-border-subtle bg-glass-subtle p-1"
                    >
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="!size-9 rounded-full"
                        aria-label="Undo last line"
                        title="Undo"
                        disabled={!selectedLines.length}
                        onClick={handleUndoLine}
                      >
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 24 24"
                          fill="none"
                          className="size-4"
                          stroke="currentColor"
                          strokeWidth="1.9"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M9 7 4 12l5 5" />
                          <path d="M5 12h8a6 6 0 0 1 6 6" />
                        </svg>
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="!size-9 rounded-full"
                        aria-label="Restore last undone line"
                        title="Redo"
                        disabled={!redoLines.length}
                        onClick={handleRedoLine}
                      >
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 24 24"
                          fill="none"
                          className="size-4"
                          stroke="currentColor"
                          strokeWidth="1.9"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="m15 7 5 5-5 5" />
                          <path d="M19 12h-8a6 6 0 0 0-6 6" />
                        </svg>
                      </Button>
                      <span
                        aria-hidden="true"
                        className="mx-0.5 h-5 w-px bg-border-subtle"
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="!size-9 rounded-full text-danger-text hover:text-danger-text"
                        aria-label="Clear all lines"
                        title="Clear all lines"
                        disabled={!selectedLines.length}
                        onClick={() => setIsConfirmingClearLines(true)}
                      >
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 24 24"
                          fill="none"
                          className="size-4"
                          stroke="currentColor"
                          strokeWidth="1.9"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M4 7h16" />
                          <path d="M9 7V4h6v3" />
                          <path d="m6.5 7 1 13h9l1-13" />
                          <path d="M10 11v5M14 11v5" />
                        </svg>
                      </Button>
                    </div>
                  ) : null}
                </div>

                <div
                  id="constellation-container"
                  /*
                    * The sky takes the whole gesture from a tablet upwards.
                    *
                    * Arranging and connecting are both direct manipulation, and
                    * a drag that starts anywhere in here is meant for a star --
                    * so nothing in it should ever be read as a page scroll. A
                    * press that misses a star used to scroll the page instead,
                    * which is the whole complaint about the screen moving.
                    *
                    * This applies at every width. The rest of the page remains
                    * scrollable around the sky, but once a gesture begins in
                    * this canvas it belongs to arranging or connecting stars.
                    */
                  className="relative h-[60vh] w-full touch-none select-none overflow-hidden overscroll-contain rounded-2xl border border-[var(--color-border)] bg-surface-base sm:h-[560px]"
                  style={{
                    /*
                     * Night, and nothing else. Two wide violet washes were
                     * painted here to carry the ambient half of the glow, and
                     * they read as light coming from nowhere -- a bloom in the
                     * corner of an empty sky with no star responsible for it.
                     * The radiance belongs to the stars and is drawn by them.
                     */
                    backgroundColor: "#090413",
                  }}
                >
                  <ConstellationLines
                    lines={selectedLines}
                    stars={visibleStars}
                    pending={
                      linkFromStarId && linkPoint
                        ? {
                            fromStarId: linkFromStarId,
                            ...linkPoint,
                            toStarId: linkHoverStarId,
                          }
                        : null
                    }
                    onRemoveLine={isConnecting ? handleRemoveLine : undefined}
                  />
                  <div className="absolute inset-0 z-10">
                    {visibleStars.map((star) => (
                      <ConstellationStar
                        key={star.id}
                        star={star}
                        interaction={skyMode}
                        isLinkSource={linkFromStarId === star.id}
                        isLinkTarget={
                          isConnecting && linkHoverStarId === star.id
                        }
                        onActivate={
                          isConnecting
                            ? () => beginOrFinishLink(star)
                            : undefined
                        }
                        label={
                          star.rewardKind === "onboarding"
                            ? star.rewardLabel ?? "First study loop"
                            : goalsById[star.goalId]
                              ? `Earned for a ${goalsById[star.goalId].targetCards}-card goal`
                              : "Earned star"
                        }
                        onDragStart={
                          !canArrangeSelectedConstellation
                            ? undefined
                            : isConnecting
                              ? () => {
                                  starGestureRef.current = true;
                                  beginOrFinishLink(star);
                                }
                              : () => {
                                  starGestureRef.current = true;
                                  setDraggingStarId(star.id);
                                }
                        }
                        onNudge={
                          canArrangeSelectedConstellation && !isConnecting
                            ? (position) =>
                                handleKeyboardStarMove(star.id, position)
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
                          description="Skies are rewards, not another task list. Finish a study goal and its star will appear here."
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

                <div>
                  <div className="mb-2 flex justify-between text-xs text-text-muted">
                    <span>
                      {selectedConstellation.starCount} of{" "}
                      {selectedConstellation.maxStars} stars
                    </span>
                    <span>{selectedProgressPercent}% filled</span>
                  </div>
                  <div className="h-2 rounded-full bg-glass-medium">
                    <div
                      className="h-2 rounded-full bg-accent transition-all duration-slow"
                      style={{ width: `${selectedProgressPercent}%` }}
                    />
                  </div>
                </div>

                {/*
                 * Finishing, offered where it applies and only when it can be
                 * done. It used to be a permanently disabled button in the page
                 * header reading "Finish at 40 stars" -- a control that spends
                 * almost its whole life explaining why it does not work.
                 */}
                {selectedConstellation.id === activeConstellation?.id &&
                canFinishActiveConstellation ? (
                  <div className="app-subtle-panel flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-text-primary">
                        This sky is full
                      </p>
                      <p className="mt-0.5 text-xs text-text-muted">
                        Finish it to keep it as a record, and a new sky starts
                        collecting your next stars. You can still rearrange this
                        one and draw on it afterwards.
                      </p>
                    </div>
                    <Button
                      type="button"
                      className="shrink-0"
                      disabled={isFinishingConstellation}
                      onClick={() => void handleFinishConstellation()}
                    >
                      {isFinishingConstellation
                        ? "Finishing..."
                        : "Finish this sky"}
                    </Button>
                  </div>
                ) : null}
              </Card>
            ) : null}

            {pastConstellations.length ? (
              <Card padding="md" className="space-y-4">
                <SectionHeader
                  title="Past skies"
                  description="Finished skies stay here. Open one to look at it, rearrange its stars, or redraw its lines."
                />
                <div className="grid gap-3 lg:grid-cols-2">
                  {pastConstellations.map((constellation) => (
                    <div
                      key={constellation.id}
                      className={`app-panel p-4 text-sm ${
                        constellation.id === selectedConstellation?.id
                          ? "ring-1 ring-[var(--color-selected-border)]"
                          : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        {renamingConstellationId === constellation.id ? (
                          renameField("w-full max-w-[10rem]")
                        ) : (
                          <>
                            <div className="min-w-0">
                              <p className="truncate font-medium text-text-primary">
                                {constellation.name}
                              </p>
                              <p className="mt-0.5 text-xs text-text-muted">
                                {constellation.starCount} star
                                {constellation.starCount === 1 ? "" : "s"}
                                {constellation.status === "finished"
                                  ? " · finished"
                                  : ""}
                              </p>
                            </div>
                            <div className="flex shrink-0 gap-2">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => startRename(constellation)}
                              >
                                Rename
                              </Button>
                              <Button
                                size="sm"
                                variant="surface"
                                disabled={
                                  constellation.id === selectedConstellation?.id
                                }
                                onClick={() =>
                                  setSelectedConstellationId(constellation.id)
                                }
                              >
                                {constellation.id === selectedConstellation?.id
                                  ? "Viewing"
                                  : "Open"}
                              </Button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            ) : null}
          </>
        )}
        <ConfirmDialog
          open={isConfirmingClearLines}
          title="Clear all lines?"
          description={`This will remove all ${selectedLines.length} connection${selectedLines.length === 1 ? "" : "s"} from this constellation and cannot be undone.`}
          confirmLabel="Clear lines"
          onConfirm={handleClearLines}
          onClose={() => setIsConfirmingClearLines(false)}
        />
      </AppPage>
    </Refreshable>
  );
}
