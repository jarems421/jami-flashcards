// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from "vitest";
import type { Stroke, StrokeDataPoint } from "js-draw";
import { createNotebookSmoothPenStrokeFactory } from "@/lib/workspace/notebook-smooth-pen";
import {
  getNotebookPenFeelFromSettings,
  NOTEBOOK_PEN_SETTINGS_DEFAULT,
} from "@/lib/workspace/notebook-pen-feel";
import { loadJsDraw, type JsDrawModule } from "@/lib/workspace/notebook-js-draw";

/*
 * "The corner pokes out a little on a smooth turn, whatever the corner
 * setting." Reported 1 Oct 2026.
 *
 * These replay round turns of the size handwriting makes -- the bottom of a
 * 'u', the top of an 'n', a small 'o', a wave -- at writing speeds, sampled the
 * way a Pencil delivers them: packets that alternate bunched and spread, a
 * fraction of a pixel of noise, and pressure that swells and fades. Then they
 * measure the furthest the drawn ink reaches past where the pen actually was.
 */

let jsDraw: JsDrawModule;

beforeAll(async () => {
  jsDraw = await loadJsDraw();
}, 120_000);

const viewport = {
  getSizeOfPixelOnCanvas: () => 1,
  visibleRect: { x: 0, y: 0, w: 1000, h: 1000 },
} as never;

type Point = { x: number; y: number };

/** A deterministic pseudo-random sequence, so every run measures the same strokes. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** A path made of straight runs and arcs, walked by distance along it. */
type Piece =
  | { kind: "line"; to: Point }
  | { kind: "arc"; centre: Point; radius: number; sweep: number };

function pathOf(start: Point, startAngle: number, pieces: Piece[]) {
  const steps: Point[] = [start];
  let current = start;
  let heading = startAngle;
  for (const piece of pieces) {
    if (piece.kind === "line") {
      const length = Math.hypot(piece.to.x - current.x, piece.to.y - current.y);
      const count = Math.max(1, Math.ceil(length * 8));
      for (let k = 1; k <= count; k += 1) {
        steps.push({
          x: current.x + ((piece.to.x - current.x) * k) / count,
          y: current.y + ((piece.to.y - current.y) * k) / count,
        });
      }
      heading = Math.atan2(piece.to.y - current.y, piece.to.x - current.x);
      current = piece.to;
    } else {
      const startOffset = Math.atan2(
        current.y - piece.centre.y,
        current.x - piece.centre.x
      );
      const count = Math.max(4, Math.ceil(Math.abs(piece.sweep) * piece.radius * 8));
      for (let k = 1; k <= count; k += 1) {
        const angle = startOffset + (piece.sweep * k) / count;
        steps.push({
          x: piece.centre.x + piece.radius * Math.cos(angle),
          y: piece.centre.y + piece.radius * Math.sin(angle),
        });
      }
      current = steps[steps.length - 1];
      heading += piece.sweep;
    }
  }
  void heading;
  return steps;
}

const SHAPES: Record<string, Point[]> = {
  // Down, round the bottom, back up.
  "fast u": pathOf({ x: 100, y: 100 }, Math.PI / 2, [
    { kind: "line", to: { x: 100, y: 125 } },
    { kind: "arc", centre: { x: 105, y: 125 }, radius: 5, sweep: -Math.PI },
    { kind: "line", to: { x: 110, y: 100 } },
  ]),
  // Up, round the top, back down.
  "fast n": pathOf({ x: 100, y: 130 }, -Math.PI / 2, [
    { kind: "line", to: { x: 100, y: 108 } },
    { kind: "arc", centre: { x: 104, y: 108 }, radius: 4, sweep: Math.PI },
    { kind: "line", to: { x: 108, y: 130 } },
  ]),
  "small o": pathOf({ x: 106, y: 100 }, Math.PI / 2, [
    { kind: "arc", centre: { x: 100, y: 100 }, radius: 6, sweep: Math.PI * 1.85 },
  ]),
  // Three humps, as a fast 'm' or a wave.
  wave: pathOf({ x: 100, y: 120 }, -Math.PI / 2, [
    { kind: "line", to: { x: 100, y: 110 } },
    { kind: "arc", centre: { x: 106, y: 110 }, radius: 6, sweep: Math.PI },
    { kind: "arc", centre: { x: 118, y: 110 }, radius: 6, sweep: -Math.PI },
    { kind: "arc", centre: { x: 130, y: 110 }, radius: 6, sweep: Math.PI },
    { kind: "line", to: { x: 136, y: 120 } },
  ]),
};

