import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { MarkingCorpusRecord } from "@/lib/evaluation/marking-corpus";
import type { PracticePaper } from "@/lib/practice/practice-papers";
import type { PracticePaperMarkSchemeItem } from "@/lib/practice/mark-schemes";
import { getAiTokenCap } from "@/lib/ai/budgets";
import { markPracticePaperWithAudit } from "@/services/ai/practice-paper-marking.server";

/**
 * Is MiMo scale-blind, or did the one-question adapter cause it?
 *
 * The database holds no real practice papers, so the intended test against
 * production submissions cannot be run. This is the strongest substitute, and
 * it is arguably a sharper test of the actual hypothesis.
 *
 * A single realistic multi-question paper spans tariffs from 1 mark to 40, and
 * both blind markers mark it in one call each. Scale-blindness then becomes
 * visible *within a single response*: if a marker awards about the same number
 * to the one-mark question and the forty-mark essay, no property of any
 * adapter explains it, because every question shared one paper, one prompt and
 * one call.
 *
 * The student answers are real work taken from the corpus, chosen by length to
 * suit each tariff. The paper around them is constructed, and that is stated
 * rather than glossed: this shows whether the behaviour reproduces outside a
 * one-question paper, not what happens on a specific real submission.
 */

const CORPUS = resolve("artifacts/corpus");
const REPORT = resolve("artifacts/evaluation");

/** Tariffs chosen to span the range a real paper covers. */
const TARIFFS = [1, 2, 3, 5, 8, 10, 20, 40];

function markSchemeItem(questionId: string, marks: number): PracticePaperMarkSchemeItem {
  const common = {
    questionId,
    maxMarks: marks,
    answer: `A complete response worth ${marks} marks.`,
    acceptableAlternatives: [],
    commonMistakes: [],
  };
  if (marks <= 5) {
    return {
      ...common,
      marking: "additive",
      points: Array.from({ length: marks }, (_unused, index) => ({
        id: `p${index + 1}`,
        marks: 1,
        code: "B" as const,
        text: `Creditable point ${index + 1} of ${marks}.`,
        dep: [],
        ft: false,
        essentialTerms: [],
        allow: [],
        reject: [],
      })),
    };
  }
  const bandSize = Math.ceil(marks / 4);
  return {
    ...common,
    marking: "banded",
    bands: Array.from({ length: 4 }, (_unused, index) => ({
      id: `b${index + 1}`,
      label: `Band ${index + 1}`,
      minMarks: index * bandSize,
      maxMarks: Math.min(marks, (index + 1) * bandSize),
      descriptor:
        index === 3
          ? "Sustained, well-evidenced and fully developed."
          : index === 0
            ? "Minimal, largely undeveloped."
            : `Developing: level ${index + 1} of 4.`,
    })),
  };
}

function buildPaper(answers: { record: MarkingCorpusRecord; marks: number }[]): PracticePaper {
  const questions = answers.map((entry, index) => ({
    id: `q${index + 1}`,
    label: `Question ${index + 1}`,
    prompt: entry.record.questionPrompt || `Respond to the task. (${entry.marks} marks)`,
    marks: entry.marks,
    assets: [],
  }));
  const totalMarks = questions.reduce((total, question) => total + question.marks, 0);

  return {
    id: "eval-scale-paper",
    notebookId: "evaluation",
    folderId: "evaluation",
    title: "Mixed-tariff diagnostic paper",
    origin: "uploaded",
    status: "submitted",
    sourceIds: [],
    sourceLabels: [],
    request: "",
    coverage: "",
    length: "full",
    focus: "balanced",
    durationMinutes: 90,
    timingMode: "untimed",
    timingState: "submitted",
    totalPausedMs: 0,
    deadlineVersion: 1,
    tutorEnabled: false,
    tutorUsed: false,
    timerEnabled: false,
    instructions: ["Answer every question.", "The marks for each question are shown in brackets."],
    assessmentProfile: {
      studyLevel: "GCSE",
      qualificationOrModule: "GCSE",
      awardingBodyOrInstitution: "Diagnostic",
      specificationOrCourse: "English essay writing and comprehension",
      tierOrComponent: "upperSecondary",
      formatSummary: `Mixed paper of ${questions.length} questions from 1 to 40 marks, totalling ${totalMarks}.`,
      confidence: "high",
    },
    questions,
    choiceGroups: [],
    totalMarks,
    markScheme: {
      kind: "official",
      label: "Diagnostic mark scheme",
      notice: "Constructed for this diagnostic.",
      items: answers.map((entry, index) => markSchemeItem(`q${index + 1}`, entry.marks)),
    },
    gradeGuidance: { kind: "none", label: "Not applicable", notice: "", boundaries: [] },
    examinerInsights: [],
    attemptCount: 1,
    createdAt: 0,
    updatedAt: 0,
  };
}

