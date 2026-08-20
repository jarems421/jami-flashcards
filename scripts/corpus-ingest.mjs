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
/**
 * A page as one string, with the runs separated.
 *
 * `readPdf`'s text mode joins runs with nothing and relies on the PDF's own end
 * of line flags, which suits sources read line by line. These commentaries are
 * prose: without a separator "10 marks" arrives as "10marks" and every pattern
 * that reads a mark stops matching. Seven of sixteen candidates were being
 * skipped as unbalanced for that reason alone.
 */
async function readSpacedPages(readPdf, file) {
  const { items } = await readPdf(file, { withItems: true });
  return items.map((page) => ({
    page: page.page,
    text: page.items.map((item) => item.text).join(" "),
  }));
}

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
    id: "sqa-higher-modern-studies-assignment",
    marker: "2023-24-h-mod-studies-assignment-commentaries.pdf",
    bases: [join(ROOT, "sqa-higher-modern-studies-assignment")],
    async run(dir) {
      const { parseSqaAssignment, splitByCandidate } = await load("sqa-assignment");

      // Each series names its files differently, and 2015 both writes one file
      // per candidate and uses an older summary form.
      const series = [];
      for (const [id, commentary, evidence] of [
        ["2023", "2023-24-h-mod-studies-assignment-commentaries.pdf", (n) => `2023-24-h-mod-studies-assignment-candidate-${n}-evidence.pdf`],
        ["2024", "2024-25-h-modern-studies-assignment-commentaries.pdf", (n) => `2024-25-h-modern-studies-assignment-candidate-${n}-evidence.pdf`],
        ["2025", "2025-26-h-modern-studies-assignment-commentary.pdf", (n) => `2025-26-h-modern-studies-assignment-candidate-evidence-${n}.pdf`],
      ]) {
        const file = join(dir, commentary);
        if (!existsSync(file)) continue;
        const pages = await readSpacedPages(readPdf, file);
        const candidates = [];
        for (const block of splitByCandidate(pages)) {
          const evidenceFile = join(dir, evidence(block.candidate));
          if (!existsSync(evidenceFile)) continue;
          const { pages: evidencePages } = await readPdf(evidenceFile, { withText: true });
          // Page one is a cover sheet; the work starts after it.
          candidates.push({
            candidate: block.candidate,
            text: block.text,
            evidence: `${evidenceFile}#page=2-${evidencePages.length}`,
          });
        }
        if (candidates.length > 0) series.push({ id, form: "modernStudies", candidates });
      }

      /**
       * 2015 is read but not ingested.
       *
       * Its commentaries parse cleanly -- the legacy reader handles them and is
       * tested -- but the evidence PDFs draw the candidate's work inside form
       * XObjects, which the scanned-page loader does not traverse, so every one
       * of those four records would carry an answer that cannot be loaded. A
       * record nothing can mark is worse than no record, and extending the
       * loader to chase four of them risks the path that already works for
       * every other scanned source.
       */
      const legacy = [];
      for (let n = 1; n <= 0; n += 1) {
        const commentary = join(dir, `HigherModernStudiesAssgn2015CommentaryCandidate${n}.pdf`);
        const evidenceFile = join(dir, `HigherModernStudiesAssgn2015EvidenceCandidate${n}.pdf`);
        if (!existsSync(commentary) || !existsSync(evidenceFile)) continue;
        const pages = await readSpacedPages(readPdf, commentary);
        const { pages: evidencePages } = await readPdf(evidenceFile, { withText: true });
        legacy.push({
          candidate: n,
          text: pages.map((page) => page.text).join(String.fromCharCode(10)),
          evidence: `${evidenceFile}#page=1-${evidencePages.length}`,
        });
      }
      if (legacy.length > 0) series.push({ id: "2015", form: "modernStudiesLegacy", candidates: legacy });

      const result = parseSqaAssignment({
        sourceId: "sqa-higher-modern-studies-assignment",
        subject: "modernStudies",
        maxMarks: 30,
        series,
      });
      return {
        ...result,
        notes: [
          `series read            ${series.map((entry) => entry.id).join(", ")}`,
          `sections skipped       ${result.stats.unbalanced} unbalanced, ${result.stats.unreadable} unreadable`,
          "typed coursework, scanned: the only criterion-level records not in handwriting",
          "2015 parses but is not ingested: its evidence draws the work in form XObjects the page loader cannot read",
          "section tariffs are inferred from the best candidate on each; SQA publishes the total only",
        ],
      };
    },
  },
  {
    id: "sqa-higher-psychology",
    marker: "2022-23-h-psychology-assignment-candidate1-commentaries.pdf",
    bases: [join(ROOT, "sqa-higher-psychology")],
    async run(dir) {
      const { parseSqaAssignment } = await load("sqa-assignment");

      const candidates = [];
      for (let n = 1; n <= 8; n += 1) {
        const commentary = join(dir, `2022-23-h-psychology-assignment-candidate${n}-commentaries.pdf`);
        const evidenceFile = join(dir, `2022-23-h-psychology-assignment-candidate${n}-evidence.pdf`);
        if (!existsSync(commentary) || !existsSync(evidenceFile)) continue;
        const pages = await readSpacedPages(readPdf, commentary);
        const { pages: evidencePages } = await readPdf(evidenceFile, { withText: true });
        candidates.push({
          candidate: n,
          text: pages.map((page) => page.text).join(String.fromCharCode(10)),
          evidence: `${evidenceFile}#page=2-${Math.min(evidencePages.length, 9)}`,
        });
      }

      const result = parseSqaAssignment({
        sourceId: "sqa-higher-psychology",
        subject: "psychology",
        // No total is published anywhere in this material, so it is summed from
        // the sections rather than asserted.
        series: candidates.length > 0 ? [{ id: "2022", form: "psychology", candidates }] : [],
      });
      return {
        ...result,
        notes: [
          `candidates read        ${candidates.length}`,
          "sections A-H sum to the examiner's own stated total, so each record is self-checked",
          "evidence is capped at eight pages; a full research report is longer than a marking prompt needs",
          "the assignment total is summed from the sections, since SQA publishes none here",
          "the per-section commentary files carry more candidates with per-mark reasons; not yet read",
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

      // Transcribed by scripts/eval/transcribe-qs-papers.ts and checked by
      // hand. The PDFs' own text layer drops the maths, so this is the only
      // readable form of the questions the corpus has.
      const transcribed = join(dir, "transcribed-papers.json");
      const transcripts = existsSync(transcribed)
        ? new Map(
            JSON.parse(readFileSync(transcribed, "utf8")).papers.map((paper) => [
              paper.paperId,
              paper.questions,
            ])
          )
        : new Map();

      const papers = [];
      for (const number of [1, 2]) {
        const commentary = join(dir, `higher-2023-Paper ${number} Commentary 2023.pdf`);
        const evidence = join(dir, `higher-2023-Paper ${number} Candidate Evidence 2023.pdf`);
        if (!existsSync(commentary) || !existsSync(evidence)) continue;
        const instructions = join(dir, `higher-2023-2023 Marking instructions paper ${number}.pdf`);
        const transcript = transcripts.get(`paper-${number}`);
        papers.push({
          id: `paper-${number}`,
          commentaryPages: (await readPdf(commentary, { withText: true })).pages,
          evidencePages: (await readPdf(evidence, { withText: true })).pages,
          evidenceFile: evidence,
          ...(existsSync(instructions)
            ? { instructionPages: (await readPdf(instructions, { withItems: true })).items }
            : {}),
          ...(transcript ? { transcript } : {}),
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
          `questions transcribed   ${[...transcripts.values()].reduce((total, questions) => total + questions.length, 0)}`,
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
