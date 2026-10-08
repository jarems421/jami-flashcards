"use client";

import { useEffect, useMemo, useState } from "react";
import type { Card } from "@/lib/study/cards";
import {
  mixUpCardIds,
  summariseDeckMixUps,
  type DiagramConfusionEvent,
  type DiagramMixUp,
} from "@/lib/study/diagram-confusion";
import { loadDiagramConfusionEvents } from "@/services/learning/flashcard-review-events";

/** Card ids never hold this, so it can join them into one comparable key. */
const SEPARATOR = "\u0000";

/**
 * The label pairs a student mixes up across a deck's diagrams, most often first.
 *
 * Read once for the deck's studied label cards, and again only when that set
 * of cards changes -- not on every edit that hands the page a new array of the
 * same cards. The events record ids and times only. Empty while loading and on
 * any failure: this is a hint, never a gate.
 */
export function useDiagramMixUps(userId: string, cards: readonly Card[]): DiagramMixUp[] {
  const idsKey = useMemo(() => mixUpCardIds(cards).join(SEPARATOR), [cards]);
  const cardIds = useMemo(() => (idsKey ? idsKey.split(SEPARATOR) : []), [idsKey]);
  const loadKey = `${userId}${SEPARATOR}${idsKey}`;
  const [loaded, setLoaded] = useState<{ key: string; events: DiagramConfusionEvent[] } | null>(null);

  useEffect(() => {
    if (!userId || cardIds.length === 0) return;
    let active = true;
    void loadDiagramConfusionEvents(userId, cardIds).then((events) => {
      if (active) setLoaded({ key: loadKey, events });
    });
    return () => {
      active = false;
    };
  }, [cardIds, loadKey, userId]);

  return useMemo(
    () => (loaded?.key === loadKey ? summariseDeckMixUps(cards, loaded.events) : []),
    [cards, loadKey, loaded]
  );
}
