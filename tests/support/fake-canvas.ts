/**
 * A stand-in for the browser's 2D canvas and `Path2D`, for testing Jami Ink's
 * renderer under jsdom (which has neither). Nothing is rasterised: each
 * context records the calls made on it, and a clock can be advanced per paint
 * so time-sliced drawing can be exercised.
 */

export type FakeCall = { op: string; args: unknown[] };

export class FakePath2D {
  readonly commands: Array<[string, ...number[]]> = [];
  moveTo(x: number, y: number) {
    this.commands.push(["M", x, y]);
  }
  lineTo(x: number, y: number) {
    this.commands.push(["L", x, y]);
  }
  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number) {
    this.commands.push(["C", x1, y1, x2, y2, x, y]);
  }
  quadraticCurveTo(x1: number, y1: number, x: number, y: number) {
    this.commands.push(["Q", x1, y1, x, y]);
  }
}

export type FakeContext = {
  canvas: HTMLCanvasElement;
  calls: FakeCall[];
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  globalAlpha: number;
  imageSmoothingEnabled: boolean;
};

const recorded = ["setTransform", "clearRect", "fill", "stroke", "drawImage", "save", "restore", "fillRect"];

export type FakeCanvasEnvironment = {
  /** Contexts made so far, by canvas. */
  contexts: Map<HTMLCanvasElement, FakeContext>;
  /** The clock tests pass to the renderer as `now`. */
  now: () => number;
  advance: (ms: number) => void;
  /** Milliseconds each `fill` or `stroke` takes on the clock (0 by default). */
  paintCost: number;
  restore: () => void;
};

/** Makes every canvas's `getContext("2d")` return a recording fake. */
export function installFakeCanvas(): FakeCanvasEnvironment {
  const prototype = HTMLCanvasElement.prototype;
  const original = prototype.getContext;
  let time = 0;
  const environment: FakeCanvasEnvironment = {
    contexts: new Map(),
    now: () => time,
    advance: (ms) => {
      time += ms;
    },
    paintCost: 0,
    restore: () => {
      prototype.getContext = original;
    },
  };
  const make = (canvas: HTMLCanvasElement): FakeContext => {
    const context = {
      canvas,
      calls: [] as FakeCall[],
      fillStyle: "#000000",
      strokeStyle: "#000000",
      lineWidth: 1,
      lineCap: "butt",
      lineJoin: "miter",
      globalAlpha: 1,
      imageSmoothingEnabled: true,
    } as FakeContext & Record<string, unknown>;
    for (const op of recorded) {
      context[op] = (...args: unknown[]) => {
        context.calls.push({ op, args });
        if (op === "fill" || op === "stroke") time += environment.paintCost;
      };
    }
    return context;
  };
  // jsdom's own getContext reports "not implemented"; this replaces it.
  prototype.getContext = function getContext(this: HTMLCanvasElement) {
    let context = environment.contexts.get(this);
    if (!context) {
      context = make(this);
      environment.contexts.set(this, context);
    }
    return context;
  } as unknown as typeof prototype.getContext;
  return environment;
}

/** The calls of one kind a canvas has had. */
export function callsOf(environment: FakeCanvasEnvironment, canvas: HTMLCanvasElement, op: string): FakeCall[] {
  return environment.contexts.get(canvas)?.calls.filter((call) => call.op === op) ?? [];
}