const PEN_WIDTH = 3.2;

/** Samples a dense path every `spacing` pixels (on average), as a Pencil would. */
function sample(dense: Point[], spacing: number, seed: number) {
  const next = random(seed);
  const input: StrokeDataPoint[] = [];
  let travelled = 0;
  let due = 0;
  let index = 0;
  let maxHalfWidth = 0;
  const push = (at: Point, distance: number) => {
    const pressure =
      0.8 + 0.35 * Math.sin(distance * 0.21 + seed) + (next() - 0.5) * 0.1;
    const width = PEN_WIDTH * pressure;
    maxHalfWidth = Math.max(maxHalfWidth, width / 2);
    input.push({
      pos: jsDraw.Vec2.of(at.x + (next() - 0.5) * 0.4, at.y + (next() - 0.5) * 0.4),
      width,
      color: jsDraw.Color4.fromString("#101010"),
      // A steady sweep at 1px/ms: a round turn is not slowed into.
      time: distance,
    });
  };
  push(dense[0], 0);
  for (index = 1; index < dense.length; index += 1) {
    travelled += Math.hypot(
      dense[index].x - dense[index - 1].x,
      dense[index].y - dense[index - 1].y
    );
    if (travelled >= due) {
      push(dense[index], travelled);
      // Packets alternate bunched and spread.
      due = travelled + spacing * (input.length % 3 === 0 ? 0.3 : 1.35);
    }
  }
  push(dense[dense.length - 1], travelled);
  return { input, maxHalfWidth };
}

function drawnPoints(stroke: Stroke) {
  const part = stroke.getParts()[0];
  const out: Point[] = [];
  let current = part.path.startPoint;
  for (const command of part.path.parts) {
    if (command.kind === jsDraw.PathCommandType.CubicBezierTo) {
      const { controlPoint1: c1, controlPoint2: c2, endPoint: end } = command;
      for (let step = 1; step <= 24; step += 1) {
        const t = step / 24;
        const u = 1 - t;
        out.push({
          x: u * u * u * current.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * end.x,
          y: u * u * u * current.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * end.y,
        });
      }
      current = end;
    } else if ("point" in command) {
      out.push({ x: command.point.x, y: command.point.y });
      current = command.point;
    }
  }
  return {
    outline: part.style.fill.a > 0,
    points: out,
    halfWidth: (part.style.stroke?.width ?? 0) / 2,
  };
}

/**
 * Which way is "out" along the true path: away from the centre of a turn, or
 * either side of a straight run. Positive offsets in this direction are ink
 * poking out; ink on the inside of a turn is the turn being drawn a little
 * tighter, which sparse samples cannot always avoid and is not this fault.
 */
function outwardFrames(dense: Point[]) {
  return dense.map((_, index) => {
    const before = dense[Math.max(0, index - 24)];
    const here = dense[index];
    const after = dense[Math.min(dense.length - 1, index + 24)];
    const tx = after.x - before.x;
    const ty = after.y - before.y;
    const length = Math.hypot(tx, ty) || 1;
    const normal = { x: -ty / length, y: tx / length };
    const turn =
      (here.x - before.x) * (after.y - here.y) -
      (here.y - before.y) * (after.x - here.x);
    // Turning towards `normal` puts the outside on the other side.
    const side = Math.abs(turn) < 0.05 ? 0 : turn > 0 ? -1 : 1;
    return { normal, side };
  });
}

