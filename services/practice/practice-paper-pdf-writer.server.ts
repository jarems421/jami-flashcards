import "server-only";

import { join } from "node:path";
import PDFDocument from "pdfkit";
import SVGtoPDF from "svg-to-pdfkit";
import { mathjax } from "@mathjax/src/js/mathjax.js";
import { TeX } from "@mathjax/src/js/input/tex.js";
import { SVG } from "@mathjax/src/js/output/svg.js";
import { liteAdaptor, type LiteAdaptor } from "@mathjax/src/js/adaptors/liteAdaptor.js";
import type { LiteElement } from "@mathjax/src/js/adaptors/lite/Element.js";
import { RegisterHTMLHandler } from "@mathjax/src/js/handlers/html.js";
import "@mathjax/src/js/input/tex/base/BaseConfiguration.js";
import "@mathjax/src/js/input/tex/ams/AmsConfiguration.js";
import { MathJaxNewcmFont } from "@mathjax/mathjax-newcm-font/js/svg.js";
import { PAPER_PAGE_HEIGHT, PAPER_PAGE_WIDTH } from "@/lib/practice/paper-pdf-layout";
import type { PaperHouseStyle } from "@/lib/practice/paper-house-style";
import { normalizeLegacyJamiMathText, splitMathRichText } from "@/lib/study/math-text";

/*
 * The booklet a practice paper is typeset into: its page geometry, its maths,
 * and the writer that lays text and maths onto pages and remembers which
 * question went where.
 */

export const PAGE_EDGE = 56;
export const PAGE_RIGHT = PAPER_PAGE_WIDTH - PAGE_EDGE;
export const TOP = 60;
export const BOTTOM = PAPER_PAGE_HEIGHT - 72;
export const FOOTER_Y = PAPER_PAGE_HEIGHT - 40;
export const BODY_SIZE = 11;
export const LINE_HEIGHT = 15;
/** Liberation Sans places its baseline this far below the top of a line, per point of size. */
export const ASCENT = 0.905;
/** MathJax measures in ex; at an 11pt body an ex is half that. */
const EX = BODY_SIZE / 2;
const MATH_SCALE = 0.84;
const MATH_CONTAINER_WIDTH = 420;
export const FIGURE_MAX_WIDTH = 380;
export const FIGURE_MAX_HEIGHT = 300;
/** Drawn diagrams are line art; at photograph size their strokes print heavy. */
export const DIAGRAM_MAX_WIDTH = 300;
export const DIAGRAM_MAX_HEIGHT = 220;
export const TICK_BOX = 10;
export const INK = "#111111";

const FONT_DIRECTORY = join(process.cwd(), "node_modules", "pdfjs-dist", "standard_fonts");

type MathBox = { svg: string; width: number; height: number; depth: number };
type Piece =
  | { kind: "text"; value: string; width: number }
  | { kind: "math"; box: MathBox; width: number }
  | { kind: "tick"; width: number }
  | { kind: "check"; width: number };
type Line = { pieces: Piece[]; ascent: number; descent: number; centred: boolean };

type MathEngine = {
  adaptor: LiteAdaptor;
  convert: (tex: string, display: boolean) => Promise<LiteElement>;
};

let engine: MathEngine | null = null;

/** Built on first use: a route that never prints maths never pays to load it. */
function mathEngine(): MathEngine {
  if (engine) return engine;
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const document = mathjax.document("", {
    InputJax: new TeX({ packages: ["base", "ams"] }),
    /*
     * Inline line breaking off: MathJax 4 otherwise splits a long inline
     * expression into several sibling SVGs, and only the first was ever drawn --
     * `3/4 + sqrt(x^2 + 1)` printed as a bare 3/4.
     */
    OutputJax: new SVG({ fontCache: "none", fontData: MathJaxNewcmFont, linebreaks: { inline: false } }),
  });
  engine = {
    adaptor,
    convert: (tex, display) =>
      mathjax.handleRetriesFor(() =>
        document.convert(tex, { display, em: BODY_SIZE, ex: EX, containerWidth: MATH_CONTAINER_WIDTH })
      ) as Promise<LiteElement>,
  };
  return engine;
}

