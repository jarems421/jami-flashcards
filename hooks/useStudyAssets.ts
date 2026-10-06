"use client";

import { useCallback, useEffect, useState } from "react";
import type { StudyAsset } from "@/lib/ai/study-assets";
import type { Card } from "@/lib/study/cards";
import { loadStudyAssets, retireStudyAsset } from "@/services/study/study-assets";

/**
 * What Jami has prepared for the session's cards: written options, gaps and
 * marking hints, merged onto each card as it is asked.
 *
 * Whatever is already stored is read as soon as a session has cards, and
 * anything prepared during the session is merged in as it lands.
 */
export function useStudyAssets({ enabled, sessionCards }: { enabled: boolean; sessionCards: Card[] }) {
  const [assets, setAssets] = useState<Record<string, StudyAsset>>({});

  const mergeAssets = useCallback((ready: Record<string, StudyAsset>) => {
    setAssets((previous) => ({ ...previous, ...ready }));
  }, []);

  const retireAsset = useCallback((cardId: string, variantId: string) => {
    setAssets((previous) => retireStudyAsset(previous, cardId, variantId));
  }, []);

  useEffect(() => {
    if (!enabled || sessionCards.length === 0) return;
    let cancelled = false;
    void loadStudyAssets(sessionCards).then((loaded) => {
      if (!cancelled) mergeAssets(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, mergeAssets, sessionCards]);

  return { assets, mergeAssets, retireAsset };
}
