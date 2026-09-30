import { sanitizeSvgDiagram } from "@/lib/practice/svg-diagram";

/**
 * A diagram the Tutor described, drawn by code.
 *
 * The same idea as `assistant-graph.ts`, for everything that is not a graph.
 * Asked to draw SVG freehand, models got the facts right and the layout wrong,
 * and for most diagrams the layout is the fact: a water cycle with the land
 * labelled "Sea" and no arrows, a "parallel" circuit whose lamps sat outside
 * the loop, a heart whose labels overlapped its title and ran off the edge.
 * Image models were worse, inventing labels outright.
 *
 * So the model says what is in the diagram and this decides where it goes:
 *
 * - `labelled`: the model draws the shapes only, and names the point each
 *   label belongs to. Labels are set in columns beside the drawing with leader
 *   lines to those points, so they cannot overlap or leave the frame. Flow
 *   arrows are drawn here too, with one arrowhead that always renders.
 * - `cycle`: stages round a loop, joined by arrows.
 * - `flow`: steps in order, laid out in layers, joined by arrows.
 * - `circuit`: components in series and in parallel branches, drawn with the
 *   standard symbols, so a parallel circuit is always electrically parallel.
 *
 * Everything drawn here is text the renderer escapes and shapes it chose, and
 * the result still goes through the paper diagram allowlist before anyone sees
 * it.
 *
 *   ```diagram
 *   {"type":"cycle","title":"The water cycle","nodes":[{"id":"sea","label":"Sea"},...],"edges":[{"from":"sea","to":"clouds","label":"Evaporation"}]}
 *   ```
 */

/** The most diagrams one Tutor answer carries. */
export const MAX_TUTOR_DIAGRAMS = 3;

/**
 * How a model writes a diagram, shared by every prompt that asks for one so the
 * format cannot drift between the Tutor's answers and "Show this visually".
 */
export const TUTOR_DIAGRAM_FORMAT = `A diagram is one JSON object; the app draws it, so you describe what is in it, never where the text goes. Four types:
- labelled -- a structure with named parts (heart, cell, leaf, eye, apparatus, a map of a place): {"type":"labelled","title":"...","viewBox":"0 0 400 300","outline":[{"path":"M 60 60 L 340 60 L 340 280 L 60 280 Z"}],"parts":[{"label":"Left ventricle","fill":"#fca5a5","ellipse":[270,210,60,45]}],"arrows":[{"from":"Left atrium","to":"Left ventricle","color":"#dc2626"}]}. Give every shape as numbers in the viewBox's coordinates, never as SVG markup: "rect":[x,y,width,height], "circle":[cx,cy,r], "ellipse":[cx,cy,rx,ry], "polygon":[[x,y],[x,y],...] or "path":"M x y L x y ... Z". Every part a student should name is its own entry in parts, with one shape drawn where that part really is; the app points the label at the middle of that shape, so draw each part the right size and in the right place, with parts not overlapping. outline is optional, for unlabelled shapes behind the parts. Arrows show flow: name the part it leaves and the part it enters, in the real direction of flow, or give [x,y] points. Give every part the fill its subject's convention uses and stay consistent: oxygenated blood and its chambers and vessels red (#fca5a5), deoxygenated blue (#93c5fd); otherwise use calm fills such as #dcfce7, #fef3c7, #e0f2fe or #ede9fe. Use the student's viewpoint conventions, such as a heart drawn as if facing the patient, its right side on the left of the page.
- cycle -- stages that return to the start (water, carbon, nitrogen, cell cycle): {"type":"cycle","title":"...","nodes":[{"id":"sea","label":"Sea"}],"edges":[{"from":"sea","to":"clouds","label":"Evaporation"}]}. List nodes in order round the loop.
- flow -- steps, causes or events in order, including a process, a chain of reasoning or a character's arc: {"type":"flow","title":"...","direction":"down","nodes":[...],"edges":[...]}. Leave edges out for a simple chain; "direction":"right" for a short one.
- circuit -- any electrical circuit, always this type and never a labelled drawing: {"type":"circuit","title":"...","loop":[{"kind":"cell"},{"kind":"switch"},{"parallel":[[{"kind":"lamp","label":"L1"}],[{"kind":"lamp","label":"L2"}]]}]}. The loop is in series round the circuit; each parallel entry lists its branches. To compare circuits side by side, give "circuits":[{"title":"Series","loop":[...]},{"title":"Parallel","loop":[...]}] instead of "loop". Kinds: cell, battery, lamp, resistor, variable_resistor, thermistor, ldr, switch, closed_switch, ammeter, voltmeter, diode, led, motor, fuse. Put a voltmeter in parallel with the part it measures.
Every label, node and edge must be a fact from the explanation or an unambiguous textbook fact. Never invent a part or a value. Keep labels short (a few words), label each part once, and prefer fewer correct labels to many.`;

const MAX_SPEC_LENGTH = 30_000;
const INK = "#1f2937";
const MUTED = "#475569";
const FONT = 'font-family="Arial, Helvetica, sans-serif"';
const FILLS = ["#dbeafe", "#dcfce7", "#fef3c7", "#fee2e2", "#ede9fe", "#e0f2fe"];

type Point = { x: number; y: number };
type Rendered = { ok: true; svg: string } | { ok: false; reason: string };

function escapeText(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function cleanLabel(value: unknown, max = 60) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function colour(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value) ? value : fallback;
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

/** Width of a line of Arial at this size, near enough to lay text out by. */
function textWidth(text: string, fontSize: number) {
  return text.length * fontSize * 0.56;
}

/** Words into lines of at most `max` characters; a word longer than that is cut. */
function wrap(text: string, max: number, maxLines = 3) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const piece = word.length > max ? `${word.slice(0, max - 1)}…` : word;
    if (!line) line = piece;
    else if (`${line} ${piece}`.length <= max) line = `${line} ${piece}`;
    else {
      lines.push(line);
      line = piece;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, max - 1)}…`;
    return kept;
  }
  return lines;
}

function textBlock(lines: readonly string[], x: number, y: number, options: { size: number; anchor: "start" | "middle" | "end"; fill?: string; weight?: string }) {
  const lineHeight = options.size * 1.25;
  const top = y - ((lines.length - 1) * lineHeight) / 2;
  return lines
    .map(
      (line, index) =>
        `<text x="${round(x)}" y="${round(top + index * lineHeight)}" ${FONT} font-size="${options.size}" text-anchor="${options.anchor}" dominant-baseline="middle" fill="${options.fill ?? INK}"${options.weight ? ` font-weight="${options.weight}"` : ""}>${escapeText(line)}</text>`
    )
    .join("");
}

/*
 * The allowlist keeps no `id`, so a marker cannot be referenced by name, and
 * an arrowhead is drawn as its own small triangle instead: the same shape,
 * with nothing that can fail to resolve.
 */
function arrow(from: Point, to: Point, options: { stroke?: string; width?: number; dash?: boolean } = {}) {
  const stroke = options.stroke ?? INK;
  const width = options.width ?? 2.5;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const head = 12;
  const base = { x: to.x - ux * head, y: to.y - uy * head };
  const left = { x: base.x - uy * 6, y: base.y + ux * 6 };
  const right = { x: base.x + uy * 6, y: base.y - ux * 6 };
  return (
    `<line x1="${round(from.x)}" y1="${round(from.y)}" x2="${round(base.x)}" y2="${round(base.y)}" stroke="${stroke}" stroke-width="${width}"${options.dash ? ' stroke-dasharray="6 5"' : ""}/>` +
    `<polygon points="${round(to.x)},${round(to.y)} ${round(left.x)},${round(left.y)} ${round(right.x)},${round(right.y)}" fill="${stroke}"/>`
  );
}

function svgDocument(width: number, height: number, body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.ceil(width)} ${Math.ceil(height)}"><rect x="0" y="0" width="${Math.ceil(width)}" height="${Math.ceil(height)}" fill="#ffffff"/>${body}</svg>`;
}