/**
 * The furthest the drawn ink reaches out beyond the pen's own path and width,
 * in pixels. The round ends are left out: a cap reaching past the last sample
 * is what a cap is for.
 */
function worstPoke(stroke: Stroke, dense: Point[], maxHalfWidth: number) {
  const { outline, points, halfWidth } = drawnPoints(stroke);
  const frames = outwardFrames(dense);
  const ends = 12;
  let worst = 0;
  for (const point of points) {
    let best = Infinity;
    let bestIndex = 0;
    for (let index = 0; index < dense.length; index += 1) {
      const distance = Math.hypot(dense[index].x - point.x, dense[index].y - point.y);
      if (distance < best) {
        best = distance;
        bestIndex = index;
      }
    }
    if (bestIndex < ends || bestIndex > dense.length - 1 - ends) continue;
    const { normal, side } = frames[bestIndex];
    const offset =
      (point.x - dense[bestIndex].x) * normal.x +
      (point.y - dense[bestIndex].y) * normal.y;
    const outward = side === 0 ? Math.abs(offset) : offset * side;
    const reach = outline ? outward : outward + halfWidth;
    worst = Math.max(worst, reach - maxHalfWidth);
  }
  return worst;
}

function measure(options: {
  cornerSharpnessPercent: number;
  pressure: boolean;
  spacings: number[];
}) {
  const feel = getNotebookPenFeelFromSettings({
    ...NOTEBOOK_PEN_SETTINGS_DEFAULT,
    cornerSharpnessPercent: options.cornerSharpnessPercent,
  });
  let worst = 0;
  let worstCase = "";
  for (const [name, dense] of Object.entries(SHAPES)) {
    for (const spacing of options.spacings) {
      for (let seed = 1; seed <= 6; seed += 1) {
        const { input, maxHalfWidth } = sample(dense, spacing, seed);
        if (!options.pressure) {
          for (const point of input) point.width = PEN_WIDTH;
        }
        const builder = createNotebookSmoothPenStrokeFactory(jsDraw, feel)(
          input[0],
          viewport
        );
        for (const next of input.slice(1)) builder.addPoint(next);
        const poke = worstPoke(
          builder.build() as Stroke,
          dense,
          options.pressure ? maxHalfWidth : PEN_WIDTH / 2
        );
        if (poke > worst) {
          worst = poke;
          worstCase = `${name}, ${spacing}px apart, seed ${seed}`;
        }
      }
    }
  }
  return { worst, worstCase };
}

describe("smooth turns", () => {
  /*
   * Before the fix, at the default corner setting: 1.8px on a fast 'u' with a
   * Pencil, 0.6-0.9px at ordinary speeds, and the same at every corner setting.
   * Three causes, none of them the corner rule: easing dragged a point towards
   * the middle of an unevenly spaced pair of neighbours; a long straight leg's
   * control arm swung it out before the turn; and the tapered outline's edges
   * were pushed out along a noisy chord rather than the centreline's direction.
   */
  for (const cornerSharpnessPercent of [0, 38, 100]) {
    it(`do not poke out with a Pencil, corners at ${cornerSharpnessPercent}`, () => {
      const { worst, worstCase } = measure({
        cornerSharpnessPercent,
        pressure: true,
        spacings: [2.5, 4, 6, 8],
      });
      expect(worst, worstCase).toBeLessThan(0.75);
    });
  }

  it("do not poke out at one width, at ordinary writing speeds", () => {
    const { worst, worstCase } = measure({
      cornerSharpnessPercent: 38,
      pressure: false,
      spacings: [2.5, 4, 6],
    });
    expect(worst, worstCase).toBeLessThan(0.75);
  });
});
