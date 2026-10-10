// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  createInkChiselBuilder,
  type InkChiselGeometry,
  type InkChiselSample,
} from "@/lib/ink/geometry/chisel";
import type { InkPathCommand } from "@/lib/ink/model";

/**
 * The highlighter geometry on its own, with no js-draw and no DOM. The golden
 * test pins it to what the js-draw builder drew; these check its character.
 */
const WIDTH = 20;
const sample = (x: number, y: number): InkChiselSample => ({ x, y, width: WIDTH });

function draw(samples: InkChiselSample[], nibAngle: () => number = () => 0, pixelSize = 0.01) {
  const chisel = createInkChiselBuilder(samples[0], { pixelSize, nibAngle });
  for (const next of samples.slice(1)) chisel.addPoint(next);
  return chisel;
}

const line = (count: number, from: [number, number], to: [number, number]) =>
  Array.from({ length: count }, (_, index) => {
    const t = index / (count - 1);
    return sample(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t);
  });

const movesIn = ({ path }: InkChiselGeometry) =>
  path.filter((command) => command.op === "M").length;

function corners({ path }: InkChiselGeometry) {
  return path.map((command: InkPathCommand) => {
    if (command.op !== "M" && command.op !== "L") throw new Error("A highlighter is straight edges only.");
    return { x: command.x, y: command.y };
  });
}

describe("the highlighter geometry", () => {
  it("leaves the tip's own footprint for a tap", () => {
    const { path } = draw([sample(90, 90)]).preview();

    // A rectangle: a flat edge of the nib's width, and a thin side.
    expect(path.map((command) => command.op)).toEqual(["M", "L", "L", "L"]);
    const xs = corners({ path }).map((corner) => corner.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(WIDTH, 6);
  });

  it("is as wide as the nib across a horizontal wash, and thin down its side", () => {
    const outline = draw(line(40, [30, 100], [330, 100])).build();
    const points = corners(outline);
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);

    expect(Math.min(...xs)).toBeCloseTo(30 - WIDTH / 2, 6);
    expect(Math.max(...xs)).toBeCloseTo(330 + WIDTH / 2, 6);
    // The narrow side is a fifth of the width, half of it either way.
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(WIDTH * 0.2, 6);
  });

  it("commits the footprints as one loop, but draws them wet as separate pieces", () => {
    const chisel = draw(
      Array.from({ length: 60 }, (_, index) => sample(30 + index * 5, 100 + Math.sin(index / 5) * 30))
    );

    expect(movesIn(chisel.preview())).toBeGreaterThan(1);
    expect(movesIn(chisel.build())).toBe(1);
  });

  it("asks for the nib's angle once for the start and once for each sample it keeps", () => {
    let asked = 0;
    const chisel = draw(
      // A real step, then a jiggle too small to count, then another step.
      [sample(0, 0), sample(5, 0), sample(5.01, 0), sample(60, 0)],
      () => {
        asked += 1;
        return 0;
      },
      1
    );

    chisel.build();
    expect(asked).toBe(3);
  });

  it("turns the nib with the hand", () => {
    const angles = [0, Math.PI / 2];
    let index = 0;
    const turning = draw(
      [sample(0, 0), sample(80, 0)],
      () => angles[Math.min(index++, angles.length - 1)]
    ).build();
    const flat = draw([sample(0, 0), sample(80, 0)]).build();

    // Held upright at the far end, the stroke reaches higher than a flat nib's.
    const height = (outline: InkChiselGeometry) => {
      const ys = corners(outline).map((corner) => corner.y);
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(height(turning)).toBeGreaterThan(height(flat) * 4);
  });

  it("grows the bounding box by half the nib", () => {
    const { points, margin } = draw(line(10, [0, 0], [100, 0])).extent();

    expect(margin).toBe(WIDTH / 2);
    expect(points[0]).toMatchObject({ x: 0, y: 0 });
  });
});
