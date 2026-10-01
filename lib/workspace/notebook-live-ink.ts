import type { Editor as JsDrawEditor } from "js-draw";
import type { JsDrawModule } from "@/lib/workspace/notebook-js-draw";

/**
 * Fast live ink: the stroke being written, drawn on a canvas the size of the
 * screen instead of the size of the page.
 *
 * js-draw draws a stroke in progress on its "wet ink" canvas, which is exactly
 * as big as its page canvas -- the whole sheet at fit, and a window twice the
 * screen in each direction once zoomed in, around 16 megapixels on an 11-inch
 * iPad at 4x. On every Pencil movement it wipes that entire canvas and redraws
 * the stroke, and at every pen lift it copies the entire canvas onto the page
 * beneath. On a desktop GPU that is nothing. On an iPad, where Safari draws a
 * 2D canvas on the CPU, it is a lot of memory traffic for a few pixels of ink.
 *
 * This keeps js-draw doing everything it does -- the pen tool, the stroke
 * builder, straightening, the committed stroke, undo, saving -- and changes
 * only where the pixels of the unfinished stroke go:
 *
 *  - While a stroke is live, js-draw's wet-ink renderer is pointed at our own
 *    canvas, which covers only the part of the page that is on screen. The
 *    same renderer draws the same path, so what is seen while writing is what
 *    js-draw would have drawn, pixel for pixel in shape.
 *  - Only the area the stroke has painted is wiped between frames, not the
 *    whole canvas.
 *  - At the lift, the finished stroke is drawn onto the page canvas as vector
 *    ink from the component js-draw just committed, rather than by copying a
 *    whole canvas across. It is drawn in the same task that clears the live
 *    canvas, so no frame shows both or neither.
 *
 * In July a separate live canvas was tried and dropped because strokes changed
 * shape when they were committed: the two canvases drew different geometry,
 * and the handover waited for the pen to be idle. Neither is true here -- one
 * renderer, one path, handed over at the lift.
 *
 * Everything hooked here is js-draw internals. Each hook is checked when this
 * is installed, and if any is missing the installer returns null and the
 * notebook simply keeps js-draw's own wet ink.
 */

/**
 * The live canvas is snapped out to this grid, in CSS pixels, so a small pan
 * between strokes usually lands inside the canvas that is already there and
 * costs no reallocation.
 */
export const NOTEBOOK_LIVE_INK_GRID = 64;

/**
 * The most pixels the live canvas may hold.
 *
 * An iPad screen at 2x is at most about six million, so this never bites
 * there; it stops a large desktop monitor asking for a canvas that serves no
 * purpose at that density.
 */
export const NOTEBOOK_LIVE_INK_MAX_PIXELS = 12_000_000;

/** Antialiasing reaches a little past the geometry; wipe that too. */
const DIRTY_MARGIN_CSS_PX = 2;

export type NotebookLiveInkRegion = {
  left: number;
  top: number;
  width: number;
  height: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * The part of the ink surface that is on screen, in the surface's own
 * coordinates, snapped outwards to the grid. Null if none of it is.
 */
export function getNotebookLiveInkRegion(input: {
  surfaceLeft: number;
  surfaceTop: number;
  surfaceWidth: number;
  surfaceHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  grid?: number;
}): NotebookLiveInkRegion | null {
  const width = Math.max(0, input.surfaceWidth);
  const height = Math.max(0, input.surfaceHeight);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  const grid = Math.max(1, input.grid ?? NOTEBOOK_LIVE_INK_GRID);

  const visibleLeft = clamp(-input.surfaceLeft, 0, width);
  const visibleTop = clamp(-input.surfaceTop, 0, height);
  const visibleRight = clamp(input.viewportWidth - input.surfaceLeft, 0, width);
  const visibleBottom = clamp(input.viewportHeight - input.surfaceTop, 0, height);
  if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) return null;

  const left = Math.max(0, Math.floor(visibleLeft / grid) * grid);
  const top = Math.max(0, Math.floor(visibleTop / grid) * grid);
  const right = Math.min(width, Math.ceil(visibleRight / grid) * grid);
  const bottom = Math.min(height, Math.ceil(visibleBottom / grid) * grid);
  return { left, top, width: right - left, height: bottom - top };
}

