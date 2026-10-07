"use client";

import { useEffect, useState } from "react";
import { forEachLimited } from "@/lib/async/for-each-limited";
import type { DeckCardCount } from "@/lib/study/deck-counts";
import { getDeckCardCount } from "@/services/study/deck-counts";

/** Enough decks at once to fill a screen quickly, without a burst of hundreds of requests. */
const COUNTS_IN_FLIGHT = 6;
/** Counts arriving within this window are shown together, so a long list re-renders a few times rather than once per deck. */
const FLUSH_MS = 80;

export type DeckCardCountRequest = {
  /** In the order the decks are listed, so the ones on screen are counted first. */
  deckIds: readonly string[];
  /** Straight to the server, as the deck list itself was read. */
  force: boolean;
};

/**
 * Each deck's card count, filled in as it arrives.
 *
 * Counted apart from loading the decks, so the list shows straight away and a
 * deck whose count is slow or fails loses only its count. A new request keeps
 * the counts already on screen until fresher ones replace them, so a refresh
 * does not flash every deck back to "counting".
 *
 * Undefined for a deck means it has not been counted yet; null means it could
 * not be counted.
 */
export function useDeckCardCounts(userId: string, request: DeckCardCountRequest | null) {
  const [counts, setCounts] = useState<Record<string, DeckCardCount | null>>({});

  useEffect(() => {
    if (!request) return;
    let cancelled = false;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const pending = new Map<string, DeckCardCount | null>();

    const flush = () => {
      flushTimer = null;
      if (cancelled || pending.size === 0) return;
      const arrived = [...pending];
      pending.clear();
      setCounts((current) => {
        const next = { ...current };
        for (const [deckId, count] of arrived) {
          // A failed recount keeps the count already shown.
          if (count === null && next[deckId]) continue;
          next[deckId] = count;
        }
        return next;
      });
    };
    const arrive = (deckId: string, count: DeckCardCount | null) => {
      pending.set(deckId, count);
      flushTimer ??= setTimeout(flush, FLUSH_MS);
    };

    void forEachLimited(
      request.deckIds,
      COUNTS_IN_FLIGHT,
      async (deckId) => {
        try {
          arrive(deckId, await getDeckCardCount(userId, deckId, { force: request.force }));
        } catch {
          arrive(deckId, null);
        }
      },
      () => cancelled
    ).then(() => {
      if (flushTimer) clearTimeout(flushTimer);
      flush();
    });

    return () => {
      cancelled = true;
      if (flushTimer) clearTimeout(flushTimer);
    };
  }, [request, userId]);

  return counts;
}
