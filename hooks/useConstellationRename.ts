"use client";

import { useState } from "react";
import type { Constellation } from "@/lib/constellation/constellations";
import { renameConstellation } from "@/services/constellation/constellations";

/** Renaming a sky in place: one at a time, saved on Enter and dropped on Escape. */
export function useConstellationRename({
  uid,
  setConstellations,
  onError,
}: {
  uid: string;
  setConstellations: (update: (current: Constellation[]) => Constellation[]) => void;
  onError: (error: unknown, fallback: string) => void;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [value, setValue] = useState("");

  const start = (constellation: Constellation) => {
    setRenamingId(constellation.id);
    setValue(constellation.name);
  };

  const cancel = () => {
    setRenamingId(null);
    setValue("");
  };

  const save = async () => {
    if (!renamingId) return;
    const trimmed = value.trim();
    if (!trimmed) return;

    try {
      const finalName = await renameConstellation(uid, renamingId, trimmed);
      setConstellations((prev) =>
        prev.map((entry) => (entry.id === renamingId ? { ...entry, name: finalName } : entry))
      );
      cancel();
    } catch (error) {
      console.error(error);
      onError(error, "Failed to rename constellation.");
    }
  };

  return { renamingId, value, setValue, start, save, cancel };
}

export type ConstellationRename = ReturnType<typeof useConstellationRename>;
