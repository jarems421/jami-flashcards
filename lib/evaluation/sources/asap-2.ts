import type { EducationStage, MarkingCorpusRecord } from "@/lib/evaluation/marking-corpus";
import { parseCsvRecords } from "./csv.ts";

/**
 * Parser for `asap-2` — the ASAP 2.0 corpus.
 *
 * Real persuasive essays from US state standardised writing tests, written by
 * students in grades 6, 8, 9 and 10 and scored holistically 1 to 6 against a
 * published rubric. Seven prompts, each based on a source text the students had
 * to read and use.
 *
 * This is the source that ends the corpus's dependence on undergraduate
 * computer science. Everything else with a cleared licence was written by
 * university students about programming; this is thousands of school-age
 * essays, under a licence its own README states plainly, which is what makes it
 * usable as a shipped exemplar rather than only as a measurement.
 *
 * Two things it is careful about.
 *
 * The level is `usStateAssessment`, not GCSE. The two sit at a similar point in
 * a similar education, and the corpus records that similarity as an education
 * stage — grades 6 and 8 lower secondary, 9 and 10 upper — but they are not the
 * same award. Filing these as GCSE would let an evaluation report claim it had
 * tested GCSE-matched exemplars using American essays.
 *
 * The demographic columns are never read. The corpus ships each writer's
 * race and ethnicity, gender, disability status, economic disadvantage and
 * English-language-learner status. None of it bears on whether an essay earned
 * its mark, and a marking corpus whose records could carry a child's disability
 * status into a prompt would be indefensible however open the licence is. The
 * columns are named here so the exclusion is checkable rather than implied.
 */

const MAX_SCORE = 6;

/** Personal characteristics of the writer. Never ingested. */
export const DEMOGRAPHIC_COLUMNS = [
  "economically_disadvantaged",
  "student_disability_status",
  "ell_status",
  "race_ethnicity",
  "gender",
] as const;

/** Grades 6 and 8 are middle school; 9 and 10 are high school. */
export function stageForGrade(grade: number): EducationStage {
  return grade <= 8 ? "lowerSecondary" : "upperSecondary";
}

export type Asap2Result = {
  records: MarkingCorpusRecord[];
  issues: string[];
  stats: {
    rows: number;
    ingested: number;
    prompts: number;
    byGrade: Record<string, number>;
    byScore: Record<string, number>;
    emptyEssay: number;
    unreadableScore: number;
    outOfRange: number;
    missingPrompt: number;
  };
};

export function parseAsap2(input: {
  essaysCsv: string;
  /** The holistic rubric, used as the mark scheme for every record. */
  rubric?: string;
  /** Source-text file paths by prompt name, if they were downloaded. */
  sourceTexts?: Record<string, string>;
}): Asap2Result {
  const { records: rows, skipped } = parseCsvRecords(input.essaysCsv);
  const records: MarkingCorpusRecord[] = [];
  const issues: string[] = [];
  for (const line of skipped) {
    issues.push(`ASAP_2 line ${line}: wrong number of fields; skipped.`);
  }

  const byGrade: Record<string, number> = {};
  const byScore: Record<string, number> = {};
  const prompts = new Set<string>();
  let emptyEssay = 0;
  let unreadableScore = 0;
  let outOfRange = 0;
  let missingPrompt = 0;

  for (const row of rows) {
    const essayId = (row.essay_id ?? "").trim();
    if (!essayId) continue;

    const essay = (row.full_text ?? "").trim();
    if (!essay) {
      emptyEssay += 1;
      continue;
    }

    const score = Number((row.score ?? "").trim());
    if (!Number.isFinite(score)) {
      unreadableScore += 1;
      issues.push(`${essayId}: unreadable score "${row.score}"; skipped.`);
      continue;
    }
    if (score < 1 || score > MAX_SCORE) {
      outOfRange += 1;
      issues.push(`${essayId}: score ${score} outside 1..${MAX_SCORE}; skipped.`);
      continue;
    }

    const promptName = (row.prompt_name ?? "").trim();
    const assignment = (row.assignment ?? "").trim();
    if (!assignment) {
      missingPrompt += 1;
      issues.push(`${essayId}: no assignment text; the record carries no prompt.`);
    }

    const grade = Number((row.grade_level ?? "").trim());
    const stage = Number.isFinite(grade) ? stageForGrade(grade) : undefined;
    if (!Number.isFinite(grade)) {
      issues.push(`${essayId}: unreadable grade "${row.grade_level}"; stage falls back to the level's.`);
    }

    prompts.add(promptName);
    byGrade[String(grade)] = (byGrade[String(grade)] ?? 0) + 1;
    byScore[String(score)] = (byScore[String(score)] ?? 0) + 1;

    const sourceText = input.sourceTexts?.[promptName];
    records.push({
      id: `asap2:${essayId}`,
      sourceId: "asap-2",
      // Not GCSE. A similar point in a similar education is recorded as the
      // stage; the qualification stays what it actually was.
      level: "usStateAssessment",
      ...(stage ? { stage } : {}),
      ...(Number.isFinite(grade) ? { levelDetail: `Grade ${grade}` } : {}),
      subject: "english",
      // One holistic score against band descriptors, not credit counted out.
      regime: "banded",
      questionId: promptName || essayId,
      // The source text is part of the task, not commentary on the mark: every
      // essay had to read and use it, so the prompt is incomplete without a
      // pointer to it. It is not put in `examinerCommentary`, which is for a
      // marker's reasoning, and this source has none.
      questionPrompt: sourceText
        ? `${assignment}\n\nSource text provided to students: ${sourceText}`
        : assignment,
      answer: { kind: "text", text: essay },
      humanMarks: [score],
      maxMarks: MAX_SCORE,
      ...(input.rubric ? { markScheme: input.rubric } : {}),
    });
  }

  return {
    records,
    issues,
    stats: {
      rows: rows.length,
      ingested: records.length,
      prompts: prompts.size,
      byGrade,
      byScore,
      emptyEssay,
      unreadableScore,
      outOfRange,
      missingPrompt,
    },
  };
}
