/**
 * Paint for imported ink. It reproduces what js-draw drew, because js-draw is
 * what students saw and edited. This mirrors `SVGLoader.getStyle` in
 * `node_modules/js-draw/dist/mjs/SVGLoader/SVGLoader.mjs` (lines 47-90), called
 * for a path as `getStyle(node)` with no computed styles (line 94):
 *
 * - Nothing is inherited. Paint comes from the path's own attributes, so a
 *   `<g fill=...>` around it changes nothing.
 * - The attribute is read first and the inline `style` declaration only when
 *   the attribute is absent (`??`, lines 53, 62-63). An attribute that is
 *   present but empty (`fill=""`) counts as set, so it does not fall through
 *   to `style`, and it paints nothing.
 * - `<style>` rules are never consulted.
 * - Fill is transparent unless set (line 48), not SVG's black.
 * - A stroke exists only when the stroke colour and the stroke width are both
 *   non-empty text (line 67). The width is read with `parseFloat` (line 69),
 *   so `2pt` is 2 and text that is not a number is 0. A colour that does not
 *   read, or a fully clear one (line 74), gives no stroke.
 * - Strokes are always drawn with round caps and joins by js-draw's canvas
 *   renderer, so the cap and join attributes are not read at all.
 *
 * One deliberate difference: `opacity`, `fill-opacity` and `stroke-opacity`
 * are honoured, because v1 pages converted by `legacyStrokesToJsDrawSvg` carry
 * a highlighter's translucency in `opacity="0.42"` and it was meant to show.
 * js-draw-written pages keep alpha in the colour and never use these.
 */

import type { InkColor } from "@/lib/ink/model";
import { parseInkColor } from "@/lib/ink/color";

type SvgProperty = "fill" | "fill-opacity" | "stroke" | "stroke-opacity" | "stroke-width" | "opacity";

const SVG_PROPERTIES: readonly SvgProperty[] = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-opacity",
  "stroke-width",
  "opacity",
];

type Declarations = Partial<Record<SvgProperty, string>>;

function isSvgProperty(name: string): name is SvgProperty {
  return (SVG_PROPERTIES as readonly string[]).includes(name);
}

/** Reads `name: value; name: value` (a `style` attribute). Later declarations win. */
function parseDeclarations(text: string): Declarations {
  const declarations: Declarations = {};
  for (const part of text.split(";")) {
    const colon = part.indexOf(":");
    if (colon === -1) continue;
    const name = part.slice(0, colon).trim().toLowerCase();
    const value = part
      .slice(colon + 1)
      .replace(/!important\s*$/i, "")
      .trim();
    if (isSvgProperty(name) && value !== "") declarations[name] = value;
  }
  return declarations;
}

function parseOpacity(text: string): number {
  const percent = text.endsWith("%");
  const value = Number(percent ? text.slice(0, -1) : text);
  if (text === "" || !Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, percent ? value / 100 : value));
}

/** JavaScript's `parseFloat`: the leading number, ignoring what follows; NaN if none. */
function parseFloatPrefix(text: string): number {
  const match = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/.exec(text);
  return match ? Number(match[1]) : NaN;
}

/**
 * Reads a paint colour with its separate opacity folded into the alpha. `none`,
 * `transparent`, anything unreadable and anything fully clear give null.
 */
function resolveColor(text: string, opacity: number): InkColor | null {
  const color = parseInkColor(text);
  if (!color) return null;
  const a = color.a * opacity;
  return a > 0 ? { r: color.r, g: color.g, b: color.b, a } : null;
}

export type SvgPathPaint = {
  fill: InkColor | null;
  stroke: { color: InkColor; width: number } | null;
  /** `opacity` of the path itself (not inherited). */
  opacity: number;
};

/** The paint js-draw would give a `<path>` with these attributes. */
export function resolvePathPaint(attrs: ReadonlyMap<string, string>): SvgPathPaint {
  const inline = parseDeclarations(attrs.get("style") ?? "");
  const read = (name: SvgProperty) => attrs.get(name) ?? inline[name] ?? "";

  const fillText = read("fill");
  const fill = fillText === "" ? null : resolveColor(fillText, parseOpacity(read("fill-opacity")));

  let stroke: SvgPathPaint["stroke"] = null;
  const strokeText = read("stroke");
  const widthText = read("stroke-width");
  if (strokeText !== "" && widthText !== "") {
    const parsed = parseFloatPrefix(widthText);
    const width = Number.isFinite(parsed) ? parsed : 0;
    const color = resolveColor(strokeText, parseOpacity(read("stroke-opacity")));
    // A zero or negative width draws nothing, so it is not kept.
    if (color && width > 0) stroke = { color, width };
  }
  return { fill, stroke, opacity: parseOpacity(read("opacity")) };
}
