/**
 * Which way the highlighter's flat edge is pointing.
 *
 * A chisel nib is a flat edge, and which way that edge faces is what gives the
 * stroke its character. Held at a fixed angle it produces the broad horizontal
 * sweep and slanted ends the highlighter already draws. A real one turns with
 * the hand, and this is where that turn is worked out.
 *
 * The honest signal for it would be `twist` -- rotation about the pen's own
 * axis, which is exactly what turns a physical chisel edge. No stylus this app
 * runs on reports it: Safari leaves `twist` at 0 for Apple Pencil. So azimuth
 * stands in for it. That is a real approximation rather than a free one -- a
 * writer *can* roll the barrel without swinging it -- but grip couples the two
 * closely enough that the edge follows the hand, which is the whole point.
 *
 * Pure geometry, no DOM beyond the shape of the event it is handed.
 */

/**
 * The edge angle used when the pointer says nothing about its orientation.
 *
 * Steep enough that ordinary left-to-right highlighting keeps nearly the full
 * thickness (sin 65 degrees is about 0.91) while still slanting the ends
 * enough to read as a chisel rather than a rectangle.
 *
 * This is also the floor of the whole feature: a mouse, a finger, a stylus
 * that reports no angles, and a browser that exposes none all land here, and
 * land on exactly the stroke this file drew before any of it was measured.
 */
export const NIB_ANGLE_DEFAULT_DEGREES = 65;

/**
 * The angle between the barrel's projected direction and the nib's flat edge.
 *
 * The grip constant. A pen is held with the nib at some fixed rotation
 * relative to the barrel, so this is what converts "which way the pen is
 * lying" into "which way the edge faces".
 *
 * Its value is chosen for continuity rather than derived: a right-handed
 * writer's barrel projects up and to the left, near 135 degrees, and -70 puts
 * the edge at the 65 degrees this file used when the angle was fixed. So the
 * common grip draws what it drew before, and moving away from that grip is
 * what changes the stroke.
 */
const NIB_EDGE_OFFSET_DEGREES = -70;

/**
 * Above this altitude the azimuth is not worth reading.
 *
 * Azimuth is the direction the barrel lies in, projected onto the page, and a
 * pen held straight up does not lie in any direction: the projection collapses
 * to a point and its angle is whatever noise the sensor had. This is a
 * coordinate singularity, not a sensor defect -- it cannot be filtered out,
 * because there is no signal underneath it to recover.
 *
 * So it is not filtered. Near vertical the last angle that meant something is
 * held instead, which is also what the hand is doing: a pen passing through
 * vertical has not changed grip, it has changed lean.
 *
 * 75 degrees rather than something closer to 90 because the noise grows as the
 * projection shortens, well before it vanishes.
 */
const AZIMUTH_UNRELIABLE_ALTITUDE_DEGREES = 75;

/**
 * How quickly the edge follows the hand, per sample.
 *
 * The edge is smoothed for the same reason the path is: the raw signal carries
 * tremor, and an edge that jitters makes both sides of a broad stroke ripple.
 * It is a much slower filter than the path's, because grip changes over a
 * stroke, not within a sample -- fast tracking here would buy nothing and
 * spend the steadiness of the outline.
 */
const NIB_FOLLOW_RATE = 0.12;

const DEGREES = Math.PI / 180;

export const NIB_ANGLE_DEFAULT = NIB_ANGLE_DEFAULT_DEGREES * DEGREES;

