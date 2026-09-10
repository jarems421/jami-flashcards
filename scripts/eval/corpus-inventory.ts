import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  MARKING_CORPUS_SOURCES,
  corpusSource,
  humanDisagreement,
  stageOf,
  type MarkingCorpusRecord,
} from "@/lib/evaluation/marking-corpus";

/**
 * What the corpus can and cannot be used to claim.
 *
 * A count of records says nothing about readiness. Marking a real past-paper
 * question against its exact published scheme is a different task from scoring
 * an essay against a holistic rubric, and a source that ships neither a scheme
 * nor criterion-level marks cannot show that a scheme was applied faithfully --
 * only that a total came out near a human's.
 *
 * So records are sorted by what they can support:
 *
 *   release     an authentic question, the scheme it was marked against, and
 *               criterion-level human marks. Only these can establish that
 *               Past Paper Practice marks a real scheme correctly.
 *   scheme      a scheme, human totals, no criterion breakdown. Enough to
 *               measure agreement, not enough to show marks landed on the
 *               right criteria.
 *   diagnostic  no scheme text: a rubric, a band descriptor, or nothing. Fine
 *               for finding failures, not for release evidence.
 *
 * Nothing here makes a paid call.
 *
 *   node scripts/run-ts.mjs scripts/eval/corpus-inventory.ts
 */
const CORPUS = resolve("artifacts/corpus");

type Tier = "release" | "scheme" | "diagnostic";

function tierOf(record: MarkingCorpusRecord): Tier {
  const scheme = record.markScheme?.trim();
  if (!scheme) return "diagnostic";
  return record.criteria?.length ? "release" : "scheme";
}

function pad(value: string | number, width: number) {
  return String(value).padStart(width);
}

export default async function main() {
  const records: MarkingCorpusRecord[] = [];
  for (const file of readdirSync(CORPUS).filter((name) => name.endsWith(".json"))) {
    records.push(...JSON.parse(readFileSync(join(CORPUS, file), "utf8")).records);
  }

  console.log(`${records.length} records across ${MARKING_CORPUS_SOURCES.length} catalogued sources\n`);

  console.log("source                          records  release   scheme  diagnos  handwr  multi  stage");
  const bySource = new Map<string, MarkingCorpusRecord[]>();
  for (const record of records) {
    const list = bySource.get(record.sourceId) ?? [];
    list.push(record);
    bySource.set(record.sourceId, list);
  }
  const totals: Record<Tier, number> = { release: 0, scheme: 0, diagnostic: 0 };
  for (const [sourceId, list] of [...bySource].sort((a, b) => b[1].length - a[1].length)) {
    const counts: Record<Tier, number> = { release: 0, scheme: 0, diagnostic: 0 };
    for (const record of list) counts[tierOf(record)] += 1;
    for (const tier of ["release", "scheme", "diagnostic"] as const) totals[tier] += counts[tier];
    const handwritten = list.filter((record) => record.answer.kind === "image").length;
    const multiMarked = list.filter((record) => record.humanMarks.length > 1).length;
    const stages = [...new Set(list.map((record) => stageOf(record)))].join(",");
    console.log(
      `${sourceId.padEnd(30)} ${pad(list.length, 7)} ${pad(counts.release, 8)} ${pad(counts.scheme, 8)} ` +
        `${pad(counts.diagnostic, 8)} ${pad(handwritten, 7)} ${pad(multiMarked, 6)}  ${stages}`
    );
  }
  console.log(
    `${"TOTAL".padEnd(30)} ${pad(records.length, 7)} ${pad(totals.release, 8)} ` +
      `${pad(totals.scheme, 8)} ${pad(totals.diagnostic, 8)}`
  );

  /*
   * The question Past Paper Practice actually needs answered. It serves GCSE
   * and post-16 school qualifications, so a graduate coursework record cannot
   * speak for it however exact its scheme is.
   */
  const schoolStages = new Set(["lowerSecondary", "upperSecondary", "postSixteen"]);
  const schoolRelease = records.filter(
    (record) => tierOf(record) === "release" && schoolStages.has(stageOf(record))
  );
  console.log("\nRelease-grade records at school stages, by regime and subject:");
  const groups = new Map<string, MarkingCorpusRecord[]>();
  for (const record of schoolRelease) {
    const key = `${record.regime} · ${record.subject} · ${record.level}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  if (groups.size === 0) console.log("  none");
  for (const [key, list] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    const questions = new Set(list.map((record) => record.questionId)).size;
    const handwritten = list.filter((record) => record.answer.kind === "image").length;
    console.log(
      `  ${key.padEnd(46)} ${pad(list.length, 5)} responses  ${pad(questions, 4)} questions  ${pad(handwritten, 4)} handwritten`
    );
  }

  /*
   * How far apart two humans are on the same answer is the ceiling on any
   * agreement figure worth reporting: a marker cannot sensibly be asked to
   * agree with a reference mark more closely than two examiners agree with
   * each other.
   */
  const disagreements = records
    .map((record) => humanDisagreement(record))
    .filter((value): value is number => typeof value === "number");
  console.log(
    `\nRecords with more than one human mark: ${disagreements.length}` +
      (disagreements.length
        ? `  ·  mean human-to-human gap ${(
            disagreements.reduce((sum, value) => sum + value, 0) / disagreements.length
          ).toFixed(2)} marks`
        : "  (human ceiling cannot be measured)")
  );

  console.log("\nLicences, and what each source may be used for:");
  for (const source of MARKING_CORPUS_SOURCES) {
    const held = bySource.get(source.id)?.length ?? 0;
    if (!held) continue;
    const licence = corpusSource(source.id)?.licence;
    console.log(
      `  ${source.id.padEnd(30)} ${licence?.verified ? "verified" : "UNVERIFIED"}` +
        ` ${licence?.redistributable ? "redistributable" : "measurement-only"}  ${licence?.id ?? "?"}`
    );
  }
}
