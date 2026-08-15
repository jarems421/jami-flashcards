/**
 * Ingest the corpus sources and report what came out of each.
 *
 * Reads from the dataset root only, writes nothing back to it, and keeps every
 * derived record separate from the source evidence. A source that has not been
 * downloaded is reported and skipped rather than failing the run, so this works
 * on a machine holding only part of the corpus.
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
const only = process.argv.slice(3).filter((argument) => !argument.startsWith("-"));

const load = (name) => import(`../lib/evaluation/sources/${name}.ts`);

/** Page count, and per-page text when asked for, from a PDF. */
async function readPdf(path, { withText = false, withItems = false } = {}) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)) });
  const document = await task.promise;
  const pages = [];
  const items = [];
  // Column layouts cannot be read in reading order, so where a source needs it
  // each run of text is kept with the position it was drawn at.
  if (withItems) {
    for (let page = 1; page <= document.numPages; page += 1) {
      const content = await (await document.getPage(page)).getTextContent();
      items.push({
        page,
        items: content.items.map((item) => ({
          x: item.transform[4],
          y: item.transform[5],
          text: item.str,
        })),
      });
    }
  }
  if (withText) {
    for (let page = 1; page <= document.numPages; page += 1) {
      const content = await (await document.getPage(page)).getTextContent();
      // Keep the line breaks. Some sources are read line by line, and a page
      // flattened into one string loses every structural cue it had.
      pages.push({
        page,
        text: content.items.map((item) => item.str + (item.hasEOL ? "\n" : "")).join(""),
      });
    }
  }
  const count = document.numPages;
  await task.destroy();
  return { count, pages, items };
}

/**
 * Find a source's payload.
 *
 * Published archives often nest a folder of the same name inside themselves, so
 * accept either shape rather than requiring the tree to be tidied by hand. A
 * source is only present when the file that actually carries the marks is.
 */
function findPayload(bases, marker) {
  for (const base of bases.filter(Boolean)) {
    if (!existsSync(base)) continue;
    if (existsSync(join(base, marker))) return base;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const nested = join(base, entry.name);
      if (existsSync(join(nested, marker))) return nested;
    }
  }
  return null;
}

const text = (path) => readFileSync(path, "utf8");