function titleBlock(title: string, width: number) {
  if (!title) return { svg: "", height: 20 };
  return { svg: textBlock(wrap(title, 60, 2), width / 2, 34, { size: 24, anchor: "middle", weight: "bold" }), height: 64 };
}

/** Where a line from a box's centre towards `toward` crosses the box's edge. */
function boxEdge(center: Point, halfWidth: number, halfHeight: number, toward: Point): Point {
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (dx === 0 && dy === 0) return center;
  const scale = 1 / Math.max(Math.abs(dx) / halfWidth, Math.abs(dy) / halfHeight);
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

// ---------------------------------------------------------------------------
// Boxes joined by arrows: cycles and flows
// ---------------------------------------------------------------------------

type Node = { id: string; label: string; lines: string[]; width: number; height: number; fill: string };
type Edge = { from: string; to: string; label: string };

function readNodes(value: unknown): Node[] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > 12) return null;
  const seen = new Set<string>();
  const nodes: Node[] = [];
  for (const [index, item] of value.entries()) {
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const label = cleanLabel(typeof item === "string" ? item : record.label, 80);
    const id = cleanLabel(record.id, 40) || label || `n${index + 1}`;
    if (!label || seen.has(id)) return null;
    seen.add(id);
    const lines = wrap(label, 18, 4);
    const width = Math.max(110, Math.min(210, Math.max(...lines.map((line) => textWidth(line, 17))) + 28));
    nodes.push({ id, label, lines, width, height: lines.length * 21 + 22, fill: colour(record.color, FILLS[index % FILLS.length]) });
  }
  return nodes;
}

function readEdges(value: unknown, nodes: readonly Node[], fallback: "chain" | "loop"): Edge[] {
  const ids = new Set(nodes.map((node) => node.id));
  const byLabel = new Map(nodes.map((node) => [node.label.toLowerCase(), node.id]));
  const resolve = (ref: unknown) => {
    const text = cleanLabel(ref, 80);
    return ids.has(text) ? text : byLabel.get(text.toLowerCase()) ?? null;
  };
  const edges: Edge[] = [];
  for (const item of Array.isArray(value) ? value.slice(0, 24) : []) {
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const from = resolve(record.from);
    const to = resolve(record.to);
    if (!from || !to || from === to) continue;
    edges.push({ from, to, label: cleanLabel(record.label, 40) });
  }
  if (edges.length > 0) return edges;
  const chain = nodes.slice(1).map((node, index) => ({ from: nodes[index].id, to: node.id, label: "" }));
  return fallback === "loop" ? [...chain, { from: nodes[nodes.length - 1].id, to: nodes[0].id, label: "" }] : chain;
}

function nodeBox(node: Node, center: Point) {
  return (
    `<rect x="${round(center.x - node.width / 2)}" y="${round(center.y - node.height / 2)}" width="${round(node.width)}" height="${round(node.height)}" rx="12" fill="${node.fill}" stroke="${MUTED}" stroke-width="2"/>` +
    textBlock(node.lines, center.x, center.y, { size: 17, anchor: "middle" })
  );
}

function edgeLabel(text: string, at: Point) {
  if (!text) return "";
  const lines = wrap(text, 20, 2);
  const width = Math.max(...lines.map((line) => textWidth(line, 15))) + 12;
  const height = lines.length * 19 + 6;
  return (
    `<rect x="${round(at.x - width / 2)}" y="${round(at.y - height / 2)}" width="${round(width)}" height="${round(height)}" rx="5" fill="#ffffff" stroke="#e2e8f0" stroke-width="1"/>` +
    textBlock(lines, at.x, at.y, { size: 15, anchor: "middle", fill: MUTED })
  );
}

function drawEdges(edges: readonly Edge[], nodes: readonly Node[], centers: Map<string, Point>) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const pairs = new Set(edges.map((edge) => `${edge.from}>${edge.to}`));
  const lines: string[] = [];
  const labels: string[] = [];
  for (const edge of edges) {
    const a = centers.get(edge.from);
    const b = centers.get(edge.to);
    const fromNode = byId.get(edge.from);
    const toNode = byId.get(edge.to);
    if (!a || !b || !fromNode || !toNode) continue;
    // Two arrows between the same pair, one each way, are set apart.
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const offset = pairs.has(`${edge.to}>${edge.from}`) ? 9 : 0;
    const nx = (-(b.y - a.y) / length) * offset;
    const ny = ((b.x - a.x) / length) * offset;
    const start = boxEdge({ x: a.x + nx, y: a.y + ny }, fromNode.width / 2 + 4, fromNode.height / 2 + 4, { x: b.x + nx, y: b.y + ny });
    const end = boxEdge({ x: b.x + nx, y: b.y + ny }, toNode.width / 2 + 6, toNode.height / 2 + 6, { x: a.x + nx, y: a.y + ny });
    lines.push(arrow(start, end));
    const mid = { x: (start.x + end.x) / 2 + nx * 2.2, y: (start.y + end.y) / 2 + ny * 2.2 };
    labels.push(edgeLabel(edge.label, mid));
  }
  // Labels last, so no arrow is drawn across one.
  return lines.join("") + labels.join("");
}

function renderCycle(spec: Record<string, unknown>): Rendered {
  const nodes = readNodes(spec.nodes);
  if (!nodes) return { ok: false, reason: "a cycle needs 2 to 12 named stages" };
  const edges = readEdges(spec.edges, nodes, "loop");
  const width = 960;
  const title = titleBlock(cleanLabel(spec.title, 120), width);
  const tallest = Math.max(...nodes.map((node) => node.height));
  const widest = Math.max(...nodes.map((node) => node.width));
  const rx = Math.max(200, Math.min(330, 120 + nodes.length * 32));
  const ry = Math.max(150, Math.min(230, 100 + nodes.length * 20));
  const center = { x: width / 2, y: title.height + ry + tallest / 2 + 10 };
  const centers = new Map<string, Point>();
  nodes.forEach((node, index) => {
    const angle = -Math.PI / 2 + (index / nodes.length) * Math.PI * 2;
    centers.set(node.id, { x: center.x + Math.cos(angle) * rx, y: center.y + Math.sin(angle) * ry });
  });
  const height = center.y + ry + tallest / 2 + 30;
  const body = drawEdges(edges, nodes, centers) + nodes.map((node) => nodeBox(node, centers.get(node.id) as Point)).join("");
  return { ok: true, svg: svgDocument(Math.max(width, rx * 2 + widest + 60), height, title.svg + body) };
}

