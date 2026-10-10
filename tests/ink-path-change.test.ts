import { describe, expect, it } from "vitest";
import { createInkChiselBuilder } from "@/lib/ink/geometry/chisel";
import { createInkPenBuilder } from "@/lib/ink/geometry/pen";
import type { InkBox, InkPathCommand } from "@/lib/ink/model";
import { inkPathChange, sameInkPath, sameInkPathCommand } from "@/lib/ink/path-change";
import { getNotebookPenFeelFromSettings, NOTEBOOK_PEN_SETTINGS_DEFAULT } from "@/lib/workspace/notebook-pen-feel";

const M = (x: number, y: number): InkPathCommand => ({ op: "M", x, y });
const L = (x: number, y: number): InkPathCommand => ({ op: "L", x, y });
const C = (x1: number, y1: number, x2: number, y2: number, x: number, y: number): InkPathCommand => ({
  op: "C",
  x1,
  y1,
  x2,
  y2,
  x,
  y,
});
const Z: InkPathCommand = { op: "Z" };

function box(change: ReturnType<typeof inkPathChange>): InkBox {
  if (change.kind !== "box") throw new Error(`expected a box, got ${change.kind}`);
  return change.box;
}

const contains = (outer: InkBox, x: number, y: number) =>
  x >= outer.minX && x <= outer.maxX && y >= outer.minY && y <= outer.maxY;

describe("command and path equality", () => {
  it("compares commands by their numbers", () => {
    expect(sameInkPathCommand(L(1, 2), L(1, 2))).toBe(true);
    expect(sameInkPathCommand(L(1, 2), M(1, 2))).toBe(false);
    expect(sameInkPathCommand(C(1, 2, 3, 4, 5, 6), C(1, 2, 3, 4, 5, 7))).toBe(false);
    expect(sameInkPathCommand(Z, { op: "Z" })).toBe(true);
    expect(sameInkPath([M(0, 0), L(1, 1)], [M(0, 0), L(1, 1)])).toBe(true);
    expect(sameInkPath([M(0, 0), L(1, 1)], [M(0, 0)])).toBe(false);
  });
});