/** The screen's density, lowered only if the canvas would pass the budget. */
export function getNotebookLiveInkPixelRatio(input: {
  width: number;
  height: number;
  devicePixelRatio: number;
  maxPixels?: number;
}) {
  const devicePixelRatio =
    Number.isFinite(input.devicePixelRatio) && input.devicePixelRatio > 0
      ? input.devicePixelRatio
      : 1;
  const maxPixels = input.maxPixels ?? NOTEBOOK_LIVE_INK_MAX_PIXELS;
  const area = Math.max(1, input.width) * Math.max(1, input.height);
  const pixels = area * devicePixelRatio * devicePixelRatio;
  return pixels > maxPixels
    ? Math.sqrt(maxPixels / area)
    : devicePixelRatio;
}

export function sameNotebookLiveInkRegion(
  first: NotebookLiveInkRegion | null,
  second: NotebookLiveInkRegion | null
) {
  if (first === second) return true;
  if (!first || !second) return false;
  return (
    first.left === second.left &&
    first.top === second.top &&
    first.width === second.width &&
    first.height === second.height
  );
}

/** The drawing calls the tracker watches, and the ones it cannot bound. */
type TrackedContext = Pick<
  CanvasRenderingContext2D,
  | "canvas"
  | "clearRect"
  | "lineTo"
  | "lineWidth"
  | "lineJoin"
  | "miterLimit"
  | "moveTo"
  | "bezierCurveTo"
  | "quadraticCurveTo"
  | "restore"
  | "save"
  | "setTransform"
  | "stroke"
>;

/**
 * Anything drawn by one of these could land anywhere, so the next wipe is of
 * the whole canvas. js-draw uses them only for text and images, which the pen
 * never draws.
 */
const UNBOUNDED_DRAWING_METHODS = [
  "arc",
  "arcTo",
  "drawImage",
  "ellipse",
  "fillRect",
  "fillText",
  "putImageData",
  "rect",
  "roundRect",
  "rotate",
  "scale",
  "setTransform",
  "strokeRect",
  "strokeText",
  "transform",
  "translate",
] as const;

/**
 * Keeps a running box around everything drawn on a 2D context since it was
 * last wiped, in the context's own (CSS pixel) coordinates, so a wipe can be
 * of that box alone.
 *
 * It wraps the context's own drawing methods rather than reading the stroke,
 * so it is right for whatever js-draw draws: a path, a straightened line, the
 * highlighter's footprint. A path passed as an argument, or any call it cannot
 * bound, makes the next wipe a full one.
 */
export class NotebookLiveInkDirtyRegion {
  private minX = Number.POSITIVE_INFINITY;
  private minY = Number.POSITIVE_INFINITY;
  private maxX = Number.NEGATIVE_INFINITY;
  private maxY = Number.NEGATIVE_INFINITY;
  private reach = 0;
  private everything = false;
  private readonly restoreMethods: Array<() => void> = [];
  private readonly clearRectDirect: TrackedContext["clearRect"];
  private readonly saveDirect: TrackedContext["save"];
  private readonly restoreDirect: TrackedContext["restore"];
  private readonly setTransformDirect: (
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number
  ) => void;

