import { describe, expect, it } from "vitest";
import {
  NOTEBOOK_PRECISION_ERASER_PATH_SWEEPS_PER_FRAME,
  NOTEBOOK_PRECISION_ERASER_PATH_SWEEPS_PER_PACKET,
  NotebookPrecisionEraserGesture,
  type NotebookPrecisionEraserFrameScheduler,
} from "@/lib/workspace/notebook-precision-eraser";
import {
  Color4,
  LineSegment2,
  Path,
  PathCommandType,
  Rect2,
  Vec2,
} from "@js-draw/math";
// @ts-expect-error -- Direct module import avoids js-draw's browser-only package entry in node tests.
import JsDrawStroke from "../node_modules/js-draw/dist/mjs/components/Stroke.mjs";

type FakeRect = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

class FakeVec2 {
  constructor(
    readonly x: number,
    readonly y: number
  ) {}

  distanceTo(other: FakeVec2) {
    return Math.hypot(this.x - other.x, this.y - other.y);
  }
}

class FakeLineSegment {
  constructor(
    readonly p1: FakeVec2,
    readonly p2: FakeVec2
  ) {}
}

class FakeSweepPath {
  readonly bbox: FakeRect;

  constructor(readonly points: FakeVec2[]) {
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    this.bbox = {
      left: Math.min(...xs),
      right: Math.max(...xs),
      top: Math.min(...ys),
      bottom: Math.max(...ys),
    };
  }

  closedContainsRect(rect: FakeRect) {
    return (
      rect.left >= this.bbox.left &&
      rect.right <= this.bbox.right &&
      rect.top >= this.bbox.top &&
      rect.bottom <= this.bbox.bottom
    );
  }
}

class FakeStrokePath {
  constructor(
    private readonly start: FakeVec2,
    private readonly end: FakeVec2
  ) {}

  closedContainsPoint() {
    return false;
  }

  intersection() {
    return [];
  }

  polylineApproximation() {
    return [{ p1: this.start, p2: this.end }];
  }

  signedDistance(point: FakeVec2, strokeRadius: number) {
    const dx = this.end.x - this.start.x;
    const dy = this.end.y - this.start.y;
    const lengthSquared = dx * dx + dy * dy;
    const progress =
      lengthSquared === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((point.x - this.start.x) * dx +
                (point.y - this.start.y) * dy) /
                lengthSquared
            )
          );
    const nearestX = this.start.x + progress * dx;
    const nearestY = this.start.y + progress * dy;
    return Math.hypot(point.x - nearestX, point.y - nearestY) - strokeRadius;
  }
}

class FakeStroke {
  eraseCallCount = 0;
  replacements: FakeStroke[] = [this];

  constructor(
    readonly id: string,
    private readonly exactBBox: FakeRect,
    private readonly start = new FakeVec2(-20, 0),
    private readonly end = new FakeVec2(20, 0),
    private readonly width = 4
  ) {}

  getExactBBox() {
    return this.exactBBox;
  }

  getParts() {
    return [
      {
        path: new FakeStrokePath(this.start, this.end),
        startPoint: this.start,
        style: {
          fill: { a: 0 },
          stroke: { width: this.width },
        },
      },
    ];
  }

  isSelectable() {
    return true;
  }

  serialize() {
    return {
      data: {
        bbox: this.exactBBox,
        end: this.end,
        start: this.start,
        width: this.width,
      },
      id: this.id,
      loadSaveData: {},
      name: "stroke",
      zIndex: 0,
    };
  }

  withRegionErased() {
    this.eraseCallCount += 1;
    return this.replacements;
  }
}

type FakeEditor = ReturnType<typeof makeHarness>["editor"];

class FakeEraseCommand {
  constructor(private readonly components: FakeStroke[]) {}

  apply(editor: FakeEditor) {
    editor.image.components = editor.image.components.filter(
      (component) => !this.components.includes(component)
    );
  }

  unapply(editor: FakeEditor) {
    for (const component of this.components) {
      if (!editor.image.components.includes(component)) {
        editor.image.components.push(component);
      }
    }
  }
}

class FakeAddCommand {
  constructor(private readonly component: FakeStroke) {}

  apply(editor: FakeEditor) {
    if (!editor.image.components.includes(this.component)) {
      editor.image.components.push(this.component);
    }
  }

