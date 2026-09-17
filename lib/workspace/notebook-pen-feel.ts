/**
 * How much the pen tidies up what the hand did.
 *
 * The two settings here are what decide whether writing reads as flowing or as
 * a chain of short straight runs, and there is no single right answer to either:
 * a fast joined-up hand wants the line carried through, and a careful printed
 * one wants every deliberate point kept. So it is a setting rather than a
 * constant.
 */

import {
  NOTEBOOK_INK_SMOOTHING,
  type NotebookInkSmoothingOptions,
} from "@/lib/workspace/notebook-ink-smoothing";

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
  /**
   * The thinnest a tapered stroke goes, as a fraction of its own average.
   *
   * A floor, not an amount: it stops a light entry stroke starting from
   * nothing, and lowering it lets the taper run further down. Turning pressure
   * off is `pressureResponse` below, not this. See `pressurePercent`.
   */
  minimumWidthFraction: number;
  /**
   * How much of the reported pressure variation is drawn, as a multiplier.
   *
   * One draws it as reported, which is what the pen always did. Zero draws the
   * stroke at one width throughout -- not a flattened taper but no taper at
   * all, which is also the cheaper shape, since a stroke of one width is drawn
   * as a stroked path rather than as its own outline. Above one exaggerates.
   */
  pressureResponse: number;
  /**
   * Whether a snapped line is also pulled towards the nearest 45 degrees.
   *
   * Straightening and levelling are two favours, and only the first is asked
   * for by holding still. See `straightenOnHold`.
   */
  snapToGuides: boolean;
};

/** What the taper did before it was settable, and what 50% still gives. */
export const NOTEBOOK_MINIMUM_WIDTH_FRACTION_DEFAULT = 0.35;

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
  minimumWidthFraction: NOTEBOOK_MINIMUM_WIDTH_FRACTION_DEFAULT,
  pressureResponse: 1,
  snapToGuides: true,
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
  minimumWidthFraction: NOTEBOOK_MINIMUM_WIDTH_FRACTION_DEFAULT,
  pressureResponse: 1,
  snapToGuides: true,
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
    minimumWidthFraction: NOTEBOOK_MINIMUM_WIDTH_FRACTION_DEFAULT,
    pressureResponse: 1,
    snapToGuides: true,
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

/* ------------------------------------------------------------------------ *
 * Advanced settings
 *
 * The Smoothing slider above is one number standing in for several, chosen so
 * that the single control moves all of them somewhere sensible together. That
 * is the right default and the wrong ceiling: the reason a hand finds the ink
 * angular is not always the reason the next hand does, and moving one slider
 * moves the lot.
 *
 * So the constants each of these covers are also settable on their own, behind
 * a disclosure. Every one of them is defined so that the middle of its travel
 * reproduces exactly what the pen did before this existed -- these widen the
 * range, they do not move the default.
 * ------------------------------------------------------------------------ */

/**
 * What happens when the pen is held still at the end of a stroke.
 *
 * `guided` is the behaviour that was hard-coded: the stroke snaps straight and
 * the line is then pulled towards the nearest 45 degrees. `lines` snaps but
 * leaves the angle exactly as drawn, for anyone who wants a tidied line without
 * it also being levelled. `off` never replaces what was drawn.
 */
export const NOTEBOOK_STRAIGHTEN_MODES = ["off", "lines", "guided"] as const;
export type NotebookStraightenOnHold =
  (typeof NOTEBOOK_STRAIGHTEN_MODES)[number];

export type NotebookPenSettings = {
  /** The one control on the front of the panel. */
  smoothingPercent: number;
  /**
   * How readily a turn is kept as a point, or null to follow Smoothing.
   *
   * This is the half of Smoothing that answers the angular-writing complaint,
   * and it is the half people want separately: a hand that wants its wobble
   * filtered hard does not necessarily want its corners rounded off too, and
   * the single slider cannot give them one without the other.
   */
  cornerSharpnessPercent: number | null;
  /** How hard hand tremor is filtered out of the input, before any shaping. */
  steadinessPercent: number;
  /** How tightly the ink follows the nib, against how much noise survives. */
  trackingPercent: number;
  /** How much pen pressure is allowed to vary the width of the line. */
  pressurePercent: number;
  straightenOnHold: NotebookStraightenOnHold;
};

