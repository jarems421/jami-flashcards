import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decodeInkDocument, encodeInkDocument } from "@/lib/ink/codec";
import { importJsDrawSvg } from "@/lib/ink/import-js-draw-svg";
import { inkItemBounds, inkItemLayer, type InkOutlineItem } from "@/lib/ink/model";

const FIXTURE_DIR = path.join(process.cwd(), "tests", "fixtures", "ink", "js-draw");

type Manifest = Record<string, { file: string; svgPathElements: number }>;

const manifest = JSON.parse(readFileSync(path.join(FIXTURE_DIR, "manifest.json"), "utf8")) as Manifest;
const fixtures = Object.entries(manifest).map(([name, entry]) => ({
  name,
  svg: readFileSync(path.join(FIXTURE_DIR, entry.file), "utf8"),
  pathCount: entry.svgPathElements,
}));

function svgOf(body: string, rootAttrs = 'viewBox="0 0 900 1240"'): string {
  return `<svg ${rootAttrs} xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

function outlines(svg: string, idPrefix?: string): InkOutlineItem[] {
  const result = importJsDrawSvg(svg, { idPrefix });
  expect(result).not.toBeNull();
  return (result?.document.items ?? []).map((item) => {
    if (item.kind !== "outline") throw new Error("expected outline items");
    return item;
  });
}

describe("importJsDrawSvg on captured js-draw pages", () => {
  it("has the fixtures it expects", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(8);
  });

  for (const fixture of fixtures) {
    describe(fixture.name, () => {
      const result = importJsDrawSvg(fixture.svg);

      it("imports every path with nothing unsupported", () => {
        expect(result).not.toBeNull();
        expect(result?.unsupported).toEqual([]);
        expect(result?.document.items).toHaveLength(fixture.pathCount);
      });

      it("keeps every item inside a generous page box", () => {
        for (const item of result?.document.items ?? []) {
          const box = inkItemBounds(item);
          expect(box.minX).toBeGreaterThan(-50);
          expect(box.minY).toBeGreaterThan(-50);
          expect(box.maxX).toBeLessThan(950);
          expect(box.maxY).toBeLessThan(1290);
        }
      });

      it("round-trips through the codec, smaller than the SVG", () => {
        const document = result?.document;
        if (!document) throw new Error("no document");
        const encoded = encodeInkDocument(document);
        expect(encoded.startsWith("j3:")).toBe(true);
        expect(encoded.length).toBeLessThan(fixture.svg.length);
        const decoded = decodeInkDocument(encoded);
        expect(decoded?.items.map(inkItemLayer)).toEqual(
          document.items.map(inkItemLayer)
        );
        expect(decoded?.items).toHaveLength(document.items.length);
      });
    });
  }

  it("reads the highlighter page as two highlighter items and one pen item", () => {
    const fixture = fixtures.find((f) => f.name === "highlighter");
    const items = importJsDrawSvg(fixture?.svg ?? "")?.document.items ?? [];
    expect(items.map(inkItemLayer)).toEqual(["pen", "highlighter", "highlighter"]);
    const highlighter = items[1];
    if (highlighter.kind !== "outline") throw new Error("expected an outline");
    expect(highlighter.paint.stroke).toBeNull();
    expect(highlighter.paint.fill?.a).toBeCloseTo(0.42, 2);
    expect(highlighter.paint.fill).toMatchObject({ r: 0xfd, g: 0xe0, b: 0x47 });
  });

  it("reads the cleared page as no ink", () => {
    const fixture = fixtures.find((f) => f.name === "cleared");
    expect(importJsDrawSvg(fixture?.svg ?? "")?.document.items).toEqual([]);
  });

  it("reads thin pen strokes as strokes, because js-draw writes fill none", () => {
    const fixture = fixtures.find((f) => f.name === "pen-thin");
    const svg = fixture?.svg ?? "";
    const widths = [...svg.matchAll(/stroke-width="([\d.]+)"/g)].map((match) => Number(match[1]));
    const all = outlines(svg);
    // The single dot is a filled circle, not a stroke.
    const dots = all.filter((item) => item.paint.fill !== null);
    expect(dots).toHaveLength(1);
    expect(dots[0].paint.stroke).toBeNull();
    const items = all.filter((item) => item.paint.fill === null);
    expect(items).toHaveLength(widths.length);
    items.forEach((item, index) => {
      expect(item.layer).toBe("pen");
      expect(item.paint.stroke?.width).toBeCloseTo(widths[index], 6);
      expect(item.paint.stroke?.cap).toBe("round");
      expect(item.paint.stroke?.join).toBe("round");
    });
  });

  it("reads pressure strokes as filled outlines", () => {
    const fixture = fixtures.find((f) => f.name === "pen-pressure");
    for (const item of outlines(fixture?.svg ?? "")) {
      expect(item.paint.fill).not.toBeNull();
    }
  });
});

/*
 * Everything below mirrors what js-draw's SVGLoader does (see the header of
 * lib/ink/import-js-draw-svg.ts), including where that differs from plain SVG.
 */
describe("importJsDrawSvg paint, as js-draw reads it", () => {
  it("lets a presentation attribute beat the style attribute", () => {
    const [item] = outlines(
      svgOf(
        `<path d="M0 0L10 10" fill="#ff0000" stroke="#111111" stroke-width="3" style="fill:#0000ff;stroke:#222222;stroke-width:9"/>`
      )
    );
    expect(item.paint.fill).toMatchObject({ r: 255, g: 0, b: 0 });
    expect(item.paint.stroke?.color).toMatchObject({ r: 0x11, g: 0x11, b: 0x11 });
    expect(item.paint.stroke?.width).toBe(3);
  });

  it("falls back to the style attribute when the attribute is absent", () => {
    const [item] = outlines(
      svgOf(`<path d="M0 0L10 10" style="fill:#0000ff;stroke:#222222;stroke-width:9"/>`)
    );
    expect(item.paint.fill).toMatchObject({ r: 0, g: 0, b: 255 });
    expect(item.paint.stroke).toMatchObject({ width: 9, color: { r: 0x22 } });
  });

  it("counts an empty attribute as set, so it does not fall through to style", () => {
    const [onlyStroke] = outlines(
      svgOf(`<path d="M0 0L10 10" fill="" stroke="#000" stroke-width="2" style="fill:#ff0000"/>`)
    );
    expect(onlyStroke.paint.fill).toBeNull();
    const result = importJsDrawSvg(
      svgOf(
        `<path d="M0 0L10 10" stroke="#000" stroke-width="" style="stroke-width:5"/>` +
          `<path d="M0 0L10 10" stroke="" stroke-width="5" style="stroke:#000"/>`
      )
    );
    expect(result?.document.items).toEqual([]);
  });

  it("ignores stylesheet rules for paint", () => {
    const body =
      `<path d="M0 0L10 10" fill="#aabbcc" stroke="#111111" stroke-width="3"/>` +
      `<path d="M0 0L10 10" stroke="#111111" stroke-width="3"/>`;
    for (const sheet of [
      `<style>path{fill:none}</style>`,
      `<style id="js-draw-style-sheet">path{fill:none}</style>`,
      `<style><![CDATA[ /* hi */ path { fill: red; stroke: blue; stroke-width: 9 } @media print { path { fill: red } } ]]></style>`,
    ]) {
      const [withFill, withoutFill] = outlines(svgOf(sheet + body));
      expect(withFill.paint.fill).toMatchObject({ r: 0xaa, g: 0xbb, b: 0xcc });
      expect(withFill.paint.stroke).toMatchObject({ width: 3, color: { r: 0x11 } });
      expect(withoutFill.paint.fill).toBeNull();
    }
  });

  it("fills nothing unless asked, unlike plain SVG, and strokes only with both a colour and a width", () => {
    const [noFill] = outlines(svgOf(`<path d="M0 0L10 10" stroke="#111111" stroke-width="3"/>`));
    expect(noFill.paint.fill).toBeNull();
    expect(importJsDrawSvg(svgOf(`<path d="M0 0L10 10" stroke="#111111"/>`))?.document.items).toEqual([]);
    const [filled] = outlines(svgOf(`<path d="M0 0L9 9L0 9Z" fill="#111111"/>`));
    expect(filled.paint.stroke).toBeNull();
  });

  it("reads the stroke width like parseFloat", () => {
    const widths = ["2pt", "3.5px", " 4 ", "1e1", ".5em"].map((width) => {
      const [item] = outlines(svgOf(`<path d="M0 0L9 9" stroke="#000" stroke-width="${width}"/>`));
      return item.paint.stroke?.width;
    });
    expect(widths).toEqual([2, 3.5, 4, 10, 0.5]);
    // Text that is not a number is a zero-width stroke, which draws nothing.
    expect(
      importJsDrawSvg(svgOf(`<path d="M0 0L9 9" stroke="#000" stroke-width="thick"/>`))?.document.items
    ).toEqual([]);
  });

  it("always strokes with round caps and joins, whatever the attributes say", () => {
    const [item, other] = outlines(
      svgOf(
        `<path d="M0 0L5 5" stroke="#000" stroke-width="2" stroke-linecap="butt" stroke-linejoin="miter"/>` +
          `<path d="M0 0L5 5" stroke="#000" stroke-width="2" style="stroke-linecap:square"/>`
      )
    );
    expect(item.paint.stroke).toMatchObject({ cap: "round", join: "round", width: 2 });
    expect(other.paint.stroke).toMatchObject({ cap: "round", join: "round" });
  });

  it("honours the opacity v1 conversions write for highlighters", () => {
    const [item] = outlines(
      svgOf(
        `<path d="M0 0L5 5" fill="none" stroke="#fde047" stroke-width="18" stroke-linecap="round" stroke-linejoin="round" opacity="0.42"/>`
      )
    );
    expect(item.paint.opacity).toBeCloseTo(0.42, 9);
    expect(item.paint.stroke?.color.a).toBe(1);
    expect(item.layer).toBe("highlighter");
  });

  it("multiplies fill-opacity into the colour alpha and calls translucent ink highlighter", () => {
    const [item] = outlines(svgOf(`<path d="M0 0L9 0L9 9Z" fill="#ffff00" fill-opacity="0.4"/>`));
    expect(item.paint.fill?.a).toBeCloseTo(0.4, 9);
    expect(item.paint.opacity).toBe(1);
    expect(item.layer).toBe("highlighter");
  });

  it("calls a translucent stroke highlighter only when there is no fill", () => {
    const [item] = outlines(
      svgOf(`<path d="M0 0L9 9" fill="none" stroke="#fde047" stroke-opacity="0.5" stroke-width="8"/>`)
    );
    expect(item.layer).toBe("highlighter");
    expect(item.paint.stroke?.color.a).toBeCloseTo(0.5, 9);
    const [pen] = outlines(
      svgOf(`<path d="M0 0L9 9" fill="#000" stroke="#fde047" stroke-opacity="0.5" stroke-width="8"/>`)
    );
    expect(pen.layer).toBe("pen");
  });

  it("treats none, transparent and unreadable fills as no fill", () => {
    for (const fill of ["none", "transparent", "url(#gradient)", "currentColor"]) {
      const [item] = outlines(
        svgOf(`<path d="M0 0L9 9" fill="${fill}" stroke="#000" stroke-width="1"/>`)
      );
      expect(item.paint.fill).toBeNull();
    }
  });

  it("skips paths that paint nothing or have nothing to draw", () => {
    const svg = svgOf(
      `<path d="M0 0L9 9" fill="none"/>` +
        `<path d="M5 5" stroke="#000" stroke-width="1"/>` +
        `<path d="" stroke="#000" stroke-width="1"/>` +
        `<path stroke="#000" stroke-width="1"/>` +
        `<path d="M0 0L9 9" stroke="#000" stroke-width="0" fill="none"/>` +
        `<path d="M0 0L9 9" stroke="#000" stroke-width="1" opacity="0"/>` +
        `<path d="M1 1L2 2" fill="none" stroke="#000" stroke-width="1"/>`
    );
    const result = importJsDrawSvg(svg);
    expect(result?.document.items).toHaveLength(1);
    expect(result?.unsupported).toEqual([]);
  });
});

describe("importJsDrawSvg structure, as js-draw reads it", () => {
  it("takes no paint from groups", () => {
    const [item] = outlines(
      svgOf(
        `<g fill="#ff0000" stroke="#00ff00" stroke-width="4" opacity="0.5">` +
          `<g stroke="#0000ff"><path d="M0 0L9 9" stroke="#000" stroke-width="2"/></g></g>`
      )
    );
    expect(item.paint.fill).toBeNull();
    expect(item.paint.stroke).toMatchObject({ width: 2, color: { r: 0, g: 0, b: 0 } });
    expect(item.paint.opacity).toBe(1);
    expect(importJsDrawSvg(svgOf(`<g stroke="#000" stroke-width="2"><path d="M0 0L9 9"/></g>`))?.document.items).toEqual(
      []
    );
  });

  it("does not apply transforms on paths or groups", () => {
    const [inGroup, onPath] = outlines(
      svgOf(
        `<g transform="translate(10 20) scale(3)"><path d="M1 1L2 2" stroke="#000" stroke-width="2"/></g>` +
          `<path d="M1 1L2 2" stroke="#000" stroke-width="2" transform="matrix(5 0 0 5 7 7)"/>`
      )
    );
    for (const item of [inGroup, onPath]) {
      expect(item.path).toEqual([
        { op: "M", x: 1, y: 1 },
        { op: "L", x: 2, y: 2 },
      ]);
      expect(item.paint.stroke?.width).toBe(2);
    }
  });

  it("uses coordinates raw, without scaling the viewBox", () => {
    for (const rootAttrs of ['viewBox="0 0 450 620"', 'viewBox="50 60 900 1240"', 'width="300" height="300"', ""]) {
      const [item] = outlines(
        svgOf(`<path d="M100 100L200 200" stroke="#000" stroke-width="2"/>`, rootAttrs)
      );
      expect(item.path[0]).toEqual({ op: "M", x: 100, y: 100 });
      expect(item.path[1]).toEqual({ op: "L", x: 200, y: 200 });
      expect(item.paint.stroke?.width).toBe(2);
    }
  });

  it("lists basic shapes, text, images and use as unsupported, once each, and imports nothing from them", () => {
    const svg = svgOf(
      `<line x1="0" y1="0" x2="9" y2="9" stroke="#000" stroke-width="1"/><line x1="1" y1="1" x2="9" y2="9"/>` +
        `<polyline points="0,0 10,0"/><polygon points="0 0 10 0 10 10"/>` +
        `<rect width="5" height="5" fill="#000"/><circle r="4" fill="#000"/><ellipse rx="4" ry="2"/>` +
        `<text x="5" y="5"><tspan><path d="M0 0L9 9" stroke="#000" stroke-width="1"/></tspan>hi</text>` +
        `<image href="a.png"/><use href="#a"/><foreignObject><div>z</div></foreignObject>` +
        `<path d="M0 0L9 9" stroke="#000" stroke-width="1"/>`
    );
    const result = importJsDrawSvg(svg);
    expect(result?.document.items).toHaveLength(1);
    expect(result?.unsupported).toEqual([
      "line",
      "polyline",
      "polygon",
      "rect",
      "circle",
      "ellipse",
      "text",
      "image",
      "use",
      "foreignObject",
    ]);
  });

  it("draws paths inside defs, symbol, marker and unknown elements, as js-draw does", () => {
    const path = (n: number) => `<path d="M${n} 0L9 9" stroke="#000" stroke-width="1"/>`;
    const result = importJsDrawSvg(
      svgOf(
        `<defs>${path(1)}</defs><symbol>${path(2)}</symbol><marker>${path(3)}</marker>` +
          `<switch><a>${path(4)}</a></switch>${path(5)}`
      )
    );
    expect(result?.document.items).toHaveLength(5);
    expect(result?.unsupported).toEqual([]);
  });

  it("does not look inside style, metadata, title, desc or script", () => {
    const path = `<path d="M0 0L9 9" stroke="#000" stroke-width="1"/>`;
    const result = importJsDrawSvg(
      svgOf(
        `<title>${path}</title><desc>${path}</desc><metadata>${path}</metadata>` +
          `<script>var a = "<path d='M0 0L9 9' stroke='#000' stroke-width='1'/>";</script>` +
          `<style>path{fill:red}</style>${path}`
      )
    );
    expect(result?.document.items).toHaveLength(1);
  });

  it("lists an unreadable path and keeps the rest", () => {
    const result = importJsDrawSvg(
      svgOf(
        `<path d="M0 0 Q" stroke="#000" stroke-width="1"/><path d="M0 0L9 9" stroke="#000" stroke-width="1"/>`
      )
    );
    expect(result?.unsupported).toEqual(["path: unreadable d"]);
    expect(result?.document.items).toHaveLength(1);
  });

  it("decodes entities in attributes and styles", () => {
    const [item] = outlines(
      svgOf(`<path d="M0 0L9 9" stroke="&#35;ff0000" style="fill:none&#59;stroke-width:&#x37;" stroke-width="&#55;"/>`)
    );
    expect(item.paint.stroke?.color).toMatchObject({ r: 255, g: 0, b: 0 });
    expect(item.paint.fill).toBeNull();
    expect(item.paint.stroke?.width).toBe(7);
  });

  it("reads single-quoted and unquoted attributes, namespaced tags and self-closing paths", () => {
    const svg =
      `<?xml version="1.0"?><!DOCTYPE svg><!-- a <path d="M9 9L8 8"/> comment -->` +
      `<svg:svg xmlns:svg="http://www.w3.org/2000/svg" viewBox='0 0 900 1240'>` +
      `<svg:path d='M0 0L9 9' stroke=red stroke-width=1 fill="none" /></svg:svg>`;
    const result = importJsDrawSvg(svg);
    expect(result?.document.items).toHaveLength(1);
    expect(result?.document.items[0]).toMatchObject({ paint: { stroke: { color: { r: 255, g: 0, b: 0 } } } });
  });

  it("numbers ids from the prefix and keeps document order", () => {
    const svg = svgOf(
      `<path d="M0 0L1 1" stroke="#000" stroke-width="1"/><path d="M2 2L3 3" stroke="#000" stroke-width="1"/>`
    );
    expect(outlines(svg).map((item) => item.id)).toEqual(["s0", "s1"]);
    expect(outlines(svg, "p").map((item) => item.id)).toEqual(["p0", "p1"]);
  });

  it("imports a compaction-damaged relative polyline exactly as written", () => {
    // Between 2 Sep and 9 Oct 2026 a bug saved relative polylines as absolute
    // commands: the deltas became coordinates near the origin. The importer
    // reads them faithfully; repairing them is a separate decision.
    const [item] = outlines(
      svgOf(`<path d="M 129 512.6 L 3.6 -1.7 L 37 3 L 38.2 -1.5" fill="#fde0476b"></path>`)
    );
    expect(item.path).toEqual([
      { op: "M", x: 129, y: 512.6 },
      { op: "L", x: 3.6, y: -1.7 },
      { op: "L", x: 37, y: 3 },
      { op: "L", x: 38.2, y: -1.5 },
    ]);
    const box = inkItemBounds(item);
    expect(box.minX).toBeCloseTo(3.6, 6);
    expect(box.maxY).toBeCloseTo(512.6, 6);
  });
});

describe("importJsDrawSvg on malformed input", () => {
  it("returns null only when there is no root svg", () => {
    expect(importJsDrawSvg("")).toBeNull();
    expect(importJsDrawSvg("hello")).toBeNull();
    expect(importJsDrawSvg("<html><body>no svg</body></html>")).toBeNull();
    expect(importJsDrawSvg("<svg")).toBeNull();
  });

  it("never throws, whatever it is given", () => {
    const inputs = [
      "<svg>",
      "<svg><path d='M0 0L1 1' stroke='#000' stroke-width='1'",
      '<svg><path d="M0 0L1 1" stroke="#000></svg>',
      "<svg></g></path></svg>",
      "<svg><g><g><path d='M0 0L1 1' stroke='#000' stroke-width='1'></svg>",
      "<svg><style>path{</style><path d='M0 0L1 1' stroke='#000' stroke-width='1'/></svg>",
      "<svg><style>@media{{{</style></svg>",
      "<svg><path d='M0 0L1 1' stroke='#000' stroke-width='NaN' opacity='x'/></svg>",
      "<svg><rect width='-5' height='abc'/><circle r='Infinity'/></svg>",
      "<svg><<<<>>>></svg>",
      "<svg>&#99999999999;&bogus;</svg>",
      `<svg>${"<g>".repeat(5000)}<path d='M0 0L1 1' stroke='#000' stroke-width='1'/></svg>`,
      `<svg>${"<g>".repeat(5000)}</svg>`,
    ];
    for (const input of inputs) {
      expect(() => importJsDrawSvg(input)).not.toThrow();
    }
  });

  it("keeps the paths before a tag that never closes", () => {
    const result = importJsDrawSvg(
      `<svg viewBox="0 0 900 1240"><path d="M0 0L9 9" stroke="#000" stroke-width="1"/><path d="M1 1L2 2" stroke="#000"`
    );
    expect(result?.document.items).toHaveLength(1);
  });

  it("reports content nested past the depth limit and still reads what is above it", () => {
    const result = importJsDrawSvg(
      `<svg><path d="M0 0L9 9" stroke="#000" stroke-width="1"/>${"<g>".repeat(300)}` +
        `<path d="M1 1L2 2" stroke="#000" stroke-width="1"/>${"</g>".repeat(300)}</svg>`
    );
    expect(result?.document.items).toHaveLength(1);
    expect(result?.unsupported).toEqual(["svg: nested too deep"]);
  });

  it("is fast on a large page", () => {
    const body = Array.from(
      { length: 2000 },
      (_, i) =>
        `<path d="M${i} 0${"l1 1".repeat(60)}" fill="none" stroke="#111827" stroke-width="4.75"></path>`
    ).join("");
    const started = performance.now();
    const result = importJsDrawSvg(svgOf(body));
    expect(result?.document.items).toHaveLength(2000);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  // Student-controlled text is read on the server, so hostile shapes must stay
  // linear. The bounds are generous: these took seconds when quadratic.
  it("stays fast when start tags never close", () => {
    const input = "<svg>" + '<a "'.repeat(40000);
    expect(input.length).toBeGreaterThan(150_000);
    const started = performance.now();
    expect(importJsDrawSvg(input)).not.toBeNull();
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("stays fast with a deep open stack and many stray end tags", () => {
    const input = "<svg>" + "<g>".repeat(40000) + "</x>".repeat(40000);
    expect(input.length).toBeGreaterThan(250_000);
    const started = performance.now();
    expect(importJsDrawSvg(input)?.unsupported).toEqual(["svg: nested too deep"]);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("stays fast on a flood of unclosed comments, styles and attributes", () => {
    const inputs = [
      "<svg>" + "<!--".repeat(50000),
      "<svg>" + "<style>".repeat(50000),
      "<svg>" + "</".repeat(100000),
      "<svg>" + '<path d="M0 0" '.repeat(30000),
      "<svg>" + "<path fill=1 ".repeat(30000) + ">",
    ];
    for (const input of inputs) {
      const started = performance.now();
      importJsDrawSvg(input);
      expect(performance.now() - started).toBeLessThan(1000);
    }
  });
});
