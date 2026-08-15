import type { MarkingCorpusRecord, MarkingRegime } from "@/lib/evaluation/marking-corpus";
import { parseCsvRecords } from "./csv.ts";

/**
 * Parser for `medly-gcse`.
 *
 * 480 GCSE answers over 20 questions, half English and half maths, and half
 * typed and half photographed handwriting. Every one carries marks from *two*
 * examiners, which is what makes this source worth more than its size suggests:
 * the two disagree on roughly half the answers, so it is the only thing in the
 * corpus that says how far apart two competent humans actually are. That number
 * is the bar Jami should be held to — matching a single examiner exactly is a
 * standard the examiners themselves do not meet.
 *
 * Both marks are kept. Averaging them here would destroy exactly the signal the
 * source exists to provide.
 */

export type MedlyQuestion = {
  question_id: string;
  markmax: number;
  question_stem?: string;
  question_text?: string;
  markscheme?: string;
  question_image?: string;
};

export type MedlyInput = {
  datasetCsv: string;
  /** Parsed question JSON by question id. */
  questions: Record<string, MedlyQuestion>;
  /** Text of the typed answers, by answer id. Handwriting stays a file path. */
  answerTexts?: Record<string, string>;
  /** Prefix for the dataset-relative answer paths, when they should be absolute. */
  root?: string;
};

export type MedlyResult = {
  records: MarkingCorpusRecord[];
  issues: string[];
  stats: {
    rows: number;
    ingested: number;
    typed: number;
    handwritten: number;
    /** Answers the two examiners marked differently. */
    examinersDisagreed: number;
    /** The widest gap between the two examiners, in marks. */
    widestDisagreement: number;
    outOfRange: number;
    missingQuestion: number;
    missingAnswer: number;
  };
};

/**
 * Which marking regime a question uses.
 *
 * Read off the evidence in the source rather than assumed: a question whose
 * examiners recorded a split across assessment objectives is marked by weighted
 * traits, maths credits method and accuracy step by step, and the remaining
 * English questions are levels-of-response bands.
 */
function regimeFor(subject: string, hasAoMarks: boolean): MarkingRegime {
  if (hasAoMarks) return "weightedTraits";
  return subject === "maths" ? "additive" : "banded";
}

/** `AO5:16;AO6:7` as a readable line, or null when the field is empty. */
function describeAoMarks(value: string | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed.split(";").map((part) => part.trim()).filter(Boolean).join(", ") : null;
}

export function parseMedlyGcse(input: MedlyInput): MedlyResult {
  const { records: rows, skipped } = parseCsvRecords(input.datasetCsv);
  const records: MarkingCorpusRecord[] = [];
  const issues: string[] = [];

  for (const line of skipped) {
    issues.push(`dataset.csv line ${line}: wrong number of fields; skipped.`);
  }

  let typed = 0;
  let handwritten = 0;
  let examinersDisagreed = 0;
  let widestDisagreement = 0;
  let outOfRange = 0;
  let missingQuestion = 0;
  let missingAnswer = 0;

  for (const row of rows) {
    const answerId = row.answer_id?.trim();
    if (!answerId) continue;

    const question = input.questions[row.question_id?.trim() ?? ""];
    if (!question) {
      missingQuestion += 1;
      issues.push(`${answerId}: no question file for "${row.question_id}"; skipped.`);
      continue;
    }

    const maxMarks = Number(row.markmax);
    if (!Number.isFinite(maxMarks) || maxMarks <= 0) {
      issues.push(`${answerId}: unreadable markmax "${row.markmax}"; skipped.`);
      continue;
    }
    if (Number.isFinite(question.markmax) && question.markmax !== maxMarks) {
      issues.push(
        `${answerId}: dataset says the question is out of ${maxMarks} but ${question.question_id} says ${question.markmax}; used the question file.`
      );
    }
    const questionMax = Number.isFinite(question.markmax) ? question.markmax : maxMarks;

    const marks = [row.examiner_1_mark, row.examiner_2_mark]
      .map((value) => (value ?? "").trim())
      .filter((value) => value !== "")
      .map(Number);
    if (marks.length === 0 || marks.some((mark) => !Number.isFinite(mark))) {
      issues.push(`${answerId}: no readable examiner mark; skipped.`);
      continue;
    }
    const beyond = marks.filter((mark) => mark < 0 || mark > questionMax);
    if (beyond.length > 0) {
      outOfRange += 1;
      issues.push(`${answerId}: mark ${beyond.join(" and ")} outside 0..${questionMax}; skipped.`);
      continue;
    }

    const isHandwritten = (row.modality ?? "").trim().toLowerCase() === "hw";
    const relative = (row.answer_file ?? "").trim();
    if (!relative) {
      missingAnswer += 1;
      issues.push(`${answerId}: no answer file named; skipped.`);
      continue;
    }
    const path = input.root ? `${input.root}/${relative}` : relative;

    let answer: MarkingCorpusRecord["answer"];
    if (isHandwritten) {
      handwritten += 1;
      answer = { kind: "image", paths: [path] };
    } else {
      const text = input.answerTexts?.[answerId];
      if (text === undefined) {
        missingAnswer += 1;
        issues.push(`${answerId}: typed answer ${relative} could not be read; skipped.`);
        continue;
      }
      typed += 1;
      answer = { kind: "text", text };
    }

    if (marks.length > 1) {
      const spread = Math.max(...marks) - Math.min(...marks);
      if (spread > 0) examinersDisagreed += 1;
      widestDisagreement = Math.max(widestDisagreement, spread);
    }

    // The assessment-objective split is the examiners' own breakdown of the
    // mark they gave, so it is recorded as their commentary rather than
    // invented prose. The record shape carries one number per marker.
    const aoLines = [
      describeAoMarks(row.examiner_1_ao_marks),
      describeAoMarks(row.examiner_2_ao_marks),
    ]
      .map((line, index) => (line ? `Examiner ${index + 1} assessment objectives: ${line}` : null))
      .filter((line): line is string => line !== null);

    const prompt = [question.question_stem, question.question_text]
      .map((part) => (part ?? "").trim())
      .filter(Boolean)
      .join("\n\n");

    records.push({
      id: `medly:${answerId}`,
      sourceId: "medly-gcse",
      level: "gcse",
      subject: (row.subject ?? "").trim(),
      regime: regimeFor((row.subject ?? "").trim(), aoLines.length > 0),
      questionId: question.question_id,
      questionPrompt: prompt,
      answer,
      humanMarks: marks,
      maxMarks: questionMax,
      ...(question.markscheme ? { markScheme: question.markscheme } : {}),
      ...(aoLines.length > 0 ? { examinerCommentary: aoLines.join("\n") } : {}),
    });
  }

  return {
    records,
    issues,
    stats: {
      rows: rows.length,
      ingested: records.length,
      typed,
      handwritten,
      examinersDisagreed,
      widestDisagreement,
      outOfRange,
      missingQuestion,
      missingAnswer,
    },
  };
}
