#!/usr/bin/env node

/**
 * The release gate for marking quality.
 *
 * Nothing in this repository has ever been able to block a release on how well
 * the marker marks. `OPENROUTER_QUALITY_GATE_PASSED` is a boolean an operator
 * sets by hand and nothing verifies, and `check-ai-benchmark.mjs` asks the
 * marking suite only for `cases >= 1` and a self-declared "passed".
 *
 * Two rules shape everything here:
 *
 * 1. **Fail safe before anything is measured.** The registry ships with every
 *    component `unmeasured`, so this prints and exits clean. It becomes a gate
 *    as a *result* of a run, not as a stub waiting to be filled in. What it
 *    must never do is silently pass once a component has been approved and the
 *    report stops being supplied.
 *
 * 2. **Judge against the human ceiling, not an absolute.** Examiners agree
 *    exactly on 72% of the same GCSE maths answers, and are 4.6 marks apart on
 *    a 20-mark essay. A bar of "80% exact agreement" would be asking the marker
 *    to beat the people it is measured against; a bar of "50%" would pass a
 *    marker that is plainly worse than them. So the thresholds are ratios to
 *    what the humans did on the same records.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const baselinePath = resolve(
  process.cwd(),
  process.env.MARKING_QUALITY_BASELINES || "benchmarks/marking-quality-baselines.json"
);
const reportArgument = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
const reportPath = reportArgument || process.env.MARKING_QUALITY_REPORT;

function fail(message) {
  console.error(`Marking-quality gate failed: ${message}`);
  process.exitCode = 1;
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

let baseline;
try {
  baseline = JSON.parse(await readFile(baselinePath, "utf8"));
} catch {
  fail(`no readable baseline registry at ${baselinePath}`);
  process.exit();
}
if (baseline.schemaVersion !== 1 || !baseline.components || !baseline.thresholds) {
  fail("baseline registry has an unsupported shape");
  process.exit();
}

const approved = Object.entries(baseline.components).filter(([, value]) => value?.approved === true);
if (!reportPath) {
  if (approved.length > 0) {
    fail("an approved marking baseline exists but no current report was supplied");
  } else {
    console.log(
      "Marking quality: every component is explicitly unmeasured; no release gate is active yet."
    );
  }
  process.exit();
}

let report;
try {
  report = JSON.parse(await readFile(resolve(process.cwd(), reportPath), "utf8"));
} catch {
  fail(`no readable current report at ${reportPath}`);
  process.exit();
}
if (report.schemaVersion !== 1 || !report.components) {
  fail("current report has an unsupported shape");
  process.exit();
}

const thresholds = baseline.thresholds;

for (const [name, component] of approved) {
  const current = report.components[name];
  if (!current) {
    fail(`approved component ${name} is missing from the current report`);
    continue;
  }

  /*
   * A run that measured the wrong pipeline is not a smaller version of the
   * right one. Whole-paper marking is two blind markers plus a juror on every
   * question; single-question marking is adaptive and buys a second marker only
   * when the mark is likely to be wrong. Reporting one as the other flatters
   * the product by an ensemble the student is never given.
   */
  if (current.pipeline !== component.pipeline) {
    fail(`${name} was measured on the ${current.pipeline} pipeline, not ${component.pipeline}`);
    continue;
  }

  /*
   * The number describes a marker, and the marker can change underneath it.
   *
   * A provider updating a model shifts severity without shifting anything this
   * repository can see, and routing moves on its own: a failover has already
   * reached a different model family here. A baseline measured on one set of
   * models does not describe a run produced by another, so this refuses rather
   * than comparing them.
   */
  const baselineModels = component.models;
  if (Array.isArray(baselineModels) && baselineModels.length > 0) {
    const currentModels = Array.isArray(current.models) ? [...current.models].sort() : [];
    const expected = [...baselineModels].sort();
    if (currentModels.join("|") !== expected.join("|")) {
      fail(
        `${name} was measured on ${expected.join(", ") || "(none recorded)"} but this run used ` +
          `${currentModels.join(", ") || "(none recorded)"}; re-measure before gating on it`
      );
      continue;
    }
  }

  if (!finite(current.records) || current.records < thresholds.minRecords) {
    fail(`${name} measured ${current.records} records, below the ${thresholds.minRecords} required`);
    continue;
  }

  /*
   * Unaccounted cost is a correctness problem here, not just a billing one: a
   * marking whose calls went unreported may have been routed somewhere the run
   * did not intend, so the figures may not describe the marker being gated.
   */
  if (current.unaccountedMarkings > 0) {
    fail(`${name} has ${current.unaccountedMarkings} markings with unreported cost; the run is not accountable`);
    continue;
  }

  /*
   * The comparison has to be like for like, and the obvious version is not.
   *
   * `humanDisagreement` is the distance between the two examiners; the marker's
   * error is its distance to their consensus. Those are different scales -- each
   * examiner sits roughly half the gap from the consensus they jointly define --
   * so comparing one to the other directly makes the marker look twice as good
   * as it is. Half the human gap is what the marker is actually being measured
   * against.
   */
  const humanGap = current.humanDisagreement;
  const candidateDistance = current.candidateDisagreement;
  if (!finite(humanGap) || !finite(candidateDistance) || humanGap <= 0) {
    fail(`${name} reports no double-marked human benchmark to be judged against`);
    continue;
  }
  const humanDistance = humanGap / 2;

  if (!finite(current.withinHumanVariationShare) ||
      current.withinHumanVariationShare < thresholds.minWithinHumanVariationShare) {
    fail(
      `${name} landed inside the examiners' own spread on ` +
        `${current.withinHumanVariationShare} of answers, below ${thresholds.minWithinHumanVariationShare}`
    );
  }

  /*
   * Bias is checked separately from error size because it is the failure this
   * marker actually has: it has run generous through every configuration tried,
   * and a generous marker can look accurate on average while telling every
   * student they did better than they did.
   */
  if (!finite(current.meanBias) || Math.abs(current.meanBias) > thresholds.maxAbsoluteMeanBias) {
    fail(`${name} is biased by ${current.meanBias} marks, beyond ±${thresholds.maxAbsoluteMeanBias}`);
  }

  const ratio = candidateDistance / humanDistance;
  if (!finite(ratio) || ratio > thresholds.maxDistanceOverHuman) {
    fail(
      `${name} sits ${ratio.toFixed(2)}x as far from the examiners' consensus as they sit ` +
        `from it themselves, beyond ${thresholds.maxDistanceOverHuman}x`
    );
  }
}

if (process.exitCode !== 1) {
  console.log(`Marking quality: ${approved.length} approved component(s) within threshold.`);
}