export const NOTEBOOK_PEN_SETTINGS_DEFAULT: NotebookPenSettings = {
  smoothingPercent: NOTEBOOK_PEN_SMOOTHING_DEFAULT,
  cornerSharpnessPercent: null,
  steadinessPercent: 50,
  trackingPercent: 50,
  pressurePercent: 50,
  straightenOnHold: "guided",
};

export const NOTEBOOK_PEN_SETTINGS_STORAGE_KEY = "jami:notebook-pen-settings";

/**
 * A percentage read onto a value whose middle is already spoken for.
 *
 * Each advanced control has to pass through the measured constant at 50, or
 * opening the panel would change how the pen writes -- so none of them is a
 * plain interpolation between two ends. Two straight runs meeting at the
 * default is the honest shape for that: no hidden curve, and the number in the
 * middle is exactly the one the comments above it were measured against.
 */
function throughTheMiddle(
  percent: number,
  at: { zero: number; fifty: number; hundred: number }
) {
  const towards = Math.max(0, Math.min(100, percent)) / 100;
  return towards <= 0.5
    ? at.zero + (at.fifty - at.zero) * (towards / 0.5)
    : at.fifty + (at.hundred - at.fifty) * ((towards - 0.5) / 0.5);
}

export function isNotebookStraightenOnHold(
  value: unknown
): value is NotebookStraightenOnHold {
  return (
    typeof value === "string" &&
    NOTEBOOK_STRAIGHTEN_MODES.includes(value as NotebookStraightenOnHold)
  );
}

/** Every field forced back into range, whatever storage or a caller handed over. */
export function clampNotebookPenSettings(
  settings: Partial<NotebookPenSettings> | null | undefined
): NotebookPenSettings {
  const percent = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.round(Math.max(0, Math.min(100, value)))
      : fallback;

  return {
    smoothingPercent: clampNotebookPenSmoothing(
      settings?.smoothingPercent ?? NOTEBOOK_PEN_SMOOTHING_DEFAULT
    ),
    // Null is a real value here -- "follow Smoothing" -- so it is kept rather
    // than filled in with the default it happens to resolve to today.
    cornerSharpnessPercent:
      settings?.cornerSharpnessPercent === null ||
      settings?.cornerSharpnessPercent === undefined
        ? null
        : percent(settings.cornerSharpnessPercent, 50),
    steadinessPercent: percent(settings?.steadinessPercent, 50),
    trackingPercent: percent(settings?.trackingPercent, 50),
    pressurePercent: percent(settings?.pressurePercent, 50),
    straightenOnHold: isNotebookStraightenOnHold(settings?.straightenOnHold)
      ? settings.straightenOnHold
      : NOTEBOOK_PEN_SETTINGS_DEFAULT.straightenOnHold,
  };
}

/** Whether anything under the disclosure has been moved off its default. */
export function hasNotebookPenAdvancedChanges(settings: NotebookPenSettings) {
  return (
    settings.cornerSharpnessPercent !== null ||
    settings.steadinessPercent !== 50 ||
    settings.trackingPercent !== 50 ||
    settings.pressurePercent !== 50 ||
    settings.straightenOnHold !== NOTEBOOK_PEN_SETTINGS_DEFAULT.straightenOnHold
  );
}

/** The advanced controls back to default, leaving Smoothing where it was set. */
export function resetNotebookPenAdvancedSettings(
  settings: NotebookPenSettings
): NotebookPenSettings {
  return {
    ...NOTEBOOK_PEN_SETTINGS_DEFAULT,
    smoothingPercent: clampNotebookPenSmoothing(settings.smoothingPercent),
  };
}

/**
 * Where the corner control sits when it is following Smoothing.
 *
 * Sharpness runs the other way from smoothing -- more smoothing is fewer
 * corners -- so following it is reading the same slider backwards. Having the
 * control show that rather than sitting blank means letting go of the link
 * never moves the pen: wherever the slider was, that is what it keeps doing.
 */
export function getNotebookCornerSharpness(settings: NotebookPenSettings) {
  return (
    settings.cornerSharpnessPercent ??
    100 - clampNotebookPenSmoothing(settings.smoothingPercent)
  );
}