  unapply(editor: FakeEditor) {
    editor.image.components = editor.image.components.filter(
      (component) => component !== this.component
    );
  }
}

class FakeCompositeCommand {
  constructor(
    private readonly commands: Array<
      FakeAddCommand | FakeEraseCommand | FakeCompositeCommand
    >
  ) {}

  apply(editor: FakeEditor) {
    this.commands.forEach((command) => command.apply(editor));
  }

  unapply(editor: FakeEditor) {
    [...this.commands].reverse().forEach((command) => command.unapply(editor));
  }
}

type GeometryOverrides = {
  LineSegment2?: typeof FakeLineSegment;
  Path?: {
    fromConvexHullOf(points: FakeVec2[]): FakeSweepPath;
  };
  Stroke?: typeof FakeStroke;
  Vec2?: {
    of(x: number, y: number): FakeVec2;
  };
};

function makeHarness(
  initial: FakeStroke[] = [],
  geometry: GeometryOverrides = {}
) {
  const editor = {
    image: {
      components: [...initial],
      getComponentsIntersecting() {
        return [...this.components];
      },
    },
    viewport: {
      getScaleFactor: () => 1,
      roundPoint: <Point>(point: Point) => point,
      screenToCanvas: (point: FakeVec2) => point,
    },
    dispatched: [] as Array<
      FakeAddCommand | FakeEraseCommand | FakeCompositeCommand
    >,
    dispatch(command: FakeAddCommand | FakeEraseCommand | FakeCompositeCommand) {
      this.dispatched.push(command);
      command.apply(this);
    },
  };
  const jsDraw = {
    EditorImage: {
      addComponent: (component: FakeStroke) => new FakeAddCommand(component),
    },
    Erase: FakeEraseCommand,
    LineSegment2: geometry.LineSegment2 ?? FakeLineSegment,
    Path:
      geometry.Path ??
      ({
        fromConvexHullOf: (points: FakeVec2[]) => new FakeSweepPath(points),
      } satisfies GeometryOverrides["Path"]),
    Stroke: geometry.Stroke ?? FakeStroke,
    Vec2:
      geometry.Vec2 ??
      ({
        of: (x: number, y: number) => new FakeVec2(x, y),
      } satisfies GeometryOverrides["Vec2"]),
    uniteCommands: (
      commands: Array<FakeAddCommand | FakeEraseCommand>
    ) => new FakeCompositeCommand(commands),
  };

  return { editor, jsDraw };
}

function makeGesture(
  harness: ReturnType<typeof makeHarness>,
  cursorDiameter = 20,
  frameScheduler?: NotebookPrecisionEraserFrameScheduler
) {
  return new NotebookPrecisionEraserGesture(
    harness.editor as never,
    harness.jsDraw as never,
    cursorDiameter,
    frameScheduler
  );
}

function makeFrameScheduler() {
  let nextHandle = 1;
  const callbacks = new Map<number, () => void>();
  const scheduler: NotebookPrecisionEraserFrameScheduler = {
    cancelFrame(handle) {
      callbacks.delete(handle);
    },
    requestFrame(callback) {
      const handle = nextHandle;
      nextHandle += 1;
      callbacks.set(handle, callback);
      return handle;
    },
  };
  return {
    pendingCount: () => callbacks.size,
    runNextFrame() {
      const next = callbacks.entries().next().value as
        | [number, () => void]
        | undefined;
      if (!next) return;
      callbacks.delete(next[0]);
      next[1]();
    },
    scheduler,
  };
}

function makeRealStrokeHarness(strokes: JsDrawStroke[]) {
  return makeHarness(strokes as unknown as FakeStroke[], {
    LineSegment2: LineSegment2 as unknown as typeof FakeLineSegment,
    Path: Path as unknown as GeometryOverrides["Path"],
    Stroke: JsDrawStroke as unknown as typeof FakeStroke,
    Vec2: Vec2 as unknown as GeometryOverrides["Vec2"],
  });
}

