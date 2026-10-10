/**
 * Counters the renderer keeps all the time, cheaply, for the performance
 * harness to read (`e2e/ink-engine/`). They are how the gates in
 * `docs/notebook-ink.md` are asserted rather than eyeballed: a stroke must
 * allocate no canvas and render no tile, the lift must take 2 ms or less, and
 * the canvases together must stay inside the memory budget.
 *
 * Layout reads are not counted here because the renderer makes none: every
 * size and position arrives through `setViewport`. The harness counts them by
 * watching the browser's own layout APIs while a stroke is drawn.
 */

export type InkRendererStats = {
  /** Canvases created, plus any whose backing store was resized. */
  canvasAllocations: number;
  /** Bytes of canvas backing store alive now, and the most there has been. */
  canvasBytes: number;
  peakCanvasBytes: number;
  /** The most pixels any one canvas has held. */
  largestCanvasPixels: number;
  /** Tiles drawn from scratch (cleared, then every item in them painted). */
  tileRenders: number;
  /**
   * Tiles brought up to date without a full draw: added ink painted onto
   * them, or a lifted stroke's live tile handed over.
   */
  tileAppends: number;
  /** The longest single step of drawing a tile (a dense one is drawn over several slices). */
  tileRenderMsMax: number;
  /** Background slices: how many, and the longest. */
  slices: number;
  sliceMsMax: number;
  /** Packets of live ink drawn, and the time they took. */
  liveDraws: number;
  liveDrawMsMax: number;
  liveDrawMsTotal: number;
  /** Lifts, and the longest. */
  commits: number;
  commitMsMax: number;
  /** Document changes, and the longest synchronous redraw one caused. */
  changes: number;
  changeMsMax: number;
  /** Tiles a document change redrew (or appended to) on the spot. */
  changeTiles: number;
  /** Times a new zoom level replaced the one on screen. */
  levelSwaps: number;
  /** Tiles let go of to stay inside the memory budget. */
  evictions: number;
  /** Tiles that could not be drawn because everything in the budget was pinned. */
  budgetMisses: number;
  /** Since the last `setDocument`: until the first tile with ink, and until every visible tile. */
  firstInkMs: number | null;
  visibleReadyMs: number | null;
};

export function emptyInkRendererStats(): InkRendererStats {
  return {
    canvasAllocations: 0,
    canvasBytes: 0,
    peakCanvasBytes: 0,
    largestCanvasPixels: 0,
    tileRenders: 0,
    tileAppends: 0,
    tileRenderMsMax: 0,
    slices: 0,
    sliceMsMax: 0,
    liveDraws: 0,
    liveDrawMsMax: 0,
    liveDrawMsTotal: 0,
    commits: 0,
    commitMsMax: 0,
    changes: 0,
    changeMsMax: 0,
    changeTiles: 0,
    levelSwaps: 0,
    evictions: 0,
    budgetMisses: 0,
    firstInkMs: null,
    visibleReadyMs: null,
  };
}

/**
 * Starts the counts again for a new measurement. What is alive is not a
 * count: the bytes held now carry over and become the new peak, and the
 * largest canvas is kept, since it may still be alive.
 */
export function resetInkRendererStats(stats: InkRendererStats): void {
  const { canvasBytes, largestCanvasPixels } = stats;
  Object.assign(stats, emptyInkRendererStats(), {
    canvasBytes,
    peakCanvasBytes: canvasBytes,
    largestCanvasPixels,
  });
}
