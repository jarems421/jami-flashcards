"use client";

import { useCallback, useRef, useState, type ReactNode, type TouchEvent } from "react";

type RefreshableProps = {
  /** Async function to call when refresh is triggered. */
  onRefresh: () => Promise<void>;
  children: ReactNode;
};

const PULL_THRESHOLD = 80; // px before we commit to a refresh
const MAX_PULL = 120;

/**
 * Wraps page content with pull-to-refresh (touch) and exposes a header
 * refresh icon button. Both trigger the same `onRefresh` callback.
 */
export default function Refreshable({ onRefresh, children }: RefreshableProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const touchStartY = useRef(0);
  const pulling = useRef(false);

  const doRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh]);

  const handleTouchStart = (e: TouchEvent) => {
    // Only pull-to-refresh when scrolled to top
    const el = e.currentTarget;
    if (el.scrollTop > 0) return;
    touchStartY.current = e.touches[0].clientY;
    pulling.current = true;
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (!pulling.current || refreshing) return;
    const delta = e.touches[0].clientY - touchStartY.current;
    if (delta > 0) {
      setPullDistance(Math.min(delta * 0.5, MAX_PULL));
    }
  };

  const handleTouchEnd = () => {
    if (!pulling.current) return;
    pulling.current = false;
    if (pullDistance >= PULL_THRESHOLD && !refreshing) {
      void doRefresh();
    }
    setPullDistance(0);
  };

  return (
    <div
      className="flex min-h-screen flex-col"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull indicator */}
      {pullDistance > 0 && (
        <div
          className="flex items-center justify-center text-text-muted"
          style={{ height: `${pullDistance}px` }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5 transition-transform"
            style={{
              transform: `rotate(${Math.min(pullDistance / PULL_THRESHOLD, 1) * 180}deg)`,
            }}
          >
            <path d="M12 5v14M5 12l7-7 7 7" />
          </svg>
        </div>
      )}

      {/* Header refresh button (rendered by the page) + children */}
      {children}
    </div>
  );
}

/** Standalone refresh icon button for use in page headers. */
export function RefreshIconButton({
  refreshing,
  onClick,
}: {
  refreshing: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={refreshing}
      aria-label="Refresh"
      className="rounded-md p-2 text-text-muted transition duration-fast hover:text-white active:scale-95 disabled:opacity-50"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`h-5 w-5 ${refreshing ? "animate-spin" : ""}`}
      >
        <path d="M21 12a9 9 0 11-2.636-6.364M21 3v6h-6" />
      </svg>
    </button>
  );
}
