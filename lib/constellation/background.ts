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
 * The constellation page draws the same sky in the middle of itself, and a
 * second copy behind that is noise.
 *
 * Notebooks have now been added and removed three times, so the short version
 * is worth having in one place before anyone tries a fourth:
 *
 *  - excluded when the notebook viewport was rewritten, with no note saying why;
 *  - allowed on 1 September, on the reasoning that page colours are solid so
 *    stars can only sit around the paper;
 *  - excluded the next day after a student's handwriting turned up squashed
 *    into a corner, blamed on the sky's class landing after the notebook had
 *    measured its frame -- diagnosis by timing, never reproduced;
 *  - allowed again on 3 September with that answered: the class is stamped by
 *    the blocking script in the head now, so the palette is right in the first
 *    painted frame and nothing about it changes afterwards;
 *  - and excluded again the same day, because it was tried on an iPad and was
 *    buggy in use. That is the finding that counts. The class-timing theory was
 *    answered and the sky was still not fit to sit behind somebody writing, so
 *    whatever is wrong is something else, and it has not been found yet.
 *
 * What is known and unresolved is the cost: forty stars, each a masked element
 * carrying two drop-shadows, plus their sparkles -- roughly 160 layers -- behind
 * a canvas that clears and repaints its whole backing store on every frame of a
 * stroke. Nobody has profiled that on the device it matters on. Do not put this
 * back without doing so, and without a symptom written down here.
 */
export const CONSTELLATION_BACKGROUND_EXCLUDED_PATHS = [
  "/dashboard/constellation",
  "/dashboard/notebooks/",
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
