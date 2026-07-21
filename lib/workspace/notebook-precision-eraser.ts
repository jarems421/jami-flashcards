import type {
  AbstractComponent,
  Editor as JsDrawEditor,
  LineSegment2,
  SerializableCommand,
  Vec2,
} from "js-draw";
import {
  getNotebookCircularEraserSweepPoints,
  getNotebookPrecisionEraserContactRadiusOnCanvas,
  type NotebookEraserPoint,
} from "@/lib/workspace/notebook-eraser";

type JsDrawModule = typeof import("js-draw");

type PrecisionEraserState = {
  addCommands: SerializableCommand[];
  eraseCommands: SerializableCommand[];
  lastPoint: Vec2;
  pendingPoints: Vec2[];
  toAdd: Set<AbstractComponent>;
  toRemove: AbstractComponent[];
};

export const NOTEBOOK_PRECISION_ERASER_PATH_SWEEPS_PER_PACKET = 1;
export const NOTEBOOK_PRECISION_ERASER_PATH_SWEEPS_PER_FRAME = 1;

export type NotebookPrecisionEraserFrameScheduler = {
  cancelFrame(handle: number): void;
  requestFrame(callback: () => void): number;
};

const browserFrameScheduler: NotebookPrecisionEraserFrameScheduler = {
  cancelFrame(handle) {
    window.cancelAnimationFrame(handle);
  },
  requestFrame(callback) {
    return window.requestAnimationFrame(callback);
  },
};

type StrokePartLike = {
  path?: {
    closedContainsPoint(point: NotebookEraserPoint): boolean;
    intersection(
      line: LineSegment2,
      strokeRadius?: number
    ): ReadonlyArray<unknown>;
    signedDistance(point: NotebookEraserPoint, strokeRadius: number): number;
  };
  startPoint?: NotebookEraserPoint;
  style?: {
    fill?: { a?: number };
    stroke?: { width?: number };
  };
};

function getComponentContactRadius(input: {
  component: AbstractComponent;
  cursorDiameter: number;
  eraserFrom: NotebookEraserPoint;
  eraserTo: NotebookEraserPoint;
  jsDraw: JsDrawModule;
  viewportScale: number;
}) {
  const component = input.component;
  const getParts = (component as AbstractComponent & {
    getParts?: () => readonly StrokePartLike[];
  }).getParts;
  if (typeof getParts !== "function") return null;

  const eraserMoved =
    input.eraserFrom.x !== input.eraserTo.x ||
    input.eraserFrom.y !== input.eraserTo.y;
  const eraserAxis = eraserMoved
    ? new input.jsDraw.LineSegment2(
        input.jsDraw.Vec2.of(input.eraserFrom.x, input.eraserFrom.y),
        input.jsDraw.Vec2.of(input.eraserTo.x, input.eraserTo.y)
      )
    : null;
  let touchedRadius: number | null = null;
  for (const part of getParts.call(component)) {
    if (!part.path) continue;
    const strokeWidth = part.style?.stroke?.width;
    const transparentFill = (part.style?.fill?.a ?? 0) === 0;
    const contactRadius =
      getNotebookPrecisionEraserContactRadiusOnCanvas({
        cursorDiameter: input.cursorDiameter,
        strokeWidth:
          transparentFill && Number.isFinite(strokeWidth)
            ? strokeWidth
            : 0,
        viewportScale: input.viewportScale,
      });

    // Path.polylineApproximation() is the Bezier control polygon, not a
    // geometric approximation of the rendered curve. Using it here caused
    // false negatives whenever the curve bowed away from its control edges.
    // signedDistance/intersection operate on js-draw's real line/Bezier
    // geometry and therefore match the pixels that withRegionErased splits.
    let touchesPath = false;
    try {
      const fromDistance = part.path.signedDistance(input.eraserFrom, 0);
      const toDistance = part.path.signedDistance(input.eraserTo, 0);
      touchesPath =
        (Number.isFinite(fromDistance) && fromDistance <= contactRadius) ||
        (Number.isFinite(toDistance) && toDistance <= contactRadius) ||
        Boolean(
          eraserAxis &&
            part.path.intersection(eraserAxis, contactRadius).length > 0
        );
    } catch {
      // Malformed legacy paths are left intact. Precision mode must never
      // turn an uncertain geometry result into whole-stroke deletion.
      touchesPath = false;
    }
    const centerInsideFill =
      !transparentFill &&
      (() => {
        try {
          return (
            part.path.closedContainsPoint(input.eraserFrom) ||
            part.path.closedContainsPoint(input.eraserTo)
          );
        } catch {
          return false;
        }
      })();
    if (touchesPath || centerInsideFill) {
      touchedRadius = Math.max(touchedRadius ?? 0, contactRadius);
    }
  }
  return touchedRadius;
}

