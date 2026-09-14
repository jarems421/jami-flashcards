import { doc, writeBatch } from "firebase/firestore";
import {
  normalizeConstellationLines,
  type ConstellationLine,
} from "@/lib/constellation/constellations";
import type { SkyDrawing } from "@/lib/constellation/sky-drawing";
import {
  readSkyPatternResponse,
  type SkyPattern,
  type SkyPatternTurn,
} from "@/lib/constellation/sky-pattern";
import type { StarPosition } from "@/lib/constellation/stars";
import { auth, db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";

const SAVE_MS = 30_000;
const FALLBACK_ERROR = "Jami could not arrange your sky just now.";

export async function requestSkyPattern(input: {
  constellationId: string;
  request: string;
  history: SkyPatternTurn[];
  previousDrawing?: SkyDrawing;
  aspectRatio?: number;
}): Promise<SkyPattern> {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in again to ask Jami.");

  const token = await user.getIdToken();
  const response = await fetch("/api/ai/constellation-pattern", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
  // A gateway can answer with HTML, which is still a failure with a status.
  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
        ? data.error
        : FALLBACK_ERROR;
    throw new Error(message);
  }

  const pattern = readSkyPatternResponse(data);
  if (!pattern) throw new Error(FALLBACK_ERROR);
  return pattern;
}

/**
 * Saves a whole arrangement at once: every star that moved, and the lines.
 *
 * One batch, so a sky is never left half rearranged -- stars in the new picture
 * joined by the old lines -- if the connection drops partway.
 */
export async function saveSkyArrangement(
  userId: string,
  constellationId: string,
  positions: Record<string, StarPosition>,
  lines: ConstellationLine[]
) {
  const batch = writeBatch(db);
  for (const [starId, position] of Object.entries(positions)) {
    batch.update(doc(db, "users", userId, "stars", starId), { position });
  }
  batch.update(doc(db, "users", userId, "constellations", constellationId), {
    lines: normalizeConstellationLines(lines),
  });
  await withTimeout(batch.commit(), SAVE_MS, "Save sky arrangement");
}
