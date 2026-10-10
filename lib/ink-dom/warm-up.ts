/**
 * GPU warm-up: gets the browser's shaders for live ink compiled before the
 * first stroke, so the first frames of a stroke are not spent on it.
 *
 * On a fresh browser the first stroke on a page stalls a frame or two for
 * 28 to 33 ms: the GPU compiles, the first time each is used, the shaders for
 * copying a tile canvas into another (what a live tile does at a stroke's first
 * touch, and again for every region it repaints) and for the paints (a pen
 * outline filled, a round-capped path stroked, the highlighter's translucent
 * fill). Compiling happens when the canvas is flushed for a frame that is
 * really presented: a canvas that is hidden is never flushed, so drawing on
 * one warms nothing, and a canvas cleared (whole) in the same task it was drawn
 * in has its drawing thrown away before it is ever flushed.
 *
 * So the warm-up does the live-ink drawing on a spare canvas from the pool,
 * puts it on screen where a live tile sits, leaves it for two frames, and only
 * then clears it and gives it back. The drawing is at an alpha of 1/255, so
 * it cannot be seen, and the canvas is off screen and clear again before the
 * warm-up ends: no pixel is left changed. Nothing is made: it takes spare
 * canvases the pool already holds, and does nothing if there are none.
 *
 * The caller runs it only between strokes and gestures (it is background work
 * in the scheduler), and aborts it when one begins: the canvas then goes
 * straight back to the pool, which clears a canvas before it shows it. The
 * drawing is three steps, each its own slice, so that on a canvas drawn in
 * software (where drawing costs its time at once) none runs long.
 */

import type { InkPaint, InkPathCommand } from "@/lib/ink/model";
import type { InkDeviceRect } from "@/lib/ink/render-plan";
import { clearInkCanvas, copyInkCanvasRegion, placeInkCanvas, type InkCanvas } from "@/lib/ink-dom/canvas";
import {
  buildInkPath,
  paintInkPath,
  setInkDeviceTransform,
  type InkPathFactory,
} from "@/lib/ink-dom/rasterizer";

/** Where the warm-up canvas sits: over a tile on screen, in the live layer. */
export type InkWarmUpSite = {
  container: HTMLElement;
  /** The tile's place, in sheet device pixels. */
  rect: InkDeviceRect;
  devicePixelRatio: number;
  /** Device pixels per page unit, so paths are transformed as live ink's are. */
  unitPx: number;
};

export type InkWarmUpDeps = {
  /** A spare canvas from the pool; never a new one. */
  lend(): InkCanvas | null;
  takeBack(canvas: InkCanvas): void;
  site(): InkWarmUpSite | null;
  pathFactory: InkPathFactory;
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (id: number) => void;
};

/**
 * Frames the canvas stays on screen: the first callback runs at the start of
 * the frame that presents it, the second at the start of the one after, when
 * it has been.
 */
const FRAMES_ON_SCREEN = 2;
/** The faintest alpha 8 bits hold that is not nothing: a pixel changes by at most one level. */
const FAINT = 1 / 255;

const INK = { r: 17, g: 24, b: 39, a: FAINT };
const HIGHLIGHT = { r: 253, g: 224, b: 71, a: FAINT };

/** A pen outline, as a pressure-shaped stroke is filled. */
const OUTLINE: InkPathCommand[] = [
  { op: "M", x: 20, y: 40 },
  { op: "C", x1: 40, y1: 20, x2: 80, y2: 20, x: 120, y: 38 },
  { op: "C", x1: 150, y1: 50, x2: 150, y2: 62, x: 120, y: 66 },
  { op: "C", x1: 80, y1: 72, x2: 40, y2: 64, x: 20, y: 44 },
  { op: "Z" },
];
/** A thin pen stroke or the predicted tip: a round-capped path. */
const LINE: InkPathCommand[] = [
  { op: "M", x: 20, y: 120 },
  { op: "C", x1: 50, y1: 100, x2: 90, y2: 140, x: 140, y: 118 },
];

const PAINTS = {
  outline: { fill: INK, stroke: null, opacity: 1 },
  line: { fill: null, stroke: { color: INK, width: 3, cap: "round", join: "round" }, opacity: 1 },
  highlight: { fill: HIGHLIGHT, stroke: null, opacity: 1 },
} satisfies Record<string, InkPaint>;

export class InkWarmUp {
  private canvas: InkCanvas | null = null;
  private source: InkCanvas | null = null;
  private frame: number | null = null;
  private unitPx = 1;
  /** How far the drawing has got: 0 nothing, 1 canvas up, 2 whole tile copied, 3 all drawn and waiting out its frames. */
  private stage = 0;
  private done = false;

