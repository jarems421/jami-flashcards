"use client";

import { useState } from "react";
import {
  isConstellationReadyToFinish,
  type Constellation,
} from "@/lib/constellation/constellations";
import {
  createConstellation,
  finishConstellation,
} from "@/services/constellation/constellations";

/**
 * Starting a new sky and finishing a full one.
 *
 * Only one sky collects stars at a time -- the service refuses a second -- so
 * creating is offered only when none is active, and finishing only once the
 * active one is full. Both reload the skies afterwards, because each changes
 * which sky is active.
 */
export function useConstellationLifecycle({
  uid,
  activeConstellation,
  reload,
  feedback,
}: {
  uid: string;
  activeConstellation: Constellation | null | undefined;
  reload: () => Promise<unknown>;
  feedback: {
    clear: () => void;
    success: (message: string) => void;
    showError: (message: string) => void;
    showThrownError: (error: unknown, fallback: string) => void;
  };
}) {
  // Held here rather than in the form, which a reload unmounts while it runs.
  const [newSkyName, setNewSkyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const canFinish = activeConstellation ? isConstellationReadyToFinish(activeConstellation) : false;

  const create = async () => {
    const trimmedName = newSkyName.trim();
    if (!trimmedName) return;

    setCreating(true);
    feedback.clear();
    try {
      await createConstellation(uid, trimmedName);
      setNewSkyName("");
      await reload();
      feedback.success(`Created constellation ${trimmedName}.`);
    } catch (error) {
      console.error(error);
      feedback.showThrownError(error, "Failed to create constellation.");
    } finally {
      setCreating(false);
    }
  };

  const finish = async () => {
    if (!activeConstellation || !canFinish) return;

    setFinishing(true);
    feedback.clear();
    try {
      await finishConstellation(uid, activeConstellation.id);
      await reload();
      feedback.success(`${activeConstellation.name} is now finished.`);
    } catch (error) {
      console.error(error);
      feedback.showError("Failed to finish constellation.");
    } finally {
      setFinishing(false);
    }
  };

  return { newSkyName, setNewSkyName, creating, create, finishing, canFinish, finish };
}
