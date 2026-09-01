/**
 * Jami's star, in one place.
 *
 * The reward moment, the walkthrough's progress trail, the sky and the
 * signed-out landing page all draw the same star. Keeping the path
 * here is what makes them read as one object at three sizes rather than three
 * unrelated star drawings, and it is why the reward can grow its own animated
 * layers without the small ones drifting away from it.
 *
 * Drawn in a 160 box so the reward's traced outline has room for whole-number
 * coordinates; `northernStarTransform` places it at any point and size.
 */
export const NORTHERN_STAR_BOX = 160;

/**
 * Eight rays on curves: four long, four short diagonals, all tapering.
 *
 * Radius 79 vertically, 62 horizontally, 22 on the diagonals, drawn as
 * quadratic curves through a waist vertex at radius 9. Every edge bows toward
 * the centre, so a ray is widest where it leaves the body and comes to a fine
 * point -- which is what makes it read as light rather than as a shape.
 *
 * This was straight-edged for a long time and every version of it was called
 * chunky or plain: at four points and at six, at waists from 0.35 down to
 * 0.165. Thinning was never the answer, because a straight-sided polygon reads
 * as a polygon at any weight. Two things fixed it. Curving the edges makes each
 * ray taper instead of running at a constant slope, and the four short
 * diagonals give the eye something between the long rays, which is the
 * difference between a cross and a star.
 *
 * Concave four-point shapes were tried alongside these and read as fat
 * diamonds -- deep curves between only four tips leave too much body in the
 * middle. Eight tips is what keeps the curves shallow enough to stay sharp.
 *
 * This is also no longer the same shape family as JamiTutorIcon, which is three
 * flat four-point sparkles. That collision has been a standing note here since
 * the six-point version was reverted; the curves and the secondary points close
 * it, and an earned star is now unmistakably not an offer of help.
 */
export const NORTHERN_STAR_PATH =
  "M80 1Q83.44 71.69 95.56 64.44Q88.31 76.56 142 80Q88.31 83.44 95.56 95.56Q83.44 88.31 80 159Q76.56 88.31 64.44 95.56Q71.69 83.44 18 80Q71.69 76.56 64.44 64.44Q76.56 71.69 80 1Z";

/**
 * The smaller cut-out that gives the filled star its facet.
 *
 * The same eight rays on the same curves, at 40 per cent. A facet of a
 * different shape from the star holding it reads as a mistake rather than a
 * highlight.
 */
export const NORTHERN_STAR_FACET_PATH =
  "M80 48.4Q81.38 76.67 86.22 73.78Q83.33 78.62 104.8 80Q83.33 81.38 86.22 86.22Q81.38 83.33 80 111.6Q78.62 83.33 73.78 86.22Q76.67 81.38 55.2 80Q76.67 78.62 73.78 73.78Q78.62 76.67 80 48.4Z";

/**
 * Places the star at `x, y` drawn `size` across, in the caller's own viewBox.
 *
 * Transforms apply left to right: the path is centred on the origin first, so
 * scaling and positioning act on its middle rather than its corner.
 */
export function northernStarTransform(x: number, y: number, size: number) {
  const scale = size / NORTHERN_STAR_BOX;
  return `translate(${x} ${y}) scale(${scale}) translate(-80 -80)`;
}
