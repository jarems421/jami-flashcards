import type { InkDocument } from "@/lib/ink/model";

/**
 * A fixed document with one of every item kind, on the 1/16 grid so it needs
 * no rounding. `ink-codec-golden.test.ts` pins its stored text.
 */
export function goldenInkDocument(): InkDocument {
  const black = { r: 0, g: 0, b: 0, a: 1 };
  return {
    version: 3,
    items: [
      {
        kind: "outline",
        id: "fill-only",
        layer: "pen",
        path: [
          { op: "M", x: 10, y: 20 },
          { op: "L", x: 30, y: 20 },
          { op: "L", x: 30, y: 40.5 },
          { op: "Z" },
        ],
        paint: { fill: { r: 255, g: 0, b: 0, a: 1 }, stroke: null, opacity: 1 },
      },
      {
        kind: "outline",
        id: "stroke-only",
        layer: "highlighter",
        path: [
          { op: "M", x: 0, y: 0 },
          { op: "C", x1: 5, y1: 5, x2: 10, y2: 5, x: 15, y: 0 },
          { op: "Q", x1: 20, y1: -5, x: 25, y: 0 },
        ],
        paint: {
          fill: null,
          stroke: { color: { r: 0, g: 0, b: 255, a: 128 / 255 }, width: 4.5, cap: "square", join: "bevel" },
          opacity: 128 / 255,
        },
      },
      {
        kind: "outline",
        id: "both",
        layer: "pen",
        path: [
          { op: "M", x: 100, y: 100 },
          { op: "L", x: 200, y: 100 },
          { op: "L", x: 200, y: 200 },
          { op: "Z" },
          { op: "M", x: 300, y: 300 },
          { op: "L", x: 310, y: 310 },
        ],
        paint: {
          fill: { r: 0, g: 128, b: 0, a: 1 },
          stroke: { color: black, width: 2, cap: "round", join: "miter" },
          opacity: 1,
        },
      },
      {
        kind: "shape",
        id: "line",
        layer: "pen",
        color: black,
        width: 4,
        shape: { type: "line", from: { x: 1, y: 2 }, to: { x: 300, y: 400.25 } },
      },
      {
        kind: "shape",
        id: "arrow",
        layer: "pen",
        color: { r: 200, g: 10, b: 30, a: 1 },
        width: 6,
        shape: { type: "arrow", from: { x: 450, y: 600 }, to: { x: 500, y: 650 } },
      },
      {
        kind: "shape",
        id: "polygon",
        layer: "pen",
        color: black,
        width: 3,
        shape: {
          type: "polygon",
          corners: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 50, y: 80 },
          ],
        },
      },
      {
        kind: "shape",
        id: "ellipse",
        layer: "pen",
        color: black,
        width: 2,
        shape: { type: "ellipse", cx: 450, cy: 600, rx: 120.5, ry: 60, rotation: 0.5 },
      },
      { kind: "unknown", id: "future", layerCode: 1, code: 9, payload: Uint8Array.from([1, 2, 3, 250]) },
    ],
  };
}
