"use client";

import { useCallback, useMemo, useState } from "react";
import { toggleConstellationLine } from "@/lib/constellation/constellations";
import { saveConstellationLines } from "@/services/constellation/constellations";
import type { Constellation, ConstellationLine } from "@/lib/constellation/constellations";

/**
 * Drawing lines between stars, with one level of history.
 *
 * The sky page owns which constellation is selected and how a constellation is
 * stored; this owns only what happens to its lines -- adding one, taking the
 * last one back, putting it back again, and clearing the lot.
 *
 * Redo is deliberately scoped to a constellation id rather than kept as a bare
 * list. Undoing a line in one sky and then switching to another must not offer
 * that line for redo on a sky it never belonged to, so the history carries the
 * id it was recorded against and is read as empty anywhere else.
 *
 * Every change is written through immediately and failures are reported to the
 * caller's error banner: a line the student drew that quietly failed to save
 * would come back missing on the next visit with nothing to explain it.
 */
export function useConstellationLineEditing({
  uid,
  selectedConstellation,
  setConstellations,
  onSaveError,
}: {
  uid: string;
  selectedConstellation: Constellation | null;
  setConstellations: (
    update: (current: Constellation[]) => Constellation[]
  ) => void;
  onSaveError: (message: string) => void;
}) {
  const [redoHistory, setRedoHistory] = useState<{
    constellationId: string;
    lines: ConstellationLine[];
  }>({ constellationId: "", lines: [] });

  const redoLines = useMemo(
    () =>
      selectedConstellation?.id === redoHistory.constellationId
        ? redoHistory.lines
        : [],
    [redoHistory, selectedConstellation?.id]
  );

  const clearRedoHistory = useCallback(() => {
    setRedoHistory({ constellationId: "", lines: [] });
  }, []);

  const applyLines = useCallback(
    (next: ConstellationLine[]) => {
      const constellation = selectedConstellation;
      if (!constellation || next === constellation.lines) return;

      setConstellations((current) =>
        current.map((entry) =>
          entry.id === constellation.id ? { ...entry, lines: next } : entry
        )
      );
      void saveConstellationLines(uid, constellation.id, next).catch(
        (error: unknown) => {
          console.error("Failed to save constellation lines.", error);
          onSaveError("Failed to save your constellation lines.");
        }
      );
    },
    [onSaveError, selectedConstellation, setConstellations, uid]
  );

  const toggleLine = useCallback(
    (starA: string, starB: string) => {
      if (!selectedConstellation) return;
      clearRedoHistory();
      applyLines(
        toggleConstellationLine(selectedConstellation.lines, starA, starB)
      );
    },
    [applyLines, clearRedoHistory, selectedConstellation]
  );

  const undoLine = useCallback(() => {
    const lastLine = selectedConstellation?.lines.at(-1);
    if (!selectedConstellation || !lastLine) return;

    setRedoHistory((current) => ({
      constellationId: selectedConstellation.id,
      lines:
        current.constellationId === selectedConstellation.id
          ? [...current.lines, lastLine]
          : [lastLine],
    }));
    applyLines(selectedConstellation.lines.slice(0, -1));
  }, [applyLines, selectedConstellation]);

  const redoLine = useCallback(() => {
    const restoredLine = redoLines.at(-1);
    if (!selectedConstellation || !restoredLine) return;

    applyLines([...selectedConstellation.lines, restoredLine]);
    setRedoHistory((current) => ({
      constellationId: selectedConstellation.id,
      lines: current.lines.slice(0, -1),
    }));
  }, [applyLines, redoLines, selectedConstellation]);

  const clearLines = useCallback(() => {
    if (!selectedConstellation?.lines.length) return;
    applyLines([]);
    clearRedoHistory();
  }, [applyLines, clearRedoHistory, selectedConstellation]);

  return {
    redoLines,
    applyLines,
    clearRedoHistory,
    toggleLine,
    undoLine,
    redoLine,
    clearLines,
  };
}