function isByteEquivalentReplacement(
  component: AbstractComponent,
  replacements: AbstractComponent[]
) {
  if (replacements.length !== 1) return false;
  const replacement = replacements[0];
  if (replacement === component) return true;

  try {
    const originalData = component.serialize();
    const replacementData = replacement.serialize();
    // IDs deliberately differ for js-draw's one-for-one clone. Rendering is
    // unchanged when component kind, stacking position, and serialized stroke
    // data are byte-equivalent, so this must not become an erase/add history
    // action on every precision sample.
    return (
      originalData.name === replacementData.name &&
      originalData.zIndex === replacementData.zIndex &&
      JSON.stringify(originalData.data) === JSON.stringify(replacementData.data)
    );
  } catch {
    return false;
  }
}

/**
 * A live, circular partial eraser built only on js-draw's public image and
 * command APIs. It never delegates precision gestures to EraserTool's square
 * PartialStroke path and never deletes components that cannot be split.
 */
export class NotebookPrecisionEraserGesture {
  private state: PrecisionEraserState | null = null;
  private pendingFrame: number | null = null;

  constructor(
    private readonly editor: JsDrawEditor,
    private readonly jsDraw: JsDrawModule,
    private readonly cursorDiameter: number,
    private readonly frameScheduler = browserFrameScheduler
  ) {}

  get active() {
    return this.state !== null;
  }

  begin(screenPoint: NotebookEraserPoint) {
    if (this.state) this.cancel();
    const canvasPoint = this.toCanvasPoint(screenPoint);
    this.state = {
      addCommands: [],
      eraseCommands: [],
      lastPoint: canvasPoint,
      pendingPoints: [],
      toAdd: new Set(),
      toRemove: [],
    };
    // Erase on contact, not after the pointer has moved two screen pixels.
    this.eraseBetween(canvasPoint, canvasPoint);
  }

  move(screenPoint: NotebookEraserPoint) {
    this.moveBatch([screenPoint]);
  }

  /**
   * Queues a bend-preserving packet and performs at most one path sweep
   * synchronously. Any remainder is frame-drained in order. If a packet does
   * leave work queued, its exact endpoint receives an immediate point contact;
   * that contact never advances the queued path anchor and cannot cut the
   * corner between unprocessed bends.
   */
  moveBatch(screenPoints: readonly NotebookEraserPoint[]) {
    const state = this.state;
    if (!state || screenPoints.length === 0) return;
    for (const screenPoint of screenPoints) {
      const canvasPoint = this.toCanvasPoint(screenPoint);
      const previousQueuedPoint =
        state.pendingPoints[state.pendingPoints.length - 1] ?? state.lastPoint;
      if (canvasPoint.distanceTo(previousQueuedPoint) > 0) {
        state.pendingPoints.push(canvasPoint);
      }
    }

    this.drainPending(NOTEBOOK_PRECISION_ERASER_PATH_SWEEPS_PER_PACKET);
    if (state.pendingPoints.length > 0) {
      const endpoint = state.pendingPoints[state.pendingPoints.length - 1];
      this.eraseBetween(endpoint, endpoint);
      this.schedulePendingDrain();
    }
  }

  finish() {
    const state = this.state;
    if (!state) return;
    this.cancelPendingFrame();
    // Pointer packets are spatially reduced before reaching this queue, so the
    // normal release remainder is zero or one segment. Keeping this final drain
    // synchronous preserves Safari capture/history/autosave ordering.
    this.drainPending(Number.POSITIVE_INFINITY);

    const commands: SerializableCommand[] = [];
    if (state.addCommands.length > 0) {
      state.addCommands.forEach((command) => command.unapply(this.editor));

      for (const item of [...state.toRemove]) {
        if (!state.toAdd.has(item)) continue;
        state.toAdd.delete(item);
        state.toRemove = state.toRemove.filter((other) => other !== item);
      }
      commands.push(
        ...[...state.toAdd].map((component) =>
          this.jsDraw.EditorImage.addComponent(component)
        )
      );
    }

    if (state.eraseCommands.length > 0) {
      state.eraseCommands.forEach((command) => command.unapply(this.editor));
      if (state.toRemove.length > 0) {
        commands.push(new this.jsDraw.Erase(state.toRemove));
      }
    }

    this.state = null;
    if (commands.length === 1) {
      void this.editor.dispatch(commands[0]);
    } else if (commands.length > 1) {
      void this.editor.dispatch(this.jsDraw.uniteCommands(commands));
    }
  }