  constructor(private readonly ctx: TrackedContext) {
    // Bound before anything is wrapped, so the wipe itself and the sizing of
    // the canvas are not counted as drawing.
    this.clearRectDirect = ctx.clearRect.bind(ctx);
    this.saveDirect = ctx.save.bind(ctx);
    this.restoreDirect = ctx.restore.bind(ctx);
    const setTransform = ctx.setTransform.bind(ctx);
    this.setTransformDirect = (a, b, c, d, e, f) =>
      setTransform(a, b, c, d, e, f);

    this.wrapPoints("moveTo", 2);
    this.wrapPoints("lineTo", 2);
    this.wrapPoints("quadraticCurveTo", 4);
    this.wrapPoints("bezierCurveTo", 6);
    this.wrap("stroke", (args) => {
      if (args.length > 0) {
        this.everything = true;
        return;
      }
      const halfWidth = Math.max(0, this.ctx.lineWidth) / 2;
      // A mitred corner reaches up to miterLimit half-widths out.
      const reach =
        this.ctx.lineJoin === "miter"
          ? halfWidth * Math.max(1, this.ctx.miterLimit)
          : halfWidth;
      this.reach = Math.max(this.reach, reach);
    });
    this.wrap("fill", (args) => {
      if (args.length > 0 && typeof args[0] === "object") this.everything = true;
    });
    for (const method of UNBOUNDED_DRAWING_METHODS) {
      this.wrap(method, () => {
        this.everything = true;
      });
    }
  }

  private wrap(method: string, observe: (args: unknown[]) => void) {
    const target = this.ctx as unknown as Record<string, unknown>;
    const original = target[method];
    if (typeof original !== "function") return;
    target[method] = function observed(this: unknown, ...args: unknown[]) {
      observe(args);
      return (original as (...values: unknown[]) => unknown).apply(this, args);
    };
    this.restoreMethods.push(() => {
      target[method] = original;
    });
  }

  private wrapPoints(method: string, coordinates: number) {
    this.wrap(method, (args) => {
      for (let index = 0; index + 1 < coordinates; index += 2) {
        const x = args[index];
        const y = args[index + 1];
        if (typeof x !== "number" || typeof y !== "number") continue;
        if (x < this.minX) this.minX = x;
        if (x > this.maxX) this.maxX = x;
        if (y < this.minY) this.minY = y;
        if (y > this.maxY) this.maxY = y;
      }
    });
  }

  /** Whether anything has been drawn since the last wipe. */
  get dirty() {
    return this.everything || this.maxX >= this.minX;
  }

  /**
   * The box to wipe, in device pixels, clamped to the canvas. Null when
   * nothing has been drawn.
   */
  getWipeRect(pixelRatio: number) {
    const canvas = this.ctx.canvas;
    if (this.everything) {
      return { x: 0, y: 0, width: canvas.width, height: canvas.height };
    }
    if (this.maxX < this.minX) return null;
    const pad = this.reach + DIRTY_MARGIN_CSS_PX;
    const x = Math.max(0, Math.floor((this.minX - pad) * pixelRatio));
    const y = Math.max(0, Math.floor((this.minY - pad) * pixelRatio));
    const right = Math.min(canvas.width, Math.ceil((this.maxX + pad) * pixelRatio));
    const bottom = Math.min(canvas.height, Math.ceil((this.maxY + pad) * pixelRatio));
    if (right <= x || bottom <= y) return null;
    return { x, y, width: right - x, height: bottom - y };
  }

  /** Wipes what has been drawn, and starts the box again. */
  wipe(pixelRatio: number) {
    const rect = this.getWipeRect(pixelRatio);
    if (rect) {
      this.saveDirect();
      this.setTransformDirect(1, 0, 0, 1, 0, 0);
      this.clearRectDirect(rect.x, rect.y, rect.width, rect.height);
      this.restoreDirect();
    }
    this.forget();
  }

  /** For after a resize, which clears the canvas by itself. */
  forget() {
    this.minX = Number.POSITIVE_INFINITY;
    this.minY = Number.POSITIVE_INFINITY;
    this.maxX = Number.NEGATIVE_INFINITY;
    this.maxY = Number.NEGATIVE_INFINITY;
    this.reach = 0;
    this.everything = false;
  }

  /** Sets the context's scale without it counting as drawing. */
  setScale(pixelRatio: number) {
    this.setTransformDirect(pixelRatio, 0, 0, pixelRatio, 0, 0);
  }

  dispose() {
    this.restoreMethods.splice(0).forEach((restore) => restore());
  }
}

/** The part of js-draw's canvas renderer that fast live ink swaps. */
type SwappableCanvasRenderer = {
  ctx: CanvasRenderingContext2D;
  clear(): void;
  setTransform(transform: unknown): void;
};

