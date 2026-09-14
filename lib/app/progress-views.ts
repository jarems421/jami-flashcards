/** Structurally what `ViewTabs` renders, without reaching into it. */
export type ProgressView = {
  href: string;
  label: string;
  detail: string;
};

/**
 * Progress in two views: flashcards, and marked practice.
 *
 * Practice was a section at the foot of a page otherwise about cards, where it
 * read as an afterthought and pushed everything below the fold. Its own view
 * gives it room for the numbers that explain it, the way Tutor sits beside
 * Sources. The Practice view lives under Progress's own address, so the
 * sidebar entry stays lit on both.
 */
export const PROGRESS_VIEWS: ProgressView[] = [
  {
    href: "/dashboard/progress",
    label: "Cards",
    detail: "Memory, decks and your week",
  },
  {
    href: "/dashboard/progress/practice",
    label: "Practice",
    detail: "Exam questions and practice papers",
  },
];

export const PROGRESS_TITLE = "Progress";
