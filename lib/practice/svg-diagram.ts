/**
 * Model-written SVG, made safe enough to put on a page.
 *
 * Exam diagrams are the one kind of picture a raster generator should not be
 * asked for. A triangle whose labelled angles have to sum to 180, a scattergram
 * whose plotted points have to match the table beside it, a scale drawing whose
 * scale has to be true: these are stated, not imagined, and an image model
 * produces something that looks right and measures wrong. Nothing downstream
 * can catch that, and a student cannot either.
 *
 * SVG states them. The coordinates are written down, the labels are text, it
 * costs ordinary output tokens, and it can be checked.
 *
 * It is also markup from a language model going into a page, which is an
 * injection vector. So this is an allowlist and not a filter: anything not
 * named here is dropped, rather than anything dangerous being removed. The
 * difference matters, because the list of dangerous things is not knowable in
 * advance and the list of things a diagram needs is.
 */

/** Elements a diagram is allowed to be built from. */
const ELEMENTS = new Set([
  "svg", "g", "title", "desc", "defs", "marker",
  "path", "line", "polyline", "polygon", "rect", "circle", "ellipse",
  "text", "tspan",
]);

/**
 * Attributes those elements may carry.
 *
 * No `style`: it admits `url()` and behaves differently across renderers.
 * No `href`/`xlink:href`: nothing in a diagram should be fetched. No `id` or
 * `class`, so a diagram cannot reach into or be reached by the page's own CSS.
 */
const ATTRIBUTES = new Set([
  "viewbox", "width", "height", "xmlns", "preserveaspectratio",
  "d", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry",
  "points", "transform", "dx", "dy", "rotate",
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity",
  "stroke-linecap", "stroke-linejoin", "stroke-dasharray",
  "text-anchor", "dominant-baseline", "font-size", "font-family", "font-weight",
  "marker-end", "marker-start", "orient", "refx", "refy",
  "markerwidth", "markerheight", "markerunits",
  "opacity", "vector-effect",
]);

/**
 * SVG is case-sensitive, so an allowlist matched in lower case has to put the
 * capitals back. Writing viewbox instead of viewBox costs nothing at parse time
 * and silently stops the diagram scaling in a browser.
 */
const CANONICAL_CASE = new Map(
  ["viewBox", "preserveAspectRatio", "markerWidth", "markerHeight", "markerUnits", "refX", "refY"]
    .map((name) => [name.toLowerCase(), name])
);

/** Values that would reach outside the diagram, whatever attribute holds them. */
const ESCAPES = /(?:javascript:|data:|<|expression\s*\(|url\s*\(\s*['"]?\s*(?:https?:|\/\/))/i;

export type SvgDiagramResult =
  | { ok: true; svg: string }
  | { ok: false; reason: string };

const SELF_CLOSING = new Set(["path", "line", "polyline", "polygon", "rect", "circle", "ellipse"]);

/**
 * Rebuild the SVG from what is allowed, dropping the rest.
 *
 * Deliberately a re-serialisation rather than a scrub of the original: what
 * comes out is assembled from recognised tags and recognised attributes, so a
 * construction nobody anticipated cannot survive by not matching a pattern.
 */
export function sanitizeSvgDiagram(input: string, options: { maxLength?: number } = {}): SvgDiagramResult {
  const source = String(input ?? "").trim();
  const cap = options.maxLength ?? 20_000;
  if (!source) return { ok: false, reason: "empty" };
  if (source.length > cap) return { ok: false, reason: `longer than ${cap} characters` };
  if (!/^<svg[\s>]/i.test(source)) return { ok: false, reason: "does not start with an <svg> element" };
  if (/<\s*(script|foreignobject|iframe|image|use|style|animate|set)\b/i.test(source)) {
    return { ok: false, reason: "contains an element a diagram never needs" };
  }
  if (/\son[a-z]+\s*=/i.test(source)) return { ok: false, reason: "carries an event handler" };

  const out: string[] = [];
  const open: string[] = [];
  const tag = /<\/?\s*([a-zA-Z][a-zA-Z0-9-]*)((?:[^<>"']|"[^"]*"|'[^']*')*)\/?>|([^<]+)/g;
  let match: RegExpExecArray | null;
  let sawSvg = false;

  while ((match = tag.exec(source)) !== null) {
    const [whole, name, rawAttrs, textRun] = match;
    if (textRun !== undefined) {
      // Text content: escaped, so a label can never open an element.
      // Escape the ampersands that are not already an entity: a label reading
      // "a &lt; b" must stay "a < b" on the page, not become "a &lt; b".
      const text = textRun
        .replace(/&(?!#?\w+;)/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      if (text.trim()) out.push(text);
      continue;
    }
    const element = name.toLowerCase();
    if (!ELEMENTS.has(element)) continue;
    if (whole.startsWith("</")) {
      const index = open.lastIndexOf(element);
      if (index === -1) continue;
      open.splice(index, 1);
      out.push(`</${element}>`);
      continue;
    }
    if (element === "svg") sawSvg = true;

    const kept: string[] = [];
    const attribute = /([a-zA-Z][a-zA-Z0-9:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let found: RegExpExecArray | null;
    while ((found = attribute.exec(rawAttrs ?? "")) !== null) {
      const key = found[1].toLowerCase();
      const value = found[2] ?? found[3] ?? "";
      if (!ATTRIBUTES.has(key)) continue;
      if (ESCAPES.test(value)) continue;
      kept.push(`${CANONICAL_CASE.get(key) ?? key}="${value.replace(/"/g, "&quot;")}"`);
    }
    const selfClosed = whole.endsWith("/>") || SELF_CLOSING.has(element);
    out.push(`<${element}${kept.length ? " " + kept.join(" ") : ""}${selfClosed ? "/>" : ">"}`);
    if (!selfClosed) open.push(element);
  }

  if (!sawSvg) return { ok: false, reason: "no <svg> element survived" };
  for (const element of [...open].reverse()) out.push(`</${element}>`);

  const svg = out.join("");
  // A diagram with no shapes and no text is a frame around nothing, which is
  // worse than no diagram: it takes up space and says the picture is there.
  if (!/<(path|line|polyline|polygon|rect|circle|ellipse|text)\b/i.test(svg)) {
    return { ok: false, reason: "draws nothing" };
  }
  if (!/viewbox\s*=/i.test(svg)) return { ok: false, reason: "has no viewBox, so it cannot scale" };
  return { ok: true, svg };
}

/** Whether this asset's content is meant to be read as SVG at all. */
export const looksLikeSvg = (content: string) => /^\s*<svg[\s>]/i.test(String(content ?? ""));
