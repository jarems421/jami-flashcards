"use client";

/**
 * Beside an answer on a notebook: put this answer on the page.
 *
 * Labelled, unlike the pin beside it, because what it does is not guessable
 * from an icon -- but in the answer's muted grey and at the size of the
 * sources line, so an answer does not end in a button asking to be pressed.
 * Once pressed it says so for a moment, then can be pressed again for another
 * page.
 */
export default function AddAnswerToPageButton({
  added,
  onAdd,
}: {
  added: boolean;
  onAdd: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={added ? "Answer added to page" : "Add this answer to the page"}
      title="Add this answer to the page, exactly as it is shown here"
      className={`-my-1 inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-2xs font-semibold transition duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 ${
        added
          ? "text-accent"
          : "text-text-muted hover:bg-[var(--color-glass-subtle)] hover:text-accent active:text-accent"
      }`}
      onClick={onAdd}
    >
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {added ? <path d="M3.5 8.5l3 3 6-7" /> : <AddToPagePaths />}
      </svg>
      {added ? "Added" : "Add to page"}
    </button>
  );
}

function AddToPagePaths() {
  return (
    <>
      <path d="M9.5 1.75H4.25a1.5 1.5 0 0 0-1.5 1.5v9.5a1.5 1.5 0 0 0 1.5 1.5h7.5a1.5 1.5 0 0 0 1.5-1.5V5.5z" />
      <path d="M8 7v4.5M5.75 9.25h4.5" />
    </>
  );
}

/** A page with a plus: the same mark as the button, for the answer's hold menu. */
export function AddToPageIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <AddToPagePaths />
    </svg>
  );
}