/** Layer of each node: the longest path to it, with any edge that closes a loop set aside. */
function layers(nodes: readonly Node[], edges: readonly Edge[]) {
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of edges) outgoing.get(edge.from)?.push(edge.to);
  const state = new Map<string, "open" | "done">();
  const forward: Edge[] = [];
  const visit = (id: string) => {
    state.set(id, "open");
    for (const next of outgoing.get(id) ?? []) {
      if (state.get(next) === "open") continue;
      forward.push({ from: id, to: next, label: "" });
      if (!state.has(next)) visit(next);
    }
    state.set(id, "done");
  };
  for (const node of nodes) if (!state.has(node.id)) visit(node.id);
  const layer = new Map(nodes.map((node) => [node.id, 0]));
  for (let pass = 0; pass < nodes.length; pass += 1) {
    for (const edge of forward) {
      const next = (layer.get(edge.from) ?? 0) + 1;
      if (next > (layer.get(edge.to) ?? 0)) layer.set(edge.to, next);
    }
  }
  return layer;
}

function renderFlow(spec: Record<string, unknown>): Rendered {
  const nodes = readNodes(spec.nodes);
  if (!nodes) return { ok: false, reason: "a flow needs 2 to 12 named steps" };
  const edges = readEdges(spec.edges, nodes, "chain");
  const layer = layers(nodes, edges);
  const count = Math.max(...layer.values()) + 1;
  const columns: Node[][] = Array.from({ length: count }, () => []);
  for (const node of nodes) columns[layer.get(node.id) ?? 0].push(node);
  const widest = Math.max(...nodes.map((node) => node.width));
  const tallest = Math.max(...nodes.map((node) => node.height));
  const across = spec.direction === "right" && count * (widest + 80) + 80 <= 1400;
  const centers = new Map<string, Point>();
  let width: number;
  let height: number;
  const title = titleBlock(cleanLabel(spec.title, 120), 1);
  if (across) {
    const perColumn = Math.max(...columns.map((column) => column.length));
    width = Math.max(720, 60 + count * (widest + 80));
    const areaHeight = perColumn * (tallest + 50);
    columns.forEach((column, index) => {
      column.forEach((node, row) => {
        centers.set(node.id, {
          x: 40 + widest / 2 + index * (widest + 80),
          y: title.height + 20 + ((row + 0.5) * areaHeight) / column.length,
        });
      });
    });
    height = title.height + 40 + areaHeight;
  } else {
    const perRow = Math.max(...columns.map((column) => column.length));
    width = Math.max(720, perRow * (widest + 50) + 60);
    columns.forEach((column, index) => {
      column.forEach((node, position) => {
        centers.set(node.id, {
          x: ((position + 0.5) * width) / column.length,
          y: title.height + 20 + tallest / 2 + index * (tallest + 54),
        });
      });
    });
    height = title.height + 40 + count * (tallest + 54) - 54 + tallest;
  }
  const heading = titleBlock(cleanLabel(spec.title, 120), width);
  const body = drawEdges(edges, nodes, centers) + nodes.map((node) => nodeBox(node, centers.get(node.id) as Point)).join("");
  return { ok: true, svg: svgDocument(width, height, heading.svg + body) };
}

// ---------------------------------------------------------------------------
// Labelled structures
// ---------------------------------------------------------------------------

/**
 * The model's drawing, without anything it wrote in it.
 *
 * Its own text is dropped: every label is placed here, beside the drawing,
 * where it cannot land on top of a shape or another label.
 */
function drawingShapes(svg: string) {
  const drawn = sanitizeSvgDiagram(svg, { maxLength: 24_000 });
  if (!drawn.ok) return null;
  const viewBox = /viewBox="\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)\s*"/.exec(drawn.svg);
  if (!viewBox) return null;
  const [x, y, width, height] = viewBox.slice(1).map(Number);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  const inner = drawn.svg
    .replace(/^<svg\b[^>]*>/, "")
    .replace(/<\/svg>$/, "")
    .replace(/<text\b[^>]*>[\s\S]*?<\/text>/g, "")
    .replace(/<\/?tspan\b[^>]*>/g, "");
  if (!/<(path|line|polyline|polygon|rect|circle|ellipse)\b/.test(inner)) return null;
  return { inner, box: { x, y, width, height } };
}

type Box = { x: number; y: number; width: number; height: number };

function readViewBox(value: unknown): Box | null {
  const numbers = typeof value === "string" ? value.trim().split(/[\s,]+/).map(Number) : [];
  if (numbers.length !== 4 || !numbers.every(Number.isFinite) || numbers[2] <= 0 || numbers[3] <= 0) return null;
  const [x, y, width, height] = numbers;
  return { x, y, width, height };
}

function attributes(source: string) {
  const found = new Map<string, string>();
  for (const [, name, value] of source.matchAll(/([a-zA-Z][\w-]*)="([^"]*)"/g)) found.set(name.toLowerCase(), value);
  return found;
}

function boundsOf(xs: readonly number[], ys: readonly number[]): Box | null {
  if (xs.length === 0 || xs.length !== ys.length || ![...xs, ...ys].every(Number.isFinite)) return null;
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function centreOf(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The box around a path, walking absolute and relative commands alike. */
function pathBounds(d: string): Box | null {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const xs: number[] = [];
  const ys: number[] = [];
  let x = 0;
  let y = 0;
  let start = { x: 0, y: 0 };
  let command = "";
  let index = 0;
  const take = (count: number) => {
    const values = tokens.slice(index, index + count).map(Number);
    index += count;
    return values.length === count && values.every(Number.isFinite) ? values : null;
  };
  const visit = (px: number, py: number) => {
    xs.push(px);
    ys.push(py);
  };
  while (index < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[index])) command = tokens[index++];
    const relative = command === command.toLowerCase();
    const upper = command.toUpperCase();
    const counts: Record<string, number> = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7, Z: 0 };
    const count = counts[upper];
    if (count === undefined) return null;
    if (count === 0) {
      x = start.x;
      y = start.y;
      if (index < tokens.length && !/[a-zA-Z]/.test(tokens[index])) return null;
      continue;
    }
    const values = take(count);
    if (!values) return null;
    const base = relative ? { x, y } : { x: 0, y: 0 };
    if (upper === "H") x = base.x + values[0];
    else if (upper === "V") y = base.y + values[0];
    else {
      // Control points are visited too: close enough to the shape for a label.
      for (let pair = 0; pair < values.length - 1; pair += 2) {
        if (upper === "A" && pair < 5) continue;
        visit(base.x + values[pair], base.y + values[pair + 1]);
      }
      x = base.x + values[values.length - 2];
      y = base.y + values[values.length - 1];
    }
    visit(x, y);
    if (upper === "M") {
      start = { x, y };
      command = relative ? "l" : "L";
    }
  }
  return boundsOf(xs, ys);
}

