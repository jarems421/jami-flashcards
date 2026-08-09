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
  /**
   * How much sharper than the turns either side of it a turn must be before it
   * is drawn as a corner.
   *
   * One is no requirement at all: any turn past `cornerDegrees` is a point,
   * which is what "None" has to mean. Above one, a turn also has to stand out
   * from its neighbours, which is what stops a tightly drawn curve being read
   * as a run of corners -- but it is smoothing, and applying it at the faithful
   * end quietly rounded off turns somebody had asked to keep.
   */
  cornerDominance: number;
};

/**
 * No smoothing. Corners are taken at the slightest turn and nothing is eased,
 * so the line goes exactly where it was taken -- wobble included.
 */
const NO_SMOOTHING: NotebookPenFeel = {
  /*
   * Low enough that an ordinary turn is a turn.
   *
   * This was 18, which sounds faithful and is not: the threshold is what a
   * turn has to exceed to survive as a point, and the turns handwriting is
   * made of -- the shoulder of an 'n', the corner of a 'z', the change of
   * direction at the top of a stem -- run from about twenty degrees up. At 18
   * they only just cleared it, and at any setting above None they did not,
   * which is why turning still felt assisted however far the slider came down.
   */
  cornerDegrees: 8,
  easeTowardsNeighbours: 0,
  cornerDominance: 1,
};

/**
 * Full smoothing. Only a turn that is unmistakably a point is drawn as one.
 *
 * The corner ceiling used to stop short of a right angle, because nothing else
 * protected the point of a `v` or the cusp between two joined letters: raise
 * the threshold past those and the pen starts refusing to go where it was
 * taken, which is a worse complaint than a slightly angular curve. The pen now
 * treats a turn past a hundred degrees as a corner whatever this says, so those
 * are safe on their own account and the ceiling is free to sit where it is
 * useful -- which is above the tightest turn a small letter makes, since that
 * was being drawn as a point at every setting.
 *
 * The easing ceiling is low, and it is the one that was got wrong first time
 * round. Easing is the only part of this that moves the line off the points the
 * pen visited, and it does so in proportion: measured on cursive at a 34px
 * x-height, the line sits 0.11px off with none of it and 0.55px off at 0.62,
 * which is felt as the pen resisting at every turn. What answers the
 * joined-up-dots complaint is the corner threshold, and that costs no deviation
 * at all -- so the corner threshold carries the range and easing stops at the
 * light touch it has always had.
 */
const FULL_SMOOTHING: NotebookPenFeel = {
  cornerDegrees: 82,
  easeTowardsNeighbours: 0.34,
  cornerDominance: 1.7,
};

export function clampNotebookPenSmoothing(value: number) {
  if (!Number.isFinite(value)) return NOTEBOOK_PEN_SMOOTHING_DEFAULT;
  return Math.round(Math.max(0, Math.min(100, value)));
}

export function getNotebookPenFeel(smoothingPercent: number): NotebookPenFeel {
  const towards = clampNotebookPenSmoothing(smoothingPercent) / 100;
  const between = (from: number, to: number) => from + (to - from) * towards;

  /*
   * The corner threshold rises slowly at first and steeply at the end.
   *
   * Straight interpolation put it at 34 degrees a quarter of the way along and
   * 50 at the halfway point -- and handwriting turns are twenty to fifty
   * degrees, so from Light upwards nearly every one of them was already being
   * carried through as a curve. The slider had a faithful end and a smoothed
   * end with almost nothing between: turning felt assisted wherever it was set.
   *
   * So the threshold now climbs slowly through the first half of the travel and
   * quickly through the second, which gives the low settings to the range a
   * hand actually turns in.
   *
   * Squaring it outright was the first attempt and went too far the other way:
   * it dropped the default from 58 degrees to 36, and cursive at a small
   * x-height went straight back to being drawn as a run of chords -- the
   * complaint the default exists to answer. This leaves the default where it
   * was and takes the slack out of the bottom instead.
   */
  const easedTowards = towards * towards * (3 - 2 * towards);

  return {
    cornerDegrees:
      NO_SMOOTHING.cornerDegrees +
      (FULL_SMOOTHING.cornerDegrees - NO_SMOOTHING.cornerDegrees) *
        easedTowards,
    easeTowardsNeighbours: between(
      NO_SMOOTHING.easeTowardsNeighbours,
      FULL_SMOOTHING.easeTowardsNeighbours
    ),
    cornerDominance: between(
      NO_SMOOTHING.cornerDominance,
      FULL_SMOOTHING.cornerDominance
    ),
  };
}

export type NotebookPenSmoothingLabel = {
  name: string;
  description: string;
};

/**
 * What the current setting is called, and what it does, in the panel.
 *
 * Named for how much smoothing is being applied, because that is what the
 * control is called. Naming the resulting line instead put the word and the
 * label in different terms, which is a thing to work out rather than read.
 */
export function getNotebookPenSmoothingLabel(
  smoothingPercent: number
): NotebookPenSmoothingLabel {
  const percent = clampNotebookPenSmoothing(smoothingPercent);
  if (percent < 25) {
    return {
      name: "None",
      description: "Nothing is smoothed; every turn you make is drawn as a point",
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
      name: "Medium",
      description: "Carries curves through, keeps deliberate points",
    };
  }
  return {
    name: "Strong",
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
