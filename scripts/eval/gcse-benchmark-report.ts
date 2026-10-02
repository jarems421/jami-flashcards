import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { MarkingCorpusRecord } from "@/lib/evaluation/marking-corpus";
import { breakdownBy, breakdownRow, examinerCeiling, type BreakdownRow } from "@/lib/evaluation/benchmark-breakdown";
import type { MarkOutcome } from "@/lib/evaluation/scoring";

/**
 * GCSE marking accuracy, overall and by board, subject and board x subject.
 *
 * Reads the journals of one or more criterion-run runs over the
 * gcse-board-exemplars corpus (several, because a long run is finished by a
 * --missing recovery pass) and joins each outcome to its record for the board
 * and course the outcome itself does not carry. Free: nothing is marked.
 *
 *   node scripts/run-ts.mjs scripts/eval/gcse-benchmark-report.ts --runs=gcse-a,gcse-a-part2 --out=gcse-a
 *
 * Writes artifacts/evaluation/<out>-breakdown.json: aggregates only, no ids or
 * answer text, so it can feed a published page.
 */

const CORPUS = resolve("artifacts/corpus");
const REPORT = resolve("artifacts/evaluation");

const SUBJECT_NAMES: Record<string, string> = {
  maths: "Maths",
  english: "English Language",
  englishLiterature: "English Literature",
  biology: "Biology",
  chemistry: "Chemistry",
  physics: "Physics",
  combinedScience: "Combined Science",
  science: "Science",
  history: "History",
  geography: "Geography",
};

const pct = (value: number) => `${(value * 100).toFixed(0)}%`;
const range = (row: BreakdownRow, key: "exactInterval" | "withinOneInterval") =>
  row[key] ? `${pct(row[key]!.low)}-${pct(row[key]!.high)}` : "-";

function table(title: string, rows: readonly BreakdownRow[]) {
  const lines = [
    `\n${title}`,
    `${"".padEnd(34)}${"answers".padStart(8)}${"marks agree".padStart(13)}${"exact".padStart(8)}${"(95% CI)".padStart(12)}${"within 1".padStart(10)}${"bias".padStart(8)}`,
  ];
  for (const row of rows) {
    lines.push(
      `${row.key.padEnd(34)}${String(row.answers).padStart(8)}${pct(row.markAgreement).padStart(13)}${pct(row.exact).padStart(8)}${range(row, "exactInterval").padStart(12)}${pct(row.withinOne).padStart(10)}${((row.bias >= 0 ? "+" : "") + row.bias.toFixed(2)).padStart(8)}${row.reportable ? "" : "   (too few to call)"}`
    );
  }
  return lines.join("\n");
}

