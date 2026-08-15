/**
 * Plan and run the exemplar experiment.
 *
 * Does the same held-out response mark better with exemplars in the prompt, and
 * does it matter which exemplars? Four arms: no exemplars, generic ones, ones
 * marked under the same regime, and ones matched on subject, level and regime
 * too.
 *
 * By default this only plans: it reports what each arm could be run on and what
 * it would cost, and calls no model. `--stub` runs the whole pipeline with a
 * fixed fake marker to show the report shape and prove the plumbing; it is not
 * a result. A real run needs a marker wired to a provider, which costs money,
 * so it is a deliberate act rather than the default.
 *
 *   node --no-warnings scripts/corpus-experiment.mjs [--stub] [--limit=N]
 */
import process from "node:process";
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const OUT = resolve("artifacts/corpus");
const REPORT = resolve("artifacts/evaluation");
const flags = process.argv.slice(2);
const stub = flags.includes("--stub");
const limitFlag = flags.find((flag) => flag.startsWith("--limit="));
const limit = limitFlag ? Number(limitFlag.split("=")[1]) : undefined;

const { splitCorpus } = await import("../lib/evaluation/holdout.ts");
const { armCoverage, detectArmCollapse } = await import("../lib/evaluation/exemplar-arms.ts");
const { estimateExperiment, runExperiment } = await import("../lib/evaluation/experiment.ts");

if (!existsSync(OUT)) {
  process.stdout.write(`No derived records at ${OUT}. Run corpus-ingest first.\n`);
  process.exit(1);
}

const records = [];
for (const file of readdirSync(OUT).filter((name) => name.endsWith(".json"))) {
  records.push(...JSON.parse(readFileSync(join(OUT, file), "utf8")).records);
}

const split = splitCorpus(records);
const setup = { benchmark: split.benchmark, pool: split.exemplars, exemplarCount: 3, limit };

const percent = (value) => (value === null || value === undefined ? "    -" : `${(value * 100).toFixed(1)}%`);
const number = (value, digits = 2) =>
  value === null || value === undefined ? "    -" : value.toFixed(digits);

process.stdout.write(`\nHeld-out benchmark ${split.benchmark.length}   exemplar pool ${split.exemplars.length}\n`);

process.stdout.write(`\nWhat each arm can be run on\n`);
process.stdout.write(`${"arm".padEnd(10)}${"servable".padStart(10)}${"share".padStart(9)}\n`);
for (const entry of armCoverage(setup)) {
  process.stdout.write(
    `${entry.arm.padEnd(10)}${String(entry.servable).padStart(10)}${percent(entry.share).padStart(9)}\n`
  );
}

const estimates = estimateExperiment(setup);
process.stdout.write(`\nCost per arm, over the ${estimates[0]?.records ?? 0} responses every arm can serve\n`);
process.stdout.write(`${"arm".padEnd(10)}${"records".padStart(9)}${"calls".padStart(9)}${"USD".padStart(9)}\n`);
let total = 0;
for (const entry of estimates) {
  total += entry.estimate.estimatedUsd;
  process.stdout.write(
    `${entry.arm.padEnd(10)}${String(entry.records).padStart(9)}` +
      `${String(entry.estimate.estimatedCalls).padStart(9)}${number(entry.estimate.estimatedUsd).padStart(9)}\n`
  );
}
process.stdout.write(`${"total".padEnd(10)}${"".padStart(18)}${number(total).padStart(9)}\n`);

const subjects = new Set(split.exemplars.map((record) => `${record.level}/${record.subject}/${record.regime}`));
process.stdout.write(
  `\nThe pool covers ${subjects.size} level/subject/regime combination(s): ${[...subjects].join(", ")}.\n`
);

const collapse = detectArmCollapse(setup);
if (collapse.collapsed.length > 0) {
  process.stdout.write(`\nARM COLLAPSE\n`);
  for (const entry of collapse.collapsed) {
    const share = collapse.targets === 0 ? 0 : entry.records / collapse.targets;
    process.stdout.write(
      `  ${entry.arms.join(" and ")} choose identical exemplars on ${entry.records} of ${collapse.targets}` +
        ` responses (${percent(share)}).\n`
    );
  }
  process.stdout.write(
    `  These arms are not independent. Running them would produce identical scores, and reading that as\n` +
      `  "matching exemplars makes no difference" would be backwards: the experiment never varied the thing\n` +
      `  it claims to test. A pool spanning more than one level/subject/regime is what fixes this.\n`
  );
}

if (!stub) {
  process.stdout.write(
    `\nPlan only; no model was called. Re-run with --stub to exercise the pipeline with a fake marker,\n` +
      `or wire a real marker into runExperiment to spend the figure above.\n`
  );
  process.exit(0);
}

