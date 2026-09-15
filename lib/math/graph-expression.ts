/**
 * A function of x a student types, turned into something a graph can plot.
 *
 * Parsed by hand and compiled to closures: nothing a student or a model writes
 * is ever evaluated as code. Written the way it is on paper -- `y = 2x² − 3x + 1`,
 * `3(x + 1)`, `sin x`, `|x|`, `√x` -- so it reads the same on the page as it
 * did in a textbook. Trig works in degrees as well as radians, because GCSE
 * graphs of sin and cos run from 0° to 360°.
 */

export type GraphAngleUnit = "degrees" | "radians";

export type CompiledGraphExpression =
  | { ok: true; evaluate: (x: number) => number }
  | { ok: false; error: string };

export const MAX_GRAPH_EXPRESSION_LENGTH = 200;
const MAX_NESTING = 40;

type Token =
  | { type: "number"; value: number }
  | { type: "name"; value: string }
  | { type: "op"; value: "+" | "-" | "*" | "/" | "^" }
  | { type: "open" }
  | { type: "close" }
  | { type: "abs" }
  | { type: "sqrt" };

type Node = (x: number) => number;

const UNARY_FUNCTIONS: Record<string, (value: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sqrt: Math.sqrt,
  abs: Math.abs,
  ln: Math.log,
  log: Math.log10,
  exp: Math.exp,
};
const TRIG = new Set(["sin", "cos", "tan"]);
const INVERSE_TRIG = new Set(["asin", "acos", "atan"]);
const NAMES = ["asin", "acos", "atan", "sqrt", "sin", "cos", "tan", "abs", "exp", "log", "ln", "pi", "x", "e"];

function tokenize(source: string): Token[] | string {
  const text = source
    .replace(/[−–—]/g, "-")
    .replace(/[×·⋅]/g, "*")
    .replace(/÷/g, "/")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/π/g, "pi");
  const tokens: Token[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      const match = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(text.slice(index));
      if (!match) return `"${char}" is not a number a graph can read.`;
      tokens.push({ type: "number", value: Number(match[0]) });
      index += match[0].length;
      continue;
    }
    if (/[a-z]/i.test(char)) {
      // "xsin" and "2pix" are names written together; read them apart.
      let word = /^[a-z]+/i.exec(text.slice(index))![0].toLowerCase();
      index += word.length;
      while (word) {
        const name = NAMES.find((candidate) => word.startsWith(candidate));
        if (!name) return `"${word}" is not something a graph can use. Write functions of x.`;
        tokens.push({ type: "name", value: name });
        word = word.slice(name.length);
      }
      continue;
    }
    if (char === "+" || char === "-" || char === "*" || char === "/" || char === "^") {
      tokens.push({ type: "op", value: char });
    } else if (char === "(" || char === "[") {
      tokens.push({ type: "open" });
    } else if (char === ")" || char === "]") {
      tokens.push({ type: "close" });
    } else if (char === "|") {
      tokens.push({ type: "abs" });
    } else if (char === "√") {
      tokens.push({ type: "sqrt" });
    } else {
      return `"${char}" is not something a graph can use.`;
    }
    index += 1;
  }
  return tokens;
}

