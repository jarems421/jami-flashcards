type JamiTutorIconProps = {
  className?: string;
};

/**
 * Three four-point stars, scaled and placed as a small constellation.
 *
 * This keeps the familiar sparkle language used when Jami helps draft a card,
 * while the filled silhouette stays legible in the sidebar and compact
 * notebook toolbar. The unequal sizes stop the mark reading like a decorative
 * border or a loading indicator.
 */
const STARS = [
  "M12 2.5l1.25 3.75 3.75 1.25-3.75 1.25-1.25 3.75-1.25-3.75-3.75-1.25 3.75-1.25z",
  "M17.8 12l.85 2.35 2.35.85-2.35.85-.85 2.35-.85-2.35-2.35-.85 2.35-.85z",
  "M6 14.4l.55 1.65 1.65.55-1.65.55-.55 1.65-.55-1.65-1.65-.55 1.65-.55z",
];

/**
 * Jami's mark, drawn wherever the conversational Tutor is offered.
 *
 * `currentColor` lets the same geometry sit quietly in navigation, pick up an
 * accent in a Tutor header, and inherit the correct contrast inside buttons.
 */
export default function JamiTutorIcon({ className = "" }: JamiTutorIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      {STARS.map((star) => (
        <path key={star} fillRule="evenodd" clipRule="evenodd" d={star} />
      ))}
    </svg>
  );
}
