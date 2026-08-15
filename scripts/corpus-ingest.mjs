/**
 * Ingest a corpus source and report what came out of it.
 *
 * Reads from the dataset root only, writes nothing back to it, and keeps every
 * derived record separate from the source evidence.
 *
 *   node --no-warnings scripts/corpus-ingest.mjs [dataset-root]
 */
import process from "node:process";
import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT =
  process.argv[2] ??
  process.env.JAMI_DATASET_ROOT ??
  "C:/Users/jarem/jami-datasets";

const OUT = resolve("artifacts/corpus");

const {
  parseHandwrittenUds,
  mcqAggregateMismatches,
  parsePackSegments,
  packScriptLocations,
  packAgreementIssues,
} = await import("../lib/evaluation/sources/handwritten-uds.ts");

/** Page count and per-page text, for reading the transport packs. */
async function readPdf(path, { withText = false } = {}) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)) });
  const document = await task.promise;
  const pages = [];
  if (withText) {
    for (let page = 1; page <= document.numPages; page += 1) {
      const content = await (await document.getPage(page)).getTextContent();
      pages.push({ page, text: content.items.map((item) => item.str).join(" ") });
    }
  }
  const count = document.numPages;
  await task.destroy();
  return { count, pages };
}

function findSourceDir(base) {
  // The published archive nests a folder of the same name inside itself; accept
  // either shape rather than requiring the tree to be tidied by hand.
  const candidates = [base];
  if (existsSync(base)) {
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory()) candidates.push(join(base, entry.name));
    }
  }
  return candidates.find((dir) => existsSync(join(dir, "Teacher_manual_marks_Anonymized.csv")));
}

const configured = join(ROOT, "handwritten-university-data-science");
const fallback = "C:/Users/jarem/Downloads/A Dataset of Digitized Student Examination Papers,";
const sourceDir = findSourceDir(configured) ?? findSourceDir(fallback);

if (!sourceDir) {
  process.stdout.write(
    `handwritten-university-data-science: no Teacher_manual_marks_Anonymized.csv under ${configured}\n`
  );
  process.exit(1);
}

process.stdout.write(`source: ${sourceDir}\n`);

const read = (name) => readFileSync(join(sourceDir, name), "utf8");

// The published per-student PDFs are the source of record.
const scripts = {};
const publishedPages = {};
for (const [folder, key] of [["Student_Pdf", "raw"], ["Corrected_Pdf", "corrected"]]) {
  const dir = join(sourceDir, folder);
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir)) {
    const id = file.replace(/\.pdf$/i, "");
    scripts[id] = { ...(scripts[id] ?? {}), [key]: join(dir, file) };
    publishedPages[id] = {
      ...(publishedPages[id] ?? {}),
      [key]: (await readPdf(join(dir, file))).count,
    };
  }
}

/**
 * The transport packs, if they were delivered.
 *
 * They are read for two reasons: to check they agree with the published
 * scripts, and to stand in for any student the published set is missing. Their
 * grouping is not carried into the records — it means nothing about the work.
 */
const packDirs = [
  join(sourceDir, "packs"),
  sourceDir,
  process.env.JAMI_UDS_PACK_DIR,
  "C:/Users/jarem/Downloads",
].filter((dir) => dir && existsSync(dir));

const packs = [];
const packIssues = [];
const seenPacks = new Set();
for (const dir of packDirs) {
  for (const file of readdirSync(dir).filter((name) => /^PACK_.*\.pdf$/i.test(name))) {
    if (seenPacks.has(file)) continue;
    seenPacks.add(file);
    const { pages } = await readPdf(join(dir, file), { withText: true });
    const { segments, issues } = parsePackSegments(pages);
    packs.push({ file: join(dir, file), segments });
    packIssues.push(...issues.map((issue) => `${file}: ${issue}`));
  }
}

if (packs.length > 0) {
  packIssues.push(...packAgreementIssues({ packs, published: publishedPages }));
  const fromPacks = packScriptLocations(packs);
  packIssues.push(...fromPacks.issues);
  for (const [id, located] of Object.entries(fromPacks.scripts)) {
    for (const key of ["raw", "corrected"]) {
      if (!scripts[id]?.[key] && located[key]) {
        scripts[id] = { ...(scripts[id] ?? {}), [key]: located[key] };
      }
    }
  }
  if (existsSync(join(sourceDir, "PACK_MANIFEST.csv"))) {
    packIssues.push(
      "PACK_MANIFEST.csv is present but not read: the mapping comes from the packs' own separator pages, which cannot drift from the file they describe."
    );
  }
}

const result = parseHandwrittenUds({
  questionText: read("Question.txt"),
  answerKeyText: read("answerkey.txt"),
  marksCsv: read("Teacher_manual_marks_Anonymized.csv"),
  scripts,
});

const mismatches = mcqAggregateMismatches({
  answerKeyText: read("answerkey.txt"),
  marksCsv: read("Teacher_manual_marks_Anonymized.csv"),
});

const { stats } = result;
process.stdout.write(`
students seen           ${stats.students}
short-answer cells      ${stats.shortAnswerCells}
records ingested        ${stats.ingested}
left uncorrected        ${stats.uncorrected}
marks out of range      ${stats.outOfRange}
rows skipped (shifted)  ${stats.misalignedRows}
scripts linked          ${Object.keys(scripts).length}
transport packs read    ${packs.length} (${packs.reduce((total, pack) => total + pack.segments.length, 0)} segments)
multiple-choice totals disagreeing with the key: ${mismatches.length} of ${stats.students}
`);

if (packs.length > 0) {
  process.stdout.write(
    packIssues.length === 0
      ? "packs agree with the published scripts page for page\n"
      : `pack issues (${packIssues.length}):\n${packIssues.map((issue) => `  ${issue}\n`).join("")}`
  );
}

const withScript = result.records.filter((record) => record.answer.kind === "image").length;
const withScheme = result.records.filter((record) => record.markScheme).length;
process.stdout.write(`records carrying a script    ${withScript}\n`);
process.stdout.write(`records carrying a reference ${withScheme}\n`);

const marks = result.records.map((record) => record.humanMarks[0]);
const distribution = new Map();
for (const mark of marks) distribution.set(mark, (distribution.get(mark) ?? 0) + 1);
process.stdout.write(`\nhuman mark distribution:\n`);
for (const mark of [...distribution.keys()].sort((a, b) => a - b)) {
  const count = distribution.get(mark);
  process.stdout.write(
    `  ${String(mark).padStart(4)}  ${String(count).padStart(4)}  ${"#".repeat(Math.round((count / marks.length) * 40))}\n`
  );
}

if (result.issues.length > 0) {
  process.stdout.write(`\nissues (${result.issues.length}):\n`);
  for (const issue of result.issues.slice(0, 20)) process.stdout.write(`  ${issue}\n`);
  if (result.issues.length > 20) {
    process.stdout.write(`  ... and ${result.issues.length - 20} more\n`);
  }
}

mkdirSync(OUT, { recursive: true });
const target = join(OUT, "handwritten-university-data-science.json");
writeFileSync(target, JSON.stringify({ records: result.records, stats, issues: result.issues }, null, 2));
process.stdout.write(`\nderived records written to ${target}\n`);