const SOURCES = [
  {
    id: "handwritten-university-data-science",
    marker: "Teacher_manual_marks_Anonymized.csv",
    bases: [
      join(ROOT, "handwritten-university-data-science"),
      "C:/Users/jarem/Downloads/A Dataset of Digitized Student Examination Papers,",
    ],
    async run(dir) {
      const {
        parseHandwrittenUds,
        mcqAggregateMismatches,
        parsePackSegments,
        packScriptLocations,
        packAgreementIssues,
      } = await load("handwritten-uds");

      // The published per-student PDFs are the source of record.
      const scripts = {};
      const publishedPages = {};
      for (const [folder, key] of [["Student_Pdf", "raw"], ["Corrected_Pdf", "corrected"]]) {
        const folderPath = join(dir, folder);
        if (!existsSync(folderPath)) continue;
        for (const file of readdirSync(folderPath)) {
          const id = file.replace(/\.pdf$/i, "");
          scripts[id] = { ...(scripts[id] ?? {}), [key]: join(folderPath, file) };
          publishedPages[id] = {
            ...(publishedPages[id] ?? {}),
            [key]: (await readPdf(join(folderPath, file))).count,
          };
        }
      }

      /**
       * The transport packs, if they were delivered. Read to check they agree
       * with the published scripts, and to stand in for anything the published
       * set is missing. Their grouping is not carried into the records.
       */
      const packDirs = [
        join(dir, "packs"),
        dir,
        process.env.JAMI_UDS_PACK_DIR,
        "C:/Users/jarem/Downloads",
      ].filter((candidate) => candidate && existsSync(candidate));

      const packs = [];
      const extra = [];
      const seen = new Set();
      for (const packDir of packDirs) {
        for (const file of readdirSync(packDir).filter((name) => /^PACK_.*\.pdf$/i.test(name))) {
          if (seen.has(file)) continue;
          seen.add(file);
          const { pages } = await readPdf(join(packDir, file), { withText: true });
          const { segments, issues } = parsePackSegments(pages);
          packs.push({ file: join(packDir, file), segments });
          extra.push(...issues.map((issue) => `${file}: ${issue}`));
        }
      }

      if (packs.length > 0) {
        extra.push(...packAgreementIssues({ packs, published: publishedPages }));
        const located = packScriptLocations(packs);
        extra.push(...located.issues);
        for (const [id, found] of Object.entries(located.scripts)) {
          for (const key of ["raw", "corrected"]) {
            if (!scripts[id]?.[key] && found[key]) {
              scripts[id] = { ...(scripts[id] ?? {}), [key]: found[key] };
            }
          }
        }
      }

      const result = parseHandwrittenUds({
        questionText: text(join(dir, "Question.txt")),
        answerKeyText: text(join(dir, "answerkey.txt")),
        marksCsv: text(join(dir, "Teacher_manual_marks_Anonymized.csv")),
        scripts,
      });

      const mismatches = mcqAggregateMismatches({
        answerKeyText: text(join(dir, "answerkey.txt")),
        marksCsv: text(join(dir, "Teacher_manual_marks_Anonymized.csv")),
      });

      const segments = packs.reduce((total, pack) => total + pack.segments.length, 0);
      return {
        ...result,
        issues: [...result.issues, ...extra],
        notes: [
          `transport packs read    ${packs.length} (${segments} segments)`,
          `multiple-choice totals disagreeing with the key: ${mismatches.length} of ${result.stats.students}`,
          packs.length > 0 && extra.length === 0
            ? "packs agree with the published scripts page for page"
            : null,
        ].filter(Boolean),
      };
    },
  },
  {
    id: "medly-gcse",
    marker: "dataset.csv",
    bases: [join(ROOT, "medly-gcse"), join(ROOT, "medly-gcse", "medly-marking-benchmark-main")],
    async run(dir) {
      const { parseMedlyGcse } = await load("medly-gcse");

      const questions = {};
      for (const subject of readdirSync(join(dir, "questions"), { withFileTypes: true })) {
        if (!subject.isDirectory() || subject.name === "images") continue;
        for (const file of readdirSync(join(dir, "questions", subject.name))) {
          if (!file.endsWith(".json")) continue;
          const question = JSON.parse(text(join(dir, "questions", subject.name, file)));
          questions[question.question_id] = question;
        }
      }

      // Typed answers are read so the record carries the text itself;
      // handwriting stays a path to the image, which is the evidence.
      const answerTexts = {};
      const datasetCsv = text(join(dir, "dataset.csv"));
      for (const line of datasetCsv.split(/\r?\n/).slice(1)) {
        const [answerId, , , modality, file] = line.split(",");
        if (!answerId || modality !== "typed" || !file) continue;
        const path = join(dir, file);
        if (existsSync(path)) answerTexts[answerId] = text(path);
      }

      const result = parseMedlyGcse({ datasetCsv, questions, answerTexts, root: dir });
      return {
        ...result,
        notes: [
          `questions loaded        ${Object.keys(questions).length}`,
          `examiners disagreed on  ${result.stats.examinersDisagreed} of ${result.stats.ingested}` +
            ` (widest gap ${result.stats.widestDisagreement} marks)`,
        ],
      };
    },
  },
  {
    id: "asap-2",
    marker: "ASAP_2_Final_github_train.csv",
    bases: [join(ROOT, "asap-2")],
    async run(dir) {
      const { parseAsap2 } = await load("asap-2");

      // The rubric ships as a .docx, which is a zip; its text lives in one XML
      // part. Read here rather than in the parser, which stays free of I/O.
      let rubric;
      const rubricXml = join(dir, "rubric-extract", "word", "document.xml");
      if (existsSync(rubricXml)) {
        rubric = text(rubricXml)
          .replace(/<w:p[ >]/g, "\n<w:p ")
          .replace(/<[^>]+>/g, "")
          .replace(/[ \t]+/g, " ")
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .join("\n");
      }

      // Prompt names and file names describe the same thing differently:
      // "Car-free cities" against "FL2_car-free_cities.pdf". Reducing both to
      // letters and single spaces is what makes them meet.
      const loosen = (value) =>
        value
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .trim();

      const sourceTexts = {};
      const sourceDir = join(dir, "ASAP2_source-texts");
      if (existsSync(sourceDir)) {
        for (const file of readdirSync(sourceDir)) {
          const key = loosen(file.replace(/\.pdf$/i, "").replace(/^[A-Z]{2}\d+_/, ""));
          sourceTexts[key] = join(sourceDir, file);
        }
      }

      const result = parseAsap2({
        essaysCsv: text(join(dir, "ASAP_2_Final_github_train.csv")),
        rubric,
        sourceTexts: new Proxy(sourceTexts, {
          get: (target, property) =>
            typeof property === "string" ? target[loosen(property)] : undefined,
        }),
      });

      return {
        ...result,
        notes: [
          `grades                  ${JSON.stringify(result.stats.byGrade)}`,
          `scores                  ${JSON.stringify(result.stats.byScore)}`,
          rubric ? "holistic rubric attached to every record" : "no rubric found",
          "demographic columns (race, gender, disability, economic status, ELL) are never read",
        ],
      };
    },
  },
  {
    id: "aqa-alevel-english",
    marker: "aqa-exemplar-1.html",
    bases: [join(ROOT, "aqa-alevel-english")],
    async run(dir) {
      const { parseAqaAlevelEnglish } = await load("aqa-alevel-english");
      const pages = readdirSync(dir)
        .filter((name) => name.endsWith(".html"))
        .sort()
        .map((name) => ({ name, html: text(join(dir, name)) }));
      const result = parseAqaAlevelEnglish({ pages });
      return {
        ...result,
        notes: [
          `bands covered           ${Object.keys(result.stats.bands).sort().join(", ")}`,
          "band, not a mark out of the paper total: maxMarks is the number of bands",
        ],
      };
    },
  },
  {
    id: "jorgpt",
    marker: "dataset_en.csv",
    bases: [join(ROOT, "jorgpt")],
    async run(dir) {
      const { parseJorgpt } = await load("jorgpt");
      const result = parseJorgpt({ datasetCsv: text(join(dir, "dataset_en.csv")) });
      return {
        ...result,
        notes: [
          existsSync(join(dir, "dataset_es.csv"))
            ? "dataset_es.csv present and deliberately not ingested: it is the Spanish twin of the same exercise, and Jami marks English"
            : null,
        ].filter(Boolean),
      };
    },
  },
  {
    id: "pearson-alevel",
    marker: "ial-economics-unit-1-exemplar-responses.pdf",
    bases: [join(ROOT, "pearson-alevel")],
    async run(dir) {
      const { parsePearsonAlevel } = await load("pearson-alevel");
      const units = [];
      for (const number of [1, 2]) {
        const file = join(dir, `ial-economics-unit-${number}-exemplar-responses.pdf`);
        if (!existsSync(file)) continue;
        units.push({
          id: `unit-${number}`,
          pages: (await readPdf(file, { withText: true })).pages,
          file,
        });
      }
      const result = parsePearsonAlevel({ units });
      return {
        ...result,
        notes: [
          `booklets read           ${units.length}`,
          `marked by regime        ${JSON.stringify(result.stats.byRegime)}`,
          "the 2019 examiner report is not ingested: it is cohort feedback and marks no individual response",
          "no question tariff exists in the payload, so each maximum is the best exemplar's mark",
        ],
      };
    },
  },
  {
    id: "qualifications-scotland",
    marker: "higher-2023-Paper 1 Commentary 2023.pdf",
    bases: [join(ROOT, "qualifications-scotland")],
    async run(dir) {
      const { parseQualificationsScotland } = await load("qualifications-scotland");

      const papers = [];
      for (const number of [1, 2]) {
        const commentary = join(dir, `higher-2023-Paper ${number} Commentary 2023.pdf`);
        const evidence = join(dir, `higher-2023-Paper ${number} Candidate Evidence 2023.pdf`);
        if (!existsSync(commentary) || !existsSync(evidence)) continue;
        const instructions = join(dir, `higher-2023-2023 Marking instructions paper ${number}.pdf`);
        papers.push({
          id: `paper-${number}`,
          commentaryPages: (await readPdf(commentary, { withText: true })).pages,
          evidencePages: (await readPdf(evidence, { withText: true })).pages,
          evidenceFile: evidence,
          ...(existsSync(instructions)
            ? { instructionPages: (await readPdf(instructions, { withItems: true })).items }
            : {}),
        });
      }

      const result = parseQualificationsScotland({
        seriesId: "higher-maths-2023",
        subject: "maths",
        papers,
      });
      return {
        ...result,
        notes: [
          `papers read             ${papers.length}`,
          `criterion-level marks   ${result.stats.criteria}` +
            ` (${result.stats.criteriaWithReason} with the examiner's reason)`,
          "Higher maths 2023 only; the record level is alevel because Higher has no closer bucket",
        ],
      };
    },
  },
  {
    id: "mohler",
    marker: join("data", "docs", "files"),
    bases: [join(ROOT, "mohler")],
    async run(dir) {
      const { parseMohler } = await load("mohler");
      const data = join(dir, "data");

      const items = {};
      for (const questionId of readdirSync(join(data, "raw"))) {
        const scores = join(data, "scores", questionId);
        if (!existsSync(scores)) continue;
        items[questionId] = {
          answers: text(join(data, "raw", questionId)),
          taScores: text(join(scores, "other")),
          authorScores: text(join(scores, "me")),
        };
      }

      const result = parseMohler({
        fileList: text(join(data, "docs", "files")),
        questions: text(join(data, "raw", "questions")),
        referenceAnswers: text(join(data, "raw", "answers")),
        items,
      });
      return {
        ...result,
        notes: [
          `graders disagreed on    ${result.stats.gradersDisagreed} of ${result.stats.ingested}` +
            ` (widest gap ${result.stats.widestDisagreement})`,
          "the shipped average in scores/x.y/ave is deliberately not read: it cannot show how far the two graders were apart",
        ],
      };
    },
  },
  {
    id: "graduate-neural-networks",
    marker: "asag_dataset.csv",
    bases: [
      join(ROOT, "graduate-neural-networks"),
      join(ROOT, "graduate-neural-networks", "ASAG-Dataset-master"),
    ],
    async run(dir) {
      const { parseAsagGraduate } = await load("asag-graduate");
      const result = parseAsagGraduate({ datasetCsv: text(join(dir, "asag_dataset.csv")) });
      return {
        ...result,
        notes: [
          `grades                  ${JSON.stringify(result.stats.gradeDistribution)}`,
          "one human judge, so this source measures agreement but not human disagreement",
        ],
      };
    },
  },
];

