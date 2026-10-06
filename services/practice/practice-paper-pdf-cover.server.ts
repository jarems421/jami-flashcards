import "server-only";

import {
  parsePaperQuestionNumber,
  printedDuration,
  type PaperHouseStyle,
} from "@/lib/practice/paper-house-style";
import type { PracticePaperPdfInput } from "@/services/practice/practice-paper-pdf.server";
import {
  BOTTOM,
  INK,
  PAGE_EDGE,
  PAGE_RIGHT,
  type BookletWriter,
} from "@/services/practice/practice-paper-pdf-writer.server";

/*
 * The front of the booklet, in the board's own layout: the candidate boxes,
 * the examiner's grid, the instructions and information, and the line saying
 * this is Jami's practice paper and not an official one.
 */

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

export async function drawCover(writer: BookletWriter, input: PracticePaperPdfInput, style: PaperHouseStyle) {
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
