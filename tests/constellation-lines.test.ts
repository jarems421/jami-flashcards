import { describe, expect, it } from "vitest";
import {
  getDrawableConstellationLines,
  MAX_LINES_PER_CONSTELLATION,
  normalizeConstellation,
  normalizeConstellationLines,
  toggleConstellationLine,
  type ConstellationLine,
} from "@/lib/constellation/constellations";

/**
 * A line has no direction, and that has to be true in the data as well as in
 * the drawing.
 *
 * Joining A to B and joining B to A are the same line. If both orderings can be
 * stored, "is this pair already joined?" becomes a two-way search, drawing the
 * same line twice adds a duplicate instead of removing it, and the sky ends up
 * with edges nothing can delete. Sorting the pair on the way in is what stops
 * all of that, so it is what these tests are mostly about.
 */
describe("constellation lines", () => {
  const lines = (...pairs: [string, string][]): ConstellationLine[] =>
    pairs.map(([a, b]) => ({ a, b }));

  describe("normalizing", () => {
    it("stores a pair in a fixed order however it arrives", () => {
      expect(normalizeConstellationLines([{ a: "z", b: "a" }])).toEqual([
        { a: "a", b: "z" },
      ]);
    });

    it("treats the two orderings as one line", () => {
      expect(
        normalizeConstellationLines([
          { a: "a", b: "b" },
          { a: "b", b: "a" },
        ])
      ).toEqual([{ a: "a", b: "b" }]);
    });

    it("drops a star joined to itself", () => {
      expect(normalizeConstellationLines([{ a: "a", b: "a" }])).toEqual([]);
    });

    it("survives anything that is not a line", () => {
      expect(
        normalizeConstellationLines([
          null,
          "a-b",
          { a: 1, b: 2 },
          { a: "a" },
          { a: "", b: "b" },
          { a: "a", b: "b" },
        ])
      ).toEqual([{ a: "a", b: "b" }]);
    });

    it("is empty for a document that has never had lines", () => {
      expect(normalizeConstellationLines(undefined)).toEqual([]);
      expect(
        normalizeConstellation("c1", { name: "Sky", starCount: 3 }).lines
      ).toEqual([]);
    });

    it("stops at the cap rather than growing without limit", () => {
      const tooMany = Array.from(
        { length: MAX_LINES_PER_CONSTELLATION + 25 },
        (_, index) => ({ a: "hub", b: `star-${index}` })
      );

      expect(normalizeConstellationLines(tooMany)).toHaveLength(
        MAX_LINES_PER_CONSTELLATION
      );
    });
  });

  describe("toggling", () => {
    it("joins two stars that are not joined", () => {
      expect(toggleConstellationLine([], "b", "a")).toEqual([{ a: "a", b: "b" }]);
    });

    it("unjoins them when the same line is drawn again, either way round", () => {
      const existing = lines(["a", "b"]);
      expect(toggleConstellationLine(existing, "a", "b")).toEqual([]);
      expect(toggleConstellationLine(existing, "b", "a")).toEqual([]);
    });

    it("leaves other lines alone", () => {
      const existing = lines(["a", "b"], ["c", "d"]);
      expect(toggleConstellationLine(existing, "a", "b")).toEqual(
        lines(["c", "d"])
      );
    });

    it("refuses to join a star to itself", () => {
      const existing = lines(["a", "b"]);
      expect(toggleConstellationLine(existing, "a", "a")).toBe(existing);
    });

    it("returns the same array when nothing changed, so callers can skip a write", () => {
      const existing = lines(["a", "b"]);
      expect(toggleConstellationLine(existing, "", "b")).toBe(existing);
    });

    it("will not add past the cap", () => {
      const full = Array.from(
        { length: MAX_LINES_PER_CONSTELLATION },
        (_, index) => ({ a: "hub", b: `star-${index}` })
      );

      expect(toggleConstellationLine(full, "new-a", "new-b")).toBe(full);
      // Removing still works when full, or a sky could never be untangled.
      expect(toggleConstellationLine(full, "hub", "star-0")).toHaveLength(
        MAX_LINES_PER_CONSTELLATION - 1
      );
    });
  });

  describe("drawing", () => {
    /*
     * A line outlives the star it points at. Deleting a star, or a backfill
     * moving one into another constellation, leaves an edge pointing at
     * nothing -- and an edge with one end missing would otherwise be drawn from
     * a star to the top-left corner.
     */
    it("skips a line whose star is not in this sky", () => {
      const drawn = getDrawableConstellationLines(
        lines(["a", "b"], ["a", "ghost"]),
        ["a", "b"]
      );

      expect(drawn).toEqual(lines(["a", "b"]));
    });

    it("draws nothing when the sky is empty", () => {
      expect(getDrawableConstellationLines(lines(["a", "b"]), [])).toEqual([]);
    });
  });
});
