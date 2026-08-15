import type { MarkingCorpusRecord } from "@/lib/evaluation/marking-corpus";
import { parseCsvLine } from "./csv.ts";

/**
 * Parser for `handwritten-university-data-science`.
 *
 * A 50-student university data science exam: 20 MCQs at one mark and 15 short
 * answers at two, digitised as scanned scripts with a teacher-annotated copy of
 * each and an item-level mark for every question.
 *
 * Two deliberate exclusions.
 *
 * The MCQs are not ingested. An MCQ mark is a key lookup, not a marking
 * judgement — there is no method to credit, no partial credit to award and no
 * evidence to quote — so including 1,000 of them would trebly inflate the
 * corpus while testing nothing this system does. Worse, the recorded aggregate
 * MCQ scores cannot be reproduced by comparing the responses against the answer
 * key (see `mcqAggregateMismatches`), so they are not dependable ground truth
 * either.
 *
 * `Student_MCQ.csv` and `file.txt` are not read at all. Despite the dataset's
 * README stating that all personally identifiable information was anonymised,
 * both still carry real student names and institutional ID numbers. Only
 * `Teacher_manual_marks_Anonymized.csv` was actually cleaned, and it is the
 * only marks file this parser will touch.
 */

/**
 * Where a script lives. Either a whole file, or a page range inside a larger
 * one when the scripts arrived bundled into transport packs.
 */
export type ScriptLocation = {
  file: string;
  /** 1-based, inclusive. Absent means the whole file. */
  firstPage?: number;
  lastPage?: number;
};

/** A script location as a single string, using the PDF `#page=` fragment. */
export function scriptReference(location: ScriptLocation | string) {
  if (typeof location === "string") return location;
  const { file, firstPage, lastPage } = location;
  if (firstPage === undefined) return file;
  return lastPage === undefined || lastPage === firstPage
    ? `${file}#page=${firstPage}`
    : `${file}#page=${firstPage}-${lastPage}`;
}

export type HandwrittenUdsInput = {
  questionText: string;
  answerKeyText: string;
  marksCsv: string;
  /** Script locations by student id, if the PDFs are present. */
  scripts?: Record<string, { raw?: ScriptLocation | string; corrected?: ScriptLocation | string }>;
};

export type HandwrittenUdsResult = {
  records: MarkingCorpusRecord[];
  issues: string[];
  stats: {
    students: number;
    shortAnswerCells: number;
    ingested: number;
    uncorrected: number;
    outOfRange: number;
    misalignedRows: number;
  };
};

/** Values meaning "the teacher did not award a mark here". */
const NOT_MARKED = new Set(["", "nc", "nm", "-", "na", "n/a"]);

const SHORT_ANSWER_FIRST = 21;
const SHORT_ANSWER_LAST = 35;
const SHORT_ANSWER_MAX_MARKS = 2;

/** Q21..Q35 prompts, keyed by number, from the exam paper. */
export function parseQuestionPrompts(questionText: string) {
  const prompts = new Map<number, string>();
  const lines = questionText.split(/\r?\n/);
  let current: number | null = null;
  let buffer: string[] = [];
  const flush = () => {
    if (current !== null && buffer.length > 0) {
      prompts.set(current, buffer.join(" ").replace(/\s+/g, " ").trim());
    }
  };
  for (const line of lines) {
    const heading = /^(\d{1,2})\.\s*(.*)$/.exec(line.trim());
    if (heading) {
      flush();
      current = Number(heading[1]);
      buffer = heading[2] ? [heading[2]] : [];
      continue;
    }
    if (current !== null && line.trim()) buffer.push(line.trim());
  }
  flush();
  return prompts;
}

/** Reference answers for the short answers, from the answer key. */
export function parseAnswerKey(answerKeyText: string) {
  const references = new Map<number, string>();
  for (const line of answerKeyText.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const cells = parseCsvLine(line);
    const number = Number(cells[0]);
    if (!Number.isFinite(number) || cells[1] !== "Short_Answer") continue;
    references.set(number, cells[2] ?? "");
  }
  return references;
}