mkdirSync(OUT, { recursive: true });

const summary = [];
for (const source of SOURCES) {
  if (only.length > 0 && !only.includes(source.id)) continue;

  const dir = findPayload(source.bases, source.marker);
  process.stdout.write(`\n${"=".repeat(72)}\n${source.id}\n${"=".repeat(72)}\n`);
  if (!dir) {
    process.stdout.write(`not downloaded: no ${source.marker} under ${source.bases[0]}\n`);
    summary.push({ id: source.id, records: 0, state: "not downloaded" });
    continue;
  }
  process.stdout.write(`source: ${dir}\n`);

  const result = await source.run(dir);
  for (const [key, value] of Object.entries(result.stats)) {
    if (typeof value === "object") continue;
    process.stdout.write(`${key.padEnd(24)}${value}\n`);
  }
  for (const note of result.notes ?? []) process.stdout.write(`${note}\n`);

  const marks = result.records.flatMap((record) => record.humanMarks);
  if (marks.length > 0) {
    const withScheme = result.records.filter((record) => record.markScheme).length;
    const withCommentary = result.records.filter((record) => record.examinerCommentary).length;
    process.stdout.write(`carrying a mark scheme  ${withScheme}\n`);
    process.stdout.write(`carrying commentary     ${withCommentary}\n`);
  }

  if (result.issues.length > 0) {
    process.stdout.write(`\nissues (${result.issues.length}):\n`);
    for (const issue of result.issues.slice(0, 15)) process.stdout.write(`  ${issue}\n`);
    if (result.issues.length > 15) {
      process.stdout.write(`  ... and ${result.issues.length - 15} more\n`);
    }
  }

  const target = join(OUT, `${source.id}.json`);
  writeFileSync(
    target,
    JSON.stringify({ records: result.records, stats: result.stats, issues: result.issues }, null, 2)
  );
  process.stdout.write(`\nderived records written to ${target}\n`);
  summary.push({ id: source.id, records: result.records.length, state: "ingested" });
}

process.stdout.write(`\n${"=".repeat(72)}\ntotal\n${"=".repeat(72)}\n`);
for (const row of summary) {
  process.stdout.write(`${row.id.padEnd(40)}${String(row.records).padStart(6)}  ${row.state}\n`);
}
process.stdout.write(
  `${"".padEnd(40)}${String(summary.reduce((total, row) => total + row.records, 0)).padStart(6)}  records\n`
);
