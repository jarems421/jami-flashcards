"use client";

import { useCardImageUrl } from "@/hooks/useCardImageUrl";
import type { DiagramPictureState } from "@/hooks/useDiagramEditor";

/** A URL to draw a diagram's picture from: the stored one, or a new file's local preview. */
export function useDiagramPictureUrl(picture: DiagramPictureState | null) {
  const stored = useCardImageUrl(picture?.kind === "saved" ? picture.image : undefined);
  if (!picture) return { url: null, failed: false };
  return picture.kind === "saved" ? stored : { url: picture.previewUrl, failed: false };
}