/** The box around a shape, from which its label's point is found. */
function shapeBounds(element: string, attrs: Map<string, string>): Box | null {
  if (attrs.has("transform")) return null;
  const n = (name: string) => Number(attrs.get(name) ?? "0");
  if (element === "rect") return boundsOf([n("x"), n("x") + n("width")], [n("y"), n("y") + n("height")]);
  if (element === "circle") return boundsOf([n("cx") - n("r"), n("cx") + n("r")], [n("cy") - n("r"), n("cy") + n("r")]);
  if (element === "ellipse") return boundsOf([n("cx") - n("rx"), n("cx") + n("rx")], [n("cy") - n("ry"), n("cy") + n("ry")]);
  if (element === "polygon" || element === "polyline") {
    const values = (attrs.get("points") ?? "").trim().split(/[\s,]+/).map(Number);
    return boundsOf(values.filter((_, index) => index % 2 === 0), values.filter((_, index) => index % 2 === 1));
  }
  if (element === "path") return pathBounds(attrs.get("d") ?? "");
  if (element === "line") return boundsOf([n("x1"), n("x2")], [n("y1"), n("y2")]);
  return null;
}

/**
 * Label points that would land on each other, set apart.
 *
 * A leaf's air space sat in the middle of the spongy layer, so "Spongy
 * mesophyll" and "Air space" pointed at the same spot. When two points nearly
 * meet, the larger part's label moves to a clear spot inside its own box, to
 * whichever side is further from the smaller part.
 */
export function separateLabelPoints(parts: readonly Part[], box: Box): Part[] {
  const near = Math.hypot(box.width, box.height) * 0.05;
  const moved = parts.map((part) => ({ ...part }));
  for (let a = 0; a < moved.length; a += 1) {
    for (let b = a + 1; b < moved.length; b += 1) {
      const first = moved[a];
      const second = moved[b];
      if (Math.hypot(first.anchor.x - second.anchor.x, first.anchor.y - second.anchor.y) >= near) continue;
      const area = (part: Part) => (part.bounds ? part.bounds.width * part.bounds.height : 0);
      const [larger, smaller] = area(first) >= area(second) ? [first, second] : [second, first];
      if (!larger.bounds) continue;
      const left = { x: larger.bounds.x + larger.bounds.width * 0.2, y: larger.anchor.y };
      const right = { x: larger.bounds.x + larger.bounds.width * 0.8, y: larger.anchor.y };
      larger.anchor = Math.abs(left.x - smaller.anchor.x) >= Math.abs(right.x - smaller.anchor.x) ? left : right;
    }
  }
  return moved;
}

type Segment = { from: Point; to: Point; stroke: string };

/**
 * Arrows that would lie on top of each other, set apart.
 *
 * A heart's "left atrium to left ventricle" and "left ventricle to aorta" ran
 * along almost the same line and read as one arrow with two heads. Any two
 * arrows that are nearly parallel, nearly on one line and overlapping along it
 * are moved apart sideways, a little each way.
 */
export function separateOverlapping(segments: readonly Segment[]): Segment[] {
  const moved = segments.map((segment) => ({ ...segment, shift: { x: 0, y: 0 } }));
  for (let a = 0; a < moved.length; a += 1) {
    for (let b = a + 1; b < moved.length; b += 1) {
      const first = moved[a];
      const second = moved[b];
      const dx = first.to.x - first.from.x;
      const dy = first.to.y - first.from.y;
      const length = Math.hypot(dx, dy) || 1;
      const ux = dx / length;
      const uy = dy / length;
      const ex = second.to.x - second.from.x;
      const ey = second.to.y - second.from.y;
      const otherLength = Math.hypot(ex, ey) || 1;
      const parallel = Math.abs(ux * (ey / otherLength) - uy * (ex / otherLength)) < 0.2;
      const offLine = (point: Point) => Math.abs((point.x - first.from.x) * uy - (point.y - first.from.y) * ux);
      const along = (point: Point) => (point.x - first.from.x) * ux + (point.y - first.from.y) * uy;
      const [low, high] = [along(second.from), along(second.to)].sort((p, q) => p - q);
      const overlaps = high > 8 && low < length - 8;
      if (parallel && offLine(second.from) < 12 && offLine(second.to) < 12 && overlaps) {
        // One perpendicular for the pair, so the two move opposite ways along it.
        const normal = { x: -uy * 9, y: ux * 9 };
        first.shift = { x: first.shift.x - normal.x, y: first.shift.y - normal.y };
        second.shift = { x: second.shift.x + normal.x, y: second.shift.y + normal.y };
      }
    }
  }
  return moved.map(({ shift, ...segment }) => ({
    ...segment,
    from: { x: segment.from.x + shift.x, y: segment.from.y + shift.y },
    to: { x: segment.to.x + shift.x, y: segment.to.y + shift.y },
  }));
}

type Part = { label: string; svg: string; anchor: Point; bounds: Box | null };

/**
 * A named part: its own shape, its own colour, and a label that points at it.
 *
 * Asked to name a point for each label, a model put "pulmonary vein" in the
 * gap between two vessels and coloured the left atrium blue. A part carries
 * its label and fill with it, and the leader line goes to the middle of the
 * shape it drew -- so a label can only ever point at the part it names.
 */
/**
 * A shape given as plain numbers, as SVG.
 *
 * Shapes used to be SVG strings inside the JSON, which meant escaping every
 * quote, and the worker model dropped one closing quote in a heart and lost the
 * whole diagram. Numbers need no escaping: `"ellipse":[cx,cy,rx,ry]`,
 * `"rect":[x,y,width,height]`, `"circle":[cx,cy,r]`, `"polygon":[[x,y],...]`,
 * or `"path":"M 10 10 L 50 10 Z"` -- path data has no quotes in it either.
 */
export function shapeFromNumbers(record: Record<string, unknown>): string | null {
  const numbers = (value: unknown, count: number) =>
    Array.isArray(value) && value.length === count && value.every(finite) ? (value as number[]) : null;
  const rect = numbers(record.rect, 4);
  if (rect && rect[2] > 0 && rect[3] > 0) {
    return `<rect x="${rect[0]}" y="${rect[1]}" width="${rect[2]}" height="${rect[3]}" rx="${round(Math.min(rect[2], rect[3]) * 0.12)}"/>`;
  }
  const circle = numbers(record.circle, 3);
  if (circle && circle[2] > 0) return `<circle cx="${circle[0]}" cy="${circle[1]}" r="${circle[2]}"/>`;
  const ellipse = numbers(record.ellipse, 4);
  if (ellipse && ellipse[2] > 0 && ellipse[3] > 0) {
    return `<ellipse cx="${ellipse[0]}" cy="${ellipse[1]}" rx="${ellipse[2]}" ry="${ellipse[3]}"/>`;
  }
  if (Array.isArray(record.polygon) && record.polygon.length >= 3 && record.polygon.length <= 60) {
    const points = record.polygon.map((point) => numbers(point, 2));
    if (points.every(Boolean)) return `<polygon points="${(points as number[][]).map(([x, y]) => `${x},${y}`).join(" ")}"/>`;
  }
  if (typeof record.path === "string" && /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s+-]{3,4000}$/.test(record.path) && /^\s*[Mm]/.test(record.path)) {
    return `<path d="${record.path.trim()}"/>`;
  }
  return typeof record.shape === "string" ? record.shape : null;
}