describe("live notebook precision eraser", () => {
  it("bounds expensive path sweeps per packet and animation frame", () => {
    const stroke = new FakeStroke(
      "long-legacy-stroke",
      { left: -100, right: 100, top: -2, bottom: 2 },
      new FakeVec2(-100, 0),
      new FakeVec2(100, 0),
      2
    );
    const harness = makeHarness([stroke]);
    const frames = makeFrameScheduler();
    const gesture = makeGesture(harness, 20, frames.scheduler);
    gesture.begin({ x: 0, y: 0 });
    const callsAfterContact = stroke.eraseCallCount;

    gesture.moveBatch([
      { x: 2, y: 2 },
      { x: 4, y: -2 },
      { x: 6, y: 2 },
      { x: 8, y: -2 },
      { x: 10, y: 0 },
    ]);

    // One true path segment plus one exact endpoint contact is the hard packet
    // bound. The endpoint contact is absent for the common one-segment packet.
    expect(stroke.eraseCallCount - callsAfterContact).toBeLessThanOrEqual(
      NOTEBOOK_PRECISION_ERASER_PATH_SWEEPS_PER_PACKET + 1
    );
    expect(frames.pendingCount()).toBe(1);

    const callsBeforeFrame = stroke.eraseCallCount;
    frames.runNextFrame();
    expect(stroke.eraseCallCount - callsBeforeFrame).toBeLessThanOrEqual(
      NOTEBOOK_PRECISION_ERASER_PATH_SWEEPS_PER_FRAME
    );
    gesture.cancel();
    expect(frames.pendingCount()).toBe(0);
  });

  it("touches the queued packet endpoint immediately without sweeping a chord", () => {
    const chordOnlyMark = new FakeStroke(
      "chord-only",
      { left: 9.5, right: 10.5, top: 9.5, bottom: 10.5 },
      new FakeVec2(9.5, 10),
      new FakeVec2(10.5, 10),
      0
    );
    const endpointDot = new FakeStroke(
      "endpoint",
      { left: 19.5, right: 20.5, top: -0.5, bottom: 0.5 },
      new FakeVec2(20, 0),
      new FakeVec2(20, 0),
      0
    );
    endpointDot.replacements = [];
    const harness = makeHarness([chordOnlyMark, endpointDot]);
    const frames = makeFrameScheduler();
    const gesture = makeGesture(harness, 4, frames.scheduler);
    gesture.begin({ x: 0, y: 0 });

    gesture.moveBatch([
      { x: 0, y: 20 },
      { x: 20, y: 20 },
      { x: 20, y: 0 },
    ]);

    expect(harness.editor.image.components).not.toContain(endpointDot);
    expect(chordOnlyMark.eraseCallCount).toBe(0);
    gesture.finish();
    expect(chordOnlyMark.eraseCallCount).toBe(0);
  });

  it("applies a touched split immediately and commits one undoable action", () => {
    const original = new FakeStroke("original", {
      left: -20,
      right: 20,
      top: -2,
      bottom: 2,
    });
    const left = new FakeStroke("left", {
      left: -20,
      right: -10,
      top: -2,
      bottom: 2,
    });
    const right = new FakeStroke("right", {
      left: 10,
      right: 20,
      top: -2,
      bottom: 2,
    });
    original.replacements = [left, right];
    const harness = makeHarness([original]);
    const gesture = makeGesture(harness);

    gesture.begin({ x: 0, y: 0 });
    expect(harness.editor.image.components).toEqual([left, right]);
    expect(harness.editor.dispatched).toHaveLength(0);

    gesture.finish();
    expect(harness.editor.image.components).toEqual([left, right]);
    expect(harness.editor.dispatched).toHaveLength(1);
    expect(gesture.active).toBe(false);
  });

  it("restores the original ink and creates no history action on cancel", () => {
    const original = new FakeStroke("original", {
      left: -20,
      right: 20,
      top: -2,
      bottom: 2,
    });
    original.replacements = [
      new FakeStroke("left", {
        left: -20,
        right: -10,
        top: -2,
        bottom: 2,
      }),
    ];
    const harness = makeHarness([original]);
    const gesture = makeGesture(harness);

    gesture.begin({ x: 0, y: 0 });
    gesture.cancel();

    expect(harness.editor.image.components).toEqual([original]);
    expect(harness.editor.dispatched).toHaveLength(0);
  });

  it("never whole-deletes a partially covered mark when splitting fails", () => {
    const original = new FakeStroke("partial", {
      left: -20,
      right: 20,
      top: -2,
      bottom: 2,
    });
    original.replacements = [];
    const harness = makeHarness([original]);
    const gesture = makeGesture(harness);

    gesture.begin({ x: 0, y: 0 });
    gesture.finish();

    expect(harness.editor.image.components).toEqual([original]);
    expect(harness.editor.dispatched).toHaveLength(0);
  });

  it("does not whole-delete a short mark that only touches the cursor edge", () => {
    const edgeMark = new FakeStroke(
      "edge-mark",
      { left: -1, right: 1, top: 9.5, bottom: 11.5 },
      new FakeVec2(-1, 10.5),
      new FakeVec2(1, 10.5),
      4
    );
    edgeMark.replacements = [];
    const harness = makeHarness([edgeMark]);
    const gesture = makeGesture(harness);

    gesture.begin({ x: 0, y: 0 });
    gesture.finish();

    expect(harness.editor.image.components).toEqual([edgeMark]);
    expect(harness.editor.dispatched).toHaveLength(0);
  });

  it("allows a genuinely enclosed dot to disappear locally", () => {
    const dot = new FakeStroke(
      "dot",
      { left: -1, right: 1, top: -1, bottom: 1 },
      new FakeVec2(0, 0),
      new FakeVec2(0, 0),
      2
    );
    dot.replacements = [];
    const harness = makeHarness([dot]);
    const gesture = makeGesture(harness);

    gesture.begin({ x: 0, y: 0 });
    expect(harness.editor.image.components).toEqual([]);
    gesture.finish();

    expect(harness.editor.image.components).toEqual([]);
    expect(harness.editor.dispatched).toHaveLength(1);
  });

  it("contacts the rendered quadratic curve instead of its control polygon", () => {
    const curvedPath = new Path(Vec2.of(-40, 20), [
      {
        kind: PathCommandType.QuadraticBezierTo,
        controlPoint: Vec2.of(0, -20),
        endPoint: Vec2.of(40, 20),
      },
    ]);
    const curvedStroke = JsDrawStroke.fromStroked(curvedPath, {
      color: Color4.black,
      width: 2,
    });
    const harness = makeRealStrokeHarness([curvedStroke]);
    const gesture = makeGesture(harness, 14.4);

    // The Bezier passes through (0, 0), while both segments of js-draw's
    // polylineApproximation control polygon remain more than 14px away.
    gesture.begin({ x: 0, y: 0 });

    expect(harness.editor.image.components).not.toContain(curvedStroke);
    expect(harness.editor.image.components).toHaveLength(2);
    gesture.finish();
    expect(harness.editor.dispatched).toHaveLength(1);
  });

  it("ignores js-draw's byte-equivalent clone for an interior filled erase", () => {
    const filledStroke = JsDrawStroke.fromFilled(
      Path.fromRect(new Rect2(-50, -50, 100, 100)),
      Color4.black
    );
    const harness = makeRealStrokeHarness([filledStroke]);
    const gesture = makeGesture(harness, 20);

    gesture.begin({ x: 0, y: 0 });
    gesture.finish();

    expect(harness.editor.image.components).toEqual([filledStroke]);
    expect(harness.editor.dispatched).toHaveLength(0);
  });

  it("still partially erases a pressure-style filled curve at its edge", () => {
    const pressureOutline = new Path(Vec2.of(-40, 0), [
      {
        kind: PathCommandType.QuadraticBezierTo,
        controlPoint: Vec2.of(0, -20),
        endPoint: Vec2.of(40, 0),
      },
      {
        kind: PathCommandType.QuadraticBezierTo,
        controlPoint: Vec2.of(0, 20),
        endPoint: Vec2.of(-40, 0),
      },
    ]);
    const filledStroke = JsDrawStroke.fromFilled(
      pressureOutline,
      Color4.black
    );
    const harness = makeRealStrokeHarness([filledStroke]);
    const gesture = makeGesture(harness, 20);

    gesture.begin({ x: 0, y: -20 });

    expect(harness.editor.image.components).not.toContain(filledStroke);
    expect(harness.editor.image.components).toHaveLength(1);
    gesture.finish();
    expect(harness.editor.dispatched).toHaveLength(1);
  });
});
