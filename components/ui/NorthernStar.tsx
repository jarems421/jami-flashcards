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
 * Four rays on cubic curves: radius 79 vertical, 62 horizontal, pull 0.95.
 *
 * Each edge leaves its tip travelling straight down that tip's own axis, then
 * turns into the next tip along the other axis. Both control points sit on the
 * axes at 95 per cent of the way to the centre, which is what pinches the body
 * to almost nothing and leaves four fine rays meeting at a point.
 *
 * These were quadratics for a while, and quadratics could not do this. One
 * control point has to serve both ends of an edge, so it cannot leave the top
 * tip vertically and arrive at the side tip horizontally, and the middle stays
 * fat however far the control is dragged in -- the body barely moved between a
 * waist of 20 and a waist of 5. A cubic has a control point per end, which is
 * the whole reason this shape is finally thin.
 *
 * `pull` is the number to reach for if it ever needs adjusting again: 0.7 is a
 * fuller star, 0.95 is this one, 1.0 collapses the body entirely.
 *
 * It briefly carried four short diagonal rays as well. They gave the eye
 * something between the long ones, but at 22 units they read as pixelation from
 * a distance -- and lengthening them to 34 or 44 turns this into an ornate
 * eight-pointed star, which is a different object. Four rays and nothing else
 * is the cleaner answer, and it leaves no feature small enough to alias.
 *
 * This is no longer the same shape family as JamiTutorIcon, which is three flat
 * four-point sparkles with straight edges. That collision was a standing note
 * here from the six-point version onward; curved tapering rays close it, and an
 * earned star is now unmistakably not an offer of help.
 */
export const NORTHERN_STAR_PATH =
  "M80 1C80 76.05 83.1 80 142 80C83.1 80 80 83.95 80 159C80 83.95 76.9 80 18 80C76.9 80 80 76.05 80 1Z";

/**
 * The smaller cut-out that gives the filled star its facet.
 *
 * The same four rays on the same curves, at 40 per cent. A facet of a
 * different shape from the star holding it reads as a mistake rather than a
 * highlight.
 */
export const NORTHERN_STAR_FACET_PATH =
  "M80 48.4C80 78.42 81.24 80 104.8 80C81.24 80 80 81.58 80 111.6C80 81.58 78.76 80 55.2 80C78.76 80 80 78.42 80 48.4Z";

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
