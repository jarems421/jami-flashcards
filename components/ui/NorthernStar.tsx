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
 * Four points, 1.37 times taller than wide, on a 0.35 waist.
 *
 * Outer radius 74 vertically and 54 horizontally, with the inner vertices on
 * the 45-degree diagonals at radius 26. The stretch is the whole point: a pole
 * star is drawn taller than it is wide, and a symmetrical four-point star is
 * just a sparkle.
 *
 * This has been three shapes. It was symmetrical at a 0.25 waist -- needle-thin
 * and, being unstretched, not really a northern star at all. It was then six
 * points, which separated it outright from the three sparkles that mean "Jami
 * can help here", but read as an asterisk at the 18-26px an ordinary sky is
 * full of. Four broad points on a long vertical axis is legible small and still
 * looks like a star.
 *
 * The cost is real and worth stating: this is once again the same shape family
 * as JamiTutorIcon. What separates them now is that an earned star is one tall
 * faceted star and the AI mark is three small flat ones -- carried by
 * composition rather than by geometry.
 */
export const NORTHERN_STAR_PATH =
  "M80 6L98.38 61.62L134 80L98.38 98.38L80 154L61.62 98.38L26 80L61.62 61.62Z";

/**
 * The smaller cut-out that gives the filled star its facet.
 *
 * The same four points at the same waist and stretch, at 40 per cent. A facet
 * of a different shape from the star holding it reads as a mistake rather than
 * a highlight.
 */
export const NORTHERN_STAR_FACET_PATH =
  "M80 50.4L87.35 72.65L101.6 80L87.35 87.35L80 109.6L72.65 87.35L58.4 80L72.65 72.65Z";

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
