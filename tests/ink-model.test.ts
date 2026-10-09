import { describe, expect, it } from "vitest";
import {
  createInkItemId,
  emptyInkDocument,
  inkBoxesIntersect,
  inkBoxGrow,
  inkBoxUnion,
  inkItemBounds,
  type InkOutlineItem,
} from "@/lib/ink/model";
import { BLACK, lineShape, outline } from "./support/ink-fixtures";

function stroked(join: "round" | "miter" | "bevel", width: number): InkOutlineItem {
  return {
    ...outline("s", [
      { op: "M", x: 10, y: 10 },
      { op: "L", x: 50, y: 30 },
    ]),
    paint: { fill: null, stroke: { color: BLACK, width, cap: "round", join }, opacity: 1 },
  };
}

describe("ink model", () => {
  it("starts empty at version 3", () => {
    expect(emptyInkDocument()).toEqual({ version: 3, items: [] });
  });

  it("unions, grows and intersects boxes", () => {
    const a = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    const b = { minX: 5, minY: -5, maxX: 20, maxY: 4 };
    expect(inkBoxUnion(a, b)).toEqual({ minX: 0, minY: -5, maxX: 20, maxY: 10 });
    expect(inkBoxGrow(a, 2)).toEqual({ minX: -2, minY: -2, maxX: 12, maxY: 12 });
    expect(inkBoxesIntersect(a, b)).toBe(true);
    expect(inkBoxesIntersect(a, { minX: 10, minY: 10, maxX: 12, maxY: 12 })).toBe(true);
    expect(inkBoxesIntersect(a, { minX: 10.1, minY: 0, maxX: 12, maxY: 12 })).toBe(false);
  });

  it("bounds a filled outline by its path", () => {
    expect(inkItemBounds(outline("f", [
      { op: "M", x: 10, y: 20 },
      { op: "L", x: 30, y: 25 },
      { op: "L", x: 15, y: 60 },
      { op: "Z" },
    ]))).toEqual({ minX: 10, minY: 20, maxX: 30, maxY: 60 });
  });

  it("adds half the stroke width, and more for miter joins", () => {
    expect(inkItemBounds(stroked("round", 10))).toEqual({ minX: 5, minY: 5, maxX: 55, maxY: 35 });
    expect(inkItemBounds(stroked("bevel", 10))).toEqual({ minX: 5, minY: 5, maxX: 55, maxY: 35 });
    expect(inkItemBounds(stroked("miter", 10))).toEqual({ minX: -10, minY: -10, maxX: 70, maxY: 50 });
  });

  it("bounds shapes with half their width", () => {
    expect(inkItemBounds(lineShape("l", 0, 0, 100, 50))).toEqual({
      minX: -2,
      minY: -2,
      maxX: 102,
      maxY: 52,
    });
  });

  it("caches per item object", () => {
    const item = lineShape("l", 0, 0, 10, 10);
    expect(inkItemBounds(item)).toBe(inkItemBounds(item));
  });

  it("gives an empty box to an item with no drawn path", () => {
    expect(inkItemBounds(outline("e", []))).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });

  it("makes short unique base36 ids", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 2000; i += 1) {
      const id = createInkItemId();
      expect(id).toMatch(/^[0-9a-z]{10}$/);
      ids.add(id);
    }
    expect(ids.size).toBe(2000);
  });
});
