/** Structurally what `SegmentedControl` renders, declared without reaching
 * into the component layer. */
export type FlashcardView = {
  href: string;
  label: string;
  detail: string;
};

/**
 * Decks and cards are one surface with two views of it.
 *
 * They used to be two entries in the sidebar, which asked a student to know
 * that a deck is a container and a card is a thing in it before they could
 * guess which one to press. It also hid each from the other: somebody looking
 * at their decks had no way of knowing a search across every card existed.
 *
 * They keep their own addresses, so both remain bookmarkable and every link
 * that already points at either one still works. What changed is that each now
 * shows the other above it, and the sidebar carries one entry rather than two.
 */
export const FLASHCARD_VIEWS: FlashcardView[] = [
  {
    href: "/dashboard/decks",
    label: "Decks",
    detail: "Your card sets",
  },
  {
    href: "/dashboard/cards",
    label: "All cards",
    detail: "Search and edit every card",
  },
];

export const FLASHCARDS_TITLE = "Flashcards";
