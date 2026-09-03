export const CONSTELLATION_BACKGROUND_STORAGE_KEY =
  "constellation-background-enabled";
export const CONSTELLATION_BACKGROUND_CONSTELLATION_ID_STORAGE_KEY =
  "constellation-background-constellation-id";
export const CONSTELLATION_BACKGROUND_CRASH_MARKER_STORAGE_KEY =
  "constellation-background-crash-marked";
export const CONSTELLATION_BACKGROUND_EVENT =
  "constellation-background-change";

/**
 * Where the star field is never drawn, whatever the preference says.
 *
 * One list, because two things read it a frame apart: the blocking script in
 * the head, which stamps the sky's class before the first paint, and the shell,
 * which stamps it again from an effect. They disagreed about notebooks for a
 * day -- the script put the sky on and the effect took it straight back off --
 * so opening a notebook painted in one palette and swapped to another. Reading
 * one list is what stops that happening to the next path added here.
 *
 * Only the constellation page is on it. That page draws the same sky in the
 * middle of itself, and a second copy behind that is noise.
 *
 * Notebooks were on this list twice and are off it again, deliberately. The
 * reason given last time was a class flip landing after the notebook had
 * measured its frame -- the shape of a report about handwriting squashed into a
 * corner -- and that reason has been answered rather than ignored: the class is
 * stamped by the blocking script now, so on a notebook route the palette is
 * correct in the first painted frame and nothing about it changes afterwards.
 * None of the rules that arrive with the class affect layout in any case; they
 * set colours, backgrounds and backdrop filters.
 *
 * What has not been answered is the frame cost of forty animated, filtered
 * layers behind a canvas that repaints on every stroke. `globals.css` holds
 * every sky animation still while a notebook is open, which is the mitigation
 * that ships with this; whether that is the right trade is a question for
 * somebody writing on an iPad, not for a test.
 */
export const CONSTELLATION_BACKGROUND_EXCLUDED_PATHS = [
  "/dashboard/constellation",
];

export function allowsConstellationBackground(pathname: string) {
  return !CONSTELLATION_BACKGROUND_EXCLUDED_PATHS.some((prefix) =>
    pathname.startsWith(prefix)
  );
}

export function getConstellationBackgroundActionLabel(enabled: boolean) {
  return enabled ? "Remove background" : "Use as background";
}

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
