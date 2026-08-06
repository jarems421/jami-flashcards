/**
 * How much the pen tidies up what the hand did.
 *
 * The two settings here are what decide whether writing reads as flowing or as
 * a chain of short straight runs, and there is no single right answer to either:
 * a fast joined-up hand wants the line carried through, and a careful printed
 * one wants every deliberate point kept. So it is a setting rather than a
 * constant.
 */

export const NOTEBOOK_PEN_SMOOTHING_STORAGE_KEY = "jami:notebook-pen-smoothing";

/**
 * Toward the flowing end, because the previous fixed behaviour sat lower and
 * read as joining up dots: on a small letter the samples turn far enough
 * between one kept point and the next that a plain curve was being taken for a
 * deliberate corner, and a run of those is drawn as a run of chords.
 */
export const NOTEBOOK_PEN_SMOOTHING_DEFAULT = 62;

export type NotebookPenFeel = {
  /**
   * How sharply the line must turn at a point before it is drawn as a corner
   * rather than carried through as a curve, in degrees.
   */
  cornerDegrees: number;
  /**
   * How far an interior point may be eased towards the line between its
   * neighbours, as a fraction of the way there.
   */
  easeTowardsNeighbours: number;
};

/**
 * The faithful end. Corners are taken at the slightest turn and nothing is
 * eased, so the line goes exactly where it was taken -- wobble included.
 */
const FAITHFUL: NotebookPenFeel = {
  cornerDegrees: 18,
  easeTowardsNeighbours: 0,
};

/**
 * The flowing end. Only a turn that is unmistakably a point is drawn as one,
 * and wobble is eased well down.
 *
 * The corner ceiling is deliberately short of a right angle: past that, the
 * point of a `v` and the cusp between two joined letters stop being corners
 * and the pen starts refusing to go where it was taken, which is a worse
 * complaint than a slightly angular curve.
 */
const FLOWING: NotebookPenFeel = {
  cornerDegrees: 62,
  easeTowardsNeighbours: 0.62,
};

export function clampNotebookPenSmoothing(value: number) {
  if (!Number.isFinite(value)) return NOTEBOOK_PEN_SMOOTHING_DEFAULT;
  return Math.round(Math.max(0, Math.min(100, value)));
}

export function getNotebookPenFeel(smoothingPercent: number): NotebookPenFeel {
  const towards = clampNotebookPenSmoothing(smoothingPercent) / 100;
  const between = (from: number, to: number) => from + (to - from) * towards;

  return {
    cornerDegrees: between(FAITHFUL.cornerDegrees, FLOWING.cornerDegrees),
    easeTowardsNeighbours: between(
      FAITHFUL.easeTowardsNeighbours,
      FLOWING.easeTowardsNeighbours
    ),
  };
}

export type NotebookPenSmoothingLabel = {
  name: string;
  description: string;
};

/** What the current setting is called, and what it does, in the panel. */
export function getNotebookPenSmoothingLabel(
  smoothingPercent: number
): NotebookPenSmoothingLabel {
  const percent = clampNotebookPenSmoothing(smoothingPercent);
  if (percent < 25) {
    return {
      name: "Faithful",
      description: "Draws every turn of the pen, wobble included",
    };
  }
  if (percent < 50) {
    return {
      name: "Light",
      description: "Keeps fine detail, eases the worst of the wobble",
    };
  }
  if (percent < 75) {
    return {
      name: "Balanced",
      description: "Carries curves through, keeps deliberate points",
    };
  }
  return {
    name: "Flowing",
    description: "Rounds the line out; only sharp turns stay points",
  };
}

export function readNotebookPenSmoothingPreference() {
  if (typeof window === "undefined") return NOTEBOOK_PEN_SMOOTHING_DEFAULT;

  try {
    const stored = window.localStorage.getItem(
      NOTEBOOK_PEN_SMOOTHING_STORAGE_KEY
    );
    if (stored === null) return NOTEBOOK_PEN_SMOOTHING_DEFAULT;
    const parsed = Number(stored);
    return Number.isFinite(parsed)
      ? clampNotebookPenSmoothing(parsed)
      : NOTEBOOK_PEN_SMOOTHING_DEFAULT;
  } catch {
    // Storage can be unavailable in privacy modes; the default stands.
    return NOTEBOOK_PEN_SMOOTHING_DEFAULT;
  }
}

export function saveNotebookPenSmoothingPreference(percent: number) {
  try {
    window.localStorage.setItem(
      NOTEBOOK_PEN_SMOOTHING_STORAGE_KEY,
      String(clampNotebookPenSmoothing(percent))
    );
  } catch {
    // This is a non-critical, device-local preference.
  }
}
