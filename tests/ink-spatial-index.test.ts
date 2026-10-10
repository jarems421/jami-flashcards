import { describe, expect, it } from "vitest";
import { inkBoxesIntersect, type InkBox } from "@/lib/ink/model";
import { InkSpatialIndex } from "@/lib/ink/spatial-index";
import { seededRandom } from "./support/ink-fixtures";

function randomBox(random: () => number): InkBox {
  const roll = random();
  // Mostly small boxes on the page; some off it; a few vast ones.
  const range = roll < 0.7 ? 1000 : roll < 0.95 ? 6000 : 100000;
  const size = roll < 0.95 ? random() * 150 : random() * 50000;
  const minX = (random() - 0.3) * range;
  const minY = (random() - 0.3) * range;
  return { minX, minY, maxX: minX + size, maxY: minY + random() * size };
}

describe("InkSpatialIndex", () => {
  it("matches a brute-force search on random boxes", () => {
    const random = seededRandom(42);
    const index = new InkSpatialIndex();
    const boxes = new Map<string, InkBox>();
    for (let i = 0; i < 600; i += 1) {
      const box = randomBox(random);
      boxes.set(`id${i}`, box);
      index.set(`id${i}`, box);
    }
    expect(index.size).toBe(600);
    for (let q = 0; q < 400; q += 1) {
      const query = randomBox(random);
      const expected = Array.from(boxes.entries())
        .filter(([, box]) => inkBoxesIntersect(box, query))
        .map(([id]) => id)
        .sort();
      const found = index.query(query);
      expect(new Set(found).size).toBe(found.length);
      expect(found.slice().sort()).toEqual(expected);
    }
  });

  it("finds boxes that touch at an edge or sit on a cell boundary", () => {
    const index = new InkSpatialIndex();
    index.set("a", { minX: 0, minY: 0, maxX: 64, maxY: 64 });
    expect(index.query({ minX: 64, minY: 64, maxX: 70, maxY: 70 })).toEqual(["a"]);
    expect(index.query({ minX: 64.5, minY: 0, maxX: 70, maxY: 10 })).toEqual([]);
  });

  it("works for boxes wholly outside the page and far beyond the grid", () => {
    const index = new InkSpatialIndex();
    index.set("left", { minX: -3000, minY: 100, maxX: -2500, maxY: 120 });
    index.set("far", { minX: 90000, minY: 90000, maxX: 91000, maxY: 91000 });
    index.set("huge", { minX: -1e9, minY: -1e9, maxX: 1e9, maxY: 1e9 });
    expect(index.query({ minX: -2800, minY: 100, maxX: -2700, maxY: 110 }).sort()).toEqual(["huge", "left"]);
    expect(index.query({ minX: 90500, minY: 90500, maxX: 90600, maxY: 90600 }).sort()).toEqual(["far", "huge"]);
    expect(index.query({ minX: 0, minY: 0, maxX: 10, maxY: 10 })).toEqual(["huge"]);
  });

  it("still finds a box with a non-finite edge", () => {
    const index = new InkSpatialIndex();
    index.set("nan", { minX: Number.NaN, minY: 0, maxX: Number.NaN, maxY: 10 });
    index.set("inf", { minX: 0, minY: 0, maxX: Number.POSITIVE_INFINITY, maxY: 10 });
    expect(index.query({ minX: 100, minY: 2, maxX: 110, maxY: 4 }).sort()).toEqual(["inf", "nan"]);
    expect(index.query({ minX: 5000, minY: 5, maxX: 5100, maxY: 6 }).sort()).toEqual(["inf", "nan"]);
    index.delete("nan");
    expect(index.query({ minX: 100, minY: 100, maxX: 110, maxY: 110 })).toEqual([]);
  });

  it("replaces, deletes and clears", () => {
    const index = new InkSpatialIndex();
    index.set("a", { minX: 0, minY: 0, maxX: 10, maxY: 10 });
    index.set("a", { minX: 500, minY: 500, maxX: 510, maxY: 510 });
    expect(index.size).toBe(1);
    expect(index.query({ minX: 0, minY: 0, maxX: 20, maxY: 20 })).toEqual([]);
    expect(index.query({ minX: 505, minY: 505, maxX: 506, maxY: 506 })).toEqual(["a"]);
    index.delete("a");
    index.delete("missing");
    expect(index.size).toBe(0);
    expect(index.query({ minX: 0, minY: 0, maxX: 1000, maxY: 1000 })).toEqual([]);
    index.set("b", { minX: 1, minY: 1, maxX: 2, maxY: 2 });
    index.clear();
    expect(index.size).toBe(0);
    expect(index.query({ minX: 0, minY: 0, maxX: 10, maxY: 10 })).toEqual([]);
  });
});