async function mathBox(tex: string, display: boolean, cache: Map<string, MathBox | null>) {
  const key = `${display ? "D" : "I"}:${tex}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  const { adaptor, convert } = mathEngine();
  let box: MathBox | null = null;
  try {
    const container = await convert(tex, display);
    const svg = adaptor.childNodes(container).find((node) => adaptor.kind(node) === "svg") as LiteElement | undefined;
    const markup = svg ? adaptor.outerHTML(svg) : "";
    if (svg && !/data-mjx-error|merror/.test(markup)) {
      // New Computer Modern sets larger than Liberation Sans at the same size; scaled to sit level with the text.
      const width = parseFloat(String(adaptor.getAttribute(svg, "width"))) * EX * MATH_SCALE;
      const height = parseFloat(String(adaptor.getAttribute(svg, "height"))) * EX * MATH_SCALE;
      const align = String(adaptor.getAttribute(svg, "style") ?? "").match(/vertical-align:\s*(-?[\d.]+)ex/);
      const depth = align ? Math.max(0, -parseFloat(align[1]) * EX * MATH_SCALE) : 0;
      if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
        box = { svg: markup, width, height, depth };
      }
    }
  } catch {
    box = null;
  }
  cache.set(key, box);
  return box;
}

/**
 * Where a question page's text goes once the board's margin has taken its
 * share: AQA and WJEC keep a ruled column on the right for the examiner, SQA a
 * marks column, and AQA's boxed question numbers need a wider gutter.
 */
export type Frame = {
  left: number;
  bodyX: number;
  right: number;
  bodyWidth: number;
  column?: { x: number; width: number };
};

export function frameFor(style: PaperHouseStyle): Frame {
  const left = PAGE_EDGE;
  const bodyX = left + (style.boxedNumbers ? 66 : 50);
  let right = PAGE_RIGHT;
  let column: Frame["column"];
  if (style.margin === "box" || style.margin === "examiner-column") {
    column = { x: PAPER_PAGE_WIDTH - 36 - 38, width: 38 };
    right = column.x - 14;
  } else if (style.margin === "marks-column") {
    column = { x: PAPER_PAGE_WIDTH - 30 - 50, width: 50 };
    right = column.x - 12;
  }
  return { left, bodyX, right, bodyWidth: right - bodyX, column };
}

export type PageKind = "cover" | "questions" | "insert";

export class BookletWriter {
  readonly doc: PDFKit.PDFDocument;
  readonly pages: Array<Set<string>> = [new Set()];
  readonly kinds: PageKind[] = ["cover"];
  readonly mathCache = new Map<string, MathBox | null>();
  y = TOP;

  constructor(title: string, readonly frame: Frame) {
    this.doc = new PDFDocument({
      size: [PAPER_PAGE_WIDTH, PAPER_PAGE_HEIGHT],
      // Everything is placed by hand; zero margins stop pdfkit adding pages of its own.
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      // Kept open so each page's furniture is drawn once the whole paper is known:
      // "Turn over" belongs on every page but the last, and nothing knows the last page until then.
      bufferPages: true,
      info: { Title: title, Creator: "Jami", Producer: "Jami" },
    });
    this.doc.registerFont("body", join(FONT_DIRECTORY, "LiberationSans-Regular.ttf"));
    this.doc.registerFont("bold", join(FONT_DIRECTORY, "LiberationSans-Bold.ttf"));
    this.doc.registerFont("italic", join(FONT_DIRECTORY, "LiberationSans-Italic.ttf"));
    this.doc.font("body").fontSize(BODY_SIZE).fillColor(INK);
  }

  get pageIndex() {
    return this.pages.length - 1;
  }

  mark(questionId?: string) {
    if (questionId) this.pages[this.pageIndex].add(questionId);
  }

  newPage(kind: PageKind = "questions") {
    this.doc.addPage({ size: [PAPER_PAGE_WIDTH, PAPER_PAGE_HEIGHT], margins: { top: 0, bottom: 0, left: 0, right: 0 } });
    this.pages.push(new Set());
    this.kinds.push(kind);
    this.y = TOP;
  }

  /** Start a new page unless this much still fits on the current one. */
  ensure(height: number, questionId?: string) {
    if (this.y + height > BOTTOM) this.newPage(this.kinds[this.pageIndex] === "insert" ? "insert" : "questions");
    this.mark(questionId);
  }

  /** Text and maths broken into lines that fit the width. */
  async layout(text: string, width: number, font = "body", size = BODY_SIZE): Promise<Line[]> {
    const { doc } = this;
    doc.font(font).fontSize(size);
    const lines: Line[] = [];
    const baseAscent = size * ASCENT;
    const baseDescent = LINE_HEIGHT * (size / BODY_SIZE) - baseAscent;
    let current: Line = { pieces: [], ascent: baseAscent, descent: baseDescent, centred: false };
    let used = 0;
    const flush = (force = false) => {
      if (current.pieces.length || force) lines.push(current);
      current = { pieces: [], ascent: baseAscent, descent: baseDescent, centred: false };
      used = 0;
    };
    const push = (piece: Piece) => {
      const spaceOnly = piece.kind === "text" && !piece.value.trim();
      if (spaceOnly && used === 0) return;
      if (used + piece.width > width && used > 0 && !spaceOnly) flush();
      if (spaceOnly && used === 0) return;
      current.pieces.push(piece);
      used += piece.width;
      if (piece.kind === "math") {
        current.ascent = Math.max(current.ascent, piece.box.height - piece.box.depth + 1);
        current.descent = Math.max(current.descent, piece.box.depth + 3);
      }
    };

    const segments = splitMathRichText(normalizeLegacyJamiMathText(text));
    for (const segment of segments) {
      if (segment.type === "math") {
        const box = await mathBox(segment.value, segment.display, this.mathCache);
        if (!box) {
          // Maths that will not typeset is printed as written rather than dropped.
          for (const word of segment.value.split(/(\s+)/)) {
            if (word) push({ kind: "text", value: word, width: doc.widthOfString(word) });
          }
          continue;
        }
        if (segment.display) {
          flush();
          lines.push({ pieces: [{ kind: "math", box, width: box.width }], ascent: box.height - box.depth + 4, descent: box.depth + 6, centred: true });
          continue;
        }
        push({ kind: "math", box, width: Math.min(box.width, width) });
        continue;
      }
      const paragraphs = segment.value.split("\n");
      paragraphs.forEach((paragraph, index) => {
        if (index > 0) flush(true);
        for (const word of paragraph.split(/(\s+)/)) {
          if (!word) continue;
          // Liberation Sans has no ballot box, so a tick box is drawn rather than printed as a missing glyph.
          if (/^[☐□]$/.test(word)) {
            push({ kind: "tick", width: TICK_BOX + 5 });
            continue;
          }
          // Nor a tick mark: "Tick (✓) one box" would print "Tick ( ) one box".
          for (const part of word.split(/([✓✔])/)) {
            if (!part) continue;
            if (/^[✓✔]$/.test(part)) push({ kind: "check", width: 9 });
            else push({ kind: "text", value: part.replace(/\t/g, " "), width: doc.widthOfString(part) });
          }
        }
      });
    }
    flush();
    // Blank paragraphs are kept as gaps, but not at either end.
    while (lines.length && !lines[0].pieces.length) lines.shift();
    while (lines.length && !lines[lines.length - 1].pieces.length) lines.pop();
    return lines;
  }

  async write(text: string, options: { x?: number; width?: number; font?: string; size?: number; questionId?: string } = {}) {
    const x = options.x ?? this.frame.bodyX;
    const width = options.width ?? this.frame.right - x;
    const font = options.font ?? "body";
    const size = options.size ?? BODY_SIZE;
    const { doc } = this;
    for (const line of await this.layout(text, width, font, size)) {
      const height = line.ascent + line.descent;
      this.ensure(height, options.questionId);
      const baseline = this.y + line.ascent;
      const lineWidth = line.pieces.reduce((sum, piece) => sum + piece.width, 0);
      let cursor = line.centred ? x + Math.max(0, (width - lineWidth) / 2) : x;
      doc.font(font).fontSize(size).fillColor(INK);
      for (const piece of line.pieces) {
        if (piece.kind === "text") {
          doc.text(piece.value, cursor, baseline - size * ASCENT, { lineBreak: false });
        } else if (piece.kind === "tick") {
          doc.save().lineWidth(0.8).strokeColor(INK)
            .rect(cursor + 1, baseline - TICK_BOX + 1, TICK_BOX, TICK_BOX).stroke().restore();
        } else if (piece.kind === "check") {
          doc.save().lineWidth(1.1).strokeColor("#111111")
            .moveTo(cursor + 1, baseline - 4).lineTo(cursor + 3.5, baseline - 1).lineTo(cursor + 8, baseline - 8.5)
            .stroke().restore();
        } else {
          SVGtoPDF(doc, piece.box.svg, cursor, baseline - (piece.box.height - piece.box.depth), {
            width: piece.width,
            height: piece.box.height * (piece.width / piece.box.width),
            assumePt: true,
          });
        }
        cursor += piece.width;
      }
      this.y += height;
    }
  }

  gap(points: number) {
    this.y = Math.min(this.y + points, BOTTOM);
  }

  /** One line of bold text set against the right edge of the body, the way marks are printed. */
  rightAligned(text: string, questionId?: string) {
    this.ensure(LINE_HEIGHT + 4, questionId);
    this.doc.font("bold").fontSize(BODY_SIZE).fillColor(INK)
      .text(text, this.frame.bodyX, this.y, { width: this.frame.bodyWidth, align: "right", lineBreak: false });
    this.y += LINE_HEIGHT;
  }

  finish(furnish: (pageIndex: number, kind: PageKind, pageCount: number) => void): Promise<Buffer> {
    const pageCount = this.pages.length;
    for (let index = 0; index < pageCount; index += 1) {
      this.doc.switchToPage(index);
      furnish(index, this.kinds[index] ?? "questions", pageCount);
    }
    const chunks: Buffer[] = [];
    return new Promise((resolve, reject) => {
      this.doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      this.doc.on("end", () => resolve(Buffer.concat(chunks)));
      this.doc.on("error", reject);
      this.doc.end();
    });
  }
}
