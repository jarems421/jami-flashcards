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
import {
  ANSWER_LINE_SPACING,
  PAPER_PAGE_HEIGHT,
  PAPER_PAGE_WIDTH,
  answerLineCount,
  answerSpacePoints,
  inferPaperQuestionKind,
  paperSubjectGroup,
  parseGraphPoints,
  parseMarkdownTableRows,
  type PaperSubjectGroup,
} from "@/lib/practice/paper-pdf-layout";
import type {
  GeneratedPracticePaper,
  PracticePaperQuestion,
  PracticePaperQuestionAsset,
} from "@/lib/practice/practice-papers";
import { looksLikeSvg, sanitizeSvgDiagram } from "@/lib/practice/svg-diagram";
import { normalizeLegacyJamiMathText, splitMathRichText } from "@/lib/study/math-text";

/**
 * A generated practice paper, typeset as a printed exam booklet.
 *
 * The student writes on these pages in a notebook exactly as they would on a
 * paper they uploaded, so a generated paper and a real one look and behave the
 * same. What the booklet adds over an upload is certainty: it was laid out
 * here, so which questions sit on which page is known rather than guessed, and
 * marking is told.
 *
 * Maths is set by MathJax as vector outlines, so it prints as sharply as the
 * text around it and needs no font of its own.
 */

export type PracticePaperPdfInput = Pick<
  GeneratedPracticePaper,
  "title" | "instructions" | "companionDocuments" | "durationMinutes" | "questions" | "choiceGroups" | "totalMarks" | "assessmentProfile"
>;

export type RenderedPracticePaperPdf = {
  bytes: Buffer;
  pageCount: number;
  pages: Array<{ pageIndex: number; questionIds: string[] }>;
};

const LEFT = 56;
const BODY_X = 102;
const RIGHT = PAPER_PAGE_WIDTH - 56;
const BODY_WIDTH = RIGHT - BODY_X;
const TOP = 60;
const BOTTOM = PAPER_PAGE_HEIGHT - 72;
const BODY_SIZE = 11;
const LINE_HEIGHT = 15;
/** Liberation Sans places its baseline this far below the top of a line, per point of size. */
const ASCENT = 0.905;
/** MathJax measures in ex; at an 11pt body an ex is half that. */
const EX = BODY_SIZE / 2;
const MATH_SCALE = 0.84;
const FIGURE_MAX_WIDTH = 380;
const FIGURE_MAX_HEIGHT = 300;
/** Drawn diagrams are line art; at photograph size their strokes print heavy. */
const DIAGRAM_MAX_WIDTH = 300;
const DIAGRAM_MAX_HEIGHT = 220;
const TICK_BOX = 10;

const FONT_DIRECTORY = join(process.cwd(), "node_modules", "pdfjs-dist", "standard_fonts");

type MathBox = { svg: string; width: number; height: number; depth: number };
type Piece =
  | { kind: "text"; value: string; width: number }
  | { kind: "math"; box: MathBox; width: number }
  | { kind: "tick"; width: number };
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
        document.convert(tex, { display, em: BODY_SIZE, ex: EX, containerWidth: BODY_WIDTH })
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

class BookletWriter {
  readonly doc: PDFKit.PDFDocument;
  readonly pages: Array<Set<string>> = [new Set()];
  readonly mathCache = new Map<string, MathBox | null>();
  y = TOP;
  private footerTitle: string;

  constructor(title: string) {
    this.doc = new PDFDocument({
      size: [PAPER_PAGE_WIDTH, PAPER_PAGE_HEIGHT],
      // Everything is placed by hand; zero margins stop pdfkit adding pages of its own.
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      info: { Title: title, Creator: "Jami", Producer: "Jami" },
    });
    this.footerTitle = title;
    this.doc.registerFont("body", join(FONT_DIRECTORY, "LiberationSans-Regular.ttf"));
    this.doc.registerFont("bold", join(FONT_DIRECTORY, "LiberationSans-Bold.ttf"));
    this.doc.registerFont("italic", join(FONT_DIRECTORY, "LiberationSans-Italic.ttf"));
    this.doc.font("body").fontSize(BODY_SIZE).fillColor("#111111");
    this.drawFooter();
  }

