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
  parseMarkdownTableRows,
  type PaperSubjectGroup,
} from "@/lib/practice/paper-pdf-layout";
import {
  paperHouseStyle,
  parsePaperQuestionNumber,
  printedDuration,
  printedEndOfPaper,
  printedQuestionNumber,
  printedQuestionTotal,
  printedSectionHeading,
  printedTariff,
  promptWithoutTariff,
  type PaperHouseStyle,
  type PaperQuestionNumber,
} from "@/lib/practice/paper-house-style";
import type {
  GeneratedPracticePaper,
  PracticePaperQuestion,
  PracticePaperQuestionAsset,
} from "@/lib/practice/practice-papers";
import { parseExamChart, renderExamChartSvg, type ExamChartSpec } from "@/lib/practice/exam-chart";
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
 * It is set in the house style of the paper's board -- the cover's candidate
 * boxes, the margins, where the marks go, how the answer lines are ruled -- so
 * sitting it feels like sitting the real thing. See `paper-house-style.ts`.
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

const PAGE_EDGE = 56;
const PAGE_RIGHT = PAPER_PAGE_WIDTH - PAGE_EDGE;
const TOP = 60;
const BOTTOM = PAPER_PAGE_HEIGHT - 72;
const FOOTER_Y = PAPER_PAGE_HEIGHT - 40;
const BODY_SIZE = 11;
const LINE_HEIGHT = 15;
/** Liberation Sans places its baseline this far below the top of a line, per point of size. */
const ASCENT = 0.905;
/** MathJax measures in ex; at an 11pt body an ex is half that. */
const EX = BODY_SIZE / 2;
const MATH_SCALE = 0.84;
const MATH_CONTAINER_WIDTH = 420;
const FIGURE_MAX_WIDTH = 380;
const FIGURE_MAX_HEIGHT = 300;
/** Drawn diagrams are line art; at photograph size their strokes print heavy. */
const DIAGRAM_MAX_WIDTH = 300;
const DIAGRAM_MAX_HEIGHT = 220;
const TICK_BOX = 10;
const INK = "#111111";

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
type Frame = {
  left: number;
  bodyX: number;
  right: number;
  bodyWidth: number;
  column?: { x: number; width: number };
};

