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
 * Four points, 1.36 times taller than wide, on a 0.165 waist.
 *
 * Outer radius 79 vertically and 58 horizontally, with the inner vertices on
 * the 45-degree diagonals at radius 13. The side points are far longer than a
 * strict pole star would draw them -- reaching 58 from a 13 waist, they are
 * thinner in proportion the further out they go, which is what makes a wide
 * star still read as delicate rather than as a cross. The stretch is the whole point: a pole
 * star is drawn taller than it is wide, and a symmetrical four-point star is
 * just a sparkle.
 *
 * The waist is what has moved most, and always in the same direction once the
 * shape settled. It was 0.25 and unstretched, which is a sparkle rather than a
 * star; then six points at 0.28, which read as an asterisk at the 18-26px an
 * ordinary sky is full of; then four points at 0.35, then 0.24, both still
 * called chunky. At 0.165 on a near-2:1 axis the star is a thin cross of light.
 * What keeps it legible at 18px is not its width but its glow -- the shape got
 * thinner and the light around it got stronger in the same pass, which is why
 * neither reads as weak.
 *
 * The cost is real and worth stating: this is the same shape family as
 * JamiTutorIcon. What separates them is that an earned star is one tall faceted
 * star and the AI mark is three small flat ones -- carried by composition
 * rather than by geometry.
 */
export const NORTHERN_STAR_PATH =
  "M80 1L89.19 70.81L138 80L89.19 89.19L80 159L70.81 89.19L22 80L70.81 70.81Z";

/**
 * The smaller cut-out that gives the filled star its facet.
 *
 * The same four points at the same waist and stretch, at 40 per cent. A facet
 * of a different shape from the star holding it reads as a mistake rather than
 * a highlight.
 */
export const NORTHERN_STAR_FACET_PATH =
  "M80 48.4L83.68 76.32L103.2 80L83.68 83.68L80 111.6L76.32 83.68L56.8 80L76.32 76.32Z";

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