/**
 * The full shaping feel, advanced settings included.
 *
 * Corner sharpness borrows the Smoothing curve read backwards rather than
 * inventing a second mapping: that curve was measured against real handwriting
 * at three sizes, and the corner threshold is the part of it those measurements
 * were mostly about. Easing still comes from Smoothing itself, because easing
 * is what smoothing means once corners have been taken out of it.
 */
export function getNotebookPenFeelFromSettings(
  settings: NotebookPenSettings
): NotebookPenFeel {
  const safe = clampNotebookPenSettings(settings);
  const fromSmoothing = getNotebookPenFeel(safe.smoothingPercent);
  const fromCorners = getNotebookPenFeel(100 - getNotebookCornerSharpness(safe));

  return {
    cornerDegrees: fromCorners.cornerDegrees,
    cornerDominance: fromCorners.cornerDominance,
    easeTowardsNeighbours: fromSmoothing.easeTowardsNeighbours,
    /*
     * Pressure is two constants, and they divide at the default.
     *
     * Below it, the variation itself is damped towards the stroke's average,
     * down to none of it at all -- which is a cheaper shape as well as a
     * steadier edge, since a stroke of one width takes the stroked path rather
     * than its own outline. Above it, the variation is pushed the other way
     * and the taper is allowed to run thinner, which is the calligraphic end.
     *
     * Splitting them is what lets the middle of the travel be exactly the pen
     * as it was: at 50 the response is 1 and the floor is where it has always
     * been, so neither half is doing anything yet.
     */
    minimumWidthFraction: throughTheMiddle(safe.pressurePercent, {
      zero: NOTEBOOK_MINIMUM_WIDTH_FRACTION_DEFAULT,
      fifty: NOTEBOOK_MINIMUM_WIDTH_FRACTION_DEFAULT,
      hundred: 0.12,
    }),
    pressureResponse: throughTheMiddle(safe.pressurePercent, {
      zero: 0,
      fifty: 1,
      hundred: 1.6,
    }),
    snapToGuides: safe.straightenOnHold === "guided",
  };
}

/**
 * The input filter's settings, which are a different thing from the shaping
 * above and are worth keeping apart.
 *
 * Everything in `NotebookPenFeel` decides what shape is drawn through the
 * samples. These two decide which samples there are in the first place, before
 * anything has been shaped -- so a hand that shakes and a hand that writes fast
 * are asking for opposite things here and the same thing there.
 *
 * Both ends of both are bounded by what was already measured in
 * `notebook-ink-smoothing.ts`: `minCutoff` runs down to where the ink starts to
 * feel magnetic and no further, and `trackingPercent` runs up through the
 * measured wobble/trail table rather than past the end of it.
 */
export function getNotebookInkSmoothingOptions(
  settings: NotebookPenSettings
): NotebookInkSmoothingOptions {
  const safe = clampNotebookPenSettings(settings);

  return {
    ...NOTEBOOK_INK_SMOOTHING,
    /*
     * Steadier means a lower cutoff, so this runs backwards. The floor is 4 Hz
     * rather than the 2 that was tried and rejected: at 2 the ink was reported
     * as magnetic, dragged towards where it had just been, and a setting nobody
     * should choose is not a wider range.
     */
    minCutoff: throughTheMiddle(safe.steadinessPercent, {
      zero: 20,
      fifty: NOTEBOOK_INK_SMOOTHING.minCutoff,
      hundred: 4,
    }),
    /*
     * The measured trade: 0.04 leaves 0.39px of wobble and a 2.87px trail,
     * 0.25 leaves 0.67px and 0.59px. The default sits at 0.08 because half the
     * surviving wobble is where a line starts to read as grainy -- which is a
     * reason to default under it, not a reason nobody may cross it.
     */
    beta: throughTheMiddle(safe.trackingPercent, {
      zero: 0.03,
      fifty: NOTEBOOK_INK_SMOOTHING.beta,
      hundred: 0.25,
    }),
  };
}

export type NotebookPenAdvancedLabel = {
  name: string;
  description: string;
};

