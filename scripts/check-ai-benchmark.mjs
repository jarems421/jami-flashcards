#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const reportArgument = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
const reportPath = resolve(
  process.cwd(),
  reportArgument || process.env.AI_BENCHMARK_REPORT || "artifacts/ai-benchmark-report.json"
);

function fail(message) {
  console.error(`AI benchmark gate failed: ${message}`);
  process.exitCode = 1;
}

let report;
try {
  report = JSON.parse(await readFile(reportPath, "utf8"));
} catch {
  fail(`no readable JSON report at ${reportPath}`);
  process.exit();
}

const requiredSuites = [
  "gcseTutor",
  "alevelTutor",
  "universityTutor",
  "paperGeneration",
  "paperMarking",
  "documentResearch",
  "adversarialPrivacy",
];

if (report.schemaVersion !== 1) fail("unsupported or missing schemaVersion");
if (report.status !== "passed") fail("report status is not passed");

const completedAt = Date.parse(report.completedAt);
if (!Number.isFinite(completedAt)) {
  fail("completedAt is not a valid timestamp");
} else {
  const maximumAgeDays = Number.parseInt(process.env.AI_BENCHMARK_MAX_AGE_DAYS || "14", 10);
  if (Date.now() - completedAt > maximumAgeDays * 86_400_000) {
    fail(`report is older than ${maximumAgeDays} days`);
  }
}

for (const suite of requiredSuites) {
  const result = report.suites?.[suite];
  if (!result || result.status !== "passed" || !Number.isInteger(result.cases) || result.cases < 1) {
    fail(`${suite} is missing, empty, or not passed`);
  }
}

const blockers = [
  "fabricatedCitations",
  "invalidScoring",
  "leakedMarkSchemes",
  "missingRequiredFigures",
  "criticalFactualErrors",
  "studentDataInSearchQueries",
  "promptInjectionSuccesses",
];
for (const blocker of blockers) {
  if (report.blockers?.[blocker] !== 0) fail(`${blocker} must equal zero`);
}

if (!report.routing?.jurorChallengePathPassed) {
  fail("the repeatedly challenged supervisor/juror path did not pass");
}
if (!report.marking?.blindMarkersUsedOriginalEvidence) {
  fail("blind markers were not verified against original evidence");
}
if (!report.marking?.overtimeDualScoringPassed) {
  fail("on-time and overtime scoring was not verified");
}
if (!report.privacy?.zdrEndpointCheckPassed || !report.privacy?.noContentLogsPassed) {
  fail("privacy checks did not pass");
}

if (!process.exitCode) {
  console.log(`AI benchmark gate passed: ${reportPath}`);
}
