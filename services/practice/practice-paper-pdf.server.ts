import "server-only";

import SVGtoPDF from "svg-to-pdfkit";
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
import { drawCover } from "@/services/practice/practice-paper-pdf-cover.server";
import {
  ASCENT,
  BODY_SIZE,
  BOTTOM,
  BookletWriter,
  DIAGRAM_MAX_HEIGHT,
  DIAGRAM_MAX_WIDTH,
  FIGURE_MAX_HEIGHT,
  FIGURE_MAX_WIDTH,
  FOOTER_Y,
  INK,
  LINE_HEIGHT,
  PAGE_EDGE,
  PAGE_RIGHT,
  TICK_BOX,
  TOP,
  frameFor,
  type Frame,
  type PageKind,
} from "@/services/practice/practice-paper-pdf-writer.server";

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
  SVGtoPDF(writer.doc, svg, x, writer.y, {
    width,
    height,
    preserveAspectRatio: "xMidYMid meet",
    // The booklet's own face, which has Ω, μ and the rest; the default Helvetica drops them.
    fontCallback: (_family: string, bold: boolean, italic: boolean) => (bold ? "bold" : italic ? "italic" : "body"),
  });
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
      SVGtoPDF(writer.doc, drawn.svg, box.x, writer.y, {
        width: box.width,
        height: box.height,
        preserveAspectRatio: "xMidYMid meet",
        // The booklet's own face, which has Ω, μ and the rest; the default Helvetica drops them.
        fontCallback: (_family: string, bold: boolean, italic: boolean) => (bold ? "bold" : italic ? "italic" : "body"),
      });
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

/**
 * A multiple-choice prompt's stem and its lettered options, or null when the
 * options are not written one to a line ("A  Speed", "B) Mass", "C. Time").
 * A box the writer typed itself is dropped, since the column of boxes replaces it.
 */
function splitChoiceOptions(prompt: string) {
  const lines = prompt.split("\n");
  const options: Array<{ letter: string; text: string }> = [];
  let first = lines.length;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!.replace(/[☐□]/g, "").trim();
    if (!line && options.length === 0) continue;
    const match = /^\(?([A-F])[).:]?\s+(.+)$/.exec(line);
    if (!match) break;
    options.unshift({ letter: match[1]!, text: match[2]!.trim() });
    first = index;
  }
  const inOrder = options.every((option, index) => option.letter === String.fromCharCode(65 + index));
  if (options.length < 2 || !inOrder) return null;
  return { stem: lines.slice(0, first).join("\n").trim(), options };
}

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
  const choice = inferPaperQuestionKind(question) === "choice" ? splitChoiceOptions(prompt) : null;
  if (choice) {
    // Options one to a line, each with its box in a column at the right, as the boards print them.
    await writer.write(choice.stem, { questionId: question.id });
    writer.gap(8);
    const textWidth = frame.right - frame.bodyX - 110;
    for (const option of choice.options) {
      const lines = await writer.layout(option.text, textWidth);
      const height = Math.max(TICK_BOX + 14, lines.reduce((sum, line) => sum + line.ascent + line.descent, 0) + 8);
      writer.ensure(height, question.id);
      const top = writer.y;
      doc.font("bold").fontSize(BODY_SIZE).fillColor(INK).text(option.letter, frame.bodyX, top + 2, { lineBreak: false });
      await writer.write(option.text, { x: frame.bodyX + 22, width: textWidth, questionId: question.id });
      doc.save().lineWidth(0.9).strokeColor(INK).rect(frame.right - 60, top, TICK_BOX + 6, TICK_BOX + 6).stroke().restore();
      writer.y = Math.max(writer.y, top + height);
    }
  } else {
    await writer.write(prompt, { questionId: question.id });
  }

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
