export type NotebookPdfCanvasTracking<TCanvas> = {
  canvas: TCanvas | null;
  renderKey: string | null;
};

/**
 * Tracks the canvas belonging to the active PDF render. A late null callback
 * from an unmounted renderer cannot clear a newer keyed canvas.
 */
export function trackNotebookPdfCanvas<TCanvas>(input: {
  current: NotebookPdfCanvasTracking<TCanvas>;
  renderKey: string | null;
  canvas: TCanvas | null;
}): NotebookPdfCanvasTracking<TCanvas> {
  if (input.canvas && input.renderKey) {
    return {
      canvas: input.canvas,
      renderKey: input.renderKey,
    };
  }

  if (input.current.renderKey === input.renderKey) {
    return {
      canvas: null,
      renderKey: null,
    };
  }

  return input.current;
}
