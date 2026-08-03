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
  /**
   * The release was also a hard enough forward pull to make a new page.
   *
   * Whether it does depends on where the queue lands, which is not known until
   * it drains -- so the gesture's strength is recorded and the decision is
   * taken later. Without this, the same flick creates a page when the track is
   * idle and does nothing when it is busy.
   */
  createsPage: boolean;
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
  createsPage?: boolean;
  direction: "next" | "previous" | null;
  velocityX: number;
}): NotebookQueuedPageTurn | null {
  if (!input.direction) return null;
  return {
    direction: input.direction,
    velocityX: input.velocityX,
    createsPage: input.direction === "next" && Boolean(input.createsPage),
  };
}

/** The offset `selectPageByOffset` takes, which re-resolves bounds itself. */
export function getNotebookPageTurnOffset(
  turn: NotebookQueuedPageTurn
): -1 | 1 {
  return turn.direction === "next" ? 1 : -1;
}

/**
 * What a queued turn should actually do, once the page it lands on is known.
 *
 * A forward pull past the end of the notebook makes a page; anywhere else it
 * turns one. Resolved at drain time so a queued gesture behaves exactly as the
 * same gesture would have on an idle track.
 */
export function resolveQueuedNotebookPageTurn(input: {
  canCreatePage: boolean;
  pageCount: number;
  selectedPageIndex: number;
  turn: NotebookQueuedPageTurn;
}): "create" | "turn" | "none" {
  const { turn } = input;
  const atLastPage =
    input.selectedPageIndex >= 0 &&
    input.selectedPageIndex === input.pageCount - 1;

  if (turn.direction === "next" && atLastPage) {
    return turn.createsPage && input.canCreatePage ? "create" : "none";
  }
  if (turn.direction === "previous" && input.selectedPageIndex <= 0) {
    return "none";
  }
  return "turn";
}
