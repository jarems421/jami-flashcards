// @vitest-environment jsdom
import { SVGLoader, Stroke } from "js-draw";
import { describe, expect, it } from "vitest";
import { importJsDrawSvg, jsDrawPathData } from "@/lib/ink/import-js-draw-svg";
import { inkItemBounds, inkBoxUnion, type InkBox } from "@/lib/ink/model";

/*
 * js-draw's loader cuts a path's data at each capital M and drops a piece made
 * only of digits, dots, commas and blanks as a lone move, so implicit
 * line-tos after M with no minus sign draw nothing (SVGLoader
 * strokeDataFromElem). The importer must agree: each case is loaded by
 * js-draw itself and by the importer, and they must find the same ink.
 * (js-draw prints sandbox noise under jsdom; see the readback test.)
 */

function page(d: string): string {
  return `<svg viewBox="0 0 900 1240" xmlns="http://www.w3.org/2000/svg"><path d="${d}" fill="none" stroke="#111111" stroke-width="2"/></svg>`;
}

/** The box around every part js-draw draws for the page, or null for none. */
async function jsDrawInk(svg: string): Promise<InkBox | null> {
  let box: InkBox | null = null;
  const loader = SVGLoader.fromString(svg, { sanitize: true, disableUnknownObjectWarnings: true });
  await loader.start(
    async (component) => {
      if (!(component instanceof Stroke)) return;
      for (const part of component.getParts()) {
        const b = part.path.bbox;
        const partBox = { minX: b.x, minY: b.y, maxX: b.x + b.w, maxY: b.y + b.h };
        box = box ? inkBoxUnion(box, partBox) : partBox;
      }
    },
    () => {}
  );
  return box;
}

/** The box around the importer's paths (stroke reach taken off again), or null for none. */
function importedInk(svg: string): InkBox | null {
  const items = importJsDrawSvg(svg)?.document.items ?? [];
  let box: InkBox | null = null;
  for (const item of items) {
    const b = inkItemBounds(item);
    const reach = item.kind === "outline" ? (item.paint.stroke?.width ?? 0) / 2 : 0;
    const path = { minX: b.minX + reach, minY: b.minY + reach, maxX: b.maxX - reach, maxY: b.maxY - reach };
    box = box ? inkBoxUnion(box, path) : path;
  }
  return box;
}

const CASES: Array<{ name: string; d: string; ink: boolean }> = [
  { name: "implicit line-tos after M, no minus", d: "M60,40 75.5,41 91,44", ink: false },
  { name: "a minus sign keeps them", d: "M60,40 75.5,-41 91,44", ink: true },
  { name: "an exponent keeps them", d: "M1e1,10 20,20", ink: true },
  { name: "a lowercase m is not cut", d: "m10 10 20 20", ink: true },
  { name: "blanks before the first M", d: " M10,10 20,20", ink: false },
  { name: "only the bare subpath goes", d: "M0 0 L10 10 M50,50 60,60 M20 20 L30 30", ink: true },
  { name: "explicit line-tos", d: "M60,40 L75.5,41 91,44", ink: true },
];

describe("importJsDrawSvg agrees with js-draw on implicit line-tos", () => {
  for (const testCase of CASES) {
    it(testCase.name, async () => {
      const svg = page(testCase.d);
      const theirs = await jsDrawInk(svg);
      const ours = importedInk(svg);
      expect(theirs !== null).toBe(testCase.ink);
      expect(ours !== null).toBe(testCase.ink);
      if (theirs && ours) {
        for (const edge of ["minX", "minY", "maxX", "maxY"] as const) expect(ours[edge]).toBeCloseTo(theirs[edge], 6);
      }
      // Dropped pieces are no ink, not an unreadable path.
      expect(importJsDrawSvg(svg)?.unsupported).toEqual([]);
    });
  }
});

describe("jsDrawPathData", () => {
  it("keeps what js-draw's loader keeps, cut and rejoined at each capital M", () => {
    expect(jsDrawPathData("M60,40 75.5,41 91,44")).toBe("");
    expect(jsDrawPathData("M0 0 L10 10 M50,50 60,60 M20 20 L30 30")).toBe("M0 0 L10 10 M20 20 L30 30");
    expect(jsDrawPathData("M0 0\r\n10 10")).toBe("M0 0\r\n10 10");
    expect(jsDrawPathData("m1 1 2 2")).toBe("m1 1 2 2");
    expect(jsDrawPathData("")).toBe("");
  });
});
