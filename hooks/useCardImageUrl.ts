"use client";

import { useEffect, useState } from "react";
import type { CardImage } from "@/lib/study/card-images";
import { getCardImageUrl } from "@/services/study/card-images";

/**
 * The URL to show a stored card image with.
 *
 * Kept against the path it was resolved for, so a card that changes image
 * reads as loading straight away rather than briefly showing the old one.
 */
export function useCardImageUrl(image: CardImage | undefined) {
  const path = image?.storagePath ?? "";
  const [resolved, setResolved] = useState<{
    path: string;
    url: string | null;
    failed: boolean;
  } | null>(null);

  useEffect(() => {
    if (!path) return;
    let active = true;
    getCardImageUrl(path)
      .then((url) => {
        if (active) setResolved({ path, url, failed: false });
      })
      .catch(() => {
        if (active) setResolved({ path, url: null, failed: true });
      });
    return () => {
      active = false;
    };
  }, [path]);

  const current = path && resolved?.path === path ? resolved : null;
  return { url: current?.url ?? null, failed: current?.failed ?? false };
}