/** The event shape this needs, so callers can pass a `PointerEvent` as-is. */
export type NotebookNibPointerLike = {
  pointerType?: string;
  altitudeAngle?: number;
  azimuthAngle?: number;
  tiltX?: number;
  tiltY?: number;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * The barrel's direction across the page, in radians, or null if it has none.
 *
 * Safari reports `azimuthAngle` for Apple Pencil directly. Chrome reports tilt
 * about each axis instead, and the conversion is not `atan2(tiltY, tiltX)`:
 * tilts are angles away from vertical, so each contributes its *tangent* to
 * the projected direction. Using the raw tilts skews everything away from the
 * diagonals, worst at 45 degrees.
 */
export function barrelAzimuth(event: NotebookNibPointerLike): number | null {
  // A browser that does not measure azimuth reports a literal zero on every
  // sample, so a persistent zero is a default rather than a reading. A pen
  // genuinely pointing along +X does cross it, and costs one held sample.
  if (isFiniteNumber(event.azimuthAngle) && event.azimuthAngle !== 0) {
    return event.azimuthAngle;
  }

  const tiltX = isFiniteNumber(event.tiltX) ? event.tiltX : 0;
  const tiltY = isFiniteNumber(event.tiltY) ? event.tiltY : 0;
  if (tiltX === 0 && tiltY === 0) return null;

  return Math.atan2(Math.tan(tiltY * DEGREES), Math.tan(tiltX * DEGREES));
}

/**
 * The nib's edge angle for one pointer sample, or null to keep the last one.
 *
 * Null is returned for everything that is not a pen, for a pen reporting no
 * orientation, and for a pen too upright to have a usable azimuth. In all of
 * those the caller holds what it had, and a stroke that never gets an answer
 * uses the default throughout.
 */
export function nibAngleFromPointer(
  event: NotebookNibPointerLike
): number | null {
  if (event.pointerType !== undefined && event.pointerType !== "pen") {
    return null;
  }

  // `altitudeAngle` is measured up from the page, so a vertical pen reads near
  // 90 degrees and a pen lying flat reads near 0 -- the opposite way round from
  // "angle away from vertical", which is the easy way to get this backwards.
  if (
    isFiniteNumber(event.altitudeAngle) &&
    event.altitudeAngle > AZIMUTH_UNRELIABLE_ALTITUDE_DEGREES * DEGREES
  ) {
    return null;
  }

  const azimuth = barrelAzimuth(event);
  if (azimuth === null) return null;

  return azimuth + NIB_EDGE_OFFSET_DEGREES * DEGREES;
}

/**
 * The shortest way round from one angle to another.
 *
 * Averaging angles by their numbers is wrong wherever the wrap sits: 359 and 1
 * degrees average to 180, pointing the edge exactly backwards. Every step this
 * tracker takes goes through here so the wrap is never crossed arithmetically.
 */
export function angleDelta(from: number, to: number): number {
  const turn = Math.PI * 2;
  const raw = (((to - from) % turn) + turn) % turn;
  return raw > Math.PI ? raw - turn : raw;
}

/**
 * Follows the nib's edge across a stroke.
 *
 * One per editor rather than one per stroke, deliberately: grip persists
 * between strokes, so the angle a stroke starts at should be the one the hand
 * finished the last stroke holding, not a default it has to climb out of
 * again. A stroke that begins during the climb would otherwise be laid down at
 * an angle the pen was never at.
 */
export class NotebookNibAngleTracker {
  private angle = NIB_ANGLE_DEFAULT;
  private measured = false;

  /** The edge angle to draw with now, in radians. */
  current(): number {
    return this.angle;
  }

  /** Whether a pointer has ever reported a usable orientation. */
  get hasMeasurement(): boolean {
    return this.measured;
  }

  observe(event: NotebookNibPointerLike): number {
    const target = nibAngleFromPointer(event);
    if (target === null) return this.angle;

    if (!this.measured) {
      // The first real measurement is taken whole. Easing towards it from the
      // default would draw the opening of the stroke at an angle that is
      // neither the default nor the hand's.
      this.measured = true;
      this.angle = target;
      return this.angle;
    }

    this.angle += angleDelta(this.angle, target) * NIB_FOLLOW_RATE;
    return this.angle;
  }

  reset() {
    this.angle = NIB_ANGLE_DEFAULT;
    this.measured = false;
  }
}
