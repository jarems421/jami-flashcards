import { getCardContentHash, type CardStudySettings } from "@/lib/study/study-modes";

export function hasCurrentStudySource(
  asset: { sourceFingerprint?: unknown } | null | undefined,
  card: { front: string; back: string; studySettings?: CardStudySettings },
) {
  return typeof asset?.sourceFingerprint === "string" && asset.sourceFingerprint === getCardContentHash(card);
}