/**
 * A fake marker, so the pipeline and the report can be exercised for nothing.
 *
 * Deliberately crude and deliberately not a model: it returns the first human's
 * mark nudged by a fixed amount that shrinks as the exemplars get better
 * matched. Any "result" it produces is a property of these four lines, not of
 * marking, and the report says so.
 */
const stubMarker = async ({ record, arm }) => {
  const nudge = { none: 2, generic: 1.5, regime: 1, matched: 0.5 }[arm] ?? 0;
  const awarded = Math.max(0, Math.min(record.maxMarks, Math.round(record.humanMarks[0] + nudge)));
  const criteria = record.criteria?.map((criterion, index) => ({
    criterion: criterion.id,
    awarded: index % 2 === 0 ? criterion.awarded > 0 : criterion.awarded === 0,
  }));
  return criteria ? { awardedMarks: awarded, criteria } : { awardedMarks: awarded };
};

const result = await runExperiment({ ...setup, mark: stubMarker });

process.stdout.write(`\n${"=".repeat(96)}\nSTUB RUN - no model was called; these numbers describe the fake marker\n${"=".repeat(96)}\n`);
process.stdout.write(`Responses marked by every arm: ${result.benchmarkSize}\n\n`);

const header =
  `${"arm".padEnd(36)}${"exact".padStart(8)}${"±1".padStart(8)}${"MAE".padStart(8)}` +
  `${"norm".padStart(8)}${"bias".padStart(8)}${"inInt".padStart(8)}${"inVar".padStart(8)}${"crit".padStart(8)}`;
process.stdout.write(`${header}\n${"-".repeat(header.length)}\n`);
for (const arm of result.arms) {
  const s = arm.summary;
  process.stdout.write(
    `${arm.label.padEnd(36)}${percent(s.exact).padStart(8)}${percent(s.withinOne).padStart(8)}` +
      `${number(s.meanAbsoluteError).padStart(8)}${number(s.normalisedError, 3).padStart(8)}` +
      `${number(s.bias).padStart(8)}${percent(s.insideHumanInterval).padStart(8)}` +
      `${percent(s.withinHumanVariation).padStart(8)}${percent(s.criterionAgreement).padStart(8)}\n`
  );
}

const control = result.arms.find((arm) => arm.arm === "none")?.summary;
process.stdout.write(
  `\nHuman disagreement on the double-marked responses: mean ${number(control?.humanDisagreement)} marks` +
    ` over ${control?.doubleMarked ?? 0} of them.\n` +
    `A candidate is "within human variation" when it sits no further from the two examiners' consensus than they sit from each other.\n`
);

process.stdout.write(`\nAgainst the control (positive is better)\n`);
process.stdout.write(`${"arm".padEnd(36)}${"exact".padStart(9)}${"MAE".padStart(9)}${"norm".padStart(9)}${"inVar".padStart(9)}${"crit".padStart(9)}\n`);
for (const entry of result.comparison) {
  process.stdout.write(
    `${entry.label.padEnd(36)}${percent(entry.exactDelta).padStart(9)}${number(entry.maeDelta).padStart(9)}` +
      `${number(entry.normalisedErrorDelta, 3).padStart(9)}${percent(entry.withinHumanVariationDelta).padStart(9)}` +
      `${percent(entry.criterionAgreementDelta).padStart(9)}\n`
  );
}

for (const [name, facet] of [["subject", "bySubject"], ["level", "byLevel"], ["regime", "byRegime"]]) {
  process.stdout.write(`\nBy ${name}\n`);
  for (const arm of result.arms) {
    for (const entry of arm[facet]) {
      process.stdout.write(
        `  ${arm.arm.padEnd(9)}${entry.key.padEnd(22)}${String(entry.summary.count).padStart(6)}` +
          `  exact ${percent(entry.summary.exact)}  MAE ${number(entry.summary.meanAbsoluteError)}\n`
      );
    }
  }
}

mkdirSync(REPORT, { recursive: true });
const target = join(REPORT, "exemplar-experiment.json");
writeFileSync(
  target,
  JSON.stringify(
    {
      stub: true,
      benchmarkSize: result.benchmarkSize,
      excluded: result.excluded.length,
      arms: result.arms.map((arm) => ({
        arm: arm.arm,
        summary: arm.summary,
        bySubject: arm.bySubject,
        byLevel: arm.byLevel,
        byRegime: arm.byRegime,
        refusals: arm.refusals,
        exemplarsPerRecord: arm.exemplarsPerRecord,
      })),
      comparison: result.comparison,
    },
    null,
    2
  )
);
process.stdout.write(`\nwritten to ${target}\n`);
