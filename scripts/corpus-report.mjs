/**
 * What the evaluation corpus covers, and what it does not.
 *
 * Reads the catalogue only — it does not touch the datasets themselves, so it
 * costs nothing and works before anything has been downloaded. Its job is to
 * make gaps visible rather than let breadth be assumed.
 *
 *   node scripts/corpus-report.mjs
 */
import process from "node:process";

// The catalogue deliberately imports nothing, so Node's own type stripping can
// load it directly without a bundler, a loader or a path-alias resolver.
const { MARKING_CORPUS_SOURCES, corpusCoverageGaps, corpusSubjects, isShippableAsExemplar } =
  await import("../lib/evaluation/marking-corpus.ts");

const LEVEL_LABELS = {
  gcse: "GCSE",
  alevel: "A-level",
  advancedHigher: "Advanced Higher",
  undergraduate: "Undergraduate",
  postgraduate: "Postgraduate",
};

function table(rows, headers) {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => String(row[index] ?? "").length))
  );
  const line = (cells) =>
    cells.map((cell, index) => String(cell ?? "").padEnd(widths[index])).join("  ");
  process.stdout.write(`${line(headers)}\n`);
  process.stdout.write(`${widths.map((width) => "-".repeat(width)).join("  ")}\n`);
  for (const row of rows) process.stdout.write(`${line(row)}\n`);
}

process.stdout.write(`\nSources: ${MARKING_CORPUS_SOURCES.length}\n\n`);

table(
  MARKING_CORPUS_SOURCES.map((source) => [
    LEVEL_LABELS[source.level] ?? source.level,
    source.id,
    source.subjects.length,
    source.regimes.join(","),
    source.handwritten ? "hand" : "typed",
    source.commentary ? "commentary" : "",
    isShippableAsExemplar(source) ? "shippable" : "measure-only",
  ]),
  ["level", "source", "subj", "regimes", "form", "notes", "use"]
);

process.stdout.write(`\nSubjects (${corpusSubjects().length}): ${corpusSubjects().join(", ")}\n`);

const shippable = MARKING_CORPUS_SOURCES.filter(isShippableAsExemplar).length;
process.stdout.write(
  `\nExemplar-eligible: ${shippable} of ${MARKING_CORPUS_SOURCES.length}.` +
    ` Unverified licences are treated as measure-only until someone reads the terms.\n`
);

const gaps = corpusCoverageGaps();
process.stdout.write(`\nUncovered level/regime combinations: ${gaps.length}\n`);
for (const gap of gaps) {
  process.stdout.write(`  ${LEVEL_LABELS[gap.level] ?? gap.level} / ${gap.regime}\n`);
}
process.stdout.write(
  "\nProof-style marking has no marked corpus at any level and needs a hand-marked regression set.\n\n"
);
