import type { Editor as JsDrawEditor } from "js-draw";
import type { NotebookLivePenTip } from "@/lib/workspace/notebook-direct-ink-input";
import type { NotebookInkSmoother, NotebookInkSmoothingOptions } from "@/lib/workspace/notebook-ink-smoothing";
import {
  keepNotebookStraightenedLineAimable,
  relaxNotebookStraightenHold,
  suppressNotebookEraserPreview,
} from "@/lib/workspace/notebook-ink-runtime";
import {
  applyNotebookStrokeShape,
  makePrecisePenInputMapper,
  registerNotebookNibAngleSource,
  type JsDrawModule,
} from "@/lib/workspace/notebook-js-draw";
import {
  installBatchedNotebookPenPreview,
  type NotebookBatchedPen,
  type NotebookPenPreviewBatch,
} from "@/lib/workspace/notebook-pen-preview";
import { readNotebookPenLiveTip } from "@/lib/workspace/notebook-smooth-pen";

/**
 * Builds the js-draw editor a notebook page draws into, set up for the
 * notebook rather than as js-draw's own app.
 */
export function createNotebookJsDrawEditor(host: HTMLElement, jsDraw: JsDrawModule): JsDrawEditor {
  // js-draw REJECTS any viewport transform outside [minZoom, maxZoom]
  // (it resets the transform on every ViewportChanged event). The page
  // viewport scale is displaySize/pageSize — roughly 0.5 at fit and up
  // to ~4 zoomed in — so the limits must be wide or the ink silently
  // renders at identity scale, anchored to the page's top-left corner.
  // User zooming inside js-draw itself stays disabled separately (no
  // wheel events, and touch never reaches js-draw's pan-zoom tools).
  const editor = new jsDraw.Editor(host, {
    wheelEventsEnabled: false,
    minZoom: 0.05,
    maxZoom: 50,
  });
  /*
   * js-draw's display cache is off, and cannot be repaired from here.
   *
   * It re-renders busy scenes from bitmap blocks fixed at 600x600
   * canvas units, and decides a block is sharp enough to blit when one
   * of its pixels covers no more than `maxScale` screen pixels --
   * defined upstream as `Math.max(1, 1.3 / devicePixelRatio)`. The
   * floor is the bug: at devicePixelRatio 2 it evaluates to 1, so a
   * cache pixel may cover a whole CSS pixel, which is two device
   * pixels, and the blit is a 2x upscale. That is the blurriness after
   * every eraser and undo. js-draw's own comment beside it reads
   * "TODO: Decrease the minimum cache scale as well."
   *
   * A note left here in July said to revisit with a DPR-aware cache.
   * Checked properly on 2 September: it cannot be built from
   * application code, for three separate reasons.
   *
   *  - `blockResolution` cannot be raised after construction. The
   *    cache's `createRenderer` closes over the original 600 to size
   *    its canvas, so changing the prop alone leaves the canvas and the
   *    cache disagreeing about how big a block is.
   *  - `Display.cache` is a private field and `getCache()` is marked
   *    @internal, so the cache object cannot be replaced.
   *  - `RenderingCache` is not exported from js-draw's entry point, so
   *    a correctly-sized one cannot be constructed to put there.
   *
   * Fixing it properly means patching js-draw or changing it upstream,
   * and this repo patches no dependencies. Until then the threshold
   * stays at Infinity, which forces the vector fallback: every page
   * re-renders from geometry and stays crisp at any zoom.
   *
   * The cost of that is proportional to how many path segments a page
   * holds, which is why the real fix went into what gets stored rather
   * than how it is drawn -- see notebook-ink-compaction.ts, which took
   * the worst page found from 9,540 segments to 2,835.
   */
  const displayCache = (
    editor.display as unknown as {
      getCache?: () => {
        sharedState?: {
          props?: { minProportionalRenderTimeToUseCache?: number };
        };
      };
    }
  ).getCache?.();
  const cacheProps = displayCache?.sharedState?.props;
  if (cacheProps) {
    cacheProps.minProportionalRenderTimeToUseCache = Number.POSITIVE_INFINITY;
  }
  // The notebook toolbar owns tool switching. Disable js-draw's numeric
  // and select-all shortcuts so an iPad keyboard/Scribble event cannot
  // silently activate its purple selection tool behind the app's state.
  editor.toolController
    .getMatchingTools(jsDraw.ToolSwitcherShortcut)
    .forEach((shortcut) => shortcut.setEnabled(false));
  editor.toolController
    .getMatchingTools(jsDraw.SelectAllShortcutHandler)
    .forEach((shortcut) => shortcut.setEnabled(false));
  return editor;
}

