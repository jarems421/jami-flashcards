/**
 * The Revision Session mark: an open book under Jami's star.
 *
 * A session is Jami teaching, so the mark says so plainly -- the book is the
 * lesson, the four-point star above it is the same northern star the rest of
 * the app uses for Jami. Drawn in the outline weight of its neighbours (Exam
 * questions, History) so it sits in a row of pills without shouting.
 */
export default function RevisionEmblem({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M12 9C10.25 7.65 7.8 7.05 4.5 7.25v11.25c3.3-.2 5.75.4 7.5 1.75 1.75-1.35 4.2-1.95 7.5-1.75V7.25C16.2 7.05 13.75 7.65 12 9zM12 9v11.25"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 1.25Q12.4 3.6 14.75 4 12.4 4.4 12 6.75 11.6 4.4 9.25 4 11.6 3.6 12 1.25z"
        fill="currentColor"
      />
    </svg>
  );
}
