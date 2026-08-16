import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { MarkingCorpusRecord } from "@/lib/evaluation/marking-corpus";
import { splitCorpus } from "@/lib/evaluation/holdout";
import { stratifiedSlice } from "@/lib/evaluation/sampling";
import { adaptRecordToPaper } from "@/lib/evaluation/practice-paper-adapter";
import { createEvaluationMarker } from "@/services/ai/evaluation-marker.server";

/**
 * Why does the blind pair disagree on every response?
 *
 * The smoke test adjudicated 46 of 46 markings, which either means the two
 * markers genuinely never agree or means the dispute rule fires on something
 * other than the marks. This measures which, and changes nothing: no threshold
 * is touched, no production behaviour altered. It marks with no exemplars, so
 * what it observes is what a student gets today.
 *
 * The marking audit already records what each blind marker awarded and which
 * questions were disputed, which is enough to separate the two cases:
 *
 *   disputed, marks equal      -> something other than the marks caused it
 *   disputed, marks different  -> a real disagreement, and by how much
 *
 * and comparing the final mark against the primary's says whether adjudication
 * actually changed the outcome or merely cost a call.
 *
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs \
 *     scripts/eval/adjudication-diagnostic.ts --size=20 --confirm
 */

const CORPUS = resolve("artifacts/corpus");
const REPORT = resolve("artifacts/evaluation");

export default async function main(args: string[]) {
  const size = Number(args.find((a) => a.startsWith("--size="))?.split("=")[1] ?? 20);

  const records: MarkingCorpusRecord[] = [];
  for (const file of readdirSync(CORPUS).filter((name) => name.endsWith(".json"))) {
    records.push(...JSON.parse(readFileSync(join(CORPUS, file), "utf8")).records);
  }
  const split = splitCorpus(records);
  const markable = split.benchmark.filter((record) => adaptRecordToPaper(record).ok);
  const sample = stratifiedSlice({ records: markable, size, seed: "adjudication-diagnostic" });

  process.stdout.write(`\nDiagnostic sample of ${sample.length}, marked with no exemplars (production behaviour).\n`);
  for (const record of sample) {
    process.stdout.write(`  ${record.id.padEnd(30)} ${record.sourceId} out of ${record.maxMarks}\n`);
  }

  if (!args.includes("--confirm")) {
    process.stdout.write(`\nNothing called. Re-run with --confirm.\n`);
    return;
  }

  mkdirSync(REPORT, { recursive: true });
  const journal = join(REPORT, "adjudication-diagnostic.jsonl");
  writeFileSync(journal, "");

  const audits: {
    record: string;
    primary: number | undefined;
    verifier: number | undefined;
    final: number | undefined;
    disputed: boolean;
    adjudicated: boolean;
    thirdView: boolean;
  }[] = [];

  const { mark, stats } = createEvaluationMarker({
    maxRecords: sample.length + 4,
    onAudit: (audit) => {
      audits.push(audit);
      appendFileSync(journal, `${JSON.stringify(audit)}\n`);
      const gap =
        audit.primary !== undefined && audit.verifier !== undefined
          ? Math.abs(audit.primary - audit.verifier)
          : null;
      process.stdout.write(
        `  ${audit.record.padEnd(30)} primary ${String(audit.primary).padStart(3)}` +
          `  verifier ${String(audit.verifier).padStart(3)}  gap ${String(gap).padStart(3)}` +
          `  final ${String(audit.final).padStart(3)}  ${audit.disputed ? "DISPUTED" : "agreed"}\n`
      );
    },
    onFallback: () => {},
  });

  process.stdout.write(`\nMarking ${sample.length} responses through the production path...\n\n`);
  for (const record of sample) {
    await mark({ record, arm: "none", exemplars: [] });
  }

  const complete = audits.filter((a) => a.primary !== undefined && a.verifier !== undefined);
  const gaps = complete.map((a) => Math.abs((a.primary ?? 0) - (a.verifier ?? 0)));
  const sameMark = complete.filter((a) => a.primary === a.verifier);
  const differentMark = complete.filter((a) => a.primary !== a.verifier);
  const disputedDespiteSameMark = sameMark.filter((a) => a.disputed);
  const changedByAdjudication = complete.filter(
    (a) => a.adjudicated && a.final !== undefined && a.final !== a.primary
  );
  const mean = (values: number[]) =>
    values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length;

  process.stdout.write(`\n${"=".repeat(70)}\nADJUDICATION DIAGNOSTIC\n${"=".repeat(70)}\n`);
  process.stdout.write(`markings with both markers  ${complete.length}\n`);
  process.stdout.write(`disputed                    ${complete.filter((a) => a.disputed).length}\n\n`);

  process.stdout.write(`WHY THEY WERE DISPUTED\n`);
  process.stdout.write(`  markers awarded the SAME mark, still disputed  ${disputedDespiteSameMark.length}\n`);
  process.stdout.write(`  markers awarded DIFFERENT marks                ${differentMark.length}\n\n`);

  process.stdout.write(`DISAGREEMENT MAGNITUDE (marks apart)\n`);
  const distribution = new Map<number, number>();
  for (const gap of gaps) distribution.set(gap, (distribution.get(gap) ?? 0) + 1);
  for (const gap of [...distribution.keys()].sort((a, b) => a - b)) {
    process.stdout.write(`  ${String(gap).padStart(3)} marks apart  ${String(distribution.get(gap)).padStart(3)}\n`);
  }
  process.stdout.write(`  mean gap ${mean(gaps).toFixed(2)}\n\n`);

  process.stdout.write(`DID ADJUDICATION CHANGE ANYTHING\n`);
  process.stdout.write(`  adjudicated                       ${complete.filter((a) => a.adjudicated).length}\n`);
  process.stdout.write(`  final mark differs from primary   ${changedByAdjudication.length}\n`);
  process.stdout.write(`  third view completed              ${complete.filter((a) => a.thirdView).length}\n`);
  process.stdout.write(`\nfailed ${stats.failed}, rate-limited waits ${stats.rateLimited}\n`);
  process.stdout.write(`\nwritten to ${journal}\n`);
}
