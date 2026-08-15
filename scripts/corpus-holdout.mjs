/**
 * Audit the line between the benchmark and the exemplar pool.
 *
 * Reads the derived records written by `corpus-ingest`, splits them, and fails
 * loudly if anything used to measure Jami could also be retrieved into a
 * marking prompt. Exits non-zero on a leak so it can gate a run.
 *
 *   node --no-warnings scripts/corpus-holdout.mjs
 */
import process from "node:process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const OUT = resolve("artifacts/corpus");
const { splitCorpus, auditHoldout } = await import("../lib/evaluation/holdout.ts");

if (!existsSync(OUT)) {
  process.stdout.write(`No derived records at ${OUT}. Run corpus-ingest first.\n`);
  process.exit(1);
}

const records = [];
for (const file of readdirSync(OUT).filter((name) => name.endsWith(".json"))) {
  records.push(...JSON.parse(readFileSync(join(OUT, file), "utf8")).records);
}

const split = splitCorpus(records);
const findings = auditHoldout({ benchmark: split.benchmark, exemplars: split.exemplars });

const pad = (value, width) => String(value).padStart(width);
process.stdout.write(`\nRecords ${records.length} over ${split.groups.length} questions\n\n`);
process.stdout.write(`benchmark (held out)      ${pad(split.benchmark.length, 6)}\n`);
process.stdout.write(`exemplars (retrievable)   ${pad(split.exemplars.length, 6)}\n`);
process.stdout.write(`withheld, licence unclear ${pad(split.withheldForLicence.length, 6)}\n`);

const bySource = new Map();
for (const [side, group] of [
  ["benchmark", split.benchmark],
  ["exemplar", split.exemplars],
  ["licence", split.withheldForLicence],
]) {
  for (const record of group) {
    const row = bySource.get(record.sourceId) ?? { benchmark: 0, exemplar: 0, licence: 0 };
    row[side] += 1;
    bySource.set(record.sourceId, row);
  }
}

process.stdout.write(`\n${"source".padEnd(40)}${"bench".padStart(7)}${"exemplar".padStart(10)}${"licence".padStart(9)}\n`);
process.stdout.write(`${"-".repeat(40)}${" ".repeat(0)}${"-".repeat(26)}\n`);
for (const [sourceId, row] of [...bySource.entries()].sort()) {
  process.stdout.write(
    `${sourceId.padEnd(40)}${pad(row.benchmark, 7)}${pad(row.exemplar, 10)}${pad(row.licence, 9)}\n`
  );
}

const calibration = split.benchmark.filter((record) => record.humanMarks.length > 1).length;
process.stdout.write(
  `\nDouble-marked records, all held out: ${calibration}. These are the only measurement of` +
    ` how far two humans are apart, so none of them is retrievable.\n`
);

if (findings.length === 0) {
  process.stdout.write(`\nNo leaks: nothing measured can be retrieved into a prompt.\n`);
  process.exit(0);
}

process.stdout.write(`\nLEAKS (${findings.length}):\n`);
for (const finding of findings.slice(0, 20)) {
  process.stdout.write(`  [${finding.kind}] ${finding.detail}\n`);
}
if (findings.length > 20) process.stdout.write(`  ... and ${findings.length - 20} more\n`);
process.exit(1);