function asSwappableCanvasRenderer(
  renderer: unknown
): SwappableCanvasRenderer | null {
  if (typeof renderer !== "object" || renderer === null) return null;
  const candidate = renderer as Partial<SwappableCanvasRenderer>;
  const ctx = candidate.ctx;
  if (
    typeof ctx !== "object" ||
    ctx === null ||
    typeof ctx.clearRect !== "function" ||
    typeof candidate.clear !== "function" ||
    typeof candidate.setTransform !== "function"
  ) {
    return null;
  }
  return candidate as SwappableCanvasRenderer;
}

/** A committed component, as far as drawing it again is concerned. */
type RenderableComponent = {
  render(renderer: unknown, visibleRect?: unknown): void;
};

function isRenderableComponent(value: unknown): value is RenderableComponent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { render?: unknown }).render === "function"
  );
}

/** Where the page sits on screen, which is all the live canvas is sized from. */
export type NotebookLiveInkPlacement = {
  /** The ink surface's rect; the live canvas is positioned inside it. */
  surfaceRect: DOMRectReadOnly;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
};

export type NotebookLiveInk = {
  /**
   * Sends the stroke about to begin to the live canvas. Call before js-draw
   * sees the pointerdown. False if there is nowhere on screen to draw.
   */
  begin(
    input: NotebookLiveInkPlacement & {
      /** js-draw's render region's rect, which its screen coordinates are from. */
      regionRect: DOMRectReadOnly;
    }
  ): boolean;
  /**
   * Sizes the live canvas for where the page now sits, without drawing.
   *
   * Allocating a canvas the size of the screen is not free, and doing it in
   * `begin` put that cost on the pointerdown -- the first stroke on a page,
   * and the first after every pan. Called whenever the page settles instead,
   * so a stroke normally finds its canvas already there.
   */
  prepare(input: NotebookLiveInkPlacement): void;
  /**
   * Whether js-draw's own wet-ink canvas is put away while fast ink is on.
   *
   * It is as large as the page canvas -- tens of megabytes on an iPad once
   * zoomed -- and with fast ink nothing draws on it. Parked, it is shrunk to a
   * single pixel; unparked, js-draw sizes it again on its next repaint.
   */
  setParked(parked: boolean): void;
  /** Gives js-draw its own wet ink back. Safe to call when nothing is live. */
  end(): void;
  readonly active: boolean;
  dispose(): void;
};

