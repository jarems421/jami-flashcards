/**
 * A deck's card count, as the deck list shows it under the deck's name.
 *
 * Counted on the server rather than from the cards themselves. The deck list
 * used to download every card the student owned to work these two numbers out,
 * so a student with thousands of cards waited on all of them, and past the
 * read's thirty seconds the whole list failed to load.
 *
 * `due` is null when only the total could be counted.
 */
export type DeckCardCount = { total: number; due: number | null };

/**
 * Due cards, from the two numbers the server can count.
 *
 * A card with no due date has never been scheduled, so it counts as due: due
 * is every card in the deck except those scheduled for later.
 */
export function dueFromCounts(total: number, scheduledLater: number) {
  return Math.max(0, total - scheduledLater);
}

/**
 * The line under a deck's name: "12 cards, 3 due".
 *
 * Undefined is still being counted, and null could not be counted, which says
 * nothing rather than a number that would be wrong.
 */
export function describeDeckCardCount(count: DeckCardCount | null | undefined) {
  if (count === undefined) return "Counting cards…";
  if (count === null) return "";
  const cards = `${count.total} ${count.total === 1 ? "card" : "cards"}`;
  return count.due === null ? cards : `${cards}, ${count.due} due`;
}