/**
 * js-draw renders its eraser cursor as a square in the wet-ink layer (not a
 * DOM element, so CSS cannot hide it). Suppress its preview so the notebook's
 * circular DOM cursor is the only indicator — notably on iPad/Safari, where
 * there is no hover cursor and the square is what users were seeing.
 */
export function suppressNotebookJsDrawEraserPreviews(editor: JsDrawEditor, jsDraw: JsDrawModule) {
  editor.toolController.getMatchingTools(jsDraw.EraserTool).forEach((eraser) => {
    suppressNotebookEraserPreview(eraser as unknown as { drawPreviewAt?: () => void });
  });
}

/**
 * Sets up js-draw's pen for notebook ink, and returns its batched preview,
 * or null when the editor has no pen.
 *
 * The pen reads its smoothing at each pointer-down, so a settings change
 * takes effect on the next stroke without the mapper being rebuilt under an
 * editor that may be mid-gesture. The highlighter asks for the nib angle per
 * sample, so it keeps answering with whatever the hand is doing now. The
 * predicted tip is painted after the stroke, on the same canvas, so the next
 * paint wipes it with everything else.
 */
export function installNotebookPrimaryPen(
  editor: JsDrawEditor,
  jsDraw: JsDrawModule,
  input: {
    smoothers: Map<number, NotebookInkSmoother>;
    getSmoothingOptions: () => NotebookInkSmoothingOptions;
    getNibAngle: () => number;
    tip: NotebookLivePenTip;
  }
): NotebookPenPreviewBatch | null {
  const primaryPen = editor.toolController.getMatchingTools(jsDraw.PenTool)[0];
  if (!primaryPen) return null;
  primaryPen.setInputMapper(
    makePrecisePenInputMapper(jsDraw, editor, input.smoothers, input.getSmoothingOptions)
  );
  registerNotebookNibAngleSource(editor, input.getNibAngle);
  // The nib is swapped with the tool, but set the pen's here too so
  // the very first stroke cannot land on js-draw's default fitter.
  applyNotebookStrokeShape(primaryPen, "pen", jsDraw);
  // A line that has snapped straight goes on following the pen, so
  // js-draw must not put the angle it first snapped to back when the
  // pen lifts shortly after being moved.
  keepNotebookStraightenedLineAimable(primaryPen);
  // And the hold that triggers the snap has to be one a hand resting
  // on glass can actually satisfy.
  relaxNotebookStraightenHold(primaryPen);
  const { tip } = input;
  return installBatchedNotebookPenPreview(primaryPen as unknown as NotebookBatchedPen, {
    afterPaint: () => {
      tip.paints += 1;
      tip.shown = false;
      const points = tip.points;
      if (!points || points.length === 0) return;
      const live = readNotebookPenLiveTip(primaryPen);
      // A see-through colour would darken where the two overlap.
      if (!live || live.color.a < 1) return;
      editor.display.getWetInkRenderer().drawPath({
        startPoint: live.point,
        commands: points.map((point) => ({
          kind: jsDraw.PathCommandType.LineTo,
          point,
        })),
        style: {
          fill: jsDraw.Color4.transparent,
          stroke: { color: live.color, width: live.width },
        },
      });
      tip.shown = true;
    },
  });
}

/**
 * Calls back with the host's size whenever it changes, and returns the way to
 * stop. A ResizeObserver where there is one; the window's resize otherwise.
 */
export function observeNotebookInkHostSize(
  host: HTMLElement,
  onResize: (width: number, height: number) => void
): () => void {
  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      onResize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }
  const handleResize = () => {
    const rect = host.getBoundingClientRect();
    onResize(rect.width, rect.height);
  };
  window.addEventListener("resize", handleResize);
  return () => window.removeEventListener("resize", handleResize);
}
