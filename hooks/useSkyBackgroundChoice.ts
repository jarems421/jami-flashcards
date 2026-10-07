"use client";

import { useSyncExternalStore } from "react";
import {
  CONSTELLATION_BACKGROUND_EVENT,
  readConstellationBackgroundConstellationId,
  readConstellationBackgroundEnabled,
} from "@/lib/constellation/background";
import type { Constellation } from "@/lib/constellation/constellations";
import { saveSkyBackgroundChoice } from "@/services/profile/appearance";

function subscribe(onChange: () => void) {
  window.addEventListener(CONSTELLATION_BACKGROUND_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CONSTELLATION_BACKGROUND_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * Whether a sky is the backdrop behind the rest of Jami, and switching the open
 * sky in or out of that role.
 *
 * Read from the device, where saving the choice writes it before the account
 * copy is sent, so the toggle answers at once. The server render, and so the
 * first client render, sees no background.
 */
export function useSkyBackgroundChoice({
  uid,
  selectedConstellation,
}: {
  uid: string;
  selectedConstellation: Constellation | null | undefined;
}) {
  const backgroundEnabled = useSyncExternalStore(
    subscribe,
    readConstellationBackgroundEnabled,
    () => false
  );
  const backgroundConstellationId = useSyncExternalStore(
    subscribe,
    readConstellationBackgroundConstellationId,
    () => ""
  );

  const isSelectedBackground =
    Boolean(selectedConstellation) &&
    backgroundEnabled &&
    backgroundConstellationId === selectedConstellation?.id;

  const toggleSelectedBackground = () => {
    if (!selectedConstellation) return;
    if (isSelectedBackground) {
      void saveSkyBackgroundChoice(uid, false);
    } else {
      void saveSkyBackgroundChoice(uid, true, selectedConstellation.id);
    }
  };

  return { backgroundEnabled, isSelectedBackground, toggleSelectedBackground };
}