/**
 * What each advanced control is doing where it currently sits.
 *
 * Bare percentages would be worse than nothing here: none of these is a
 * quantity the reader can picture, and the two ends of each trade against each
 * other rather than running from less to more.
 */
export function getNotebookCornerSharpnessLabel(
  percent: number
): NotebookPenAdvancedLabel {
  if (percent < 25) {
    return {
      name: "Flowing",
      description: "Only an unmistakable point is drawn as one",
    };
  }
  if (percent < 50) {
    return { name: "Rounded", description: "Curves carry through most turns" };
  }
  if (percent < 75) {
    return { name: "Crisp", description: "Deliberate turns come to a point" };
  }
  return {
    name: "Sharp",
    description: "Almost every turn is drawn as a corner",
  };
}

export function getNotebookSteadinessLabel(
  percent: number
): NotebookPenAdvancedLabel {
  if (percent < 34) {
    return { name: "Raw", description: "Hand tremor is left in the line" };
  }
  if (percent < 67) {
    return {
      name: "Balanced",
      description: "Filters tremor without holding the ink back",
    };
  }
  return {
    name: "Very steady",
    description: "Removes fine shake; slow strokes may feel slightly dragged",
  };
}

export function getNotebookTrackingLabel(
  percent: number
): NotebookPenAdvancedLabel {
  if (percent < 34) {
    return {
      name: "Relaxed",
      description: "Smoothest line; fast strokes trail the nib a little",
    };
  }
  if (percent < 67) {
    return {
      name: "Balanced",
      description: "Follows the nib closely with a steady line",
    };
  }
  return {
    name: "Immediate",
    description: "Ink stays under the nib; fast strokes may look grainier",
  };
}

export function getNotebookPressureLabel(
  percent: number
): NotebookPenAdvancedLabel {
  if (percent < 20) {
    return { name: "Off", description: "One width the whole way, like a biro" };
  }
  if (percent < 45) {
    return { name: "Subtle", description: "A slight swell where you press" };
  }
  if (percent < 75) {
    return {
      name: "Natural",
      description: "Width follows pressure as a pen does",
    };
  }
  return {
    name: "Expressive",
    description: "Wide strokes thin right down, like a brush",
  };
}

export function getNotebookStraightenLabel(
  mode: NotebookStraightenOnHold
): NotebookPenAdvancedLabel {
  if (mode === "off") {
    return { name: "Off", description: "Strokes are always left as drawn" };
  }
  if (mode === "lines") {
    return {
      name: "Straighten",
      description: "Hold still to snap a rough line straight, at your own angle",
    };
  }
  return {
    name: "Straighten and level",
    description: "Snaps straight, then nudges towards the nearest 45 degrees",
  };
}

export function readNotebookPenSettings(): NotebookPenSettings {
  if (typeof window === "undefined") return NOTEBOOK_PEN_SETTINGS_DEFAULT;

  try {
    // Anyone who set Smoothing before the advanced panel existed keeps it: the
    // old key is still the one that holds that number, and is still written.
    const smoothingPercent = readNotebookPenSmoothingPreference();
    const stored = window.localStorage.getItem(
      NOTEBOOK_PEN_SETTINGS_STORAGE_KEY
    );
    if (stored === null) {
      return { ...NOTEBOOK_PEN_SETTINGS_DEFAULT, smoothingPercent };
    }
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== "object" || parsed === null) {
      return { ...NOTEBOOK_PEN_SETTINGS_DEFAULT, smoothingPercent };
    }
    return clampNotebookPenSettings({
      ...(parsed as Partial<NotebookPenSettings>),
      smoothingPercent,
    });
  } catch {
    // Storage can be unavailable, and the stored value can be anything at all.
    return NOTEBOOK_PEN_SETTINGS_DEFAULT;
  }
}

export function saveNotebookPenSettings(settings: NotebookPenSettings) {
  const safe = clampNotebookPenSettings(settings);
  saveNotebookPenSmoothingPreference(safe.smoothingPercent);
  try {
    window.localStorage.setItem(
      NOTEBOOK_PEN_SETTINGS_STORAGE_KEY,
      JSON.stringify(safe)
    );
  } catch {
    // These are non-critical, device-local preferences.
  }
}