function frameFor(style: PaperHouseStyle): Frame {
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

type PageKind = "cover" | "questions" | "insert";

class BookletWriter {
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

/* ------------------------------------------------------------------------ */
/* Page furniture: margins, page numbers, "Turn over".                        */
/* ------------------------------------------------------------------------ */

/** Vertical text reading bottom to top, centred on a point, as margins print it. */
function verticalLabel(doc: PDFKit.PDFDocument, text: string, centreX: number, centreY: number, size: number, length: number, backing?: string) {
  doc.save();
  doc.rotate(-90, { origin: [centreX, centreY] });
  if (backing) doc.rect(centreX - length / 2, centreY - size * 0.8, length, size * 1.6).fill(backing);
  doc.font("bold").fontSize(size).fillColor("#555555")
    .text(text, centreX - length / 2, centreY - size * 0.45, { width: length, align: "center", lineBreak: false });
  doc.restore();
}

function drawMargin(writer: BookletWriter, style: PaperHouseStyle) {
  const { doc, frame } = writer;
  const column = frame.column;
  if ((style.margin === "box" || style.margin === "examiner-column") && column) {
    const heading = style.margin === "box" ? "Do not write outside the box" : "Examiner only";
    doc.font("body").fontSize(6.5).fillColor(INK)
      .text(heading, column.x - 6, TOP - 30, { width: column.width + 12, align: "center" });
    doc.lineWidth(0.8).strokeColor(INK).rect(column.x, TOP - 6, column.width, BOTTOM - TOP + 16).stroke();
    return;
  }
  if (style.margin === "marks-column" && column) {
    const marksWidth = 30;
    const top = TOP - 12;
    doc.lineWidth(0.6).strokeColor(INK);
    for (const x of [column.x, column.x + marksWidth, column.x + column.width]) {
      doc.moveTo(x, top).lineTo(x, BOTTOM + 8).stroke();
    }
    doc.font("bold").fontSize(6.5).fillColor(INK).text("MARKS", column.x, top - 10, { width: marksWidth, align: "center", lineBreak: false });
    const outer = column.x + marksWidth + (column.width - marksWidth) / 2;
    verticalLabel(doc, "DO NOT WRITE IN THIS MARGIN", outer, (top + BOTTOM) / 2, 6, 160);
    return;
  }
  if (style.margin === "hatched") {
    const width = 22;
    const top = 44;
    const height = PAPER_PAGE_HEIGHT - 96;
    for (const x of [16, PAPER_PAGE_WIDTH - 16 - width]) {
      doc.save();
      doc.rect(x, top, width, height).clip();
      doc.lineWidth(0.5).strokeColor("#cfcfcf");
      for (let offset = -width; offset < height + width; offset += 5) {
        doc.moveTo(x, top + offset + width).lineTo(x + width, top + offset).stroke();
      }
      doc.restore();
      for (const share of [0.18, 0.5, 0.82]) {
        verticalLabel(doc, "DO NOT WRITE IN THIS AREA", x + width / 2, top + height * share, 6, 112, "#ffffff");
      }
    }
  }
}

function drawFurniture(writer: BookletWriter, style: PaperHouseStyle, pageIndex: number, kind: PageKind, pageCount: number) {
  const { doc } = writer;
  doc.save();
  // No board's paper code or copyright line: the foot says whose paper this is.
  doc.font("body").fontSize(7.5).fillColor("#666666").text("Jami practice paper", PAGE_EDGE, FOOTER_Y + 2, { lineBreak: false });
  if (kind !== "cover") {
    const number = String(pageIndex + 1);
    doc.font("body").fontSize(9).fillColor(INK);
    doc.text(number, 0, style.pageNumber === "top" ? 30 : FOOTER_Y, { width: PAPER_PAGE_WIDTH, align: "center", lineBreak: false });
  }
  if (kind === "questions") drawMargin(writer, style);
  if (pageIndex < pageCount - 1) {
    const arrow = style.turnOver.endsWith("►");
    const words = style.turnOver.replace(/\s*►$/, "");
    doc.font("bold").fontSize(9.5).fillColor(INK);
    const width = doc.widthOfString(words);
    const right = PAGE_RIGHT - (arrow ? 11 : 0);
    doc.text(words, right - width, FOOTER_Y, { lineBreak: false });
    if (arrow) {
      // Liberation Sans may not carry the pointer, so it is drawn.
      const midY = FOOTER_Y + 5;
      doc.moveTo(right + 4, midY - 4).lineTo(right + 11, midY).lineTo(right + 4, midY + 4).closePath().fill(INK);
    }
  }
  doc.restore();
  doc.font("body").fontSize(BODY_SIZE).fillColor(INK);
}

/* ------------------------------------------------------------------------ */
/* Covers.                                                                    */
/* ------------------------------------------------------------------------ */

type CoverFacts = {
  board: string;
  qualification: string;
  component: string;
  duration: string;
  total: number;
  /** Question numbers for an examiner's grid, with the marks each is worth. */
  questions: Array<{ number: string; marks: number }>;
};

function coverFacts(input: PracticePaperPdfInput): CoverFacts {
  const profile = input.assessmentProfile;
  const questions: CoverFacts["questions"] = [];
  for (const question of input.questions) {
    const number = parsePaperQuestionNumber(question.label);
    const key = number.base ?? number.label;
    const last = questions[questions.length - 1];
    if (last && last.number === key) last.marks += question.marks;
    else questions.push({ number: key, marks: question.marks });
  }
  const board = profile?.awardingBodyOrInstitution?.trim() ?? "";
  const qualification = profile?.qualificationOrModule?.trim() || input.title;
  // "CCEA GCSE English Language" under a "CCEA" line says the board twice.
  const withoutBoard = board && qualification.toLowerCase().startsWith(`${board.toLowerCase()} `)
    ? qualification.slice(board.length).trim()
    : qualification;
  return {
    board,
    qualification: withoutBoard,
    component: profile?.tierOrComponent?.trim() ?? "",
    duration: input.durationMinutes > 0 ? printedDuration(input.durationMinutes) : "",
    total: input.totalMarks,
    questions,
  };
}

function label(doc: PDFKit.PDFDocument, text: string, x: number, y: number, size = 8, font = "body") {
  doc.font(font).fontSize(size).fillColor(INK).text(text, x, y, { lineBreak: false });
}

/** A row of single-character boxes, as candidate and centre numbers are written. */
function characterBoxes(doc: PDFKit.PDFDocument, x: number, y: number, count: number, size = 17) {
  doc.save().lineWidth(0.8).strokeColor(INK);
  for (let index = 0; index < count; index += 1) doc.rect(x + index * size, y, size, size + 3).stroke();
  doc.restore();
  return count * size;
}

/** A labelled box to write in, with its label printed inside the top-left corner. */
function field(doc: PDFKit.PDFDocument, text: string, x: number, y: number, width: number, height = 28) {
  doc.save().lineWidth(0.8).strokeColor(INK).rect(x, y, width, height).stroke().restore();
  label(doc, text, x + 4, y + 3, 7);
}

/** A labelled line to write on. */
function lineField(doc: PDFKit.PDFDocument, text: string, x: number, y: number, width: number) {
  label(doc, text, x, y + 6, 9);
  const start = x + doc.font("body").fontSize(9).widthOfString(text) + 8;
  doc.save().lineWidth(0.6).strokeColor(INK).moveTo(start, y + 16).lineTo(x + width, y + 16).stroke().restore();
}

async function bulletList(writer: BookletWriter, heading: string, lines: string[], x: number, width: number) {
  if (!lines.length) return;
  await writer.write(heading, { x, width, font: "bold", size: 11 });
  writer.gap(4);
  for (const line of lines) {
    // A hanging indent: a wrapped line starts under the text, not under the bullet.
    const top = writer.y;
    await writer.write(line, { x: x + 16, width: width - 16, size: 10 });
    writer.doc.font("body").fontSize(10).fillColor(INK).text("•", x + 5, top, { lineBreak: false });
    writer.gap(2);
  }
  writer.gap(12);
}

/** The grid an examiner fills in, one row a question, merged into ranges when a paper has many. */
function examinerGrid(
  doc: PDFKit.PDFDocument,
  facts: CoverFacts,
  x: number,
  y: number,
  width: number,
  withMaximum: boolean
) {
  const rowHeight = 17;
  const maxRows = 14;
  const perRow = Math.max(1, Math.ceil(facts.questions.length / maxRows));
  const rows: Array<{ number: string; marks: number }> = [];
  for (let index = 0; index < facts.questions.length; index += perRow) {
    const chunk = facts.questions.slice(index, index + perRow);
    const first = chunk[0].number;
    const last = chunk[chunk.length - 1].number;
    rows.push({ number: first === last ? first : `${first}–${last}`, marks: chunk.reduce((sum, item) => sum + item.marks, 0) });
  }
  const columns = withMaximum ? [0.3, 0.35, 0.35] : [0.5, 0.5];
  const headers = withMaximum ? ["Question", "Maximum Mark", "Mark Awarded"] : ["Question", "Mark"];
  doc.save().lineWidth(0.7).strokeColor(INK);
  doc.rect(x, y, width, rowHeight).fillAndStroke("#e6e6e6", INK);
  doc.font("bold").fontSize(8).fillColor(INK)
    .text(withMaximum ? "For Examiner's use only" : "For Examiner's Use", x, y + 5, { width, align: "center", lineBreak: false });
  let top = y + rowHeight;
  const cells = (values: string[], bold: boolean) => {
    let left = x;
    values.forEach((value, index) => {
      const cellWidth = width * columns[index];
      doc.rect(left, top, cellWidth, rowHeight).stroke();
      doc.font(bold ? "bold" : "body").fontSize(8).fillColor(INK)
        .text(value, left, top + 5, { width: cellWidth, align: "center", lineBreak: false });
      left += cellWidth;
    });
    top += rowHeight;
  };
  cells(headers, true);
  for (const row of rows) cells(withMaximum ? [row.number, String(row.marks), ""] : [row.number, ""], false);
  cells(withMaximum ? ["Total", String(facts.total), ""] : ["TOTAL", ""], true);
  doc.restore();
  return top;
}

function informationLines(style: PaperHouseStyle, input: PracticePaperPdfInput) {
  const total = input.totalMarks;
  const base: Record<PaperHouseStyle["id"], string[]> = {
    aqa: ["The marks for questions are shown in brackets.", `The maximum mark for this paper is ${total}.`],
    pearson: [
      `The total mark for this paper is ${total}.`,
      "The marks for each question are shown in brackets – use this as a guide as to how much time to spend on each question.",
    ],
    ocr: [`The total mark for this paper is ${total}.`, "The marks for each question are shown in brackets [ ]."],
    sqa: [],
    wjec: [`The total mark for this paper is ${total}.`, "The number of marks is given in brackets at the end of each question or part-question."],
    ccea: [`The total mark for this paper is ${total}.`, "Figures in brackets printed at the end of each question indicate the marks awarded to each question or part question."],
    cambridge: [`The total mark for this paper is ${total}.`, "The number of marks for each question or part question is shown in brackets [ ]."],
    generic: [`Total marks: ${total}`, "The marks for each question are shown in brackets."],
  };
  return [
    ...base[style.id],
    ...input.choiceGroups.map((group) => group.label).filter(Boolean),
    ...(input.companionDocuments?.length
      ? [`You will need: ${input.companionDocuments.map((document) => document.title).join(", ")} (at the back of this booklet).`]
      : []),
  ];
}

const DISCLAIMER = "This is a practice paper written by Jami for revision. It is not an official examination paper.";

async function drawDisclaimer(writer: BookletWriter) {
  writer.y = BOTTOM - 22;
  await writer.write(DISCLAIMER, { x: PAGE_EDGE, width: PAGE_RIGHT - PAGE_EDGE, font: "italic", size: 8.5 });
}

async function drawCover(writer: BookletWriter, input: PracticePaperPdfInput, style: PaperHouseStyle) {
  const { doc } = writer;
  const facts = coverFacts(input);
  const width = PAGE_RIGHT - PAGE_EDGE;
  const instructions = input.instructions;
  const information = informationLines(style, input);

  switch (style.cover) {
    case "aqa": {
      label(doc, "Please write clearly in block capitals.", PAGE_EDGE, 40, 9);
      label(doc, "Centre number", PAGE_EDGE, 62, 9);
      characterBoxes(doc, PAGE_EDGE + 74, 56, 5);
      label(doc, "Candidate number", PAGE_EDGE + 200, 62, 9);
      characterBoxes(doc, PAGE_EDGE + 290, 56, 4);
      for (const [index, text] of ["Surname", "Forename(s)", "Candidate signature"].entries()) {
        const y = 88 + index * 26;
        label(doc, text, PAGE_EDGE, y + 6, 9);
        doc.save().lineWidth(0.8).strokeColor(INK).rect(PAGE_EDGE + 100, y, width - 100, 21).stroke().restore();
      }
      label(doc, "I declare this is my own work.", PAGE_EDGE + 100, 169, 7);
      writer.y = 196;
      await writer.write(facts.qualification.toUpperCase(), { x: PAGE_EDGE, width, font: "bold", size: 22 });
      if (facts.component) await writer.write(facts.component, { x: PAGE_EDGE, width, font: "bold", size: 14 });
      writer.gap(6);
      const factsY = writer.y;
      label(doc, "Practice paper", PAGE_EDGE, factsY, 10);
      if (facts.duration) {
        doc.font("bold").fontSize(10).text(`Time allowed: ${facts.duration}`, PAGE_EDGE, factsY, { width, align: "right", lineBreak: false });
      }
      writer.y = factsY + 18;
      doc.save().lineWidth(1.2).strokeColor(INK).moveTo(PAGE_EDGE, writer.y).lineTo(PAGE_RIGHT, writer.y).stroke().restore();
      writer.gap(16);
      const gridX = PAGE_RIGHT - 150;
      const gridBottom = examinerGrid(doc, facts, gridX, writer.y, 150, false);
      const textWidth = gridX - PAGE_EDGE - 18;
      await bulletList(writer, "Instructions", instructions, PAGE_EDGE, textWidth);
      await bulletList(writer, "Information", information, PAGE_EDGE, textWidth);
      writer.y = Math.max(writer.y, gridBottom + 12);
      break;
    }
    case "pearson": {
      doc.save().lineWidth(0.8).strokeColor(INK).roundedRect(PAGE_EDGE, 34, width, 104, 6).stroke().restore();
      label(doc, "Please check the examination details below before entering your candidate information", PAGE_EDGE + 8, 42, 8);
      field(doc, "Candidate surname", PAGE_EDGE + 8, 56, width / 2 - 12, 34);
      field(doc, "Other names", PAGE_EDGE + width / 2 + 4, 56, width / 2 - 12, 34);
      label(doc, "Centre Number", PAGE_EDGE + 8, 106, 8, "bold");
      characterBoxes(doc, PAGE_EDGE + 76, 100, 5);
      label(doc, "Candidate Number", PAGE_EDGE + 200, 106, 8, "bold");
      characterBoxes(doc, PAGE_EDGE + 286, 100, 4);
      writer.y = 156;
      if (facts.board) await writer.write(facts.board, { x: PAGE_EDGE, width, font: "bold", size: 13 });
      writer.gap(4);
      const rowY = writer.y;
      doc.save().lineWidth(0.8).strokeColor(INK).rect(PAGE_EDGE, rowY, width, 24).stroke().restore();
      doc.font("body").fontSize(10).fillColor(INK);
      if (facts.duration) doc.text(`Time ${facts.duration}`, PAGE_EDGE + 8, rowY + 7, { lineBreak: false });
      doc.text("Practice paper", PAGE_EDGE, rowY + 7, { width: width - 8, align: "right", lineBreak: false });
      writer.y = rowY + 40;
      await writer.write(facts.qualification, { x: PAGE_EDGE, width, font: "bold", size: 24 });
      if (facts.component) await writer.write(facts.component, { x: PAGE_EDGE, width, font: "bold", size: 15 });
      writer.gap(14);
      const boxY = writer.y;
      doc.save().lineWidth(0.8).strokeColor(INK).rect(PAGE_RIGHT - 96, boxY, 96, 44).stroke().restore();
      label(doc, "Total Marks", PAGE_RIGHT - 92, boxY + 4, 8, "bold");
      writer.y = boxY + 58;
      await bulletList(writer, "Instructions", instructions, PAGE_EDGE, width);
      await bulletList(writer, "Information", information, PAGE_EDGE, width);
      await bulletList(writer, "Advice", [
        "Read each question carefully before you start to answer it.",
        "Try to answer every question.",
        "Check your answers if you have time at the end.",
      ], PAGE_EDGE, width);
      break;
    }
    case "ocr":
    case "cambridge": {
      writer.y = 40;
      await writer.write(facts.qualification, { x: PAGE_EDGE, width, font: "bold", size: 20 });
      if (facts.component) await writer.write(facts.component, { x: PAGE_EDGE, width, font: "bold", size: 13 });
      writer.gap(4);
      if (facts.duration) {
        await writer.write(style.cover === "ocr" ? `Time allowed: ${facts.duration}` : facts.duration, { x: PAGE_EDGE, width, font: "bold", size: 10 });
      }
      writer.gap(14);
      const boxY = writer.y;
      if (style.cover === "ocr") {
        doc.save().lineWidth(0.8).strokeColor(INK).rect(PAGE_EDGE, boxY, width, 104).stroke().restore();
        label(doc, "Please write clearly in black ink.", PAGE_EDGE + 8, boxY + 8, 9, "bold");
        label(doc, "Centre number", PAGE_EDGE + 8, boxY + 30, 9);
        characterBoxes(doc, PAGE_EDGE + 84, boxY + 24, 5);
        label(doc, "Candidate number", PAGE_EDGE + 210, boxY + 30, 9);
        characterBoxes(doc, PAGE_EDGE + 300, boxY + 24, 4);
        lineField(doc, "First name(s)", PAGE_EDGE + 8, boxY + 52, width - 16);
        lineField(doc, "Last name", PAGE_EDGE + 8, boxY + 76, width - 16);
        writer.y = boxY + 122;
      } else {
        lineField(doc, "CANDIDATE NAME", PAGE_EDGE, boxY, width);
        label(doc, "CENTRE NUMBER", PAGE_EDGE, boxY + 36, 9);
        characterBoxes(doc, PAGE_EDGE + 96, boxY + 30, 5);
        label(doc, "CANDIDATE NUMBER", PAGE_EDGE + 218, boxY + 36, 9);
        characterBoxes(doc, PAGE_EDGE + 326, boxY + 30, 4);
        writer.y = boxY + 68;
        await writer.write("You must answer on the question paper.", { x: PAGE_EDGE, width, size: 10 });
        writer.gap(12);
      }
      await bulletList(writer, "INSTRUCTIONS", instructions, PAGE_EDGE, width);
      await bulletList(writer, "INFORMATION", information, PAGE_EDGE, width);
      if (style.cover === "ocr") {
        await bulletList(writer, "ADVICE", ["Read each question carefully before you start your answer."], PAGE_EDGE, width);
      }
      break;
    }
    case "sqa": {
      writer.y = 40;
      await writer.write(facts.qualification, { x: PAGE_EDGE, width, font: "bold", size: 20 });
      if (facts.component) await writer.write(facts.component, { x: PAGE_EDGE, width, font: "bold", size: 13 });
      writer.gap(4);
      if (facts.duration) await writer.write(`Duration — ${facts.duration}`, { x: PAGE_EDGE, width, size: 10 });
      writer.gap(16);
      label(doc, "Fill in these boxes and read what is printed below.", PAGE_EDGE, writer.y, 9, "bold");
      const gridY = writer.y + 16;
      field(doc, "Full name of centre", PAGE_EDGE, gridY, width * 0.62, 30);
      field(doc, "Town", PAGE_EDGE + width * 0.64, gridY, width * 0.36, 30);
      field(doc, "Forename(s)", PAGE_EDGE, gridY + 38, width * 0.4, 30);
      field(doc, "Surname", PAGE_EDGE + width * 0.42, gridY + 38, width * 0.4, 30);
      field(doc, "Number of seat", PAGE_EDGE + width * 0.84, gridY + 38, width * 0.16, 30);
      label(doc, "Date of birth", PAGE_EDGE, gridY + 80, 8);
      let x = PAGE_EDGE;
      for (const part of ["Day", "Month", "Year"]) {
        label(doc, part, x, gridY + 92, 7);
        x += characterBoxes(doc, x, gridY + 102, 2, 15) + 10;
      }
      label(doc, "Scottish candidate number", PAGE_EDGE + 170, gridY + 92, 7);
      characterBoxes(doc, PAGE_EDGE + 170, gridY + 102, 9, 15);
      writer.y = gridY + 140;
      await writer.write(`Total marks — ${facts.total}`, { x: PAGE_EDGE, width, font: "bold", size: 12 });
      writer.gap(12);
      for (const line of [...instructions, ...information]) {
        await writer.write(line, { x: PAGE_EDGE, width, size: 10.5 });
        writer.gap(8);
      }
      break;
    }
    case "wjec": {
      field(doc, "Surname", PAGE_EDGE, 36, width * 0.49, 30);
      field(doc, "Other Names", PAGE_EDGE + width * 0.51, 36, width * 0.49, 30);
      label(doc, "Centre Number", PAGE_EDGE, 84, 9);
      characterBoxes(doc, PAGE_EDGE + 80, 78, 5);
      label(doc, "Candidate Number", PAGE_EDGE + 200, 84, 9);
      characterBoxes(doc, PAGE_EDGE + 294, 78, 4);
      writer.y = 120;
      if (facts.board) await writer.write(facts.board, { x: PAGE_EDGE, width, font: "bold", size: 12 });
      await writer.write(facts.qualification, { x: PAGE_EDGE, width, font: "bold", size: 20 });
      if (facts.component) await writer.write(facts.component, { x: PAGE_EDGE, width, font: "bold", size: 13 });
      if (facts.duration) await writer.write(facts.duration.toUpperCase(), { x: PAGE_EDGE, width, font: "bold", size: 10 });
      writer.gap(16);
      const gridX = PAGE_RIGHT - 190;
      const gridBottom = examinerGrid(doc, facts, gridX, writer.y, 190, true);
      const textWidth = gridX - PAGE_EDGE - 18;
      await bulletList(writer, "INSTRUCTIONS TO CANDIDATES", instructions, PAGE_EDGE, textWidth);
      await bulletList(writer, "INFORMATION FOR CANDIDATES", information, PAGE_EDGE, textWidth);
      writer.y = Math.max(writer.y, gridBottom + 12);
      break;
    }
    default: {
      writer.y = 64;
      const course = [facts.board, facts.qualification].filter(Boolean).join(" · ");
      if (course) {
        await writer.write(course, { x: PAGE_EDGE, width, font: "bold", size: 12 });
        writer.gap(8);
      }
      await writer.write(input.title, { x: PAGE_EDGE, width, font: "bold", size: 20 });
      if (facts.component) {
        writer.gap(4);
        await writer.write(facts.component, { x: PAGE_EDGE, width, size: 12 });
      }
      writer.gap(18);
      lineField(doc, "Name", PAGE_EDGE, writer.y, width);
      writer.gap(34);
      const lines = [facts.duration ? `Time allowed: ${facts.duration}` : "", `Total marks: ${facts.total}`].filter(Boolean);
      doc.save().lineWidth(0.8).strokeColor(INK).rect(PAGE_EDGE, writer.y, width, 20 + lines.length * 16).stroke().restore();
      writer.y += 10;
      for (const line of lines) await writer.write(line, { x: PAGE_EDGE + 12, width: width - 24, font: "bold" });
      writer.gap(24);
      await bulletList(writer, "Instructions", instructions, PAGE_EDGE, width);
      await bulletList(writer, "Information", information.filter((line) => !line.startsWith("Total marks")), PAGE_EDGE, width);
    }
  }
  await drawDisclaimer(writer);
}

/* ------------------------------------------------------------------------ */
/* Figures, tables and graphs.                                                */
/* ------------------------------------------------------------------------ */

function svgAspect(svg: string) {
  const viewBox = svg.match(/viewBox\s*=\s*"([^"]+)"/i)?.[1].trim().split(/[\s,]+/).map(Number);
  if (viewBox && viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) return viewBox[3] / viewBox[2];
  const width = Number(svg.match(/\bwidth\s*=\s*"([\d.]+)/i)?.[1]);
  const height = Number(svg.match(/\bheight\s*=\s*"([\d.]+)/i)?.[1]);
  return width > 0 && height > 0 ? height / width : 0.6;
}

function fitFigure(frame: Frame, aspect: number, maxWidth = FIGURE_MAX_WIDTH, maxHeight = FIGURE_MAX_HEIGHT) {
  let width = Math.min(maxWidth, frame.bodyWidth);
  let height = width * aspect;
  if (height > maxHeight) {
    height = maxHeight;
    width = height / aspect;
  }
  return { width, height, x: frame.bodyX + (frame.bodyWidth - width) / 2 };
}

async function drawTable(writer: BookletWriter, rows: string[][], questionId: string) {
  const { doc, frame } = writer;
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
  const scale = naturalWidth > frame.bodyWidth ? frame.bodyWidth / naturalWidth : 1;
  const widths = natural.map((value) => Math.max(48, value * scale));
  const width = widths.reduce((sum, value) => sum + value, 0);
  const x = frame.bodyX + Math.max(0, (frame.bodyWidth - width) / 2);
  const offsets = widths.map((_, column) => widths.slice(0, column).reduce((sum, value) => sum + value, 0));
  for (const [rowIndex, row] of rows.entries()) {
    doc.font(rowIndex === 0 ? "bold" : "body").fontSize(10);
    const height = Math.max(22, ...row.map((cell, column) => doc.heightOfString(cell, { width: (widths[column] ?? 60) - 10 }) + 10));
    writer.ensure(height, questionId);
    doc.save().lineWidth(0.7).strokeColor(INK);
    for (let column = 0; column < columns; column += 1) {
      const cellWidth = widths[column] ?? 60;
      doc.rect(x + offsets[column], writer.y, cellWidth, height).stroke();
      const cell = row[column] ?? "";
      doc.font(rowIndex === 0 ? "bold" : "body").fontSize(10).fillColor(INK)
        .text(cell, x + offsets[column] + 5, writer.y + 5, { width: cellWidth - 10, align: "center" });
    }
    doc.restore();
    writer.y += height;
  }
  doc.font("body").fontSize(BODY_SIZE);
}

/**
 * A graph, drawn from its stated data by the same code the app uses, so the
 * printed scale and the on-screen one are the same scale.
 */
function drawChart(writer: BookletWriter, chart: ExamChartSpec, questionId: string) {
  const { frame } = writer;
  const svg = renderExamChartSvg(chart);
  const width = Math.min(400, frame.bodyWidth);
  const height = width * (340 / 480);
  writer.ensure(height + 10, questionId);
  const x = frame.bodyX + (frame.bodyWidth - width) / 2;
  SVGtoPDF(writer.doc, svg, x, writer.y, { width, height, preserveAspectRatio: "xMidYMid meet" });
  writer.doc.font("body").fontSize(BODY_SIZE).fillColor(INK);
  writer.y += height + 10;
}

async function drawAsset(
  writer: BookletWriter,
  asset: PracticePaperQuestionAsset,
  questionId: string,
  loadImage: (storagePath: string) => Promise<Buffer | null>
) {
  const { frame } = writer;
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
    await writer.write(heading, { font: "bold", questionId, x: frame.bodyX, width: frame.bodyWidth });
    writer.gap(4);
  };

  if (asset.storagePath) {
    const bytes = await loadImage(asset.storagePath).catch(() => null);
    if (bytes) {
      const aspect = asset.width && asset.height ? asset.height / asset.width : 0.75;
      const box = fitFigure(frame, aspect);
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
      const box = fitFigure(frame, svgAspect(drawn.svg), DIAGRAM_MAX_WIDTH, DIAGRAM_MAX_HEIGHT);
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
    const chart = parseExamChart(content);
    if (chart) {
      await drawHeading(Math.min(400, frame.bodyWidth) * (340 / 480) + 10);
      drawChart(writer, chart, questionId);
      return;
    }
  }

  // Anything else -- a formula sheet, a source extract, a figure described in
  // words -- is set in a ruled box, the way a paper prints an insert.
  const text = content.trim() || asset.altText?.trim();
  if (!text) return;
  const lines = await writer.layout(text, frame.bodyWidth - 24);
  const height = lines.reduce((sum, line) => sum + line.ascent + line.descent, 0) + 20;
  await drawHeading(Math.min(height, 120));
  if (height < BOTTOM - TOP) writer.ensure(height, questionId);
  const top = writer.y;
  writer.y += 10;
  await writer.write(text, { x: frame.bodyX + 12, width: frame.bodyWidth - 24, questionId });
  writer.doc.save().lineWidth(0.7).strokeColor(INK).rect(frame.bodyX, top, frame.bodyWidth, Math.min(writer.y + 10 - top, BOTTOM - top)).stroke().restore();
  writer.y += 18;
}

/* ------------------------------------------------------------------------ */
/* Questions.                                                                 */
/* ------------------------------------------------------------------------ */

type QuestionContext = {
  style: PaperHouseStyle;
  group: PaperSubjectGroup;
  number: PaperQuestionNumber;
  firstOfQuestion: boolean;
  lastOfQuestion: boolean;
  /** Every part of the question together, for a total printed after its last part. */
  questionMarks: number;
  singlePart: boolean;
  loadImage: (storagePath: string) => Promise<Buffer | null>;
};

function drawRule(writer: BookletWriter, style: PaperHouseStyle, y: number, from: number, to: number) {
  const { doc } = writer;
  doc.save();
  if (style.answerLines === "dotted") doc.lineWidth(0.6).dash(1, { space: 2.2 }).strokeColor("#444444");
  else doc.lineWidth(0.6).strokeColor("#8c8c8c");
  doc.moveTo(from, y).lineTo(to, y).stroke();
  doc.undash().restore();
}

/** The number beside a question: in AQA's digit boxes, or in bold, shrunk to fit its gutter. */
function drawQuestionNumber(writer: BookletWriter, style: PaperHouseStyle, printed: string, y: number) {
  const { doc, frame } = writer;
  const gutter = frame.bodyX - frame.left - 6;
  const boxed = style.boxedNumbers ? printed.match(/^(\d{2})(?:\.(\d{1,2}))?(?:\s+(.+))?$/) : null;
  if (boxed) {
    const size = 12.5;
    let x = frame.left;
    doc.save().lineWidth(0.7).strokeColor(INK);
    const digits = (value: string) => {
      for (const digit of value) {
        doc.rect(x, y - 2.5, size, 15).stroke();
        doc.font("bold").fontSize(10).fillColor(INK).text(digit, x, y, { width: size, align: "center", lineBreak: false });
        x += size;
      }
    };
    digits(boxed[1]);
    if (boxed[2]) {
      doc.font("bold").fontSize(10).text(".", x + 1.5, y, { lineBreak: false });
      x += 6;
      digits(boxed[2]);
    }
    if (boxed[3]) doc.font("bold").fontSize(10).text(boxed[3], x + 3, y, { lineBreak: false });
    doc.restore();
    doc.font("body").fontSize(BODY_SIZE);
    return;
  }
  let size = BODY_SIZE;
  doc.font("bold");
  while (size > 8 && doc.fontSize(size).widthOfString(printed) > gutter) size -= 0.5;
  doc.fontSize(size).fillColor(INK).text(printed, frame.left, y + (BODY_SIZE - size) * 0.6, { lineBreak: false });
  doc.font("body").fontSize(BODY_SIZE);
}

/**
 * The line a final answer goes on, as the board prints it: AQA's "Answer ___",
 * Pearson's dotted line, OCR's "(c) ........ [3]" with the marks at its end.
 */
function drawAnswerLine(writer: BookletWriter, question: PracticePaperQuestion, context: QuestionContext) {
  const { doc, frame } = writer;
  const { style } = context;
  writer.ensure(34, question.id);
  writer.y += 22;
  const trailing = style.tariff === "bracketed-after" ? printedTariff(style, question.marks) : "";
  doc.font("bold").fontSize(BODY_SIZE);
  const lineRight = trailing ? frame.right - doc.widthOfString(trailing) - 6 : frame.right;
  const lineLeft = lineRight - 200;
  const textY = writer.y - BODY_SIZE * ASCENT;
  doc.font("body").fontSize(BODY_SIZE).fillColor(INK);
  if (style.id === "aqa" || style.id === "generic" || style.id === "wjec") {
    doc.text("Answer", lineLeft - 50, textY, { lineBreak: false });
  } else if (trailing && context.number.part && !context.number.numericPart) {
    const part = context.number.part;
    doc.text(part, lineLeft - doc.widthOfString(part) - 8, textY, { lineBreak: false });
  }
  if (style.answerLines === "solid") {
    doc.save().lineWidth(0.6).strokeColor(INK).moveTo(lineLeft, writer.y + 2).lineTo(lineRight, writer.y + 2).stroke().restore();
  } else {
    drawRule(writer, style, writer.y + 2, lineLeft, lineRight);
  }
  if (trailing) doc.font("bold").fontSize(BODY_SIZE).text(trailing, lineRight + 6, textY, { lineBreak: false });
  doc.font("body").fontSize(BODY_SIZE);
  writer.y += 12;
}

/** Ruled lines, or blank working space for maths, carried on to the next page when needed. */
function drawAnswerSpace(writer: BookletWriter, question: PracticePaperQuestion, context: QuestionContext) {
  const { style, group } = context;
  const { doc, frame } = writer;
  const kind = inferPaperQuestionKind(question);
  const space = answerSpacePoints(question, group);
  const marksAtEnd = style.tariff === "bracketed-after";

  if (kind === "choice" || kind === "draw") {
    writer.ensure(space, question.id);
    writer.gap(space);
    if (marksAtEnd) {
      writer.y -= LINE_HEIGHT;
      writer.rightAligned(printedTariff(style, question.marks), question.id);
    }
    return;
  }

  // SQA leaves working space unruled and prints no answer line; the marks sit in the margin.
  const wantsAnswerLine = style.id !== "sqa" && (group === "maths" || kind === "calculation");
  const blankWorking = group === "maths" || (style.id === "sqa" && kind === "calculation");
  if (blankWorking) {
    const reserve = wantsAnswerLine ? 34 : 0;
    let remaining = space - reserve;
    while (remaining > 0) {
      if (BOTTOM - writer.y < 48) writer.newPage();
      writer.mark(question.id);
      const chunk = Math.min(remaining, BOTTOM - writer.y - reserve);
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
      const last = index === lines - 1 && !wantsAnswerLine;
      if (last && marksAtEnd) {
        // OCR and Cambridge end the last line with the marks.
        const tariff = printedTariff(style, question.marks);
        doc.font("bold").fontSize(BODY_SIZE);
        const tariffWidth = doc.widthOfString(tariff);
        drawRule(writer, style, writer.y, frame.bodyX, frame.right - tariffWidth - 6);
        doc.fillColor(INK).text(tariff, frame.right - tariffWidth, writer.y - BODY_SIZE * ASCENT - 1, { lineBreak: false });
        doc.font("body");
      } else {
        drawRule(writer, style, writer.y, frame.bodyX, frame.right);
      }
    }
  }

  if (wantsAnswerLine) drawAnswerLine(writer, question, context);
}

async function drawQuestion(writer: BookletWriter, question: PracticePaperQuestion, context: QuestionContext) {
  const { doc, frame } = writer;
  const { style } = context;
  // A question never starts at the foot of a page with its opening line alone.
  // With a figure, room for the question and the whole of its first figure where
  // they fit on a page together, so the question is not stranded above a figure overleaf.
  const prompt = promptWithoutTariff(question.prompt, question.marks);
  const promptHeight = (await writer.layout(prompt, frame.right - frame.bodyX))
    .reduce((sum, line) => sum + line.ascent + line.descent, 0);
  const first = question.assets[0];
  const figureHeight = !first
    ? 0
    : first.type === "graph" && parseExamChart(first.content ?? "")
      ? Math.min(400, frame.bodyWidth) * (340 / 480) + 50
      : 150;
  const together = promptHeight + figureHeight + LINE_HEIGHT;
  writer.ensure(together <= BOTTOM - TOP ? together : LINE_HEIGHT * 4 + (first ? 150 : 0), question.id);
  drawQuestionNumber(writer, style, printedQuestionNumber(style, context.number, context.firstOfQuestion), writer.y);
  await writer.write(prompt, { questionId: question.id });

  if (style.tariff === "column" && frame.column) {
    // Level with the question's last line, in the margin's marks column.
    doc.font("bold").fontSize(BODY_SIZE).fillColor(INK)
      .text(printedTariff(style, question.marks), frame.column.x, writer.y - LINE_HEIGHT, { width: 30, align: "center", lineBreak: false });
    doc.font("body");
  }

  for (const asset of question.assets) await drawAsset(writer, asset, question.id, context.loadImage);

  // Pearson's maths prints a one-part question's marks only in its total.
  const onlyInTotal = style.questionTotals && context.group === "maths" && context.singlePart;
  const marksUnderQuestion = style.tariff === "words" || style.tariff === "parenthesised" || style.tariff === "bracketed-before";
  if (marksUnderQuestion && !onlyInTotal) {
    writer.gap(4);
    writer.rightAligned(printedTariff(style, question.marks), question.id);
  } else {
    writer.gap(6);
  }

  drawAnswerSpace(writer, question, context);

  if (style.questionTotals && context.lastOfQuestion && context.number.base) {
    writer.gap(10);
    writer.rightAligned(printedQuestionTotal(context.number.base, context.questionMarks, context.group === "maths"), question.id);
  }
  writer.gap(context.lastOfQuestion ? 26 : 18);
}

async function drawCompanionDocuments(writer: BookletWriter, input: PracticePaperPdfInput) {
  const width = PAGE_RIGHT - PAGE_EDGE;
  for (const document of input.companionDocuments ?? []) {
    writer.newPage("insert");
    await writer.write(document.title, { x: PAGE_EDGE, width, font: "bold", size: 16 });
    if (document.instructions?.trim()) {
      writer.gap(6);
      await writer.write(document.instructions, { x: PAGE_EDGE, width, font: "italic" });
    }
    for (const page of document.pages) {
      writer.gap(16);
      if (page.title?.trim()) {
        await writer.write(page.title, { x: PAGE_EDGE, width, font: "bold" });
        writer.gap(6);
      }
      await writer.write(page.content, { x: PAGE_EDGE, width });
    }
  }
}

/** Which questions belong together, so a part knows whether it opens or closes its question. */
function questionContexts(
  input: PracticePaperPdfInput,
  style: PaperHouseStyle,
  group: PaperSubjectGroup,
  loadImage: QuestionContext["loadImage"]
): QuestionContext[] {
  const numbers = input.questions.map((question) => parsePaperQuestionNumber(question.label));
  const sameQuestion = (left: number, right: number) =>
    numbers[left]?.base !== null && numbers[left]?.base !== undefined && numbers[left].base === numbers[right]?.base;
  return input.questions.map((_, index) => {
    let first = index;
    while (first > 0 && sameQuestion(first - 1, index)) first -= 1;
    let last = index;
    while (last < input.questions.length - 1 && sameQuestion(last + 1, index)) last += 1;
    const parts = input.questions.slice(first, last + 1);
    return {
      style,
      group,
      number: numbers[index],
      firstOfQuestion: first === index,
      lastOfQuestion: last === index,
      questionMarks: parts.reduce((sum, part) => sum + part.marks, 0),
      singlePart: parts.length === 1,
      loadImage,
    };
  });
}

export async function renderPracticePaperPdf(
  input: PracticePaperPdfInput,
  options: { loadImage?: (storagePath: string) => Promise<Buffer | null> } = {}
): Promise<RenderedPracticePaperPdf> {
  const loadImage = options.loadImage ?? (async () => null);
  const style = paperHouseStyle(input.assessmentProfile);
  const writer = new BookletWriter(input.title, frameFor(style));
  const group = paperSubjectGroup(input.assessmentProfile, input.title);

  await drawCover(writer, input, style);
  writer.newPage();

  if ((style.id === "pearson" || style.id === "ocr") && !input.choiceGroups.length && !input.questions[0]?.section) {
    await writer.write(
      style.id === "pearson" ? "Answer ALL questions. Write your answers in the spaces provided." : "Answer all the questions.",
      { x: writer.frame.left, width: writer.frame.right - writer.frame.left, font: "bold" }
    );
    writer.gap(14);
  }

  const contexts = questionContexts(input, style, group, loadImage);
  let section: string | undefined;
  for (const [index, question] of input.questions.entries()) {
    if (question.section && question.section !== section) {
      section = question.section;
      writer.ensure(LINE_HEIGHT * 6);
      await writer.write(printedSectionHeading(style, section), {
        x: writer.frame.left,
        width: writer.frame.right - writer.frame.left,
        font: "bold",
        size: 13,
      });
      writer.gap(12);
    }
    await drawQuestion(writer, question, contexts[index]);
  }

  writer.ensure(LINE_HEIGHT * 2);
  writer.gap(4);
  writer.doc.font("bold").fontSize(BODY_SIZE).fillColor(INK)
    .text(printedEndOfPaper(style, input.totalMarks), writer.frame.left, writer.y, {
      width: writer.frame.right - writer.frame.left,
      align: style.id === "pearson" ? "right" : "center",
      lineBreak: false,
    });
  writer.y += LINE_HEIGHT;

  await drawCompanionDocuments(writer, input);

  const bytes = await writer.finish((pageIndex, kind, pageCount) => drawFurniture(writer, style, pageIndex, kind, pageCount));
  return {
    bytes,
    pageCount: writer.pages.length,
    pages: writer.pages.map((ids, pageIndex) => ({ pageIndex, questionIds: [...ids] })),
  };
}
