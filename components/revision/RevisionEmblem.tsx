/**
 * The Revision Session mark: three stars joined in a gentle climb.
 *
 * Understand, practise, recall -- the path a session takes -- drawn in the
 * constellation language the rest of Jami uses for what a student has earned,
 * but small and quiet: a mark for a place to go, not a reward. The last star is
 * the brightest, because that is where the session is heading.
 */
export default function RevisionEmblem({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M4.5 17.5 11 12.5l8.5-7"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.55"
      />
      <circle cx="4.5" cy="17.5" r="1.9" fill="currentColor" opacity="0.6" />
      <circle cx="11" cy="12.5" r="2.2" fill="currentColor" opacity="0.8" />
      <path
        d="M19.5 2.6l.78 2.12 2.12.78-2.12.78-.78 2.12-.78-2.12-2.12-.78 2.12-.78z"
        fill="currentColor"
      />
    </svg>
  );
}