function readPart(item: unknown, box: Box): Part | null {
  const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
  const label = cleanLabel(record.label ?? record.text, 60);
  const shape = shapeFromNumbers(record);
  if (!label || !shape) return null;
  const drawn = sanitizeSvgDiagram(
    `<svg viewBox="${box.x} ${box.y} ${box.width} ${box.height}">${shape}</svg>`,
    { maxLength: 8_000 }
  );
  if (!drawn.ok) return null;
  const inner = drawn.svg
    .replace(/^<svg\b[^>]*>/, "")
    .replace(/<\/svg>$/, "")
    .replace(/<text\b[^>]*>[\s\S]*?<\/text>/g, "");
  const first = /<(rect|circle|ellipse|polygon|polyline|path|line)\b([^>]*)>/.exec(inner);
  if (!first) return null;
  const bounds = shapeBounds(first[1], attributes(first[2]));
  const given = Array.isArray(record.point) && finite(record.point[0]) && finite(record.point[1])
    ? { x: record.point[0], y: record.point[1] }
    : null;
  const point = given ?? (bounds ? centreOf(bounds) : null);
  if (!point) return null;
  const fill = colour(record.fill, "");
  const svg = fill
    ? `<g fill="${fill}" stroke="${MUTED}" stroke-width="2">${inner.replace(/\sfill="[^"]*"/g, "")}</g>`
    : `<g fill="#f1f5f9" stroke="${MUTED}" stroke-width="2">${inner}</g>`;
  // A point the model gave is kept where it put it, so it is never moved.
  return { label, svg, anchor: point, bounds: given ? null : bounds };
}

/** Label positions in a column, in order, at least `gap` apart and inside [top, bottom]. */
function spread(targets: readonly number[], gap: number, top: number, bottom: number) {
  const placed = targets.map((target) => Math.max(top, Math.min(bottom, target)));
  for (let index = 1; index < placed.length; index += 1) {
    placed[index] = Math.max(placed[index], placed[index - 1] + gap);
  }
  const overflow = placed.length ? placed[placed.length - 1] - bottom : 0;
  if (overflow > 0) {
    placed[placed.length - 1] = bottom;
    for (let index = placed.length - 2; index >= 0; index -= 1) {
      placed[index] = Math.min(placed[index], placed[index + 1] - gap);
    }
  }
  return placed;
}

function renderLabelled(spec: Record<string, unknown>): Rendered {
  const outline = typeof spec.drawing === "string" ? drawingShapes(spec.drawing) : null;
  const box = outline?.box ?? readViewBox(spec.viewBox);
  if (!box) return { ok: false, reason: 'a labelled diagram needs a "viewBox", or a drawing with one' };
  const namedParts = (Array.isArray(spec.parts) ? spec.parts.slice(0, 16) : []).map((item) => readPart(item, box));
  if (namedParts.some((part) => part === null)) {
    return { ok: false, reason: "every part needs a label and one shape (rect, circle, ellipse, polygon or path) whose middle can be found" };
  }
  const parts = separateLabelPoints(namedParts as Part[], box);
  // Unlabelled shapes behind the parts -- a heart's outline, a leaf's edge --
  // given as numbers like the parts, drawn quietly.
  const backdrop = (Array.isArray(spec.outline) ? spec.outline.slice(0, 20) : []).flatMap((item) => {
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const shape = shapeFromNumbers(record);
    return shape
      ? [`<g fill="${colour(record.fill, "none")}" stroke="#94a3b8" stroke-width="2">${shape}</g>`]
      : [];
  });
  if (!outline && parts.length === 0 && backdrop.length === 0) {
    return { ok: false, reason: "a labelled diagram needs parts, or a drawing with shapes" };
  }
  const drawing = { inner: (outline?.inner ?? "") + backdrop.join("") + parts.map((part) => part.svg).join(""), box };
  const width = 960;
  const columnWidth = 230;
  const area = { x: columnWidth + 30, width: width - 2 * (columnWidth + 30) };
  const title = titleBlock(cleanLabel(spec.title, 120), width);
  const scale = Math.min(area.width / drawing.box.width, 480 / drawing.box.height);
  const drawnWidth = drawing.box.width * scale;
  const drawnHeight = drawing.box.height * scale;
  const origin = { x: area.x + (area.width - drawnWidth) / 2, y: title.height + 20 };
  const place = (x: number, y: number): Point => ({
    x: origin.x + (x - drawing.box.x) * scale,
    y: origin.y + (y - drawing.box.y) * scale,
  });

  const pointLabels = (Array.isArray(spec.labels) ? spec.labels.slice(0, 16) : []).flatMap((item) => {
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const text = cleanLabel(record.text, 60);
    if (!text || !finite(record.x) || !finite(record.y)) return [];
    return [{ lines: wrap(text, 22, 3), target: place(record.x, record.y) }];
  });
  const labels = [
    ...parts.map((part) => ({ lines: wrap(part.label, 22, 3), target: place(part.anchor.x, part.anchor.y) })),
    ...pointLabels,
  ].slice(0, 18);
  if (labels.length === 0) return { ok: false, reason: "a labelled diagram needs labelled parts" };
  const anchors = new Map(parts.map((part) => [part.label.toLowerCase(), part.anchor]));

  const middle = origin.x + drawnWidth / 2;
  const top = origin.y + 10;
  const gap = 46;
  const columns = (["left", "right"] as const).map((side) => ({
    side,
    labels: labels
      .filter((label) => (side === "left" ? label.target.x < middle : label.target.x >= middle))
      .sort((a, b) => a.target.y - b.target.y),
  }));
  // Tall enough for the drawing and for the busier column at full spacing, so
  // spreading a crowded column never pushes a label above the frame.
  const busiest = Math.max(...columns.map((column) => column.labels.length));
  const bottomLimit = Math.max(origin.y + drawnHeight - 10, top + (busiest - 1) * gap);
  const labelMarks: string[] = [];
  for (const { side, labels: column } of columns) {
    const ys = spread(column.map((label) => label.target.y), gap, top, bottomLimit);
    column.forEach((label, index) => {
      const y = ys[index];
      const textX = side === "left" ? columnWidth : width - columnWidth;
      const lineStart = { x: side === "left" ? textX + 8 : textX - 8, y };
      labelMarks.push(
        `<line x1="${round(lineStart.x)}" y1="${round(y)}" x2="${round(label.target.x)}" y2="${round(label.target.y)}" stroke="${MUTED}" stroke-width="1.5"/>` +
          `<circle cx="${round(label.target.x)}" cy="${round(label.target.y)}" r="3.5" fill="${INK}"/>` +
          textBlock(label.lines, side === "left" ? textX : textX, y, { size: 17, anchor: side === "left" ? "end" : "start" })
      );
    });
  }

  /*
   * An arrow names the parts it runs between, or gives two points. Between
   * parts it runs from one middle to the other, stopping short of both so the
   * label dots stay clear.
   */
  const end = (value: unknown): Point | null => {
    if (typeof value === "string") return anchors.get(cleanLabel(value, 60).toLowerCase()) ?? null;
    return Array.isArray(value) && finite(value[0]) && finite(value[1]) ? { x: value[0], y: value[1] } : null;
  };
  const segments = (Array.isArray(spec.arrows) ? spec.arrows.slice(0, 16) : []).flatMap((item) => {
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const fromPoint = end(record.from);
    const toPoint = end(record.to);
    if (!fromPoint || !toPoint) return [];
    let from = place(fromPoint.x, fromPoint.y);
    let to = place(toPoint.x, toPoint.y);
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length < 30) return [];
    if (typeof record.from === "string" || typeof record.to === "string") {
      const ux = (to.x - from.x) / length;
      const uy = (to.y - from.y) / length;
      if (typeof record.from === "string") from = { x: from.x + ux * 14, y: from.y + uy * 14 };
      if (typeof record.to === "string") to = { x: to.x - ux * 14, y: to.y - uy * 14 };
    }
    return [{ from, to, stroke: colour(record.color, INK) }];
  });
  const arrows = separateOverlapping(segments).map((segment) =>
    arrow(segment.from, segment.to, { stroke: segment.stroke, width: 3 })
  );

  const content =
    `<g transform="translate(${round(origin.x - drawing.box.x * scale)} ${round(origin.y - drawing.box.y * scale)}) scale(${round(scale * 1000) / 1000})">${drawing.inner}</g>` +
    arrows.join("") +
    labelMarks.join("");
  const height = Math.max(origin.y + drawnHeight, bottomLimit + 20) + 30;
  return { ok: true, svg: svgDocument(width, height, title.svg + content) };
}

