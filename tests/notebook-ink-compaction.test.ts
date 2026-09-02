import { describe, expect, it } from "vitest";
import {
  compactNotebookInkSvg,
  simplifyPoints,
  simplifyPolylinePath,
} from "@/lib/workspace/notebook-ink-compaction";

/**
 * Compaction rewrites somebody's handwriting, so the tests are mostly about
 * what it must refuse to touch.
 *
 * The risk is not that it drops too few points. It is that it drops a point
 * that was carrying shape, or reaches a path it does not understand -- a curve
 * from the smooth pen, whose control points do not sit on the outline and would
 * be pulled about by a polyline simplifier.
 */
describe("compacting notebook ink", () => {
  describe("simplifyPoints", () => {
    it("drops points that sit on the line between their neighbours", () => {
      const straight = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
      ];

      expect(simplifyPoints(straight, 0.25)).toEqual([
        { x: 0, y: 0 },
        { x: 3, y: 0 },
      ]);
    });

    it("keeps a point that carries a corner", () => {
      const corner = [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 5 },
      ];

      expect(simplifyPoints(corner, 0.25)).toEqual(corner);
    });

    it("keeps a bend just outside the tolerance and drops one just inside", () => {
      const bend = (height: number) => [
        { x: 0, y: 0 },
        { x: 5, y: height },
        { x: 10, y: 0 },
      ];

      expect(simplifyPoints(bend(0.3), 0.25)).toHaveLength(3);
      expect(simplifyPoints(bend(0.2), 0.25)).toHaveLength(2);
    });

    it("never drops the first or last point", () => {
      const wander = Array.from({ length: 50 }, (_, index) => ({
        x: index,
        y: 0,
      }));
      const simplified = simplifyPoints(wander, 1);

      expect(simplified[0]).toEqual({ x: 0, y: 0 });
      expect(simplified[simplified.length - 1]).toEqual({ x: 49, y: 0 });
    });

    it("survives a stroke that doubles back on itself", () => {
      // An outline goes out along one side of the nib and back along the other,
      // so the two halves lie on top of each other. Measuring to an unclamped
      // infinite line would call the return leg redundant and flatten it.
      const there = Array.from({ length: 20 }, (_, i) => ({ x: i, y: 0 }));
      const back = Array.from({ length: 20 }, (_, i) => ({ x: 19 - i, y: 2 }));
      const simplified = simplifyPoints([...there, ...back], 0.25);

      expect(simplified.some((p) => p.y === 2)).toBe(true);
      expect(simplified.length).toBeGreaterThanOrEqual(4);
    });

    it("leaves a short path alone", () => {
      const two = [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ];
      expect(simplifyPoints(two, 5)).toBe(two);
    });
  });

  describe("simplifyPolylinePath", () => {
    it("keeps a closed outline closed", () => {
      const result = simplifyPolylinePath(
        "M 0 0 L 1 0 L 2 0 L 2 2 L 0 2 Z",
        0.25,
        1
      );

      expect(result?.d.startsWith("M ")).toBe(true);
      expect(result?.d.endsWith(" Z")).toBe(true);
    });

    it("rounds coordinates to the requested precision", () => {
      const result = simplifyPolylinePath("M 1.23456 2.98765 L 9 9", 0.25, 1);
      expect(result?.d).toBe("M 1.2 3 L 9 9");
    });

    /*
     * The smooth pen emits curves. A cubic's control points are not on the
     * outline, so treating them as vertices and dropping "redundant" ones would
     * change the drawn shape rather than thin it.
     */
    it("refuses a path that curves", () => {
      expect(
        simplifyPolylinePath("M 0 0 C 1 1 2 2 3 3 Z", 0.25, 1)
      ).toBeNull();
      expect(simplifyPolylinePath("M 0 0 Q 1 1 2 2", 0.25, 1)).toBeNull();
    });

    it("refuses anything it cannot read as pairs of finite numbers", () => {
      expect(simplifyPolylinePath("", 0.25, 1)).toBeNull();
      expect(simplifyPolylinePath("M 0 0 L 1", 0.25, 1)).toBeNull();
      expect(simplifyPolylinePath("Z", 0.25, 1)).toBeNull();
    });

    it("will not thin a closed outline below a drawable triangle", () => {
      // Three points within tolerance of one line still enclose the only area
      // this shape has; flattening it to two would erase the mark entirely.
      const d = "M 0 0 L 5 0.1 L 10 0 Z";
      const result = simplifyPolylinePath(d, 5, 1);
      expect(result?.d).toBe(d);
    });
  });

  describe("compactNotebookInkSvg", () => {
    const svg = (paths: string) =>
      `<svg viewBox="0 0 900 1240"><style id="js-draw-style-sheet">path{fill:none}</style>${paths}</svg>`;

    it("thins polyline strokes and reports what it did", () => {
      // The shape of a real stroke outline: out along one side of the nib,
      // back along the other, densely sampled on both legs.
      const out = Array.from({ length: 40 }, (_, i) => `L ${i} 0`).join(" ");
      const back = Array.from({ length: 40 }, (_, i) => `L ${39 - i} 3`).join(" ");
      const result = compactNotebookInkSvg(
        svg(`<path d="M 0 0 ${out} ${back} Z" fill="#111827"/>`)
      );

      expect(result.simplifiedPaths).toBe(1);
      expect(result.pointsAfter).toBeLessThan(result.pointsBefore);
      expect(result.bytesAfter).toBeLessThan(result.bytesBefore);
      // Four corners are all this outline actually needs.
      expect(result.pointsAfter).toBeLessThanOrEqual(6);
    });

    it("leaves everything but the d attribute untouched", () => {
      const result = compactNotebookInkSvg(
        svg('<path d="M 0 0 L 1 0 L 2 0" fill="#f9a8d4" stroke-width="3"/>')
      );

      expect(result.svg).toContain('fill="#f9a8d4"');
      expect(result.svg).toContain('stroke-width="3"');
      expect(result.svg).toContain("js-draw-style-sheet");
      expect(result.svg.startsWith('<svg viewBox="0 0 900 1240">')).toBe(true);
    });

    it("passes curved paths through and counts them as skipped", () => {
      const result = compactNotebookInkSvg(
        svg('<path d="M 0 0 C 1 1 2 2 3 3"/><path d="M 0 0 L 1 0 L 2 0"/>')
      );

      expect(result.skippedPaths).toBe(1);
      expect(result.simplifiedPaths).toBe(1);
      expect(result.svg).toContain('d="M 0 0 C 1 1 2 2 3 3"');
    });

    it("changes nothing in a page that has no ink", () => {
      const empty = svg("");
      expect(compactNotebookInkSvg(empty).svg).toBe(empty);
    });
  });
});
