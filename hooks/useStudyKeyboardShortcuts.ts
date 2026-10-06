"use client";

import { useEffect, useRef } from "react";
import type { CardRating } from "@/lib/study/scheduler";

const FOUR_POINT_KEYS: Record<string, CardRating> = { "1": "again", "2": "hard", "3": "good", "4": "easy" };
const TWO_POINT_KEYS: Record<string, CardRating> = { "1": "again", "2": "good" };

/**
 * Space turns a flashcard over and the number keys rate it.
 *
 * Only for a plain flashcard: an exercise takes typed answers and owns its own
 * keys, and nothing fires while a text field has focus.
 */
export function useStudyKeyboardShortcuts({
  enabled,
  flipped,
  ratingLocked,
  scale,
  onReveal,
  onRate,
}: {
  /** A flashcard is on screen. */
  enabled: boolean;
  flipped: boolean;
  /** A rating is still being saved. */
  ratingLocked: boolean;
  scale: "two-point" | "four-point";
  onReveal: () => void;
  onRate: (rating: CardRating) => unknown;
}) {
  const onRateRef = useRef(onRate);
  useEffect(() => {
    onRateRef.current = onRate;
  });

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.code === "Space") {
        event.preventDefault();
        if (!flipped) onReveal();
        return;
      }
      if (!flipped || ratingLocked) return;
      const rating = (scale === "two-point" ? TWO_POINT_KEYS : FOUR_POINT_KEYS)[event.key];
      if (rating) {
        event.preventDefault();
        void onRateRef.current(rating);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, flipped, onReveal, ratingLocked, scale]);
}