// ---------------------------------------------------------------------------
// Circuits
// ---------------------------------------------------------------------------

const COMPONENTS = {
  cell: 36, battery: 64, lamp: 44, resistor: 64, variable_resistor: 64, thermistor: 64, ldr: 64,
  switch: 56, closed_switch: 56, ammeter: 44, voltmeter: 44, diode: 48, led: 48, motor: 44, fuse: 56,
} as const;
type ComponentKind = keyof typeof COMPONENTS;

/** What students and models also call them. A refused circuit costs a whole diagram. */
const COMPONENT_ALIASES: Record<string, ComponentKind> = {
  bulb: "lamp", light_bulb: "lamp", light: "lamp", filament_lamp: "lamp",
  batteries: "battery", power_supply: "battery", dc_supply: "battery",
  fixed_resistor: "resistor", rheostat: "variable_resistor", potentiometer: "variable_resistor",
  light_dependent_resistor: "ldr", open_switch: "switch", switch_open: "switch", switch_closed: "closed_switch",
  light_emitting_diode: "led",
};
type CircuitItem = { kind: ComponentKind; label: string } | { branches: CircuitItem[][] };

const COMPONENT_GAP = 34;
const BRANCH_GAP = 110;

function readCircuitItems(value: unknown, depth = 0): CircuitItem[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 12) return null;
  const items: CircuitItem[] = [];
  for (const item of value) {
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    if (Array.isArray(record.parallel)) {
      if (depth > 0 || record.parallel.length < 2 || record.parallel.length > 5) return null;
      const branches = record.parallel.map((branch) => readCircuitItems(Array.isArray(branch) ? branch : [branch], depth + 1));
      if (branches.some((branch) => branch === null)) return null;
      items.push({ branches: branches as CircuitItem[][] });
      continue;
    }
    const named = String(typeof item === "string" ? item : record.kind ?? "").toLowerCase().replace(/[\s-]+/g, "_");
    const kind = COMPONENT_ALIASES[named] ?? named;
    if (!(kind in COMPONENTS)) return null;
    items.push({ kind: kind as ComponentKind, label: cleanLabel(record.label, 30) });
  }
  return items;
}

function itemWidth(item: CircuitItem): number {
  if ("kind" in item) return COMPONENTS[item.kind] + COMPONENT_GAP * 2;
  return Math.max(...item.branches.map((branch) => branch.reduce((total, part) => total + itemWidth(part), 0))) + 40;
}

function itemDepth(item: CircuitItem) {
  return "kind" in item ? 0 : (item.branches.length - 1) * BRANCH_GAP;
}

function wire(x1: number, y1: number, x2: number, y2: number) {
  return `<line x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}" stroke="${INK}" stroke-width="2.5"/>`;
}

