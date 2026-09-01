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
 * Four rays on deep curves: radius 79 vertical, 62 horizontal, waist 5.
 *
 * Each edge is a quadratic bowing hard toward the centre, so a ray is widest
 * where it leaves the body and comes to a fine point. That taper is what makes
 * it read as light rather than as a shape, and it is what every straight-edged
 * version was missing -- a straight-sided polygon reads as a polygon at any
 * weight, which is why five rounds of thinning never fixed "chunky" or "plain".
 *
 * It briefly carried four short diagonal rays as well. They gave the eye
 * something between the long ones, but at 22 units they were small enough to
 * read as pixelation from any distance -- and lengthening them to 34 or 44
 * turns this into an ornate eight-pointed star, which is a different object.
 * Four rays and nothing else is the cleaner answer.
 *
 * The waist is the number that matters, and it is small: 5, not the 10 to 20
 * tried first. Deep curves between only four tips leave a lot of body in the
 * middle, and at anything above about 8 the star stops being a star and becomes
 * a rounded diamond with points on it.
 *
 * This is no longer the same shape family as JamiTutorIcon, which is three flat
 * four-point sparkles with straight edges. That collision was a standing note
 * here from the six-point version onward; curved tapering rays close it, and an
 * earned star is now unmistakably not an offer of help.
 */
export const NORTHERN_STAR_PATH =
  "M80 1Q83.54 76.46 142 80Q83.54 83.54 80 159Q76.46 83.54 18 80Q76.46 76.46 80 1Z";

/**
 * The smaller cut-out that gives the filled star its facet.
 *
 * The same four rays on the same curves, at 40 per cent. A facet of a
 * different shape from the star holding it reads as a mistake rather than a
 * highlight.
 */
export const NORTHERN_STAR_FACET_PATH =
  "M80 48.4Q81.41 78.59 104.8 80Q81.41 81.41 80 111.6Q78.59 81.41 55.2 80Q78.59 78.59 80 48.4Z";

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