export function installNotebookLiveInk(input: {
  editor: JsDrawEditor;
  jsDraw: Pick<JsDrawModule, "Mat33" | "Vec2">;
  canvas: HTMLCanvasElement;
}): NotebookLiveInk | null {
  const { editor, jsDraw, canvas } = input;
  const display = editor.display;
  const wet = asSwappableCanvasRenderer(display.getWetInkRenderer());
  const dry = display.getDryInkRenderer();
  const image = editor.image as unknown as {
    addComponentDirectly?: (component: unknown) => unknown;
  };
  const originalAddComponentDirectly = image.addComponentDirectly;
  const liveCtx = canvas.getContext("2d");
  if (
    !wet ||
    !liveCtx ||
    typeof originalAddComponentDirectly !== "function" ||
    typeof display.flatten !== "function"
  ) {
    return null;
  }

  const dirtyRegion = new NotebookLiveInkDirtyRegion(liveCtx);
  const originalCtx = wet.ctx;
  const wetCanvas = originalCtx.canvas;
  const originalClear = wet.clear;
  const originalFlatten = display.flatten;
  let live = false;
  let parked = false;
  let region: NotebookLiveInkRegion | null = null;
  let pixelRatio = 1;
  let committed: RenderableComponent | null = null;

  wet.clear = function clearLiveOrWet(this: unknown) {
    if (live) {
      dirtyRegion.wipe(pixelRatio);
      return;
    }
    originalClear.call(wet);
  };

  image.addComponentDirectly = function recordCommitted(
    this: unknown,
    component: unknown
  ) {
    const result = originalAddComponentDirectly.call(this, component);
    if (live && isRenderableComponent(component)) committed = component;
    return result;
  };

  display.flatten = function flattenLiveOrWet() {
    if (!live) {
      // A parked wet canvas has nothing on it to copy. Only reached if a
      // stroke could not go live -- the page entirely off screen -- and then
      // a repaint puts the stroke on the page instead.
      if (parked) {
        editor.queueRerender();
        return;
      }
      originalFlatten.call(display);
      return;
    }
    // js-draw would copy its wet canvas onto the page here -- a canvas we
    // never drew on. Draw the committed stroke onto the page directly.
    const component = committed;
    committed = null;
    if (component) {
      component.render(dry, editor.viewport.visibleRect);
    } else {
      editor.queueRerender();
    }
  };

  /** Sizes and places the live canvas; the region, or null if off screen. */
  const place = (placement: NotebookLiveInkPlacement) => {
    const next = getNotebookLiveInkRegion({
      surfaceLeft: placement.surfaceRect.left,
      surfaceTop: placement.surfaceRect.top,
      surfaceWidth: placement.surfaceRect.width,
      surfaceHeight: placement.surfaceRect.height,
      viewportWidth: placement.viewportWidth,
      viewportHeight: placement.viewportHeight,
    });
    if (!next) return null;
    const nextRatio = getNotebookLiveInkPixelRatio({
      width: next.width,
      height: next.height,
      devicePixelRatio: placement.devicePixelRatio,
    });
    if (!sameNotebookLiveInkRegion(region, next) || nextRatio !== pixelRatio) {
      region = next;
      pixelRatio = nextRatio;
      canvas.style.left = `${next.left}px`;
      canvas.style.top = `${next.top}px`;
      canvas.style.width = `${next.width}px`;
      canvas.style.height = `${next.height}px`;
      // Resizing clears the canvas and resets its transform.
      canvas.width = Math.max(1, Math.round(next.width * nextRatio));
      canvas.height = Math.max(1, Math.round(next.height * nextRatio));
      dirtyRegion.forget();
      dirtyRegion.setScale(nextRatio);
    } else {
      dirtyRegion.wipe(pixelRatio);
    }
    return next;
  };

  const end = () => {
    if (!live) return;
    dirtyRegion.wipe(pixelRatio);
    wet.ctx = originalCtx;
    wet.setTransform(null);
    live = false;
    committed = null;
  };

  const unpark = (repaint: boolean) => {
    if (!parked) return;
    parked = false;
    wetCanvas.style.removeProperty("display");
    // js-draw sizes its canvases from their laid-out size at each repaint.
    if (repaint) editor.rerender();
  };

  return {
    get active() {
      return live;
    },
    begin(stroke) {
      end();
      const next = place(stroke);
      if (!next) return false;

      // js-draw's screen coordinates are measured from its render region;
      // ours from the live canvas. The difference is a plain offset.
      const offsetX =
        stroke.regionRect.left - (stroke.surfaceRect.left + next.left);
      const offsetY =
        stroke.regionRect.top - (stroke.surfaceRect.top + next.top);
      wet.ctx = liveCtx;
      wet.setTransform(
        jsDraw.Mat33.translation(jsDraw.Vec2.of(offsetX, offsetY)).rightMul(
          editor.viewport.canvasToScreenTransform
        )
      );
      live = true;
      committed = null;
      return true;
    },
    prepare(placement) {
      if (live) return;
      place(placement);
    },
    setParked(next) {
      if (next === parked) return;
      if (!next) {
        unpark(true);
        return;
      }
      parked = true;
      // Hidden, js-draw measures it as zero and keeps whatever size it has,
      // so a one-pixel canvas stays one pixel through its later resizes.
      wetCanvas.style.display = "none";
      wetCanvas.width = 1;
      wetCanvas.height = 1;
    },
    end,
    dispose() {
      end();
      // The editor is being taken down; there is nothing left to repaint.
      unpark(false);
      wet.clear = originalClear;
      display.flatten = originalFlatten;
      image.addComponentDirectly = originalAddComponentDirectly;
      dirtyRegion.dispose();
    },
  };
}
