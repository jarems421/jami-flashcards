import { describe, expect, it } from "vitest";
import type { InkDocument, InkItem, InkPathCommand } from "@/lib/ink/model";
import { planInkScribbleErase } from "@/lib/ink/tools/scribble-erase";
import { docOf, lineShape, outline } from "./support/ink-fixtures";

// A counter-clockwise rectangle over x 100-200, y 40-60.
const BAND = {
  hull: [
    { x: 100, y: 40 },
    { x: 200, y: 40 },
    { x: 200, y: 60 },
    { x: 100, y: 60 },
  ],
  bounds: { minX: 100, minY: 40, maxX: 200, maxY: 60 },
};

function polyline(id: string, points: Array<[number, number]>): InkItem {
  const path: InkPathCommand[] = points.map(([x, y], index) => ({ op: index === 0 ? "M" : "L", x, y }));
  return outline(id, path);
}

function plan(doc: InkDocument, majorExtent = 200, candidates?: string[]): string[] {
  return planInkScribbleErase({
    doc,
    candidates: candidates ?? doc.items.map((item) => item.id),
    band: BAND,
    majorExtent,
  });
}

describe("planInkScribbleErase", () => {
  it("takes a word the band fully covers", () => {
    const word = polyline("word", [
      [110, 50],
      [130, 45],
      [150, 55],
      [190, 50],
    ]);
    expect(plan(docOf(word))).toEqual(["word"]);
  });

  it("takes a curved word and a shape", () => {
    const curve = outline("curve", [
      { op: "M", x: 110, y: 50 },
      { op: "C", x1: 130, y1: 42, x2: 170, y2: 58, x: 190, y: 50 },
    ]);
    expect(plan(docOf(curve, lineShape("rule", 120, 50, 180, 50)))).toEqual(["curve", "rule"]);
  });

  it("leaves an underline that only crosses the band", () => {
    const underline = polyline("underline", [
      [0, 50],
      [900, 50],
    ]);
    const word = polyline("word", [
      [120, 50],
      [180, 50],
    ]);
    expect(plan(docOf(underline, word))).toEqual(["word"]);
  });

  it("takes an item covered by half or more of its length", () => {
    // 100 of 200 units are inside the band.
    const long = polyline("long", [
      [100, 50],
      [300, 50],
    ]);
    expect(plan(docOf(long))).toEqual(["long"]);
    const longer = polyline("longer", [
      [100, 50],
      [350, 50],
    ]);
    expect(plan(docOf(longer))).toEqual([]);
  });

  it("asks a letter-sized scribble for 0.8 coverage", () => {
    // 90 of 120 units (0.75) are inside the band.
    const mostly = polyline("mostly", [
      [110, 50],
      [230, 50],
    ]);
    expect(plan(docOf(mostly), 200)).toEqual(["mostly"]);
    expect(plan(docOf(mostly), 50)).toEqual([]);
    const whole = polyline("whole", [
      [110, 50],
      [190, 50],
    ]);
    expect(plan(docOf(whole), 50)).toEqual(["whole"]);
  });

  it("weighs a dot by the band alone", () => {
    // A zero-length stroke: drawn (it has a round cap) but with no length.
    const dot = polyline("dot", [
      [150, 50],
      [150, 50],
    ]);
    const outside = polyline("outside", [
      [150, 80],
      [150, 80],
    ]);
    expect(plan(docOf(dot, outside))).toEqual(["dot"]);
  });

  it("closes a filled outline before measuring it", () => {
    const box = outline("box", [
      { op: "M", x: 120, y: 45 },
      { op: "L", x: 180, y: 45 },
      { op: "L", x: 180, y: 55 },
      { op: "L", x: 120, y: 55 },
      { op: "Z" },
    ]);
    expect(plan(docOf(box), 50)).toEqual(["box"]);
  });

  it("ignores unknown items and items outside the band", () => {
    const unknown: InkItem = { kind: "unknown", id: "mystery", layerCode: 1, code: 9, payload: new Uint8Array([1, 2]) };
    const far = polyline("far", [
      [500, 500],
      [520, 500],
    ]);
    expect(plan(docOf(unknown, far))).toEqual([]);
  });

  it("only considers the candidates it is given", () => {
    const a = polyline("a", [
      [110, 50],
      [190, 50],
    ]);
    const b = polyline("b", [
      [120, 50],
      [180, 50],
    ]);
    expect(plan(docOf(a, b), 200, ["b", "missing"])).toEqual(["b"]);
    expect(plan(docOf(a, b), 200, [])).toEqual([]);
  });
});
