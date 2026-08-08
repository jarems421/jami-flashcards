type JamiTutorIconProps = {
  className?: string;
};

/**
 * The letter, as the area a pen of a given width would cover.
 *
 * A flat head, a straight stem, and a hook that is a true circle -- and every
 * part of it is a straight line or an exact arc, so it is right at any size
 * rather than an approximation that facets when drawn large. The two ends are
 * round, which is what a stroked version of the same letter would give.
 *
 * Solid rather than outlined because that is the language the sidebar already
 * speaks: every other entry there is a filled shape, and a single outlined mark
 * among them reads as belonging to a different set however well it is drawn.
 *
 * The stem is three units on a twenty-four grid, which is what sits it with its
 * neighbours -- lighter and it reads thin beside them, heavier and the counter
 * inside the hook starts to close at the twenty pixels a nav row draws it at.
 */
const LETTER =
  "M7.5 3.6H14.1a1.5 1.5 0 0 1 1.5 1.5v8.1a4.6 4.6 0 0 1-9.2 0 1.5 1.5 0 0 1 3 0 1.6 1.6 0 0 0 3.2 0V6.6H7.5a1.5 1.5 0 0 1 0-3Z";

/**
 * Her star, three times over, scattered rather than arranged.
 *
 * Three sizes, none of them the same distance from the letter and no two lined
 * up with each other -- placed evenly they read as a border around the mark
 * instead of as something in the air near it. The smallest two are the first to
 * go at a nav row's size, which is why the largest sits alone in the corner
 * with the most room around it.
 */
const STARS = [
  "M19.5 2.5l.65 1.25 1.25.65-1.25.65-.65 1.25-.65-1.25-1.25-.65 1.25-.65z",
  "M4.6 11.4l.34.66.66.34-.66.34-.34.66-.34-.66-.66-.34.66-.34z",
  "M18.2 15.3l.44.86.86.44-.86.44-.44.86-.44-.86-.86-.44.86-.44z",
];

/**
 * Jami's mark: her initial, and her star.
 *
 * Drawn wherever the tutor is offered, so a student recognises who they are
 * about to talk to before they read the label. `currentColor` throughout, so it
 * is muted in a resting nav row, accent in the assistant header, and inherited
 * on a button.
 */
export default function JamiTutorIcon({ className = "" }: JamiTutorIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      {[LETTER, ...STARS].map((shape) => (
        <path key={shape} fillRule="evenodd" clipRule="evenodd" d={shape} />
      ))}
    </svg>
  );
}
