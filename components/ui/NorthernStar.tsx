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
 * Four points, 1.63 times taller than wide, on a 0.24 waist.
 *
 * Outer radius 78 vertically and 48 horizontally, with the inner vertices on
 * the 45-degree diagonals at radius 19. The stretch is the whole point: a pole
 * star is drawn taller than it is wide, and a symmetrical four-point star is
 * just a sparkle.
 *
 * The waist is what has moved most. It was 0.25 and unstretched, which is a
 * sparkle rather than a star; then six points at 0.28, which read as an
 * asterisk at the 18-26px an ordinary sky is full of; then four points at 0.35,
 * which was legible but chunky. This is thin without being needle-like -- long
 * rays on a long axis, which is the shape that reads as calm rather than as
 * spiky or as heavy.
 *
 * The cost is real and worth stating: this is the same shape family as
 * JamiTutorIcon. What separates them is that an earned star is one tall faceted
 * star and the AI mark is three small flat ones -- carried by composition
 * rather than by geometry.
 */
export const NORTHERN_STAR_PATH =
  "M80 2L93.44 66.56L128 80L93.44 93.44L80 158L66.56 93.44L32 80L66.56 66.56Z";

/**
 * The smaller cut-out that gives the filled star its facet.
 *
 * The same four points at the same waist and stretch, at 40 per cent. A facet
 * of a different shape from the star holding it reads as a mistake rather than
 * a highlight.
 */
export const NORTHERN_STAR_FACET_PATH =
  "M80 48.8L85.37 74.63L99.2 80L85.37 85.37L80 111.2L74.63 85.37L60.8 80L74.63 74.63Z";

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
