import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  corpusSource,
  humanDisagreement,
  referenceMark,
  stageOf,
  type MarkingCorpusRecord,
} from "@/lib/evaluation/marking-corpus";

/**
 * Whether the scheme-and-total records can carry a GCSE score-accuracy test.
 *
 * The first inventory sorted records by whether they could prove a scheme was
 * applied *correctly*, which needs criterion-level human marks. That is the
 * right bar for "did the mark land on the right criteria" and the wrong bar for
 * "is the total right": a reliable human total tests score accuracy on its own,
 * and 24,242 records were set aside on a distinction that does not apply to
 * that question.
 *
 * So this asks a narrower thing. For each source: is it the qualification being
 * released, does it ship the scheme the human marked against, how reliable is
 * the reference mark, and is the answer typed or handwritten.
 *
 * It also breaks the human-to-human gap down by tariff and regime. A single
 * mean gap across a whole corpus is a property of that corpus's tariff mix, not
 * a ceiling on marking: one mark apart on a 30-mark essay and one mark apart on
 * a 2-mark recall question are not the same disagreement.
 *
 * No paid calls.
 *
 *   node scripts/run-ts.mjs scripts/eval/gcse-suitability.ts
 */
const CORPUS = resolve("artifacts/corpus");

const pad = (value: string | number, width: number) => String(value).padStart(width);

function band(marks: number) {
  if (marks <= 2) return " 1-2";
  if (marks <= 5) return " 3-5";
  if (marks <= 9) return " 6-9";
  if (marks <= 19) return "10-19";
  return "  20+";
}

export default async function main() {
  const records: MarkingCorpusRecord[] = [];
  for (const file of readdirSync(CORPUS).filter((name) => name.endsWith(".json"))) {
    records.push(...JSON.parse(readFileSync(join(CORPUS, file), "utf8")).records);
  }

  /*
   * The qualification matters more than the stage. A US state writing
   * assessment sits at the same age as a GCSE and is not one, and a report
   * that blurs them claims coverage the corpus does not have.
   */
  console.log("Score-accuracy suitability, by source\n");
  console.log(
    "source                          records  scheme  typed  handw  multi  meanMarks  qualification"
  );
  const bySource = new Map<string, MarkingCorpusRecord[]>();
  for (const record of records) {
    bySource.set(record.sourceId, [...(bySource.get(record.sourceId) ?? []), record]);
  }
  for (const [sourceId, list] of [...bySource].sort((a, b) => b[1].length - a[1].length)) {
    const scheme = list.filter((record) => record.markScheme?.trim()).length;
    const typed = list.filter((record) => record.answer.kind === "text").length;
    const handwritten = list.length - typed;
    const multi = list.filter((record) => record.humanMarks.length > 1).length;
    const meanMarks = list.reduce((sum, record) => sum + record.maxMarks, 0) / list.length;
    console.log(
      `${sourceId.padEnd(30)} ${pad(list.length, 7)} ${pad(scheme, 7)} ${pad(typed, 6)} ` +
        `${pad(handwritten, 6)} ${pad(multi, 6)} ${pad(meanMarks.toFixed(1), 10)}  ${list[0]?.level}`
    );
  }

  /*
   * What could carry a GCSE run today: the qualification itself, a scheme
   * present, and a human total to compare against.
   */
  const gcse = records.filter(
    (record) => record.level === "gcse" && record.markScheme?.trim() && record.humanMarks.length > 0
  );
  console.log(`\nGCSE records with a scheme and a human mark: ${gcse.length}`);
  const byShape = new Map<string, MarkingCorpusRecord[]>();
  for (const record of gcse) {
    const key = `${record.regime.padEnd(15)} ${record.subject.padEnd(10)} ${
      record.answer.kind === "text" ? "typed      " : "handwritten"
    }`;
    byShape.set(key, [...(byShape.get(key) ?? []), record]);
  }
  for (const [key, list] of [...byShape].sort((a, b) => b[1].length - a[1].length)) {
    const questions = new Set(list.map((record) => record.questionId)).size;
    const multi = list.filter((record) => record.humanMarks.length > 1).length;
    console.log(
      `  ${key}  ${pad(list.length, 4)} responses  ${pad(questions, 3)} questions  ${pad(multi, 4)} multi-marked`
    );
  }

  /*
   * The human ceiling, per tariff band and regime rather than as one number.
   */
  console.log("\nHuman-to-human disagreement, by tariff band");
  console.log("band     records  meanGap  meanMax  gap/mark  regimes");
  const byBand = new Map<string, MarkingCorpusRecord[]>();
  for (const record of records) {
    if (record.humanMarks.length < 2) continue;
    byBand.set(band(record.maxMarks), [...(byBand.get(band(record.maxMarks)) ?? []), record]);
  }
  for (const key of [" 1-2", " 3-5", " 6-9", "10-19", "  20+"]) {
    const list = byBand.get(key);
    if (!list?.length) continue;
    const gaps = list.map((record) => humanDisagreement(record) ?? 0);
    const meanGap = gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
    const meanMax = list.reduce((sum, record) => sum + record.maxMarks, 0) / list.length;
    const regimes = [...new Set(list.map((record) => record.regime))].join(",");
    console.log(
      `${key}  ${pad(list.length, 8)} ${pad(meanGap.toFixed(2), 8)} ${pad(meanMax.toFixed(1), 8)} ` +
        `${pad((meanGap / meanMax).toFixed(3), 9)}  ${regimes}`
    );
  }

  console.log("\nHuman-to-human disagreement, by regime");
  const byRegime = new Map<string, MarkingCorpusRecord[]>();
  for (const record of records) {
    if (record.humanMarks.length < 2) continue;
    byRegime.set(record.regime, [...(byRegime.get(record.regime) ?? []), record]);
  }
  for (const [regime, list] of [...byRegime].sort((a, b) => b[1].length - a[1].length)) {
    const gaps = list.map((record) => humanDisagreement(record) ?? 0);
    const meanGap = gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
    const exact = gaps.filter((value) => value === 0).length / gaps.length;
    const meanMax = list.reduce((sum, record) => sum + record.maxMarks, 0) / list.length;
    console.log(
      `  ${regime.padEnd(16)} ${pad(list.length, 6)} records  mean gap ${meanGap.toFixed(2)} of ` +
        `${meanMax.toFixed(1)} marks  ·  humans agreed exactly ${(exact * 100).toFixed(1)}%`
    );
  }

  /*
   * The reference mark's own reliability, which decides what a comparison
   * against it can be called.
   */
  const singleMarked = records.filter((record) => record.humanMarks.length === 1).length;
  console.log(
    `\nReference marks: ${records.length - singleMarked} independently checked, ${singleMarked} from a single marker`
  );
  const unverified = [...bySource.keys()].filter((id) => !corpusSource(id)?.licence.verified);
  console.log(`Sources whose licence is unverified: ${unverified.join(", ") || "none"}`);

  const stages = new Map<string, number>();
  for (const record of records) stages.set(stageOf(record), (stages.get(stageOf(record)) ?? 0) + 1);
  console.log(`Stage mix: ${[...stages].map(([key, count]) => `${key} ${count}`).join(", ")}`);
  console.log(
    `Mean reference mark across corpus: ${(
      records.reduce((sum, record) => sum + referenceMark(record), 0) / records.length
    ).toFixed(2)}`
  );
}
