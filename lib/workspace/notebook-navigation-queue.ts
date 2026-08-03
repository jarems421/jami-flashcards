/**
 * A single deferred page turn.
 *
 * Turning a page holds a navigation lock from the moment the swipe is released
 * until the next page's ink has loaded and painted. A flick that lands inside
 * that window used to be dropped on the floor, so two quick flicks advanced one
 * page and the second gesture simply vanished.
 *
 * A queued turn is a deferred *command*, not a deferred drag: the track is
 * mid-animation, so the gesture writes no offset and shows no preview. It only
 * records which way the student asked to go.
 */
export type NotebookQueuedPageTurn = {
  direction: "next" | "previous";
  velocityX: number;
};

/**
 * One slot, newest wins.
 *
 * A flurry of flicks should land one page beyond wherever the animation is
 * going, not replay every gesture in turn — nobody flicking five times wants to
 * watch five page turns. A release that did not resolve to a direction clears
 * the slot instead, so changing your mind mid-settle cancels the queued turn
 * rather than committing it.
 */
export function getQueuedNotebookPageTurn(input: {
  current: NotebookQueuedPageTurn | null;
  direction: "next" | "previous" | null;
  velocityX: number;
}): NotebookQueuedPageTurn | null {
  if (!input.direction) return null;
  return { direction: input.direction, velocityX: input.velocityX };
}

/** The offset `selectPageByOffset` takes, which re-resolves bounds itself. */
export function getNotebookPageTurnOffset(
  turn: NotebookQueuedPageTurn
): -1 | 1 {
  return turn.direction === "next" ? 1 : -1;
}
