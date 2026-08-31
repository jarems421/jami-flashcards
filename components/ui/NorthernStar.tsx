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

export const NORTHERN_STAR_PATH =
  "M80 16L91 68L144 80L91 92L80 144L69 92L16 80L69 68L80 16Z";

/** The smaller cut-out that gives the filled star its facet. */
export const NORTHERN_STAR_FACET_PATH =
  "M80 54L84 76L106 80L84 84L80 106L76 84L54 80L76 76L80 54Z";

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