export function parseHandwrittenUds(input: HandwrittenUdsInput): HandwrittenUdsResult {
  const prompts = parseQuestionPrompts(input.questionText);
  const references = parseAnswerKey(input.answerKeyText);
  const issues: string[] = [];
  const records: MarkingCorpusRecord[] = [];

  const lines = input.marksCsv.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) {
    return {
      records,
      issues: ["Marks file is empty."],
      stats: { students: 0, shortAnswerCells: 0, ingested: 0, uncorrected: 0, outOfRange: 0, misalignedRows: 0 },
    };
  }

  const header = parseCsvLine(lines[0]);
  const columnFor = new Map<number, number>();
  header.forEach((name, index) => {
    const number = Number(name);
    if (Number.isFinite(number) && number >= 1 && number <= SHORT_ANSWER_LAST) {
      columnFor.set(number, index);
    }
  });

  let students = 0;
  let shortAnswerCells = 0;
  let uncorrected = 0;
  let outOfRange = 0;
  let misalignedRows = 0;

  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const studentId = cells[0];
    if (!studentId) continue;
    students += 1;

    if (cells.length !== header.length) {
      misalignedRows += 1;
      issues.push(
        `${studentId}: row has ${cells.length} fields against ${header.length} in the header; skipped.`
      );
      continue;
    }

    // A row can be the right length and still be shifted, so check that the
    // MCQ block really is MCQ options before trusting the columns after it.
    const mcqCells = Array.from({ length: 20 }, (_, index) => cells[columnFor.get(index + 1) ?? -1] ?? "");
    const looksLikeOption = (value: string) => /^[A-D]$/i.test(value) || NOT_MARKED.has(value.toLowerCase());
    if (!mcqCells.every(looksLikeOption)) {
      misalignedRows += 1;
      issues.push(
        `${studentId}: multiple-choice columns contain values that are not options (${mcqCells
          .filter((value) => !looksLikeOption(value))
          .slice(0, 3)
          .join(", ")}); row is shifted, so its short-answer marks cannot be trusted. Skipped.`
      );
      continue;
    }

    for (let number = SHORT_ANSWER_FIRST; number <= SHORT_ANSWER_LAST; number += 1) {
      const column = columnFor.get(number);
      if (column === undefined) continue;
      const raw = (cells[column] ?? "").trim();
      shortAnswerCells += 1;

      if (NOT_MARKED.has(raw.toLowerCase())) {
        // Not a zero. "Not corrected" is missing data, and treating it as a
        // zero would invent a human judgement that was never made.
        uncorrected += 1;
        continue;
      }

      const mark = Number(raw);
      if (!Number.isFinite(mark)) {
        issues.push(`${studentId} Q${number}: unreadable mark "${raw}"; skipped.`);
        continue;
      }
      if (mark < 0 || mark > SHORT_ANSWER_MAX_MARKS) {
        outOfRange += 1;
        issues.push(
          `${studentId} Q${number}: mark ${mark} is outside 0..${SHORT_ANSWER_MAX_MARKS}; skipped.`
        );
        continue;
      }

      const script = input.scripts?.[studentId];
      records.push({
        id: `handwritten-uds:${studentId}:q${number}`,
        sourceId: "handwritten-university-data-science",
        level: "undergraduate",
        subject: "dataScience",
        // Two marks awarded in halves against a short list of expected points
        // is a pool, not a method-and-accuracy chain.
        regime: "pointPool",
        questionId: `q${number}`,
        questionPrompt: prompts.get(number) ?? "",
        answer: script?.raw
          ? { kind: "image", paths: [scriptReference(script.raw)] }
          : { kind: "text", text: "" },
        humanMarks: [mark],
        maxMarks: SHORT_ANSWER_MAX_MARKS,
        ...(references.get(number) ? { markScheme: references.get(number)! } : {}),
        ...(script?.corrected
          ? { examinerCommentary: `Annotated script: ${scriptReference(script.corrected)}` }
          : {}),
      });
    }
  }

  for (let number = SHORT_ANSWER_FIRST; number <= SHORT_ANSWER_LAST; number += 1) {
    if (!prompts.has(number)) issues.push(`Q${number}: no prompt found in the exam paper.`);
    if (!references.has(number)) issues.push(`Q${number}: no reference answer in the answer key.`);
  }

  return {
    records,
    issues,
    stats: { students, shortAnswerCells, ingested: records.length, uncorrected, outOfRange, misalignedRows },
  };
}

/**
 * The transport packs.
 *
 * The scripts were also delivered bundled into eleven PDFs, each holding a run
 * of students as raw-then-corrected. That grouping carries no meaning: it is a
 * way to move the files, and the per-student PDFs published alongside remain
 * the source of record. What the packs do carry is a typed separator page
 * before every script naming the student and which version follows, so the
 * mapping can be read out of the transport itself rather than guessed from page
 * order or taken on trust from a side-car index.
 *
 * The separator pages are the only ones with a text layer — the scans have
 * none — so a page carrying no text is script content.
 */
export type PackPageText = { page: number; text: string };

export type PackSegment = {
  studentId: string;
  role: "raw" | "corrected";
  /** 1-based, inclusive, within the pack. Excludes the separator page. */
  firstPage: number;
  lastPage: number;
};

const SEPARATOR = /STUDENT\s+(\d{1,3})\s*[-–—]\s*(RAW|TEACHER[-\s]?CORRECTED)/i;

