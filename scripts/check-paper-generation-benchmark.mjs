#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const baselinePath = resolve(process.cwd(), process.env.PAPER_GENERATION_BASELINES || "benchmarks/paper-generation-baselines.json");
const reportArgument = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
const reportPath = reportArgument || process.env.PAPER_GENERATION_BENCHMARK_REPORT;

function fail(message) {
  console.error(`Paper-generation benchmark gate failed: ${message}`);
  process.exitCode = 1;
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

let baseline;
try { baseline = JSON.parse(await readFile(baselinePath, "utf8")); } catch {
  fail(`no readable baseline registry at ${baselinePath}`);
  process.exit();
}
if (baseline.schemaVersion !== 1 || !baseline.branches) {
  fail("baseline registry has an unsupported shape");
  process.exit();
}

const approved = Object.entries(baseline.branches).filter(([, value]) => value?.approved === true);
if (!reportPath) {
  if (approved.length > 0) fail("an approved baseline exists but no current report was supplied");
  else console.log("Paper-generation benchmark: all branches are explicitly unmeasured; no release gate is active yet.");
  process.exit();
}

let report;
try { report = JSON.parse(await readFile(resolve(process.cwd(), reportPath), "utf8")); } catch {
  fail(`no readable current report at ${reportPath}`);
  process.exit();
}
if (report.schemaVersion !== 1 || !report.branches) fail("current report has an unsupported shape");

for (const blocker of [
  "silentAttrition", "invalidScoring", "hiddenSchemeLeaks", "missingEvidence",
  "ownershipFailures", "privacyFailures", "missingRequiredFigures",
]) {
  if (report.blockers?.[blocker] !== 0) fail(`${blocker} must equal zero`);
}

for (const [branchName, approvedBaseline] of approved) {
  const current = report.branches?.[branchName];
  if (!current || current.status !== "measured") {
    fail(`${branchName} has an approved baseline but no measured current result`);
    continue;
  }
  if (!Number.isInteger(current.expectedCases) || current.expectedCases < 1 || current.completedCases !== current.expectedCases) {
    fail(`${branchName} did not complete every expected record`);
  }
  if (current.humanReviewedCases !== current.completedCases) {
    fail(`${branchName} was not fully reviewed for answerability and authenticity`);
  }
  for (const metric of [
    "specificationCoverage", "commandWordAuthenticity", "answerability",
    "schemeCorrectness", "visualValidity", "boundaryProvenance",
  ]) {
    const value = current.metrics?.[metric];
    const minimum = approvedBaseline.metrics?.[metric];
    if (!finite(value) || !finite(minimum) || value < minimum) {
      fail(`${branchName}.${metric} regressed below its approved paired baseline`);
    }
  }
  for (const metric of ["tariffDistributionError", "timingError", "choiceRuleError"]) {
    const value = current.metrics?.[metric];
    const maximum = approvedBaseline.metrics?.[metric];
    if (!finite(value) || !finite(maximum) || value > maximum) {
      fail(`${branchName}.${metric} regressed above its approved paired baseline`);
    }
  }
}

if (!process.exitCode) {
  const unmeasured = Object.entries(baseline.branches)
    .filter(([, value]) => value?.approved !== true)
    .map(([name]) => name);
  console.log(`Paper-generation benchmark gate passed.${unmeasured.length ? ` Unmeasured branches: ${unmeasured.join(", ")}.` : ""}`);
}
