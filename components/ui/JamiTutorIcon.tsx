type JamiTutorIconProps = {
  className?: string;
};

/**
 * How far down each braid bead sits, from the top of the braid.
 *
 * Four a side. The reference has more, but a bead is a filled dot under a
 * pixel across in a sidebar, and a fifth only closes the gaps between the
 * others into a bar.
 */
const BRAID_BEADS = [0, 1.9, 3.8, 5.7];

/**
 * Jami herself: the mark for the tutor, wherever the tutor is offered.
 *
 * Mostly strokes on a 24 grid rather than filled silhouettes, so the lenses,
 * the smile and the gaps between the braids stay open at the sizes this is used
 * at -- a filled version of the same drawing closes them into a blob as soon as
 * it goes in a nav row. The beads and the star are filled for the opposite
 * reason: a ring that small has no middle left to show.
 *
 * `currentColor` throughout, so it takes the colour of whatever offers it --
 * muted in a resting nav row, accent in the assistant header, inherited on a
 * button.
 */
export default function JamiTutorIcon({ className = "" }: JamiTutorIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {/* Face, down to a rounded chin. Its top is left open: the cap covers it. */}
      <path d="M8 9.7v2.6a4 4 0 008 0V9.7" />

      {/* Shoulders. */}
      <path d="M8.1 16.9c-1.9.8-3.1 2.2-3.1 3.9h14c0-1.7-1.2-3.1-3.1-3.9" />

      {/* Mortarboard: the board, then the cap under it. */}
      <path d="M12 2.7 20.9 6 12 9.3 3.1 6z" />
      <path d="M7.5 7.7v1.3c0 1.3 2 2.1 4.5 2.1s4.5-.8 4.5-2.1V7.7" />

      {/* Tassel, hanging from the left corner of the board. */}
      <path d="M3.7 6.4v2.4" />
      <circle cx="3.7" cy="9.8" r="0.95" fill="currentColor" stroke="none" />

      {/* The Jami star, at the right corner of the board. */}
      <path
        d="m20.5 6.6.66 1.36L22.5 8.6l-1.34.64L20.5 10.6l-.66-1.36L18.5 8.6l1.34-.64z"
        fill="currentColor"
        stroke="none"
      />

      {/* Glasses: two lenses and the bridge between them. */}
      <circle cx="10" cy="12.1" r="1.5" />
      <circle cx="14" cy="12.1" r="1.5" />
      <path d="M11.5 12.1h1" />

      {/* A smile, not a mouth: one stroke reads at every size. */}
      <path d="M10.8 14.7a1.9 1.9 0 002.4 0" />

      {/* Box braids, down both sides of the face. */}
      {BRAID_BEADS.map((offset) => (
        <circle
          key={`left-${offset}`}
          cx="6.1"
          cy={10.9 + offset}
          r="0.9"
          fill="currentColor"
          stroke="none"
        />
      ))}
      {BRAID_BEADS.map((offset) => (
        <circle
          key={`right-${offset}`}
          cx="17.9"
          cy={10.9 + offset}
          r="0.9"
          fill="currentColor"
          stroke="none"
        />
      ))}
    </svg>
  );
}