  constructor(private readonly deps: InkWarmUpDeps) {}

  /** True from the first drawing to the last frame: the canvas is on screen. */
  get active(): boolean {
    return this.canvas !== null;
  }

  /** The warm-up has run to the end once. */
  get completed(): boolean {
    return this.done;
  }

  /**
   * Draws what live ink draws on a spare canvas, on screen, in three steps;
   * true means another is wanted, in a slice of its own. The canvas then
   * stays up for a couple of frames. Nothing happens (false) with no spare
   * canvas, no tile on screen, or when running on or done.
   */
  step(): boolean {
    if (this.done) return false;
    switch (this.stage) {
      case 0:
        if (!this.setUp()) return false;
        this.stage = 1;
        return true;
      case 1:
        // The dry tile copied into the live tile at a stroke's first touch: the whole tile.
        if (this.canvas && this.source) {
          copyInkCanvasRegion(this.source, this.canvas, { x: 0, y: 0, width: this.canvas.width, height: this.canvas.height });
        }
        this.stage = 2;
        return true;
      case 2:
        if (this.canvas) this.drawRest(this.canvas);
        this.stage = 3;
        this.showFrames();
        return false;
      default:
        return false;
    }
  }

  /** The canvas goes on screen over a tile, with a faint mark on the canvas to copy from. */
  private setUp(): boolean {
    const site = this.deps.site();
    if (!site) return false;
    const canvas = this.deps.lend();
    if (!canvas) return false;
    this.canvas = canvas;
    this.unitPx = site.unitPx;
    // Copies need a second canvas to copy from; without one, only the paints are warmed.
    const source = this.deps.lend();
    this.source = source;
    placeInkCanvas(canvas, site.rect.x, site.rect.y, site.devicePixelRatio);
    site.container.appendChild(canvas.element);
    if (source) {
      source.ctx.setTransform(1, 0, 0, 1, 0, 0);
      source.ctx.fillStyle = "rgba(17, 24, 39, 0.004)";
      source.ctx.fillRect(0, 0, 160, 160);
    }
    return true;
  }

  private showFrames(): void {
    let frames = FRAMES_ON_SCREEN;
    const requestFrame = this.deps.requestFrame ?? ((callback) => requestAnimationFrame(callback));
    const next = () => {
      this.frame = null;
      frames -= 1;
      if (frames > 0) this.frame = requestFrame(next);
      else this.finish(true);
    };
    this.frame = requestFrame(next);
  }

  /**
   * A gesture begins, or the sheet is about to change: the canvas goes back at
   * once, and the warm-up may run again later.
   */
  abort(): void {
    this.finish(false);
  }

  /**
   * A stroke begins: the canvas goes back at once, and the warm-up is over.
   * The stroke is itself the first use of the drawing paths, so there is
   * nothing left to warm, and no warm-up starts again while the next is written.
   */
  retire(): void {
    this.finish(false);
    this.done = true;
  }

  /**
   * The regions put back on later packets (a part of the tile copied), then the
   * paints. Copies are drawn at full alpha, as live ink's are; the source
   * itself is faint.
   */
  private drawRest(canvas: InkCanvas): void {
    const ctx = canvas.ctx;
    if (this.source) copyInkCanvasRegion(this.source, canvas, { x: 40, y: 40, width: 200, height: 160 });
    setInkDeviceTransform(ctx, this.unitPx, 0, 0);
    const outline = buildInkPath(OUTLINE, this.deps.pathFactory).path;
    const line = buildInkPath(LINE, this.deps.pathFactory).path;
    paintInkPath(ctx, outline, PAINTS.outline);
    paintInkPath(ctx, line, PAINTS.line);
    paintInkPath(ctx, outline, PAINTS.highlight);
    // A region cleared on its own, as a live tile puts back a stretch with no dry ink under it.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(40, 40, 200, 160);
  }

  private finish(completed: boolean): void {
    const canvas = this.canvas;
    if (!canvas) return;
    if (this.frame !== null) {
      (this.deps.cancelFrame ?? ((id) => cancelAnimationFrame(id)))(this.frame);
      this.frame = null;
    }
    const source = this.source;
    this.canvas = null;
    this.source = null;
    this.stage = 0;
    // Only now, after the frames that showed the drawing, is it wiped; an
    // aborted warm-up skips this (the pool clears a canvas before it shows it).
    if (completed) {
      clearInkCanvas(canvas);
      if (source) clearInkCanvas(source);
    }
    canvas.element.remove();
    this.deps.takeBack(canvas);
    if (source) this.deps.takeBack(source);
    if (completed) this.done = true;
  }
}
