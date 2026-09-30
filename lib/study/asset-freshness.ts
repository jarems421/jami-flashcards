import type { CardOcclusion } from "@/lib/study/image-occlusion";
import { getCardContentHash, type CardStudySettings } from "@/lib/study/study-modes";

export function hasCurrentStudySource(
  asset: { sourceFingerprint?: unknown } | null | undefined,
  card: {
    front: string;
    back: string;
    studySettings?: CardStudySettings;
    frontImage?: { storagePath: string };
    backImage?: { storagePath: string };
    occlusion?: CardOcclusion;
  },
) {
  return typeof asset?.sourceFingerprint === "string" && asset.sourceFingerprint === getCardContentHash(card);
}