/** Read the student/version segments out of one pack's page text. */
export function parsePackSegments(pages: readonly PackPageText[]) {
  const segments: PackSegment[] = [];
  const issues: string[] = [];
  const ordered = [...pages].sort((a, b) => a.page - b.page);

  for (const [index, { page, text }] of ordered.entries()) {
    const match = SEPARATOR.exec(text);
    if (!match) continue;
    const nextSeparator = ordered
      .slice(index + 1)
      .find((candidate) => SEPARATOR.test(candidate.text));
    const lastPage = (nextSeparator?.page ?? ordered[ordered.length - 1].page + 1) - 1;
    if (lastPage < page + 1) {
      issues.push(`Student_${match[1]} ${match[2].toLowerCase()}: separator on page ${page} is followed by no script pages.`);
      continue;
    }
    segments.push({
      studentId: `Student_${Number(match[1])}`,
      role: /RAW/i.test(match[2]) ? "raw" : "corrected",
      firstPage: page + 1,
      lastPage,
    });
  }

  if (segments.length === 0) issues.push("No student separator pages found; this does not look like a transport pack.");
  return { segments, issues };
}

/**
 * Build the script map from packs, keeping each segment's page range.
 *
 * A student appearing twice in the same role is reported rather than silently
 * overwritten — duplication across packs would mean the transport, not the
 * payload, decided which copy won.
 */
export function packScriptLocations(
  packs: readonly { file: string; segments: readonly PackSegment[] }[]
) {
  const scripts: Record<string, { raw?: ScriptLocation; corrected?: ScriptLocation }> = {};
  const issues: string[] = [];
  for (const { file, segments } of packs) {
    for (const segment of segments) {
      const existing = scripts[segment.studentId]?.[segment.role];
      if (existing) {
        issues.push(
          `${segment.studentId} ${segment.role}: appears in more than one pack (${existing.file} and ${file}); kept the first.`
        );
        continue;
      }
      scripts[segment.studentId] = {
        ...scripts[segment.studentId],
        [segment.role]: { file, firstPage: segment.firstPage, lastPage: segment.lastPage },
      };
    }
  }
  return { scripts, issues };
}

/**
 * Check the packs against the per-student PDFs they were built from.
 *
 * Transport is only trustworthy when it can be shown to have changed nothing,
 * so where both are on disk the page counts must agree. A disagreement means a
 * script was truncated or a separator missed, and the segment ranges would then
 * point at the wrong pages.
 */
export function packAgreementIssues(input: {
  packs: readonly { file: string; segments: readonly PackSegment[] }[];
  /** Page counts of the published per-student PDFs, by student id. */
  published: Record<string, { raw?: number; corrected?: number }>;
}) {
  const issues: string[] = [];
  for (const { file, segments } of input.packs) {
    for (const segment of segments) {
      const expected = input.published[segment.studentId]?.[segment.role];
      if (expected === undefined) continue;
      const actual = segment.lastPage - segment.firstPage + 1;
      if (actual !== expected) {
        issues.push(
          `${segment.studentId} ${segment.role}: ${file} holds ${actual} pages against ${expected} in the published script.`
        );
      }
    }
  }
  return issues;
}

/**
 * How many students' recorded multiple-choice totals disagree with a direct
 * comparison of their answers against the key.
 *
 * Reported rather than corrected. It is the evidence for not treating the
 * multiple-choice section as ground truth, and a caller may want to know how
 * far the aggregates drift before trusting anything else in the file.
 */
export function mcqAggregateMismatches(input: {
  answerKeyText: string;
  marksCsv: string;
}) {
  const key = new Map<number, string>();
  for (const line of input.answerKeyText.split(/\r?\n/).slice(1)) {
    const cells = parseCsvLine(line);
    const number = Number(cells[0]);
    if (Number.isFinite(number) && cells[1] === "MCQ") key.set(number, (cells[2] ?? "").toUpperCase());
  }

  const lines = input.marksCsv.split(/\r?\n/).filter((line) => line.trim());
  const header = parseCsvLine(lines[0]);
  const statedColumn = header.findIndex((name) => /mcq/i.test(name));
  const columnFor = new Map<number, number>();
  header.forEach((name, index) => {
    const number = Number(name);
    if (Number.isFinite(number) && number >= 1 && number <= 20) columnFor.set(number, index);
  });

  const mismatches: { studentId: string; stated: number; derived: number }[] = [];
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    if (!cells[0] || cells.length !== header.length) continue;
    let derived = 0;
    for (const [number, expected] of key) {
      const column = columnFor.get(number);
      if (column === undefined) continue;
      if ((cells[column] ?? "").trim().toUpperCase() === expected) derived += 1;
    }
    const stated = Number(cells[statedColumn]);
    if (Number.isFinite(stated) && stated !== derived) {
      mismatches.push({ studentId: cells[0], stated, derived });
    }
  }
  return mismatches;
}