export default async function main(args: string[]) {
  const flag = (name: string) => args.find((value) => value.startsWith(`--${name}=`))?.split("=")[1];
  const runs = (flag("runs") ?? "").split(",").map((name) => name.trim()).filter(Boolean);
  if (runs.length === 0) throw new Error("Pass --runs=<journal name>[,<another>].");
  const out = flag("out") ?? runs[0];

  const records = new Map<string, MarkingCorpusRecord>();
  for (const file of readdirSync(CORPUS).filter((name) => name.endsWith(".json"))) {
    for (const record of JSON.parse(readFileSync(join(CORPUS, file), "utf8")).records as MarkingCorpusRecord[]) {
      records.set(record.id, record);
    }
  }

  // Later runs win, so a re-marked record counts once.
  const byId = new Map<string, MarkOutcome>();
  for (const run of runs) {
    const lines = readFileSync(join(REPORT, `${run}.jsonl`), "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      const outcome = JSON.parse(line) as MarkOutcome;
      byId.set(outcome.recordId, outcome);
    }
  }
  const outcomes = [...byId.values()].filter((outcome) => records.get(outcome.recordId)?.board);
  const board = (outcome: MarkOutcome) => records.get(outcome.recordId)?.board ?? null;
  const subject = (outcome: MarkOutcome) => SUBJECT_NAMES[outcome.subject] ?? outcome.subject;
  const regime = (outcome: MarkOutcome) =>
    outcome.regime === "banded" ? "Levels-marked (essays, extended answers)" : "Point-marked (each mark for a step or point)";
  const tariff = (outcome: MarkOutcome) =>
    outcome.maxMarks <= 2 ? "1-2 marks" : outcome.maxMarks <= 4 ? "3-4 marks" : outcome.maxMarks <= 6 ? "5-6 marks" : "7+ marks";

  /*
   * The ceiling: two examiners on the same GCSE answer. Medly's answers are
   * the only double-marked GCSE work on disk -- mock questions, real
   * examiners -- so this is how far one examiner sits from another on GCSE
   * marking, split the same way as the marker's figures.
   */
  // The 40-mark writing tasks are left out: examiners differ on them by up to
  // 20 marks, and nothing this benchmark marks is that long.
  const doubleMarked = [...records.values()].filter(
    (record) => record.sourceId === "medly-gcse" && record.humanMarks.length >= 2 && record.maxMarks <= 20
  );
  const ceilingBy = (facet: (record: MarkingCorpusRecord) => string) => {
    const groups = new Map<string, MarkingCorpusRecord[]>();
    for (const record of doubleMarked) groups.set(facet(record), [...(groups.get(facet(record)) ?? []), record]);
    return [...groups.entries()]
      .map(([key, group]) =>
        examinerCeiling(
          key,
          group.map((record) => ({ firstMark: record.humanMarks[0], secondMark: record.humanMarks[1], maxMarks: record.maxMarks }))
        )
      )
      .sort((left, right) => right.answers - left.answers);
  };
  const recordRegime = (record: MarkingCorpusRecord) =>
    regime({ regime: record.regime === "additive" || record.regime === "pointPool" ? "additive" : "banded" } as MarkOutcome);
  const recordTariff = (record: MarkingCorpusRecord) => tariff({ maxMarks: record.maxMarks } as MarkOutcome);

  const report = {
    generatedAt: new Date().toISOString(),
    runs,
    overall: breakdownRow("All GCSE answers", outcomes),
    byBoard: breakdownBy(outcomes, board),
    bySubject: breakdownBy(outcomes, subject),
    byBoardAndSubject: breakdownBy(outcomes, (outcome) => `${board(outcome)} - ${subject(outcome)}`),
    byRegime: breakdownBy(outcomes, regime),
    byTariff: breakdownBy(outcomes, tariff),
    examinerCeiling: {
      source: "medly-gcse: GCSE mock questions, each answer marked independently by two examiners",
      overall: examinerCeiling(
        "Two examiners, same answer",
        doubleMarked.map((record) => ({ firstMark: record.humanMarks[0], secondMark: record.humanMarks[1], maxMarks: record.maxMarks }))
      ),
      byRegime: ceilingBy(recordRegime),
      byTariff: ceilingBy(recordTariff),
    },
  };

  process.stdout.write(
    [
      `GCSE marking benchmark: ${outcomes.length} answers from ${runs.join(", ")}`,
      table("Overall", [report.overall]),
      table("By board", report.byBoard),
      table("By subject", report.bySubject),
      table("By board and subject", report.byBoardAndSubject),
      table("By marking style", report.byRegime),
      table("By question size", report.byTariff),
      table("Ceiling - two examiners on the same GCSE answer (Medly)", [report.examinerCeiling.overall]),
      table("Ceiling by marking style", report.examinerCeiling.byRegime),
      table("Ceiling by question size", report.examinerCeiling.byTariff),
      "",
    ].join("\n")
  );
  const target = join(REPORT, `${out}-breakdown.json`);
  writeFileSync(target, JSON.stringify(report, null, 2));
  process.stdout.write(`\nWritten to ${target}\n`);
}