class Parser {
  private position = 0;
  private depth = 0;
  /** Inside |...|, a bar closes the value rather than starting a new one. */
  private absDepth = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly angleUnit: GraphAngleUnit
  ) {}

  done() {
    return this.position >= this.tokens.length;
  }

  private peek() {
    return this.tokens[this.position];
  }

  private next() {
    return this.tokens[this.position++];
  }

  private enter() {
    this.depth += 1;
    if (this.depth > MAX_NESTING) throw new Error("That expression is nested too deeply.");
  }

  private leave() {
    this.depth -= 1;
  }

  private startsValue(token: Token | undefined) {
    if (!token) return false;
    if (token.type === "abs") return this.absDepth === 0;
    return token.type === "number" || token.type === "name" || token.type === "open" || token.type === "sqrt";
  }

  parseExpression(): Node {
    this.enter();
    let left = this.parseTerm();
    for (let token = this.peek(); token?.type === "op" && (token.value === "+" || token.value === "-"); token = this.peek()) {
      this.next();
      const right = this.parseTerm();
      const previous = left;
      left = token.value === "+" ? (x) => previous(x) + right(x) : (x) => previous(x) - right(x);
    }
    this.leave();
    return left;
  }

  private parseTerm(): Node {
    let left = this.parseUnary();
    for (;;) {
      const token = this.peek();
      if (token?.type === "op" && (token.value === "*" || token.value === "/")) {
        this.next();
        const right = this.parseUnary();
        const previous = left;
        left = token.value === "*" ? (x) => previous(x) * right(x) : (x) => previous(x) / right(x);
      } else if (this.startsValue(token)) {
        // Written side by side, as in 2x or 3(x + 1).
        const right = this.parseUnary();
        const previous = left;
        left = (x) => previous(x) * right(x);
      } else {
        return left;
      }
    }
  }

  private parseUnary(): Node {
    const token = this.peek();
    if (token?.type === "op" && (token.value === "-" || token.value === "+")) {
      this.next();
      const operand = this.parseUnary();
      return token.value === "-" ? (x) => -operand(x) : operand;
    }
    return this.parsePower();
  }

  /** Right-associative, and above unary minus: -x² is -(x²), as it is on paper. */
  private parsePower(): Node {
    const base = this.parsePrimary();
    const token = this.peek();
    if (token?.type === "op" && token.value === "^") {
      this.next();
      const exponent = this.parseUnary();
      return (x) => Math.pow(base(x), exponent(x));
    }
    return base;
  }

  private parsePrimary(): Node {
    const token = this.next();
    if (!token) throw new Error("That expression ends too soon.");
    switch (token.type) {
      case "number": {
        const value = token.value;
        return () => value;
      }
      case "open": {
        const inner = this.parseExpression();
        if (this.next()?.type !== "close") throw new Error("A bracket is not closed.");
        return inner;
      }
      case "abs": {
        this.absDepth += 1;
        const inner = this.parseExpression();
        this.absDepth -= 1;
        if (this.next()?.type !== "abs") throw new Error("An absolute value bar is not closed.");
        return (x) => Math.abs(inner(x));
      }
      case "sqrt": {
        const argument = this.parsePower();
        return (x) => Math.sqrt(argument(x));
      }
      case "name":
        return this.parseName(token.value);
      default:
        throw new Error("That expression has an operator where a value should be.");
    }
  }

  private parseName(name: string): Node {
    if (name === "x") return (x) => x;
    if (name === "pi") return () => Math.PI;
    if (name === "e") return () => Math.E;
    const apply = UNARY_FUNCTIONS[name];
    if (!apply) throw new Error(`"${name}" is not something a graph can use.`);
    // sin(x) or sin x: a function applies to the value written straight after it.
    const argument = this.parsePower();
    const toRadians = this.angleUnit === "degrees" && TRIG.has(name);
    const fromRadians = this.angleUnit === "degrees" && INVERSE_TRIG.has(name);
    return (x) => {
      const input = argument(x);
      const output = apply(toRadians ? (input * Math.PI) / 180 : input);
      return fromRadians ? (output * 180) / Math.PI : output;
    };
  }
}