  get pageIndex() {
    return this.pages.length - 1;
  }

  mark(questionId?: string) {
    if (questionId) this.pages[this.pageIndex].add(questionId);
  }

  newPage() {
    this.doc.addPage({ size: [PAPER_PAGE_WIDTH, PAPER_PAGE_HEIGHT], margins: { top: 0, bottom: 0, left: 0, right: 0 } });
    this.pages.push(new Set());
    this.y = TOP;
    this.drawFooter();
  }

  /** Start a new page unless this much still fits on the current one. */
  ensure(height: number, questionId?: string) {
    if (this.y + height > BOTTOM) this.newPage();
    this.mark(questionId);
  }

  private drawFooter() {
    const { doc } = this;
    doc.save();
    doc.font("body").fontSize(8).fillColor("#666666");
    const footer = `Jami practice paper · ${this.footerTitle}`;
    // Cut at a word, not through one: "Practice Pa" reads as a typo.
    const shortened = footer.length > 105 ? `${footer.slice(0, 105).replace(/\s+\S*$/, "")}…` : footer;
    doc.text(shortened, LEFT, PAPER_PAGE_HEIGHT_FOOTER, { lineBreak: false });
    doc.text(String(this.pages.length), RIGHT - 40, PAPER_PAGE_HEIGHT_FOOTER, { width: 40, align: "right", lineBreak: false });
    doc.restore();
    doc.font("body").fontSize(BODY_SIZE).fillColor("#111111");
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
          push({ kind: "text", value: word.replace(/\t/g, " "), width: doc.widthOfString(word) });
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
    const x = options.x ?? BODY_X;
    const width = options.width ?? RIGHT - x;
    const font = options.font ?? "body";
    const size = options.size ?? BODY_SIZE;
    const { doc } = this;
    for (const line of await this.layout(text, width, font, size)) {
      const height = line.ascent + line.descent;
      this.ensure(height, options.questionId);
      const baseline = this.y + line.ascent;
      const lineWidth = line.pieces.reduce((sum, piece) => sum + piece.width, 0);
      let cursor = line.centred ? x + Math.max(0, (width - lineWidth) / 2) : x;
      doc.font(font).fontSize(size).fillColor("#111111");
      for (const piece of line.pieces) {
        if (piece.kind === "text") {
          doc.text(piece.value, cursor, baseline - size * ASCENT, { lineBreak: false });
        } else if (piece.kind === "tick") {
          doc.save().lineWidth(0.8).strokeColor("#111111")
            .rect(cursor + 1, baseline - TICK_BOX + 1, TICK_BOX, TICK_BOX).stroke().restore();
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

  finish(): Promise<Buffer> {
    const chunks: Buffer[] = [];
    return new Promise((resolve, reject) => {
      this.doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      this.doc.on("end", () => resolve(Buffer.concat(chunks)));
      this.doc.on("error", reject);
      this.doc.end();
    });
  }
}

const PAPER_PAGE_HEIGHT_FOOTER = PAPER_PAGE_HEIGHT - 40;

function describeCourse(input: PracticePaperPdfInput) {
  const profile = input.assessmentProfile;
  return [profile?.awardingBodyOrInstitution, profile?.qualificationOrModule]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(" · ");
}

async function drawCover(writer: BookletWriter, input: PracticePaperPdfInput) {
  const { doc } = writer;
  const course = describeCourse(input);
  writer.y = 88;
  if (course) {
    await writer.write(course, { x: LEFT, width: RIGHT - LEFT, font: "bold", size: 12 });
    writer.gap(10);
  }
  await writer.write(input.title, { x: LEFT, width: RIGHT - LEFT, font: "bold", size: 20 });
  const component = input.assessmentProfile?.tierOrComponent?.trim();
  if (component) {
    writer.gap(6);
    await writer.write(component, { x: LEFT, width: RIGHT - LEFT, size: 12 });
  }
  writer.gap(22);

  const facts = [
    input.durationMinutes > 0 ? `Time allowed: ${input.durationMinutes} minutes` : "",
    `Total marks: ${input.totalMarks}`,
  ].filter(Boolean);
  doc.save().lineWidth(0.8).strokeColor("#111111");
  doc.rect(LEFT, writer.y, RIGHT - LEFT, 28 + facts.length * 16).stroke();
  doc.restore();
  writer.y += 14;
  for (const fact of facts) await writer.write(fact, { x: LEFT + 14, width: RIGHT - LEFT - 28, font: "bold" });
  writer.gap(26);

  if (input.instructions.length) {
    await writer.write("Instructions", { x: LEFT, width: RIGHT - LEFT, font: "bold", size: 12 });
    writer.gap(6);
    for (const instruction of input.instructions) {
      await writer.write(`•  ${instruction}`, { x: LEFT + 8, width: RIGHT - LEFT - 8 });
      writer.gap(3);
    }
    writer.gap(16);
  }

  const information = [
    "The marks for each question are shown in brackets.",
    ...input.choiceGroups.map((group) => group.label).filter(Boolean),
    ...(input.companionDocuments?.length
      ? [`You will need: ${input.companionDocuments.map((document) => document.title).join(", ")} (at the back of this booklet).`]
      : []),
  ];
  await writer.write("Information", { x: LEFT, width: RIGHT - LEFT, font: "bold", size: 12 });
  writer.gap(6);
  for (const line of information) {
    await writer.write(`•  ${line}`, { x: LEFT + 8, width: RIGHT - LEFT - 8 });
    writer.gap(3);
  }

  writer.y = BOTTOM - 40;
  await writer.write(
    "This is a practice paper written by Jami for revision. It is not an official examination paper.",
    { x: LEFT, width: RIGHT - LEFT, font: "italic", size: 9 }
  );
}

function svgAspect(svg: string) {
  const viewBox = svg.match(/viewBox\s*=\s*"([^"]+)"/i)?.[1].trim().split(/[\s,]+/).map(Number);
  if (viewBox && viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) return viewBox[3] / viewBox[2];
  const width = Number(svg.match(/\bwidth\s*=\s*"([\d.]+)/i)?.[1]);
  const height = Number(svg.match(/\bheight\s*=\s*"([\d.]+)/i)?.[1]);
  return width > 0 && height > 0 ? height / width : 0.6;
}

function fitFigure(aspect: number, maxWidth = FIGURE_MAX_WIDTH, maxHeight = FIGURE_MAX_HEIGHT) {
  let width = maxWidth;
  let height = width * aspect;
  if (height > maxHeight) {
    height = maxHeight;
    width = height / aspect;
  }
  return { width, height, x: BODY_X + (BODY_WIDTH - width) / 2 };
}

async function drawTable(writer: BookletWriter, rows: string[][], questionId: string) {
  const { doc } = writer;
  const columns = Math.max(...rows.map((row) => row.length));
  /*
   * Each column as wide as its longest cell wants, scaled down only when the
   * table would not fit. Equal columns gave a one-letter "Option" column the
   * same width as the sentences beside it, which then wrapped to five lines.
   */
  const natural = Array.from({ length: columns }, (_, column) =>
    Math.max(60, ...rows.map((row, rowIndex) => {
      doc.font(rowIndex === 0 ? "bold" : "body").fontSize(10);
      return doc.widthOfString(row[column] ?? "") + 16;
    }))
  );
  const naturalWidth = natural.reduce((sum, value) => sum + value, 0);
  const scale = naturalWidth > BODY_WIDTH ? BODY_WIDTH / naturalWidth : 1;
  const widths = natural.map((value) => Math.max(48, value * scale));
  const width = widths.reduce((sum, value) => sum + value, 0);
  const x = BODY_X + Math.max(0, (BODY_WIDTH - width) / 2);
  const offsets = widths.map((_, column) => widths.slice(0, column).reduce((sum, value) => sum + value, 0));
  for (const [rowIndex, row] of rows.entries()) {
    doc.font(rowIndex === 0 ? "bold" : "body").fontSize(10);
    const height = Math.max(22, ...row.map((cell, column) => doc.heightOfString(cell, { width: (widths[column] ?? 60) - 10 }) + 10));
    writer.ensure(height, questionId);
    doc.save().lineWidth(0.7).strokeColor("#111111");
    for (let column = 0; column < columns; column += 1) {
      const cellWidth = widths[column] ?? 60;
      doc.rect(x + offsets[column], writer.y, cellWidth, height).stroke();
      const cell = row[column] ?? "";
      doc.font(rowIndex === 0 ? "bold" : "body").fontSize(10).fillColor("#111111")
        .text(cell, x + offsets[column] + 5, writer.y + 5, { width: cellWidth - 10, align: "center" });
    }
    doc.restore();
    writer.y += height;
  }
  doc.font("body").fontSize(BODY_SIZE);
}

function drawGraph(writer: BookletWriter, points: Array<{ x: number; y: number }>, questionId: string) {
  const { doc } = writer;
  const width = 300;
  const height = 180;
  writer.ensure(height + 24, questionId);
  const left = BODY_X + (BODY_WIDTH - width) / 2;
  const top = writer.y;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const plot = (point: { x: number; y: number }) => ({
    x: left + ((point.x - minX) / spanX) * width,
    y: top + height - ((point.y - minY) / spanY) * height,
  });
  const label = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, ""));
  doc.save().lineWidth(0.4).strokeColor("#bbbbbb");
  for (let step = 1; step < 10; step += 1) {
    doc.moveTo(left + (width * step) / 10, top).lineTo(left + (width * step) / 10, top + height).stroke();
    doc.moveTo(left, top + (height * step) / 10).lineTo(left + width, top + (height * step) / 10).stroke();
  }
  doc.restore();
  doc.save().lineWidth(1).strokeColor("#111111").moveTo(left, top).lineTo(left, top + height).lineTo(left + width, top + height).stroke().restore();
  const plotted = points.map(plot);
  doc.save().lineWidth(1.2).strokeColor("#111111");
  plotted.forEach((point, index) => (index === 0 ? doc.moveTo(point.x, point.y) : doc.lineTo(point.x, point.y)));
  doc.stroke();
  for (const point of plotted) doc.circle(point.x, point.y, 2).fill("#111111");
  doc.restore();
  doc.font("body").fontSize(8).fillColor("#111111");
  doc.text(label(minY), left - 34, top + height - 4, { width: 30, align: "right", lineBreak: false });
  doc.text(label(maxY), left - 34, top - 4, { width: 30, align: "right", lineBreak: false });
  doc.text(label(minX), left - 10, top + height + 6, { width: 20, align: "center", lineBreak: false });
  doc.text(label(maxX), left + width - 10, top + height + 6, { width: 20, align: "center", lineBreak: false });
  doc.font("body").fontSize(BODY_SIZE);
  writer.y = top + height + 24;
}

async function drawAsset(
  writer: BookletWriter,
  asset: PracticePaperQuestionAsset,
  questionId: string,
  loadImage: (storagePath: string) => Promise<Buffer | null>
) {
  const heading = asset.caption?.trim() || asset.title?.trim();
  /*
   * The caption waits until the figure's size is known, so it moves to the
   * next page with its figure: a "Figure 2" left at the foot of a page with
   * the drawing overleaf reads as a figure that is missing.
   */
  const drawHeading = async (following: number) => {
    const needed = Math.min(following, BOTTOM - TOP - LINE_HEIGHT * 3);
    if (!heading) {
      writer.ensure(needed, questionId);
      return;
    }
    writer.ensure(LINE_HEIGHT * 2 + 10 + needed, questionId);
    writer.gap(6);
    await writer.write(heading, { font: "bold", questionId, x: BODY_X, width: BODY_WIDTH });
    writer.gap(4);
  };

  if (asset.storagePath) {
    const bytes = await loadImage(asset.storagePath).catch(() => null);
    if (bytes) {
      const aspect = asset.width && asset.height ? asset.height / asset.width : 0.75;
      const box = fitFigure(aspect);
      await drawHeading(box.height + 8);
      writer.ensure(box.height + 8, questionId);
      writer.doc.image(bytes, box.x, writer.y, { width: box.width, height: box.height });
      writer.y += box.height + 8;
      return;
    }
  }

  const content = asset.content ?? "";
  if (looksLikeSvg(content)) {
    const drawn = sanitizeSvgDiagram(content);
    if (drawn.ok) {
      const box = fitFigure(svgAspect(drawn.svg), DIAGRAM_MAX_WIDTH, DIAGRAM_MAX_HEIGHT);
      await drawHeading(box.height + 8);
      writer.ensure(box.height + 8, questionId);
      SVGtoPDF(writer.doc, drawn.svg, box.x, writer.y, { width: box.width, height: box.height, preserveAspectRatio: "xMidYMid meet" });
      writer.y += box.height + 8;
      return;
    }
  }
  if (asset.type === "table") {
    const rows = parseMarkdownTableRows(content);
    if (rows.length) {
      await drawHeading(Math.min(rows.length, 4) * 22);
      await drawTable(writer, rows, questionId);
      writer.gap(8);
      return;
    }
  }
  if (asset.type === "graph") {
    const points = parseGraphPoints(content);
    if (points.length >= 2) {
      await drawHeading(204);
      drawGraph(writer, points, questionId);
      return;
    }
  }

  // Anything else -- a formula sheet, a source extract, a figure described in
  // words -- is set in a ruled box, the way a paper prints an insert.
  const text = content.trim() || asset.altText?.trim();
  if (!text) return;
  const lines = await writer.layout(text, BODY_WIDTH - 24);
  const height = lines.reduce((sum, line) => sum + line.ascent + line.descent, 0) + 20;
  await drawHeading(Math.min(height, 120));
  if (height < BOTTOM - TOP) writer.ensure(height, questionId);
  const top = writer.y;
  writer.y += 10;
  await writer.write(text, { x: BODY_X + 12, width: BODY_WIDTH - 24, questionId });
  writer.doc.save().lineWidth(0.7).strokeColor("#111111").rect(BODY_X, top, BODY_WIDTH, Math.min(writer.y + 10 - top, BOTTOM - top)).stroke().restore();
  writer.y += 18;
}

function drawDottedLine(writer: BookletWriter, y: number) {
  writer.doc.save().lineWidth(0.6).dash(1, { space: 2.2 }).strokeColor("#444444")
    .moveTo(BODY_X, y).lineTo(RIGHT, y).stroke().undash().restore();
}

/** Ruled lines, or blank working space for maths, carried on to the next page when needed. */
function drawAnswerSpace(writer: BookletWriter, question: PracticePaperQuestion, group: PaperSubjectGroup) {
  const kind = inferPaperQuestionKind(question);
  const space = answerSpacePoints(question, group);
  const { doc } = writer;

  if (kind === "choice" || kind === "draw") {
    writer.ensure(space, question.id);
    writer.gap(space);
    return;
  }

  const wantsAnswerLine = group === "maths" || kind === "calculation";
  if (group === "maths") {
    let remaining = space - 34;
    while (remaining > 0) {
      if (BOTTOM - writer.y < 48) writer.newPage();
      writer.mark(question.id);
      const chunk = Math.min(remaining, BOTTOM - writer.y - 34);
      writer.y += chunk;
      remaining -= chunk;
    }
  } else {
    const lines = answerLineCount(space - (wantsAnswerLine ? 34 : 0));
    // A short answer keeps its lines together; one stray line overleaf reads as a second question.
    const block = lines * ANSWER_LINE_SPACING + (wantsAnswerLine ? 34 : 0);
    if (block <= 240) writer.ensure(block, question.id);
    for (let index = 0; index < lines; index += 1) {
      writer.ensure(ANSWER_LINE_SPACING, question.id);
      writer.y += ANSWER_LINE_SPACING;
      drawDottedLine(writer, writer.y);
    }
  }

  if (wantsAnswerLine) {
    writer.ensure(34, question.id);
    writer.y += 22;
    doc.font("body").fontSize(BODY_SIZE).fillColor("#111111");
    doc.text("Answer", RIGHT - 250, writer.y - BODY_SIZE * ASCENT, { lineBreak: false });
    doc.save().lineWidth(0.6).strokeColor("#111111").moveTo(RIGHT - 200, writer.y + 2).lineTo(RIGHT, writer.y + 2).stroke().restore();
    writer.y += 12;
  }
}

async function drawQuestion(
  writer: BookletWriter,
  question: PracticePaperQuestion,
  group: PaperSubjectGroup,
  loadImage: (storagePath: string) => Promise<Buffer | null>
) {
  const { doc } = writer;
  // A question never starts at the foot of a page with its opening line alone.
  // With a figure, room for some of it too, so the opening line is not stranded above a figure overleaf.
  writer.ensure(LINE_HEIGHT * 4 + (question.assets.length ? 150 : 0), question.id);
  const labelY = writer.y;
  doc.font("bold").fontSize(BODY_SIZE).fillColor("#111111");
  const label = question.label.replace(/^question\s+/i, "").trim() || question.label;
  doc.text(label, LEFT, labelY, { width: BODY_X - LEFT - 6, lineBreak: false });
  await writer.write(question.prompt, { questionId: question.id });

  for (const asset of question.assets) await drawAsset(writer, asset, question.id, loadImage);

  writer.ensure(LINE_HEIGHT + 4, question.id);
  writer.gap(4);
  const tariff = `[${question.marks} ${question.marks === 1 ? "mark" : "marks"}]`;
  doc.font("bold").fontSize(BODY_SIZE).text(tariff, BODY_X, writer.y, { width: BODY_WIDTH, align: "right", lineBreak: false });
  writer.y += LINE_HEIGHT;

  drawAnswerSpace(writer, question, group);
  writer.gap(26);
}

async function drawCompanionDocuments(writer: BookletWriter, input: PracticePaperPdfInput) {
  for (const document of input.companionDocuments ?? []) {
    writer.newPage();
    await writer.write(document.title, { x: LEFT, width: RIGHT - LEFT, font: "bold", size: 16 });
    if (document.instructions?.trim()) {
      writer.gap(6);
      await writer.write(document.instructions, { x: LEFT, width: RIGHT - LEFT, font: "italic" });
    }
    for (const page of document.pages) {
      writer.gap(16);
      if (page.title?.trim()) {
        await writer.write(page.title, { x: LEFT, width: RIGHT - LEFT, font: "bold" });
        writer.gap(6);
      }
      await writer.write(page.content, { x: LEFT, width: RIGHT - LEFT });
    }
  }
}

export async function renderPracticePaperPdf(
  input: PracticePaperPdfInput,
  options: { loadImage?: (storagePath: string) => Promise<Buffer | null> } = {}
): Promise<RenderedPracticePaperPdf> {
  const loadImage = options.loadImage ?? (async () => null);
  const writer = new BookletWriter(input.title);
  const group = paperSubjectGroup(input.assessmentProfile, input.title);

  await drawCover(writer, input);
  writer.newPage();

  let section: string | undefined;
  for (const question of input.questions) {
    if (question.section && question.section !== section) {
      section = question.section;
      writer.ensure(LINE_HEIGHT * 6);
      await writer.write(/^section\b/i.test(section) ? section : `Section ${section}`, { x: LEFT, width: RIGHT - LEFT, font: "bold", size: 13 });
      writer.gap(12);
    }
    await drawQuestion(writer, question, group, loadImage);
  }

  writer.ensure(LINE_HEIGHT * 2);
  writer.doc.font("bold").fontSize(BODY_SIZE).text("END OF QUESTIONS", LEFT, writer.y, { width: RIGHT - LEFT, align: "center", lineBreak: false });
  writer.y += LINE_HEIGHT;

  await drawCompanionDocuments(writer, input);

  const bytes = await writer.finish();
  return {
    bytes,
    pageCount: writer.pages.length,
    pages: writer.pages.map((ids, pageIndex) => ({ pageIndex, questionIds: [...ids] })),
  };
}
