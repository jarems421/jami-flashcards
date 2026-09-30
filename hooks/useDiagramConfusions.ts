"use client";

import { useEffect, useMemo, useState } from "react";
import type { Card } from "@/lib/study/cards";
import {
  summariseDiagramConfusions,
  type DiagramConfusionEvent,
  type DiagramConfusionPair,
} from "@/lib/study/diagram-confusion";
import type { OcclusionDiagram } from "@/lib/study/image-occlusion";
import { loadDiagramConfusionEvents } from "@/services/learning/flashcard-review-events";

/**
 * The label pairs a student mixes up on one diagram, most often first.
 *
 * Read once when a diagram is opened, from review events that record only
 * ids. Empty while loading and on any failure: this is a hint, never a gate.
 */
export function useDiagramConfusions(
  userId: string,
  diagram: OcclusionDiagram | null,
  cards: readonly Card[]
): DiagramConfusionPair[] {
  const [loaded, setLoaded] = useState<{ key: string; events: DiagramConfusionEvent[] } | null>(null);
  const cardIds = useMemo(() => cards.filter((card) => card.occlusion?.labelId).map((card) => card.id), [cards]);
  const key = `${diagram?.id ?? ""}:${cardIds.join(",")}`;

  useEffect(() => {
    if (!diagram || cardIds.length === 0) return;
    let active = true;
    void loadDiagramConfusionEvents(userId, cardIds).then((events) => {
      if (active) setLoaded({ key, events });
    });
    return () => {
      active = false;
    };
  }, [cardIds, diagram, key, userId]);

  return useMemo(
    () => (diagram && loaded?.key === key ? summariseDiagramConfusions(diagram, cards, loaded.events) : []),
    [cards, diagram, key, loaded]
  );
}
