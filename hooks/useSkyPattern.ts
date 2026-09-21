"use client";

import { useCallback, useState } from "react";
import {
  requestSkyPattern,
  saveSkyArrangement,
} from "@/services/constellation/sky-pattern";
import type { SkyDrawing } from "@/lib/constellation/sky-drawing";
import type { SkyPatternTurn } from "@/lib/constellation/sky-pattern";
import type { Constellation, ConstellationLine } from "@/lib/constellation/constellations";
import type { NormalizedStar } from "@/lib/constellation/stars";

type StarPositions = Record<string, NormalizedStar["position"]>;

/**
 * Asking Jami to arrange the sky, and being able to take it back.
 *
 * Everything an arrangement touches moves together -- where the stars sit, the
 * lines between them, and the half-drawn line that has to be dropped because
 * the star it started from may have moved underneath it -- so it is applied in
 * one place rather than from each caller.
 *
 * Two pieces of history are kept, and they are not the same thing. The undo
 * snapshot is where the sky was before Jami touched it, so one press puts it
 * back. The last drawing is what Jami drew, so a follow-up like "make it
 * bigger" has something to build on; undoing clears it, because what is on the
 * sky is then no longer Jami's drawing and a follow-up would be building on a
 * picture that is no longer there.
 *
 * Only stars that are actually in the sky are moved or joined. What comes back
 * has already been limited to real stars, and that limit is applied again here
 * because this is the code that writes it down.
 */
export function useSkyPattern({
  uid,
  selectedConstellation,
  visibleStars,
  setAllStars,
  setConstellations,
  onArrangementApplied,
  onReloadNeeded,
  onError,
}: {
  uid: string;
  selectedConstellation: Constellation | null;
  visibleStars: NormalizedStar[];
  setAllStars: (update: (current: NormalizedStar[]) => NormalizedStar[]) => void;
  setConstellations: (update: (current: Constellation[]) => Constellation[]) => void;
  /** Drop anything mid-gesture: the stars under it have moved. */
  onArrangementApplied: () => void;
  onReloadNeeded: () => void;
  onError: (message: string) => void;
}) {
  const [undoSnapshot, setUndoSnapshot] = useState<{
    constellationId: string;
    positions: StarPositions;
    lines: ConstellationLine[];
  } | null>(null);
  /** Jami's last drawing for this sky, so a follow-up like "bigger" can build on it. */
  const [lastDrawing, setLastDrawing] = useState<{
    constellationId: string;
    drawing: SkyDrawing;
  } | null>(null);

  const applyArrangement = useCallback(
    async (
      constellationId: string,
      positions: StarPositions,
      lines: ConstellationLine[]
    ) => {
      setAllStars((current) =>
        current.map((star) => {
          const position = positions[star.id];
          return position ? { ...star, position } : star;
        })
      );
      setConstellations((current) =>
        current.map((entry) => (entry.id === constellationId ? { ...entry, lines } : entry))
      );
      onArrangementApplied();
      await saveSkyArrangement(uid, constellationId, positions, lines);
    },
    [onArrangementApplied, setAllStars, setConstellations, uid]
  );

  const ask = useCallback(
    async (request: string, history: SkyPatternTurn[]) => {
      const constellation = selectedConstellation;
      if (!constellation) throw new Error("Choose a sky first.");

      const rect = document.getElementById("constellation-container")?.getBoundingClientRect();
      const pattern = await requestSkyPattern({
        constellationId: constellation.id,
        request,
        history,
        previousDrawing:
          lastDrawing?.constellationId === constellation.id ? lastDrawing.drawing : undefined,
        aspectRatio: rect && rect.height > 0 ? rect.width / rect.height : undefined,
      });

      const present = new Set(visibleStars.map((star) => star.id));
      const positions = Object.fromEntries(
        Object.entries(pattern.positions).filter(([starId]) => present.has(starId))
      );
      const lines =
        pattern.lines?.filter((line) => present.has(line.a) && present.has(line.b)) ?? null;
      // Jami answered without changing anything -- a question, or a request it declined.
      if (Object.keys(positions).length === 0 && lines === null) return pattern.reply;

      const before = {
        constellationId: constellation.id,
        positions: Object.fromEntries(visibleStars.map((star) => [star.id, star.position])),
        lines: constellation.lines,
      };
      try {
        await applyArrangement(constellation.id, positions, lines ?? constellation.lines);
      } catch (error) {
        console.error("Failed to save Jami's arrangement.", error);
        onReloadNeeded();
        throw new Error("Jami arranged your stars, but they could not be saved. Try again.");
      }
      setUndoSnapshot(before);
      if (pattern.drawing) {
        setLastDrawing({ constellationId: constellation.id, drawing: pattern.drawing });
      }
      return pattern.reply;
    },
    [applyArrangement, lastDrawing, onReloadNeeded, selectedConstellation, visibleStars]
  );

  const undo = useCallback(() => {
    const before = undoSnapshot;
    if (!before) return;
    setUndoSnapshot(null);
    // What is on the sky is no longer Jami's drawing, so a follow-up starts fresh.
    setLastDrawing(null);
    void applyArrangement(before.constellationId, before.positions, before.lines).catch(
      (error: unknown) => {
        console.error("Failed to undo Jami's arrangement.", error);
        onError("Could not put your sky back. Try again.");
        onReloadNeeded();
      }
    );
  }, [applyArrangement, onError, onReloadNeeded, undoSnapshot]);

  return { undoSnapshot, ask, undo };
}
