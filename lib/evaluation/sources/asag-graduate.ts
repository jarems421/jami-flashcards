import type { MarkingCorpusRecord } from "@/lib/evaluation/marking-corpus";
import { parseCsvRecords } from "./csv.ts";

/**
 * Parser for `graduate-neural-networks`.
 *
 * 646 postgraduate neural-networks answers over 17 questions, each graded by a
 * single human judge as 0 (completely incorrect), 1 (partially correct) or
 * 2 (perfect answer) — the dataset's own README states the scale and that one
 * judge produced it. One marker means this source can measure agreement but can
 * say nothing about human disagreement.
 *
 * Most of the file is not evidence. Alongside the question, the answer and the
 * grade sit stop-worded copies (`student_modified`, `ref_demoted`), sentence
 * embeddings, cosine similarities and alignment scores — all of them outputs of
 * the original authors' model, computed *from* the answer. Ingesting any of it
 * would put another system's opinion into the corpus and, worse, hand a marker
 * under test a precomputed similarity score for an answer it is supposed to be
 * reading. Only the four source columns are read.
 */

const MAX_MARKS = 2;

/**
 * Columns derived by the dataset's authors rather than written by a student or
 * a marker. Never ingested; named so the exclusion is checkable.
 */
export const DERIVED_COLUMNS = [
  "student_modified",
  "qn_modified",
  "ref_modified",
  "student_demoted",
  "ref_demoted",
  "length_ratio",
  "embed_ref",
  "embed_stud",
  "embed_ref_demoted",
  "embed_stud_demoted",
  "aligned",
  "aligned_demoted",
  "cos_similarity",
  "cos_similarity_demo",
  "aligned_score",
  "aligned_score_demo",
] as const;

export type AsagResult = {
  records: MarkingCorpusRecord[];
  issues: string[];
  stats: {
    rows: number;
    ingested: number;
    questions: number;
    unreadableGrade: number;
    outOfRange: number;
    emptyAnswer: number;
    gradeDistribution: Record<string, number>;
  };
};

export function parseAsagGraduate(input: { datasetCsv: string }): AsagResult {
  const { records: rows, skipped } = parseCsvRecords(input.datasetCsv);
  const records: MarkingCorpusRecord[] = [];
  const issues: string[] = [];
  for (const line of skipped) {
    issues.push(`asag_dataset.csv line ${line}: wrong number of fields; skipped.`);
  }

  let unreadableGrade = 0;
  let outOfRange = 0;
  let emptyAnswer = 0;
  const questions = new Set<string>();
  const gradeDistribution: Record<string, number> = {};

  for (const [offset, row] of rows.entries()) {
    const questionId = (row.question_id ?? "").trim();
    const answer = (row.student_answer ?? "").trim();
    // The row index is the only identifier the file carries, so it is what
    // makes a record traceable back to its line.
    const rowId = (row[""] ?? String(offset)).trim() || String(offset);

    if (!answer) {
      emptyAnswer += 1;
      continue;
    }

    const grade = Number((row.grades_round ?? "").trim());
    if (!Number.isFinite(grade)) {
      unreadableGrade += 1;
      issues.push(`row ${rowId}: unreadable grade "${row.grades_round}"; skipped.`);
      continue;
    }
    if (grade < 0 || grade > MAX_MARKS) {
      outOfRange += 1;
      issues.push(`row ${rowId}: grade ${grade} outside 0..${MAX_MARKS}; skipped.`);
      continue;
    }

    questions.add(questionId);
    gradeDistribution[String(grade)] = (gradeDistribution[String(grade)] ?? 0) + 1;

    records.push({
      id: `asag:${questionId || "q?"}:${rowId}`,
      sourceId: "graduate-neural-networks",
      level: "postgraduate",
      subject: "computerScience",
      // The README's own wording -- completely incorrect, partially correct,
      // perfect -- is a band judgement of the whole answer, not credit counted
      // out against a pool of expected points.
      regime: "banded",
      questionId,
      questionPrompt: (row.question ?? "").trim(),
      answer: { kind: "text", text: answer },
      humanMarks: [grade],
      maxMarks: MAX_MARKS,
      ...((row.ref_answer ?? "").trim() ? { markScheme: (row.ref_answer ?? "").trim() } : {}),
    });
  }

  return {
    records,
    issues,
    stats: {
      rows: rows.length,
      ingested: records.length,
      questions: questions.size,
      unreadableGrade,
      outOfRange,
      emptyAnswer,
      gradeDistribution,
    },
  };
}
