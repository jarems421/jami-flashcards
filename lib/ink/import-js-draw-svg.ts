/**
 * Reads the SVG that js-draw saved for a notebook page into an
 * {@link InkDocument} of `outline` items, so every page saved before Jami Ink
 * opens and renders as it did.
 *
 * The aim is to reproduce what js-draw drew, because that is what students saw
 * and edited, so this follows `SVGLoader` in
 * `node_modules/js-draw/dist/mjs/SVGLoader/SVGLoader.mjs`, quirks included:
 *
 * - Only `<path>` elements become ink (`visit`, line 464). Basic shapes
 *   (`line`, `rect`, `circle`, `ellipse`, `polyline`, `polygon`) are not drawn
 *   by js-draw's canvas, and `text`, `image` and `use` need their own
 *   renderers, so they are listed in `unsupported` and skipped.
 * - Paint is the path's own (see `svg-style.ts`): nothing is inherited from
 *   `<g>`, and stylesheets are not read.
 * - `transform` attributes are not applied, on paths or groups (`getTransform`
 *   is only used for text and images), and `viewBox` is not scaled: js-draw
 *   uses coordinates raw and sets its own import rectangle (line 413 onward).
 *   Every page Jami saved is already 900 x 1240.
 * - Unknown elements, `<defs>`, `<symbol>` and `<marker>` included, still have
 *   their children visited (the default case at line 494 returns without
 *   clearing `visitChildren`), so a path inside them is drawn.
 *   `text` and `image` are the only elements js-draw does not descend into.
 *
 * Paths are read as written, never repaired, even one a past bug damaged.
 * Nothing here touches the DOM, so it also runs on the server.
 */

import {
  emptyInkDocument,
  type InkDocument,
  type InkItem,
  type InkLayer,
  type InkPaint,
} from "@/lib/ink/model";
import { inkPathBounds, parseSvgPathData } from "@/lib/ink/path";
import { resolvePathPaint } from "@/lib/ink/svg-style";
import { parseSvgXml, type XmlElement } from "@/lib/ink/svg-xml";

export type ImportedInk = {
  document: InkDocument;
  /** Tag names (and short reasons) of anything that drew but could not be imported. */
  unsupported: string[];
};

export type ImportJsDrawSvgOptions = { idPrefix?: string };

/** Elements whose content is not ink and is not looked into at all. */
const IGNORED_TAGS: ReadonlySet<string> = new Set(["style", "metadata", "title", "desc", "script"]);
/** Elements that draw something Jami Ink cannot import, so they are reported. */
const UNSUPPORTED_DRAWING_TAGS: ReadonlySet<string> = new Set([
  "text",
  "image",
  "use",
  "foreignobject",
  "line",
  "polyline",
  "polygon",
  "rect",
  "circle",
  "ellipse",
]);
/** js-draw does not descend into these, so neither do we. */
const LEAF_TAGS: ReadonlySet<string> = new Set(["text", "image"]);
/** A path this translucent or more reads as highlighter ink. */
const HIGHLIGHTER_ALPHA_BELOW = 0.95;

function layerFor(paint: InkPaint): InkLayer {
  const visible = paint.fill ?? paint.stroke?.color ?? null;
  if (!visible) return "pen";
  return visible.a * paint.opacity < HIGHLIGHTER_ALPHA_BELOW ? "highlighter" : "pen";
}

export function importJsDrawSvg(
  svg: string,
  options: ImportJsDrawSvgOptions = {}
): ImportedInk | null {
  let parsed: ReturnType<typeof parseSvgXml>;
  try {
    parsed = parseSvgXml(svg);
  } catch {
    return null;
  }
  if (!parsed) return null;

  const idPrefix = options.idPrefix ?? "s";
  const items: InkItem[] = [];
  const unsupported = new Set<string>();
  if (parsed.tooDeep) unsupported.add("svg: nested too deep");

  function addPath(element: XmlElement): void {
    const d = element.attrs.get("d") ?? "";
    if (d.trim() === "") return;
    const path = parseSvgPathData(d);
    if (!path) {
      unsupported.add("path: unreadable d");
      return;
    }
    // A lone moveto draws nothing.
    if (inkPathBounds(path) === null) return;
    const { fill, stroke, opacity } = resolvePathPaint(element.attrs);
    if ((!fill && !stroke) || opacity <= 0) return;
    // js-draw strokes with round caps and joins whatever the attributes say.
    const inkPaint: InkPaint = {
      fill,
      stroke: stroke ? { ...stroke, cap: "round", join: "round" } : null,
      opacity,
    };
    items.push({
      kind: "outline",
      id: `${idPrefix}${items.length}`,
      layer: layerFor(inkPaint),
      path,
      paint: inkPaint,
    });
  }

  function visit(element: XmlElement): void {
    const tag = element.tag.toLowerCase();
    if (IGNORED_TAGS.has(tag)) return;
    if (tag === "path") addPath(element);
    else if (UNSUPPORTED_DRAWING_TAGS.has(tag)) unsupported.add(element.tag);
    if (LEAF_TAGS.has(tag)) return;
    for (const child of element.children) visit(child);
  }

  try {
    // Nesting is capped by the parser, so this recursion is shallow.
    for (const child of parsed.root.children) visit(child);
  } catch {
    // Keep what was read before the failure: losing one page's tail beats
    // losing the page.
    unsupported.add("svg: unreadable");
  }

  const document: InkDocument = { ...emptyInkDocument(), items };
  return { document, unsupported: [...unsupported] };
}