describe("inkPathChange", () => {
  it("finds nothing between a path and itself, or an equal copy", () => {
    const path = [M(0, 0), L(10, 0), L(10, 10)];
    expect(inkPathChange(path, path, true)).toEqual({ kind: "none" });
    expect(inkPathChange(path, path.map((command) => ({ ...command })), true)).toEqual({ kind: "none" });
  });

  it("covers an extended stroke from where it was to where it now ends", () => {
    const before = [M(0, 0), L(10, 0), L(20, 0)];
    const after = [M(0, 0), L(10, 0), L(20, 0), L(30, 5)];
    expect(box(inkPathChange(before, after, false))).toEqual({ minX: 20, minY: 0, maxX: 30, maxY: 5 });
  });

  it("keeps the shared ends of an outline out of the box", () => {
    // Left edge out, round the tip, right edge back: only the tip moved.
    const before = [M(0, 0), L(50, 0), L(60, 5), L(50, 10), L(0, 10)];
    const after = [M(0, 0), L(50, 0), L(70, 5), L(50, 10), L(0, 10)];
    expect(box(inkPathChange(before, after, true))).toEqual({ minX: 50, minY: 0, maxX: 70, maxY: 10 });
  });

  it("covers the start of a filled subpath when its last point moves, for the closing line", () => {
    const before = [M(0, 0), L(50, 0), L(50, 10)];
    const after = [M(0, 0), L(50, 0), L(55, 12)];
    const filled = box(inkPathChange(before, after, true));
    expect(contains(filled, 0, 0)).toBe(true);
    const stroked = box(inkPathChange(before, after, false));
    expect(contains(stroked, 0, 0)).toBe(false);
    expect(stroked).toEqual({ minX: 50, minY: 0, maxX: 55, maxY: 12 });
  });

  it("covers the start of a subpath closed by Z when the point before the Z moves", () => {
    const before = [M(0, 0), L(50, 0), L(50, 10), Z];
    const after = [M(0, 0), L(50, 0), L(60, 10), Z];
    expect(contains(box(inkPathChange(before, after, false)), 0, 0)).toBe(true);
  });

  it("covers curves by their control points and the point they start from", () => {
    const before = [M(0, 0), C(10, 0, 20, 0, 30, 0), C(40, 0, 50, 0, 60, 0)];
    const after = [M(0, 0), C(10, 0, 20, 0, 30, 0), C(40, -20, 50, 30, 60, 0)];
    expect(box(inkPathChange(before, after, false))).toEqual({ minX: 30, minY: -20, maxX: 60, maxY: 30 });
  });

  it("covers subpaths added, removed or changed, and leaves the rest out", () => {
    const square = (x: number) => [M(x, 0), L(x + 5, 0), L(x + 5, 5), L(x, 5)];
    const before = [...square(0), ...square(10), ...square(20)];
    const after = [...square(0), ...square(10), ...square(20), ...square(40)];
    expect(box(inkPathChange(before, after, true))).toEqual({ minX: 40, minY: 0, maxX: 45, maxY: 5 });
    const moved = [...square(0), ...square(12), ...square(20)];
    expect(box(inkPathChange(before, moved, true))).toEqual({ minX: 10, minY: 0, maxX: 17, maxY: 5 });
    const twoChanged = [...square(0), ...square(12), ...square(22)];
    expect(box(inkPathChange(before, twoChanged, true))).toEqual({ minX: 10, minY: 0, maxX: 27, maxY: 5 });
  });

  it("covers a whole subpath with a Z in its middle", () => {
    const before = [M(0, 0), L(10, 0), Z, L(0, 20), L(30, 30)];
    const after = [M(0, 0), L(10, 0), Z, L(0, 20), L(30, 35)];
    expect(box(inkPathChange(before, after, false))).toEqual({ minX: 0, minY: 0, maxX: 30, maxY: 35 });
  });

  /**
   * The property live ink relies on: every command that differs between the
   * two paths, and the point it starts from, lies inside the box.
   */
  function expectChangesInside(before: InkPathCommand[], after: InkPathCommand[], filled: boolean) {
    const change = inkPathChange(before, after, filled);
    if (change.kind === "none") {
      expect(sameInkPath(before, after)).toBe(true);
      return;
    }
    if (change.kind === "all") return;
    const points = (command: InkPathCommand): Array<[number, number]> =>
      command.op === "Z"
        ? []
        : command.op === "C"
          ? [[command.x1, command.y1], [command.x2, command.y2], [command.x, command.y]]
          : command.op === "Q"
            ? [[command.x1, command.y1], [command.x, command.y]]
            : [[command.x, command.y]];
    const sharedStart = (() => {
      let i = 0;
      while (i < Math.min(before.length, after.length) && sameInkPathCommand(before[i], after[i])) i += 1;
      return i;
    })();
    for (const path of [before, after]) {
      for (let i = sharedStart; i < path.length; i += 1) {
        // Commands also shared at the end were judged unchanged; only check up to them.
        const tail = path.length - i;
        const other = path === before ? after : before;
        if (tail <= other.length && sameInkPathCommand(path[i], other[other.length - tail]) && i > sharedStart + 1) {
          continue;
        }
        for (const [x, y] of points(path[i])) expect(contains(change.box, x, y)).toBe(true);
      }
    }
  }

  it("holds for a real pen stroke as it is written, with and without pressure", () => {
    for (const pressure of [false, true]) {
      const feel = getNotebookPenFeelFromSettings(NOTEBOOK_PEN_SETTINGS_DEFAULT);
      const sample = (i: number) => ({
        x: 100 + i * 2 + 6 * Math.sin(i / 3),
        y: 200 + 8 * Math.cos(i / 3),
        width: pressure ? 4 + 2 * Math.sin(i / 7) : 4,
        time: i * 4,
      });
      const pen = createInkPenBuilder(sample(0), { feel, pixelSize: 0.5 });
      let before = pen.geometry();
      for (let i = 1; i < 80; i += 1) {
        pen.addPoint(sample(i));
        const after = pen.geometry();
        if (before.paint.kind === after.paint.kind) expectChangesInside(before.path, after.path, after.paint.kind === "fill");
        before = after;
      }
    }
  });

  it("covers both versions when a highlighter's footprints give way to its traced outline", () => {
    // The last live packet draws build()'s union in place of preview()'s footprints.
    const sample = (i: number) => ({ x: 100 + i * 2, y: 200 + 3 * Math.sin(i / 5), width: 20 });
    const chisel = createInkChiselBuilder(sample(0), { pixelSize: 0.5, nibAngle: () => 1.1 });
    for (let i = 1; i < 80; i += 1) chisel.addPoint(sample(i));
    const footprints = chisel.preview().path;
    const union = chisel.build().path;
    const change = box(inkPathChange(footprints, union, true));
    for (const command of [...footprints, ...union]) {
      if (command.op === "M" || command.op === "L") expect(contains(change, command.x, command.y)).toBe(true);
    }
  });

  it("holds for a real highlighter as it is written", () => {
    const sample = (i: number) => ({ x: 100 + i * 2, y: 200 + 3 * Math.sin(i / 5), width: 20 });
    const chisel = createInkChiselBuilder(sample(0), { pixelSize: 0.5, nibAngle: () => 1.1 });
    let before = chisel.preview().path;
    for (let i = 1; i < 80; i += 1) {
      chisel.addPoint(sample(i));
      const after = chisel.preview().path;
      expectChangesInside(before, after, true);
      before = after;
    }
  });
});
