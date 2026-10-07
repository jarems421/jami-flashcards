"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clampPercentage, SKY_CONTAINER_ID, type NormalizedStar } from "@/lib/constellation/stars";
import { saveStarPosition } from "@/services/constellation/stars";

/**
 * Moving stars around the sky: dragged with a pointer, or nudged from the
 * keyboard. A drag moves the star as it goes and saves once, where it is let go.
 */
export function useStarArranging({
  uid,
  enabled,
  setAllStars,
  onSaveError,
}: {
  uid: string;
  enabled: boolean;
  setAllStars: (update: (current: NormalizedStar[]) => NormalizedStar[]) => void;
  onSaveError: (message: string) => void;
}) {
  const [draggingStarId, setDraggingStarId] = useState<string | null>(null);
  const dragPositionRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!draggingStarId || !enabled) {
      return;
    }

    const container = document.getElementById(SKY_CONTAINER_ID);
    if (!container) {
      return;
    }

    const updateDragPosition = (clientX: number, clientY: number) => {
      const rect = container.getBoundingClientRect();
      const x = clampPercentage(((clientX - rect.left) / rect.width) * 100);
      const y = clampPercentage(((clientY - rect.top) / rect.height) * 100);

      dragPositionRef.current = { x, y };
      setAllStars((prev) =>
        prev.map((star) => (star.id === draggingStarId ? { ...star, position: { x, y } } : star))
      );
    };

    const handleEnd = () => {
      const position = dragPositionRef.current;
      const starId = draggingStarId;
      setDraggingStarId(null);
      dragPositionRef.current = null;

      if (!position || !starId) {
        return;
      }

      void saveStarPosition(uid, starId, position);
    };

    /*
     * Pointer events, for mouse, pen and finger alike.
     *
     * This listened for `mouseup`, and a star swallows its own `pointerdown` to
     * stop the page scrolling -- which also stops the browser sending the mouse
     * events that would have followed. So on a computer the release never
     * arrived: the star stayed stuck to the cursor until a click somewhere else,
     * usually outside the sky, where it was left pinned to the edge.
     */
    const handleMove = (event: PointerEvent) => {
      // No button held means the release happened somewhere this never heard.
      if (event.pointerType === "mouse" && event.buttons === 0) {
        handleEnd();
        return;
      }
      updateDragPosition(event.clientX, event.clientY);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleEnd);
    window.addEventListener("pointercancel", handleEnd);

    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
      window.removeEventListener("pointercancel", handleEnd);
    };
  }, [enabled, draggingStarId, setAllStars, uid]);

  const nudgeStar = useCallback(
    (starId: string, position: NormalizedStar["position"]) => {
      setAllStars((current) =>
        current.map((star) => (star.id === starId ? { ...star, position } : star))
      );
      void saveStarPosition(uid, starId, position).catch((error) => {
        console.error(error);
        onSaveError("Could not save that star position.");
      });
    },
    [onSaveError, setAllStars, uid]
  );

  return { startDrag: setDraggingStarId, nudgeStar };
}