  cancel() {
    const state = this.state;
    if (!state) return;
    this.cancelPendingFrame();
    state.addCommands.forEach((command) => command.unapply(this.editor));
    state.eraseCommands.forEach((command) => command.unapply(this.editor));
    this.state = null;
  }

  private toCanvasPoint(screenPoint: NotebookEraserPoint) {
    return this.editor.viewport.screenToCanvas(
      this.jsDraw.Vec2.of(screenPoint.x, screenPoint.y)
    );
  }

  private makeSweepPath(
    from: NotebookEraserPoint,
    to: NotebookEraserPoint,
    radius: number
  ) {
    return this.jsDraw.Path.fromConvexHullOf(
      getNotebookCircularEraserSweepPoints({ from, to, radius }).map((point) =>
        this.jsDraw.Vec2.of(point.x, point.y)
      )
    );
  }

  private cancelPendingFrame() {
    if (this.pendingFrame === null) return;
    this.frameScheduler.cancelFrame(this.pendingFrame);
    this.pendingFrame = null;
  }

  private schedulePendingDrain() {
    if (this.pendingFrame !== null || !this.state?.pendingPoints.length) return;
    this.pendingFrame = this.frameScheduler.requestFrame(() => {
      this.pendingFrame = null;
      if (!this.state) return;
      this.drainPending(NOTEBOOK_PRECISION_ERASER_PATH_SWEEPS_PER_FRAME);
      this.schedulePendingDrain();
    });
  }

  private drainPending(maxSweeps: number) {
    const state = this.state;
    if (!state) return;
    let completedSweeps = 0;
    while (
      state.pendingPoints.length > 0 &&
      completedSweeps < maxSweeps
    ) {
      const currentPoint = state.pendingPoints.shift();
      if (!currentPoint) break;
      this.eraseBetween(state.lastPoint, currentPoint);
      state.lastPoint = currentPoint;
      completedSweeps += 1;
    }
  }

  private eraseBetween(fromPoint: Vec2, currentPoint: Vec2) {
    const state = this.state;
    if (!state) return;

    const viewportScale = this.editor.viewport.getScaleFactor();
    const broadRadius = getNotebookPrecisionEraserContactRadiusOnCanvas({
      cursorDiameter: this.cursorDiameter,
      viewportScale,
    });
    const broadSweep = this.makeSweepPath(
      fromPoint,
      currentPoint,
      broadRadius
    );
    const candidates = this.editor.image
      .getComponentsIntersecting(broadSweep.bbox)
      .filter(
        (component) =>
          component instanceof this.jsDraw.Stroke &&
          component.isSelectable() &&
          typeof component.withRegionErased === "function"
      );
    const toErase: AbstractComponent[] = [];
    const toAdd: AbstractComponent[] = [];

    for (const component of candidates) {
      const contactRadius = getComponentContactRadius({
        component,
        cursorDiameter: this.cursorDiameter,
        eraserFrom: fromPoint,
        eraserTo: currentPoint,
        jsDraw: this.jsDraw,
        viewportScale,
      });
      if (contactRadius === null) continue;
      const contactSweep = this.makeSweepPath(
        fromPoint,
        currentPoint,
        contactRadius
      );
      const replacements = component.withRegionErased?.(
        contactSweep,
        this.editor.viewport
      );
      if (!replacements || isByteEquivalentReplacement(component, replacements)) {
        continue;
      }
      // js-draw can return [] for tiny paths even when only their edge was
      // touched. Whole-component removal is allowed only when the circular
      // contact region genuinely contains the complete visible bounds.
      if (
        replacements.length === 0 &&
        !broadSweep.closedContainsRect(component.getExactBBox())
      ) {
        continue;
      }
      toErase.push(component);
      toAdd.push(...replacements);
    }

    if (toErase.length > 0) {
      const liveErase = new this.jsDraw.Erase(toErase);
      const liveAdds = toAdd.map((component) =>
        this.jsDraw.EditorImage.addComponent(component)
      );
      liveErase.apply(this.editor);
      liveAdds.forEach((command) => command.apply(this.editor));

      const originalComponents: AbstractComponent[] = [];
      for (const component of toErase) {
        if (state.toAdd.has(component)) {
          state.toAdd.delete(component);
        } else {
          originalComponents.push(component);
        }
      }
      state.toRemove.push(...originalComponents);
      toAdd.forEach((component) => state.toAdd.add(component));
      if (originalComponents.length > 0) {
        state.eraseCommands.push(new this.jsDraw.Erase(originalComponents));
      }
      state.addCommands.push(...liveAdds);
    }
  }
}
