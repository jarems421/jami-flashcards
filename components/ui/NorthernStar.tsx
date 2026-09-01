/**
 * Jami's star, in one place.
 *
 * The reward moment, the walkthrough's progress trail and the signed-out
 * landing page all draw the same eight-point northern star. Keeping the path
 * here is what makes them read as one object at three sizes rather than three
 * unrelated star drawings, and it is why the reward can grow its own animated
 * layers without the small ones drifting away from it.
 *
 * Drawn in a 160 box so the reward's traced outline has room for whole-number
 * coordinates; `northernStarTransform` places it at any point and size.
 */
export const NORTHERN_STAR_BOX = 160;

/**
 * Six points, a 0.28 waist, and 1.18 taller than it is wide.
 *
 * It was four points at a 0.25 waist, which is very nearly a cross, and the
 * same shape family as the three sparkles that mean "Jami can help here" -- so
 * only size and count told an earned star apart from an offer of help. Six
 * points separates them outright, and the vertical stretch is what makes it a
 * northern star rather than a generic one: the pole star is drawn taller than
 * it is wide.
 */
export const NORTHERN_STAR_PATH =
  "M80 4.48L88.96 64.48L135.43 42.24L97.92 80L135.43 117.76L88.96 95.52L80 155.52L71.04 95.52L24.57 117.76L62.08 80L24.57 42.24L71.04 64.48Z";

/**
 * The smaller cut-out that gives the filled star its facet.
 *
 * The same six points at the same waist and stretch, at 40 per cent. A facet
 * of a different shape from the star holding it reads as a mistake rather than
 * a highlight.
 */
export const NORTHERN_STAR_FACET_PATH =
  "M80 49.79L83.58 73.79L102.17 64.9L87.17 80L102.17 95.1L83.58 86.21L80 110.21L76.42 86.21L57.83 95.1L72.83 80L57.83 64.9L76.42 73.79Z";

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