/** One symbol, centred on (cx, y), joined by wire to `left` and `right`. */
function symbol(kind: ComponentKind, cx: number, y: number, left: number, right: number, label: string) {
  const half = COMPONENTS[kind] / 2;
  const leads = wire(left, y, cx - half, y) + wire(cx + half, y, right, y);
  const stroke = `stroke="${INK}" stroke-width="2.5" fill="none"`;
  const box = (w: number, h: number, fill = "#ffffff") => `<rect x="${round(cx - w / 2)}" y="${round(y - h / 2)}" width="${w}" height="${h}" fill="${fill}" stroke="${INK}" stroke-width="2.5"/>`;
  const meter = (letter: string) => `<circle cx="${round(cx)}" cy="${round(y)}" r="${half}" fill="#ffffff" stroke="${INK}" stroke-width="2.5"/>` + textBlock([letter], cx, y + 1, { size: 20, anchor: "middle", weight: "bold" });
  let drawn: string;
  switch (kind) {
    case "cell":
      drawn = `<line x1="${round(cx - 6)}" y1="${round(y - 22)}" x2="${round(cx - 6)}" y2="${round(y + 22)}" ${stroke}/><line x1="${round(cx + 6)}" y1="${round(y - 11)}" x2="${round(cx + 6)}" y2="${round(y + 11)}" stroke="${INK}" stroke-width="6"/>` + wire(cx - half, y, cx - 6, y) + wire(cx + 6, y, cx + half, y);
      break;
    case "battery":
      drawn = [-20, 8].map((offset) => `<line x1="${round(cx + offset)}" y1="${round(y - 22)}" x2="${round(cx + offset)}" y2="${round(y + 22)}" ${stroke}/><line x1="${round(cx + offset + 12)}" y1="${round(y - 11)}" x2="${round(cx + offset + 12)}" y2="${round(y + 11)}" stroke="${INK}" stroke-width="6"/>`).join("") + wire(cx - half, y, cx - 20, y) + wire(cx - 8, y, cx + 8, y) + wire(cx + 20, y, cx + half, y);
      break;
    case "lamp":
      drawn = `<circle cx="${round(cx)}" cy="${round(y)}" r="${half}" fill="#ffffff" stroke="${INK}" stroke-width="2.5"/><line x1="${round(cx - half * 0.7)}" y1="${round(y - half * 0.7)}" x2="${round(cx + half * 0.7)}" y2="${round(y + half * 0.7)}" ${stroke}/><line x1="${round(cx - half * 0.7)}" y1="${round(y + half * 0.7)}" x2="${round(cx + half * 0.7)}" y2="${round(y - half * 0.7)}" ${stroke}/>`;
      break;
    case "resistor":
      drawn = box(COMPONENTS.resistor, 22);
      break;
    case "variable_resistor":
      drawn = box(COMPONENTS.variable_resistor, 22) + arrow({ x: cx - 30, y: y + 24 }, { x: cx + 30, y: y - 24 }, { width: 2 });
      break;
    case "thermistor":
      drawn = box(COMPONENTS.thermistor, 22) + `<polyline points="${round(cx - 34)},${round(y + 26)} ${round(cx - 18)},${round(y + 26)} ${round(cx + 26)},${round(y - 26)}" ${stroke}/>`;
      break;
    case "ldr":
      drawn = `<circle cx="${round(cx)}" cy="${round(y)}" r="${half}" fill="#ffffff" stroke="${INK}" stroke-width="2.5"/>` + box(40, 16) + arrow({ x: cx - 44, y: y - 44 }, { x: cx - 22, y: y - 22 }, { width: 2 }) + arrow({ x: cx - 30, y: y - 50 }, { x: cx - 8, y: y - 28 }, { width: 2 });
      break;
    case "switch":
      drawn = `<circle cx="${round(cx - half + 4)}" cy="${round(y)}" r="3.5" fill="${INK}"/><circle cx="${round(cx + half - 4)}" cy="${round(y)}" r="3.5" fill="${INK}"/><line x1="${round(cx - half + 4)}" y1="${round(y)}" x2="${round(cx + half - 8)}" y2="${round(y - 20)}" ${stroke}/>`;
      break;
    case "closed_switch":
      drawn = `<circle cx="${round(cx - half + 4)}" cy="${round(y)}" r="3.5" fill="${INK}"/><circle cx="${round(cx + half - 4)}" cy="${round(y)}" r="3.5" fill="${INK}"/>` + wire(cx - half + 4, y, cx + half - 4, y);
      break;
    case "ammeter":
      drawn = meter("A");
      break;
    case "voltmeter":
      drawn = meter("V");
      break;
    case "motor":
      drawn = meter("M");
      break;
    case "diode":
    case "led":
      drawn = `<polygon points="${round(cx - 14)},${round(y - 16)} ${round(cx - 14)},${round(y + 16)} ${round(cx + 12)},${round(y)}" fill="#ffffff" stroke="${INK}" stroke-width="2.5"/><line x1="${round(cx + 13)}" y1="${round(y - 16)}" x2="${round(cx + 13)}" y2="${round(y + 16)}" ${stroke}/>` + wire(cx - half, y, cx - 14, y) + wire(cx + 13, y, cx + half, y) +
        (kind === "led" ? arrow({ x: cx, y: y - 22 }, { x: cx + 16, y: y - 42 }, { width: 2 }) + arrow({ x: cx + 12, y: y - 18 }, { x: cx + 28, y: y - 38 }, { width: 2 }) : "");
      break;
    case "fuse":
      drawn = box(COMPONENTS.fuse, 20) + wire(cx - half, y, cx + half, y);
      break;
  }
  const caption = label ? textBlock([label], cx, y + 44, { size: 15, anchor: "middle", fill: MUTED }) : "";
  return leads + drawn + caption;
}

/** A run of items along one wire from x=left, at height y; returns the SVG and where it ended. */
function circuitRun(items: readonly CircuitItem[], left: number, y: number): { svg: string; right: number } {
  let x = left;
  const parts: string[] = [];
  for (const item of items) {
    const width = itemWidth(item);
    if ("kind" in item) {
      parts.push(symbol(item.kind, x + width / 2, y, x, x + width, item.label));
    } else {
      const right = x + width;
      const bottom = y + itemDepth(item);
      parts.push(wire(x, y, x + 20, y), wire(right - 20, y, right, y));
      parts.push(wire(x + 20, y, x + 20, bottom), wire(right - 20, y, right - 20, bottom));
      parts.push(`<circle cx="${round(x + 20)}" cy="${round(y)}" r="4.5" fill="${INK}"/><circle cx="${round(right - 20)}" cy="${round(y)}" r="4.5" fill="${INK}"/>`);
      item.branches.forEach((branch, index) => {
        const branchY = y + index * BRANCH_GAP;
        const branchWidth = branch.reduce((total, part) => total + itemWidth(part), 0);
        const start = x + 20 + (width - 40 - branchWidth) / 2;
        const run = circuitRun(branch, start, branchY);
        parts.push(wire(x + 20, branchY, start, branchY), run.svg, wire(run.right, branchY, right - 20, branchY));
        if (index > 0) {
          parts.push(`<circle cx="${round(x + 20)}" cy="${round(branchY)}" r="4.5" fill="${INK}"/><circle cx="${round(right - 20)}" cy="${round(branchY)}" r="4.5" fill="${INK}"/>`);
        }
      });
    }
    x += width;
  }
  return { svg: parts.join(""), right: x };
}

type CircuitPanel = { svg: string; width: number; height: number };

/** One circuit, drawn from (0, 0): its SVG and its size, or why it cannot be drawn. */
function circuitPanel(loop: unknown, subtitle: string): CircuitPanel | { reason: string } {
  const items = readCircuitItems(loop);
  if (!items) return { reason: "a circuit needs a loop of known components (and at most one level of parallel branches)" };
  const flat = items.flatMap((item) => ("kind" in item ? [item] : item.branches.flat()));
  if (!flat.some((item) => "kind" in item && (item.kind === "cell" || item.kind === "battery"))) {
    return { reason: "a circuit needs a cell or battery" };
  }
  const left = 40;
  const run = itemWidthTotal(items);
  const width = Math.max(360, left * 2 + run);
  const heading = subtitle ? textBlock([subtitle], width / 2, 18, { size: 19, anchor: "middle", weight: "bold" }) : "";
  const top = subtitle ? 76 : 40;
  const depth = Math.max(0, ...items.map(itemDepth));
  const bottom = top + depth + 100;
  const start = left + (width - left * 2 - run) / 2;
  const drawn = circuitRun(items, start, top);
  const svg =
    heading +
    wire(left, top, start, top) +
    drawn.svg +
    wire(drawn.right, top, width - left, top) +
    wire(left, top, left, bottom) +
    wire(width - left, top, width - left, bottom) +
    wire(left, bottom, width - left, bottom);
  return { svg, width, height: bottom + 30 };
}