/** A readable expression compiled to a function of x, or the reason it cannot be. */
export function compileGraphExpression(
  source: string,
  angleUnit: GraphAngleUnit = "radians"
): CompiledGraphExpression {
  const text = String(source ?? "")
    .trim()
    .replace(/^(?:y|f\s*\(\s*x\s*\))\s*=\s*/i, "");
  if (!text) return { ok: false, error: "Type a function of x, like 2x + 1." };
  if (text.length > MAX_GRAPH_EXPRESSION_LENGTH) {
    return { ok: false, error: `Keep a function under ${MAX_GRAPH_EXPRESSION_LENGTH} characters.` };
  }
  const tokens = tokenize(text);
  if (typeof tokens === "string") return { ok: false, error: tokens };
  try {
    const parser = new Parser(tokens, angleUnit);
    const node = parser.parseExpression();
    if (!parser.done()) return { ok: false, error: "Part of that expression could not be read." };
    return {
      ok: true,
      evaluate: (x) => {
        const value = node(x);
        return Number.isFinite(value) ? value : Number.NaN;
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "That expression could not be read." };
  }
}

export type GraphViewWindow = { xMin: number; xMax: number; yMin: number; yMax: number };
export type GraphPoint = { x: number; y: number };

/**
 * Points along a function across a view, split wherever the curve leaves the real numbers or jumps.
 *
 * A single line drawn through 1/x joins the two branches with a vertical
 * stroke through the asymptote, which is exactly the kind of inaccuracy a real
 * graph is here to avoid. So the line breaks where the function is undefined,
 * and where consecutive samples leap across most of the view in opposite
 * directions. Values outside the view are kept as they are, for
 * `clipGraphPolyline` to cut exactly at its edge.
 */
export function sampleGraphFunction(
  evaluate: (x: number) => number,
  view: GraphViewWindow,
  samples = 480
): GraphPoint[][] {
  const count = Math.max(8, Math.min(4_000, Math.round(samples)));
  const span = view.yMax - view.yMin;
  const middle = (view.yMin + view.yMax) / 2;
  const segments: GraphPoint[][] = [];
  let current: GraphPoint[] = [];
  let previous: GraphPoint | null = null;
  for (let index = 0; index <= count; index += 1) {
    const x = view.xMin + ((view.xMax - view.xMin) * index) / count;
    const y = evaluate(x);
    if (!Number.isFinite(y)) {
      if (current.length > 1) segments.push(current);
      current = [];
      previous = null;
      continue;
    }
    const jumped =
      previous !== null &&
      Math.abs(y - previous.y) > span * 1.5 &&
      Math.sign(y - middle) !== Math.sign(previous.y - middle);
    if (jumped) {
      if (current.length > 1) segments.push(current);
      current = [];
    }
    current.push({ x, y });
    previous = { x, y };
  }
  if (current.length > 1) segments.push(current);
  return segments;
}

/** One line segment cut to a rectangle (Liang–Barsky), or null when none of it is inside. */
function clipSegment(from: GraphPoint, to: GraphPoint, view: GraphViewWindow): [GraphPoint, GraphPoint] | null {
  let start = 0;
  let end = 1;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const edges: Array<[number, number]> = [
    [-dx, from.x - view.xMin],
    [dx, view.xMax - from.x],
    [-dy, from.y - view.yMin],
    [dy, view.yMax - from.y],
  ];
  for (const [direction, distance] of edges) {
    if (direction === 0) {
      if (distance < 0) return null;
      continue;
    }
    const ratio = distance / direction;
    if (direction < 0) {
      if (ratio > end) return null;
      if (ratio > start) start = ratio;
    } else {
      if (ratio < start) return null;
      if (ratio < end) end = ratio;
    }
  }
  // The ends themselves when nothing was cut, so a piece stays joined to the next.
  return [
    start === 0 ? from : { x: from.x + start * dx, y: from.y + start * dy },
    end === 1 ? to : { x: from.x + end * dx, y: from.y + end * dy },
  ];
}

/**
 * A line through points, cut exactly at the edges of the view.
 *
 * Drawing is kept inside the axes by arithmetic rather than by an SVG clip
 * path. A clip path depends on the browser resolving a reference by id, and a
 * graph whose curve vanished while its axes stayed put is exactly what a
 * failed reference looks like; cutting the line here cannot fail that way, and
 * it also keeps a steep curve's far-off coordinates out of the drawing.
 */
export function clipGraphPolyline(points: readonly GraphPoint[], view: GraphViewWindow): GraphPoint[][] {
  const pieces: GraphPoint[][] = [];
  let current: GraphPoint[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!;
    const to = points[index]!;
    const clipped = clipSegment(from, to, view);
    if (!clipped) {
      if (current.length > 1) pieces.push(current);
      current = [];
      continue;
    }
    const [start, end] = clipped;
    const last = current[current.length - 1];
    if (!last || last.x !== start.x || last.y !== start.y) {
      if (current.length > 1) pieces.push(current);
      current = [start];
    }
    current.push(end);
    // Left the view part-way along this segment: the piece ends at the edge.
    if (end.x !== to.x || end.y !== to.y) {
      pieces.push(current);
      current = [];
    }
  }
  if (current.length > 1) pieces.push(current);
  return pieces;
}
