export const CONSTELLATION_BACKGROUND_STORAGE_KEY =
  "constellation-background-enabled";
export const CONSTELLATION_BACKGROUND_CONSTELLATION_ID_STORAGE_KEY =
  "constellation-background-constellation-id";
export const CONSTELLATION_BACKGROUND_CRASH_MARKER_STORAGE_KEY =
  "constellation-background-crash-marked";
export const CONSTELLATION_BACKGROUND_EVENT =
  "constellation-background-change";

export function readConstellationBackgroundEnabled() {
  if (typeof window === "undefined") {
    return false;
  }

  return (
    window.localStorage.getItem(CONSTELLATION_BACKGROUND_STORAGE_KEY) === "true"
  );
}

export function setConstellationBackgroundEnabled(enabled: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  if (enabled) {
    clearConstellationBackgroundCrashMarked();
  }

  window.localStorage.setItem(
    CONSTELLATION_BACKGROUND_STORAGE_KEY,
    enabled ? "true" : "false"
  );
  window.dispatchEvent(new Event(CONSTELLATION_BACKGROUND_EVENT));
}

export function readConstellationBackgroundCrashMarked() {
  if (typeof window === "undefined") {
    return false;
  }

  return (
    window.localStorage.getItem(
      CONSTELLATION_BACKGROUND_CRASH_MARKER_STORAGE_KEY
    ) === "true"
  );
}

export function setConstellationBackgroundCrashMarked(marked: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  if (marked) {
    window.localStorage.setItem(
      CONSTELLATION_BACKGROUND_CRASH_MARKER_STORAGE_KEY,
      "true"
    );
  } else {
    window.localStorage.removeItem(
      CONSTELLATION_BACKGROUND_CRASH_MARKER_STORAGE_KEY
    );
  }

  window.dispatchEvent(new Event(CONSTELLATION_BACKGROUND_EVENT));
}

function clearConstellationBackgroundCrashMarked() {
  setConstellationBackgroundCrashMarked(false);
}

export function readConstellationBackgroundConstellationId() {
  if (typeof window === "undefined") {
    return "";
  }

  return (
    window.localStorage.getItem(
      CONSTELLATION_BACKGROUND_CONSTELLATION_ID_STORAGE_KEY
    ) ?? ""
  );
}

export function setConstellationBackgroundConstellationId(
  constellationId: string
) {
  if (typeof window === "undefined") {
    return;
  }

  if (constellationId) {
    window.localStorage.setItem(
      CONSTELLATION_BACKGROUND_CONSTELLATION_ID_STORAGE_KEY,
      constellationId
    );
  } else {
    window.localStorage.removeItem(
      CONSTELLATION_BACKGROUND_CONSTELLATION_ID_STORAGE_KEY
    );
  }

  window.dispatchEvent(new Event(CONSTELLATION_BACKGROUND_EVENT));
}