/**
 * One circuit, or up to three side by side.
 *
 * "Show me series and parallel" needs two circuits. When a diagram could hold
 * only one, the model drew both freehand instead -- and its parallel circuit
 * was not parallel. `circuits` gives each its own panel, drawn the same way.
 */
function renderCircuit(spec: Record<string, unknown>): Rendered {
  const sources = Array.isArray(spec.circuits)
    ? spec.circuits.slice(0, 3).map((item) => {
        const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
        return { loop: record.loop, subtitle: cleanLabel(record.title, 40) };
      })
    : [{ loop: spec.loop, subtitle: "" }];
  if (sources.length === 0) return { ok: false, reason: "a circuit diagram needs a loop or circuits" };
  const panels: CircuitPanel[] = [];
  for (const source of sources) {
    const panel = circuitPanel(source.loop, source.subtitle);
    if ("reason" in panel) return { ok: false, reason: panel.reason };
    panels.push(panel);
  }
  const gap = 50;
  const rowWidth = panels.reduce((total, panel) => total + panel.width, 0) + gap * (panels.length - 1);
  const across = rowWidth <= 1300;
  const width = Math.max(560, across ? rowWidth + 40 : Math.max(...panels.map((panel) => panel.width)) + 40);
  const title = titleBlock(cleanLabel(spec.title, 120), width);
  let x = (width - rowWidth) / 2;
  let y = title.height;
  const placed = panels.map((panel) => {
    const at = across ? { x, y } : { x: (width - panel.width) / 2, y };
    if (across) x += panel.width + gap;
    else y += panel.height + 20;
    return `<g transform="translate(${round(at.x)} ${round(at.y)})">${panel.svg}</g>`;
  });
  const height = across ? title.height + Math.max(...panels.map((panel) => panel.height)) : y;
  return { ok: true, svg: svgDocument(width, height + 20, title.svg + placed.join("")) };
}

function itemWidthTotal(items: readonly CircuitItem[]) {
  return items.reduce((total, item) => total + itemWidth(item), 0);
}

// ---------------------------------------------------------------------------

const DIAGRAM_TYPES = ["labelled", "cycle", "flow", "circuit"] as const;
type DiagramType = (typeof DIAGRAM_TYPES)[number];

/**
 * The spec's type, or what its content makes it when the type was left out.
 *
 * A model wrote a correct side-by-side circuit and forgot `"type":"circuit"`;
 * refusing it would have cost the student a right diagram over a missing word.
 * Only content that can mean one thing is read this way.
 */
export function diagramType(spec: Record<string, unknown>): DiagramType | null {
  const named = String(spec.type ?? "").toLowerCase().replace("labeled", "labelled");
  if ((DIAGRAM_TYPES as readonly string[]).includes(named)) return named as DiagramType;
  if (spec.type !== undefined) return null;
  if (Array.isArray(spec.circuits) || Array.isArray(spec.loop)) return "circuit";
  if (Array.isArray(spec.parts) || typeof spec.drawing === "string") return "labelled";
  if (Array.isArray(spec.nodes)) return "flow";
  return null;
}

/** A diagram spec drawn as SVG, or the reason it could not be. */
export function renderTutorDiagram(source: string): Rendered {
  if (!source || source.length > MAX_SPEC_LENGTH) return { ok: false, reason: "missing or too long" };
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch {
    return { ok: false, reason: "not JSON" };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, reason: "not an object" };
  const spec = data as Record<string, unknown>;
  const type = diagramType(spec);
  const rendered =
    type === "cycle" ? renderCycle(spec)
      : type === "flow" ? renderFlow(spec)
        : type === "labelled" ? renderLabelled(spec)
          : type === "circuit" ? renderCircuit(spec)
            : ({ ok: false, reason: "type must be labelled, cycle, flow or circuit" } as const);
  if (!rendered.ok) return rendered;
  // Built here from escaped text and chosen shapes, and still put through the
  // allowlist: whatever is shown has passed the same check a paper's has.
  const safe = sanitizeSvgDiagram(rendered.svg, { maxLength: 120_000 });
  return safe.ok ? { ok: true, svg: safe.svg } : { ok: false, reason: safe.reason };
}

/** A spec that renders, rewritten compactly; or null. */
function canonicalDiagramSpec(source: string) {
  const trimmed = source
    .trim()
    .replace(/^`{0,3}\s*(?:diagram)?\s*(?=\{)/i, "")
    .replace(/\s*`{1,3}n?\s*$/, "");
  if (!renderTutorDiagram(trimmed).ok) return null;
  return JSON.stringify(JSON.parse(trimmed));
}

/** The diagrams the Tutor put in its answer's `diagrams` field; anything that will not draw is dropped. */
export function readTutorDiagramSpecs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const specs = value.flatMap((item) => {
    const source = typeof item === "string" ? item : item && typeof item === "object" ? JSON.stringify(item) : "";
    const spec = source ? canonicalDiagramSpec(source) : null;
    return spec ? [spec] : [];
  });
  return [...new Set(specs)].slice(0, MAX_TUTOR_DIAGRAMS);
}

/** Diagram blocks written into the answer text itself, lifted out of it, as graphs are. */
export function extractTutorDiagrams(answer: string): { answer: string; diagrams: string[] } {
  const diagrams: string[] = [];
  const text = answer.replace(/`{3}[ \t]*diagram[ \t]*\n([\s\S]*?)\n[ \t]*`{2,3}n?(?=\s|$)/gi, (match, source: string) => {
    const spec = canonicalDiagramSpec(source);
    if (!spec) return match;
    diagrams.push(spec);
    return "\n";
  });
  return { answer: text.replace(/\n{3,}/g, "\n\n").trim(), diagrams: [...new Set(diagrams)] };
}

/**
 * The answer with each diagram drawn where the Tutor marked it.
 *
 * `[diagram 1]` becomes the first diagram's SVG, in the fenced svg block the
 * answer renderer already draws (with "Add to page"). A diagram with no marker
 * goes before the text; a marker with no diagram behind it is removed.
 */
export function placeTutorDiagrams(answer: string, specs: readonly string[]) {
  let text = answer;
  const unmarked: string[] = [];
  specs.slice(0, MAX_TUTOR_DIAGRAMS).forEach((spec, index) => {
    const rendered = renderTutorDiagram(spec);
    if (!rendered.ok) return;
    const block = "```svg\n" + rendered.svg + "\n```";
    const marker = new RegExp(`\\[{1,2}\\s*diagram(?:\\s*${index + 1})?\\s*\\]{1,2}`, "i");
    if (marker.test(text)) text = text.replace(marker, () => `\n\n${block}\n\n`);
    else unmarked.push(block);
  });
  text = text.replace(/\[{1,2}\s*diagram(?:\s*\d+)?\s*\]{1,2}/gi, "");
  return [...unmarked, text]
    .filter((part) => part.trim())
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
