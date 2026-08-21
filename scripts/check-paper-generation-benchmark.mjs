#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const baselinePath = resolve(process.cwd(), process.env.PAPER_GENERATION_BASELINES || "benchmarks/paper-generation-baselines.json");
const reportArgument = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
const reportPath = reportArgument || process.env.PAPER_GENERATION_BENCHMARK_REPORT;
const HARD_BLOCKERS = [
  "unanswerable_question", "incorrect_scheme", "invalid_total", "answer_leak",
  "missing_insert", "broken_visual", "confirmed_copying", "privacy_failure",
  "ownership_failure",
];

function fail(message) {
  console.error(`Paper-generation benchmark gate failed: ${message}`);
  process.exitCode = 1;
}

function finiteScores(value) {
  return Array.isArray(value) && value.length > 0 && value.every((score) =>
    typeof score === "number" && Number.isFinite(score)
  );
}

function statisticallySupportedRegression(baseline, current) {
  if (!finiteScores(baseline) || !finiteScores(current) || baseline.length !== current.length) return true;
  let lower = 0;
  let higher = 0;
  for (let index = 0; index < baseline.length; index += 1) {
    if (current[index] < baseline[index]) lower += 1;
    if (current[index] > baseline[index]) higher += 1;
  }
  // Nine fixed paired cases make eight deteriorations with no more than one
  // improvement a one-sided sign-test result below 5%. The gate therefore
  // uses observed distributions instead of a hand-picked average score.
  return lower >= 8 && higher <= 1;
}

let baseline;
try { baseline = JSON.parse(await readFile(baselinePath, "utf8")); }
catch { fail(`no readable baseline registry at ${baselinePath}`); process.exit(); }
if (baseline.schemaVersion !== 2 || !baseline.components) {
  fail("baseline registry has an unsupported shape");
  process.exit();
}

const approved = Object.entries(baseline.components).filter(([, value]) => value?.approved === true);
if (!reportPath) {
  if (approved.length > 0) fail("an approved component baseline exists but no current report was supplied");
  else console.log("Paper-generation benchmark: all exact components are explicitly unmeasured; no release gate is active yet.");
  process.exit();
}

let report;
try { report = JSON.parse(await readFile(resolve(process.cwd(), reportPath), "utf8")); }
catch { fail(`no readable current report at ${reportPath}`); process.exit(); }
if (report.schemaVersion !== 2 || !report.components) fail("current report has an unsupported shape");
if (report.completedCases !== report.expectedCases || report.reviewedCases !== report.expectedCases) {
  fail("every expected benchmark case must complete and receive human review");
}
for (const blocker of HARD_BLOCKERS) {
  if (report.hardBlockers?.[blocker] !== 0) fail(`${blocker} must be present and equal zero`);
}

for (const [componentId, approvedBaseline] of approved) {
  const current = report.components[componentId];
  if (!current || current.cases !== 9 || current.usableCases !== current.cases) {
    fail(`${componentId} did not complete nine usable paired cases`);
    continue;
  }
  if (current.profileVersion !== approvedBaseline.profileVersion) {
    fail(`${componentId} used ${current.profileVersion}, not approved profile ${approvedBaseline.profileVersion}`);
  }
  for (const [metric, baselineDistribution] of Object.entries(approvedBaseline.scoreDistributions ?? {})) {
    const currentDistribution = current.scoreDistributions?.[metric];
    if (!finiteScores(currentDistribution) || currentDistribution.length !== 9) {
      fail(`${componentId}.${metric} has no complete paired distribution`);
    } else if (statisticallySupportedRegression(baselineDistribution, currentDistribution)) {
      fail(`${componentId}.${metric} shows a statistically supported paired regression`);
    }
  }
}

if (!process.exitCode) {
  const unmeasured = Object.entries(baseline.components)
    .filter(([, value]) => value?.approved !== true)
    .map(([name]) => name);
  console.log(`Paper-generation benchmark gate passed.${unmeasured.length ? ` Unmeasured exact components: ${unmeasured.join(", ")}.` : ""}`);
}
