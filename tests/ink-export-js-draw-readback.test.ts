// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { SVGLoader, Stroke } from "js-draw";
import { describe, expect, it } from "vitest";
import { inkToSvg } from "@/lib/ink/export-svg";
import { importJsDrawSvg } from "@/lib/ink/import-js-draw-svg";
import { inkItemBounds, type InkColor, type InkDocument, type InkOutlineItem } from "@/lib/ink/model";

/*
 * The SVG copy that Jami Ink writes must still open in a js-draw build (the
 * rollback path). This loads it with js-draw's own SVGLoader and compares what
 * it makes against what we exported: how many components, where they are, and
 * how they are painted, so a colour js-draw misreads fails here.
 *
 * jsdom cannot enforce the iframe sandbox js-draw loads SVG in, so js-draw's
 * own sandbox self-test prints "JavaScript should not be able to run here" for
 * every load. That is jsdom noise on stderr; the assertions below still hold.
 */

const FIXTURE_DIR = path.join(process.cwd(), "tests", "fixtures", "ink", "js-draw");
const manifest = JSON.parse(readFileSync(path.join(FIXTURE_DIR, "manifest.json"), "utf8")) as Record<
  string,
  { file: string; svgPathElements: number }
>;

type JsDrawColor = { r: number; g: number; b: number; a: number };
type LoadedStroke = {
  box: { x: number; y: number; maxX: number; maxY: number };
  parts: { fill: JsDrawColor; stroke?: { color: JsDrawColor; width: number } }[];
};

async function loadWithJsDraw(svg: string): Promise<LoadedStroke[]> {
  const loaded: LoadedStroke[] = [];
  const loader = SVGLoader.fromString(svg, { sanitize: true, disableUnknownObjectWarnings: true });
  await loader.start(
    async (component) => {
      if (!(component instanceof Stroke)) return;
      const box = component.getBBox();
      loaded.push({
        box: { x: box.x, y: box.y, maxX: box.x + box.w, maxY: box.y + box.h },
        parts: component.getParts().map((part) => ({ fill: part.style.fill, stroke: part.style.stroke })),
      });
    },
    () => {}
  );
  return loaded;
}

/** Highlighter first, then pen: the order the export writes. */
function exportOrder(doc: InkDocument): InkOutlineItem[] {
  const outlines = doc.items.filter((item): item is InkOutlineItem => item.kind === "outline");
  return [
    ...outlines.filter((item) => item.layer === "highlighter"),
    ...outlines.filter((item) => item.layer === "pen"),
  ];
}

function expectColor(actual: JsDrawColor, expected: InkColor | null): void {
  if (!expected) {
    expect(actual.a).toBe(0);
    return;
  }
  expect(Math.round(actual.r * 255)).toBe(expected.r);
  expect(Math.round(actual.g * 255)).toBe(expected.g);
  expect(Math.round(actual.b * 255)).toBe(expected.b);
  expect(Math.abs(actual.a - Math.round(expected.a * 255) / 255)).toBeLessThan(0.005);
}

function expectReadBack(doc: InkDocument, loaded: LoadedStroke[]): void {
  const items = exportOrder(doc);
  expect(loaded).toHaveLength(items.length);
  loaded.forEach((stroke, index) => {
    const item = items[index];
    const box = inkItemBounds(item);
    expect(Math.abs(stroke.box.x - box.minX)).toBeLessThan(0.5);
    expect(Math.abs(stroke.box.y - box.minY)).toBeLessThan(0.5);
    expect(Math.abs(stroke.box.maxX - box.maxX)).toBeLessThan(0.5);
    expect(Math.abs(stroke.box.maxY - box.maxY)).toBeLessThan(0.5);
    expect(stroke.parts.length).toBeGreaterThan(0);
    for (const part of stroke.parts) {
      expectColor(part.fill, item.paint.fill);
      if (item.paint.stroke) {
        expect(part.stroke).toBeDefined();
        expectColor(part.stroke?.color ?? { r: 0, g: 0, b: 0, a: 0 }, item.paint.stroke.color);
        expect(part.stroke?.width).toBeCloseTo(item.paint.stroke.width, 3);
      } else {
        expect(part.stroke).toBeUndefined();
      }
    }
  });
}

/** Jami writes 6 or 8 digit hex only: js-draw reads #abc as #a0b0c0, unlike CSS. */
function expectOnlyLongHex(svg: string): void {
  const colours = [...svg.matchAll(/ (?:fill|stroke)="([^"]*)"/g)].map((match) => match[1]);
  expect(colours.length).toBeGreaterThan(0);
  for (const colour of colours) expect(colour).toMatch(/^(none|#[0-9a-f]{6}|#[0-9a-f]{8})$/);
}

function outline(id: string, layer: "pen" | "highlighter", paint: InkOutlineItem["paint"]): InkOutlineItem {
  return {
    kind: "outline",
    id,
    layer,
    path: [
      { op: "M", x: 10 + id.length, y: 20 },
      { op: "L", x: 80, y: 40 },
      { op: "L", x: 60, y: 90 },
      { op: "Z" },
    ],
    paint,
  };
}

describe("inkToSvg read back by js-draw", () => {
  for (const [name, entry] of Object.entries(manifest)) {
    it(`${name} loads as the same number of strokes with the same bounds and paint`, async () => {
      const imported = importJsDrawSvg(readFileSync(path.join(FIXTURE_DIR, entry.file), "utf8"));
      if (!imported) throw new Error("fixture did not import");
      expect(imported.document.items).toHaveLength(entry.svgPathElements);
      const exported = inkToSvg(imported.document);
      if (entry.svgPathElements > 0) expectOnlyLongHex(exported);
      expectReadBack(imported.document, await loadWithJsDraw(exported));
    });
  }

  it("reads colours that need exact hex: odd channels, short-hex lookalikes and alpha", async () => {
    // #aabbcc and #112233 would be wrong if written as #abc and #123.
    const stroke = (r: number, g: number, b: number, a: number, width: number) => ({
      color: { r, g, b, a },
      width,
      cap: "round" as const,
      join: "round" as const,
    });
    const doc: InkDocument = {
      version: 3,
      items: [
        outline("a", "pen", { fill: { r: 0xaa, g: 0xbb, b: 0xcc, a: 1 }, stroke: null, opacity: 1 }),
        outline("b", "pen", { fill: null, stroke: stroke(0x11, 0x22, 0x33, 1, 3.25), opacity: 1 }),
        outline("c", "highlighter", { fill: { r: 0xfd, g: 0xe0, b: 0x47, a: 0x6b / 255 }, stroke: null, opacity: 1 }),
        outline("d", "pen", { fill: { r: 1, g: 2, b: 3, a: 1 }, stroke: stroke(250, 5, 17, 1, 0.5), opacity: 1 }),
        outline("e", "highlighter", { fill: null, stroke: stroke(0x0a, 0x1b, 0x2c, 0x80 / 255, 12), opacity: 1 }),
      ],
    };
    const svg = inkToSvg(doc);
    expectOnlyLongHex(svg);
    expectReadBack(doc, await loadWithJsDraw(svg));
  });
});
