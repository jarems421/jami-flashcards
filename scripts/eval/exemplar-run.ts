import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

import type { MarkingCorpusRecord } from "@/lib/evaluation/marking-corpus";
import { splitCorpus } from "@/lib/evaluation/holdout";
import { commonBenchmark, detectArmCollapse } from "@/lib/evaluation/exemplar-arms";
import { runExperiment } from "@/lib/evaluation/experiment";
import { stratifiedSlice } from "@/lib/evaluation/sampling";
import { adaptRecordToPaper } from "@/lib/evaluation/practice-paper-adapter";
import { createEvaluationMarker } from "@/services/ai/evaluation-marker.server";

/**
 * The exemplar experiment, against Jami's real marking path.
 *
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs \
 *     scripts/eval/exemplar-run.ts --smoke=12
 *   ... --slice=150
 *
 * Nothing is marked without `--smoke` or `--slice`. With neither, this prints
 * the plan and the sample composition and stops, because the difference between
 * planning and spending should be a flag somebody typed rather than a default.
 */

const CORPUS = resolve("artifacts/corpus");
const REPORT = resolve("artifacts/evaluation");

const percent = (value: number | null | undefined) =>
  value === null || value === undefined ? "    -" : `${(value * 100).toFixed(1)}%`;
const number = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined ? "    -" : value.toFixed(digits);

function loadRecords() {
  if (!existsSync(CORPUS)) throw new Error(`No derived records at ${CORPUS}. Run corpus-ingest first.`);
  const records: MarkingCorpusRecord[] = [];
  for (const file of readdirSync(CORPUS).filter((name) => name.endsWith(".json"))) {
    records.push(...JSON.parse(readFileSync(join(CORPUS, file), "utf8")).records);
  }
  return records;
}