export default async function main(args: string[]) {
  const records: MarkingCorpusRecord[] = [];
  for (const file of readdirSync(CORPUS).filter((name) => name.endsWith(".json"))) {
    records.push(...JSON.parse(readFileSync(join(CORPUS, file), "utf8")).records);
  }

  // Real student writing, matched by length so a 40-mark slot gets an essay
  // and a 1-mark slot gets a sentence. A marker seeing a one-line answer under
  // a 40-mark heading would be right to mark it low, which would confound this.
  const texts = records
    .filter((record) => record.answer.kind === "text" && record.answer.text.trim().length > 0)
    .map((record) => ({ record, length: (record.answer as { text: string }).text.length }))
    .sort((a, b) => a.length - b.length);

  const chosen = TARIFFS.map((marks) => {
    const target = 80 + marks * 90;
    const best = texts.reduce((closest, candidate) =>
      Math.abs(candidate.length - target) < Math.abs(closest.length - target) ? candidate : closest
    );
    return { record: best.record, marks };
  });

  const paper = buildPaper(chosen);
  process.stdout.write(`\nMixed-tariff diagnostic paper: ${paper.questions.length} questions, ${paper.totalMarks} marks\n`);
  for (const [index, entry] of chosen.entries()) {
    const text = entry.record.answer.kind === "text" ? entry.record.answer.text : "";
    process.stdout.write(
      `  q${index + 1}  ${String(entry.marks).padStart(3)} marks   answer ${String(text.length).padStart(5)} chars   from ${entry.record.sourceId}\n`
    );
  }

  if (!args.includes("--confirm")) {
    process.stdout.write(`\nNothing called. Re-run with --confirm.\n`);
    return;
  }

  const answerParts = chosen.map((entry, index) => ({
    text: `--- STUDENT ANSWER (Question ${index + 1}) ---\n${
      entry.record.answer.kind === "text" ? entry.record.answer.text : ""
    }`,
  }));

  process.stdout.write(`\nMarking through the production path...\n`);
  const { result, audit } = await markPracticePaperWithAudit({
    paper,
    answerParts,
    deadlineAt: Date.now() + 600_000,
    maxOutputTokens: getAiTokenCap("practicePaperMarking"),
    logFallback: (fields) => process.stdout.write(`  fallback: ${JSON.stringify(fields).slice(0, 140)}\n`),
  });

  const rows = paper.questions.map((question) => ({
    questionId: question.id,
    maxMarks: question.marks,
    primary: audit.primaryScores[question.id],
    verifier: audit.verifierScores[question.id],
    final: result.questionResults.find((r) => r.questionId === question.id)?.awardedMarks,
  }));

  process.stdout.write(`\n${"=".repeat(72)}\nONE PAPER, ONE CALL PER MARKER, TARIFFS 1 TO 40\n${"=".repeat(72)}\n`);
  process.stdout.write(`${"question".padEnd(10)}${"max".padStart(5)}${"MiniMax".padStart(9)}${"MiMo".padStart(7)}${"final".padStart(7)}   MiMo as share of tariff\n`);
  for (const row of rows) {
    const share =
      typeof row.verifier === "number" && row.maxMarks > 0
        ? `${((row.verifier / row.maxMarks) * 100).toFixed(0)}%`
        : "-";
    process.stdout.write(
      `${row.questionId.padEnd(10)}${String(row.maxMarks).padStart(5)}${String(row.primary).padStart(9)}` +
        `${String(row.verifier).padStart(7)}${String(row.final).padStart(7)}   ${share}\n`
    );
  }

  const verifierMarks = rows.map((r) => r.verifier).filter((v): v is number => typeof v === "number");
  const primaryMarks = rows.map((r) => r.primary).filter((v): v is number => typeof v === "number");
  process.stdout.write(`\ndistinct MiMo marks    ${JSON.stringify([...new Set(verifierMarks)].sort((a, b) => a - b))}\n`);
  process.stdout.write(`distinct MiniMax marks ${JSON.stringify([...new Set(primaryMarks)].sort((a, b) => a - b))}\n`);

  // Correlation between the mark and the tariff. A marker that reads the scale
  // should track it; one emitting a constant will not.
  const correlate = (marks: number[]) => {
    const tariffs = rows.map((r) => r.maxMarks).slice(0, marks.length);
    const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
    const mx = mean(tariffs);
    const my = mean(marks);
    const cov = tariffs.reduce((s, x, i) => s + (x - mx) * (marks[i] - my), 0);
    const vx = Math.sqrt(tariffs.reduce((s, x) => s + (x - mx) ** 2, 0));
    const vy = Math.sqrt(marks.reduce((s, y) => s + (y - my) ** 2, 0));
    return vx === 0 || vy === 0 ? null : cov / (vx * vy);
  };
  const rMimo = correlate(verifierMarks);
  const rMiniMax = correlate(primaryMarks);
  process.stdout.write(`correlation with tariff: MiMo ${rMimo === null ? "undefined (constant)" : rMimo.toFixed(3)}, MiniMax ${rMiniMax === null ? "undefined (constant)" : rMiniMax.toFixed(3)}\n`);
  process.stdout.write(`\ndisputed questions: ${audit.disputedQuestionIds.length} of ${paper.questions.length}\n`);

  mkdirSync(REPORT, { recursive: true });
  const target = join(REPORT, "mimo-scale-diagnostic.json");
  writeFileSync(target, JSON.stringify({ rows, audit, note: "constructed paper, real corpus answers" }, null, 2));
  appendFileSync(target, "");
  process.stdout.write(`\nwritten to ${target}\n`);
}
