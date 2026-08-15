import type { MarkingCorpusRecord } from "@/lib/evaluation/marking-corpus";
import { parseCsvRecords } from "./csv.ts";

/**
 * Parser for `jorgpt`.
 *
 * Around 3,000 open-ended undergraduate computer science answers, each with a
 * teacher's grade out of ten and written feedback.
 *
 * The hazard in this source is that the teacher's grade sits in a row beside
 * four machine-generated ones — `deepseek_grade`, `qwen_grade`, `gemini_grade`
 * and an LLM `judge_grade`. Only `teacher_grade` is a human judgement. Letting
 * a model's grade into `humanMarks` would mean measuring Jami against another
 * model's opinion while calling the result human agreement, which would make
 * every number downstream meaningless. So the machine columns are never read,
 * and a test asserts it.
 *
 * `teacher_corrected` is required rather than assumed: a row the teacher never
 * reviewed has no human mark to ingest, whatever is sitting in the column.
 */

const MAX_MARKS = 10;

/** Columns holding machine-generated grades. Never read as a human mark. */
export const MODEL_GRADE_COLUMNS = [
  "deepseek_grade",
  "qwen_grade",
  "gemini_grade",
  "judge_grade",
] as const;

export type JorgptResult = {
  records: MarkingCorpusRecord[];
  issues: string[];
  stats: {
    rows: number;
    ingested: number;
    questions: number;
    /** Rows the teacher never reviewed, so they carry no human mark. */
    notCorrected: number;
    unreadableGrade: number;
    outOfRange: number;
    emptyAnswer: number;
    withFeedback: number;
  };
};

export function parseJorgpt(input: { datasetCsv: string }): JorgptResult {
  const { header, records: rows, skipped } = parseCsvRecords(input.datasetCsv);
  const records: MarkingCorpusRecord[] = [];
  const issues: string[] = [];

  for (const line of skipped) {
    issues.push(`dataset line ${line}: wrong number of fields; skipped.`);
  }
  if (header.length > 0 && !header.includes("teacher_grade")) {
    return {
      records,
      issues: [...issues, "No teacher_grade column: this file carries no human marks."],
      stats: {
        rows: rows.length,
        ingested: 0,
        questions: 0,
        notCorrected: 0,
        unreadableGrade: 0,
        outOfRange: 0,
        emptyAnswer: 0,
        withFeedback: 0,
      },
    };
  }

  let notCorrected = 0;
  let unreadableGrade = 0;
  let outOfRange = 0;
  let emptyAnswer = 0;
  let withFeedback = 0;
  const questions = new Set<string>();

  for (const row of rows) {
    const entryId = (row.entry_id ?? "").trim();
    if (!entryId) continue;

    if ((row.teacher_corrected ?? "").trim().toLowerCase() !== "true") {
      notCorrected += 1;
      continue;
    }

    const grade = Number((row.teacher_grade ?? "").trim());
    if (!Number.isFinite(grade)) {
      unreadableGrade += 1;
      issues.push(`${entryId}: unreadable teacher grade "${row.teacher_grade}"; skipped.`);
      continue;
    }
    if (grade < 0 || grade > MAX_MARKS) {
      outOfRange += 1;
      issues.push(`${entryId}: grade ${grade} outside 0..${MAX_MARKS}; skipped.`);
      continue;
    }

    const answer = (row.student_answer ?? "").trim();
    if (!answer) {
      emptyAnswer += 1;
      continue;
    }

    const feedback = (row.teacher_feedback ?? "").trim();
    if (feedback) withFeedback += 1;
    const questionId = (row.question_id ?? "").trim();
    questions.add(questionId);

    records.push({
      id: `jorgpt:${entryId}`,
      sourceId: "jorgpt",
      level: "undergraduate",
      subject: "computerScience",
      // A single grade out of ten with written feedback, awarded against an
      // ideal answer rather than a list of creditable points.
      regime: "banded",
      questionId,
      questionPrompt: (row.question_text ?? "").trim(),
      answer: { kind: "text", text: answer },
      humanMarks: [grade],
      maxMarks: MAX_MARKS,
      ...((row.ideal_answer ?? "").trim() ? { markScheme: (row.ideal_answer ?? "").trim() } : {}),
      ...(feedback ? { examinerCommentary: feedback } : {}),
    });
  }

  return {
    records,
    issues,
    stats: {
      rows: rows.length,
      ingested: records.length,
      questions: questions.size,
      notCorrected,
      unreadableGrade,
      outOfRange,
      emptyAnswer,
      withFeedback,
    },
  };
}