function describeSample(sample: readonly MarkingCorpusRecord[]) {
  const tally = new Map<string, number>();
  for (const record of sample) {
    const share = record.maxMarks > 0 ? record.humanMarks[0] / record.maxMarks : 0;
    const band = Math.min(3, Math.max(0, Math.floor(share * 4)));
    const key = `${record.sourceId} ${record.level}/${record.subject}/${record.regime} band${band}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  return [...tally.entries()].sort(([left], [right]) => left.localeCompare(right));
}

export default async function main(args: string[]) {
  const flag = (name: string) => args.find((value) => value.startsWith(`--${name}=`))?.split("=")[1];
  const smoke = flag("smoke");
  const slice = flag("slice");
  const size = Number(smoke ?? slice ?? 0);
  const mode = smoke ? "smoke" : slice ? "slice" : "plan";

  const records = loadRecords();
  const split = splitCorpus(records);
  const setup = { benchmark: split.benchmark, pool: split.exemplars, count: 3 };

  process.stdout.write(`\nHeld-out benchmark ${split.benchmark.length}   exemplar pool ${split.exemplars.length}\n`);

  const servable = commonBenchmark(setup);
  // Only text answers can be sent, so the sample is drawn from what the runner
  // can actually mark rather than filtered afterwards, which would leave the
  // stratification lopsided in whatever direction the scans happened to fall.
  const markable = servable.filter((record) => adaptRecordToPaper(record).ok);
  process.stdout.write(
    `Servable by every arm ${servable.length}, of which markable as text ${markable.length}\n`
  );

  const collapse = detectArmCollapse({ ...setup, targets: markable });
  if (collapse.collapsed.length > 0) {
    process.stdout.write(`\nARM COLLAPSE — the arms are not independent:\n`);
    for (const entry of collapse.collapsed) {
      process.stdout.write(`  ${entry.arms.join(" and ")} identical on ${entry.records} responses\n`);
    }
    process.stdout.write(`  Running would compare an arm against itself. Stopping.\n`);
    return;
  }
  process.stdout.write(`No arm collapse: every arm selects a different set.\n`);

  const sample = size > 0 ? stratifiedSlice({ records: markable, size }) : [];
  if (size > 0) {
    process.stdout.write(`\nSample of ${sample.length}, stratified by source, regime and attainment:\n`);
    for (const [key, count] of describeSample(sample)) {
      process.stdout.write(`  ${String(count).padStart(4)}  ${key}\n`);
    }
  }

  if (mode === "plan") {
    process.stdout.write(
      `\nPlan only. Nothing was marked and no model was called.\n` +
        `Add --smoke=12 for a small end-to-end check, or --slice=150 for the real run.\n`
    );
    return;
  }

  /**
   * Spending is a second, explicit step. Naming a size shows what would run;
   * only `--confirm` makes calls. A run that started because someone typed a
   * number is a run nobody decided to pay for.
   */
  if (!args.includes("--confirm")) {
    process.stdout.write(
      `\nThis would mark ${sample.length} responses in each of 4 arms through the production path` +
        ` — about ${sample.length * 4} markings, ${sample.length * 8}+ model calls once the blind pair` +
        ` and adjudication are counted.\n` +
        `Nothing has been called. Re-run with --confirm to start.\n`
    );
    return;
  }

  // Four arms over the sample, plus adjudication where the blind markers
  // disagree. The ceiling is generous enough for that and hard enough to stop
  // a runaway.
  const maxRecords = sample.length * 4 + 8;
  const { mark, stats } = createEvaluationMarker({
    maxRecords,
    onProgress: ({ done, record, arm, awarded, error }) => {
      const outcome = error ? `FAILED ${error.slice(0, 60)}` : `awarded ${awarded}`;
      process.stdout.write(`  [${String(done).padStart(4)}/${maxRecords}] ${arm.padEnd(8)} ${record.padEnd(28)} ${outcome}\n`);
    },
    onFallback: (fields) => process.stdout.write(`  fallback: ${JSON.stringify(fields).slice(0, 160)}\n`),
  });

  process.stdout.write(
    `\n${mode === "smoke" ? "SMOKE TEST" : "SLICE RUN"}: ${sample.length} responses x 4 arms through the` +
      ` production marking path (blind pair, adjudication, juror third view).\n\n`
  );

  /**
   * Every marking is appended as it lands.
   *
   * The first real run was killed at 88% and every completed marking went with
   * it, because results were only written at the end. A run this slow has to be
   * able to lose its tail without losing its body.
   */
  mkdirSync(REPORT, { recursive: true });
  const journal = join(REPORT, `exemplar-${mode}.jsonl`);
  writeFileSync(journal, "");

  const started = Date.now();
  const result = await runExperiment({
    ...setup,
    benchmark: sample,
    mark,
    // Marking is almost entirely waiting, and one model in the ensemble sits on
    // a 60-second timeout, so running several at once stops the slow ones
    // blocking everything behind them. Three rather than six: the supervisor is
    // called two or three times per marking, and six put twenty of its calls in
    // flight and drew rate limits.
    concurrency: 3,
    onOutcome: (outcome, arm) => {
      appendFileSync(journal, `${JSON.stringify({ arm, ...outcome })}\n`);
    },
  });
  const minutes = ((Date.now() - started) / 60_000).toFixed(1);

  process.stdout.write(
    `\nMarked ${stats.marked} of ${stats.attempted} attempts in ${minutes} min` +
      ` (${stats.failed} failed, ${stats.unsupported} unsupported,` +
      ` ${stats.adjudicated} adjudicated, ${stats.thirdView} went to the juror).\n`
  );
  for (const reason of stats.reasons.slice(0, 10)) process.stdout.write(`  ${reason}\n`);

  process.stdout.write(
    `
Headline figures are paired: computed over the ${result.pairedSize} responses every arm marked.
` +
      `Averaging each arm over its own survivors compares different exams and invents effects from attrition.
`
  );
  const header =
    `${"arm".padEnd(36)}${"n".padStart(6)}${"exact".padStart(8)}${"±1".padStart(8)}${"MAE".padStart(8)}` +
    `${"norm".padStart(8)}${"bias".padStart(8)}${"inVar".padStart(8)}${"crit".padStart(8)}`;
  process.stdout.write(`\n${header}\n${"-".repeat(header.length)}\n`);
  for (const arm of result.arms) {
    const s = arm.summary;
    process.stdout.write(
      `${arm.label.padEnd(36)}${String(s.count).padStart(6)}${percent(s.exact).padStart(8)}` +
        `${percent(s.withinOne).padStart(8)}${number(s.meanAbsoluteError).padStart(8)}` +
        `${number(s.normalisedError, 3).padStart(8)}${number(s.bias).padStart(8)}` +
        `${percent(s.withinHumanVariation).padStart(8)}${percent(s.criterionAgreement).padStart(8)}\n`
    );
  }

  process.stdout.write(`\nAgainst the control (positive is better)\n`);
  for (const entry of result.comparison) {
    process.stdout.write(
      `  ${entry.label.padEnd(36)} exact ${percent(entry.exactDelta)}  MAE ${number(entry.maeDelta)}` +
        `  norm ${number(entry.normalisedErrorDelta, 3)}  crit ${percent(entry.criterionAgreementDelta)}\n`
    );
  }

  if (mode === "smoke") {
    process.stdout.write(
      `\nA smoke test proves the pipeline, not the feature. ${sample.length} responses cannot separate` +
        ` these arms from noise; read it only as "the plumbing works".\n`
    );
  }

  mkdirSync(REPORT, { recursive: true });
  const target = join(REPORT, `exemplar-${mode}.json`);
  writeFileSync(
    target,
    JSON.stringify(
      {
        mode,
        markedAt: new Date().toISOString(),
        sampleSize: sample.length,
        markerStats: stats,
        arms: result.arms.map((arm) => ({
          arm: arm.arm,
          summary: arm.summary,
          bySubject: arm.bySubject,
          byLevel: arm.byLevel,
          byRegime: arm.byRegime,
          refusals: arm.refusals,
          outcomes: arm.outcomes,
        })),
        comparison: result.comparison,
      },
      null,
      2
    )
  );
  process.stdout.write(`\nwritten to ${target}\n`);
}
