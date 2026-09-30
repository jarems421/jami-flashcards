import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";

import { getAiInputTokenCap } from "@/lib/ai/budgets";
import type { AiContentPart } from "@/lib/ai/content-parts";
import type { MarkingCorpusRecord } from "@/lib/evaluation/marking-corpus";
import { adaptRecordToPaper } from "@/lib/evaluation/practice-paper-adapter";
import { scoreMark } from "@/lib/evaluation/scoring";
import { EXAM_SHEET_A4_PAGE_HEIGHT, EXAM_SHEET_PAGE_WIDTH } from "@/lib/practice/exam-question-sheet";
import { examWorkingSheetLayout } from "@/lib/practice/exam-working";
import { buildSingleQuestionAnswerParts } from "@/lib/practice/single-question-paper";
import { getAiTokenCap } from "@/services/ai/budgets";
import { markSingleQuestionAdaptively } from "@/services/ai/practice-paper-marking.server";
import { loadScannedPages } from "@/services/ai/scanned-page-loader.server";
import { loadQuestionTypeRules } from "@/services/practice/question-type-rules.server";

/**
 * Does Jami mark working the same when it runs onto another page?
 *
 * A student who runs out of room on the printed page adds an extra sheet and
 * carries on, and seldom tidily: the continuation starts mid-line, sits part way
 * down the sheet, carries no part label, and sometimes the final answer goes
 * back on the printed answer line with the working that reaches it on the
 * sheet. Nothing in the corpus is shaped like that -- two records in all run
 * over a page -- so this makes it from answers that are.
 *
 * Each Qualifications Scotland script is a real candidate's handwriting with
 * the examiner's mark on every criterion. It is cut at gaps between lines of
 * writing and laid out exactly as the practice sheet lays out a submission:
 * captioned pages, side by side, on the sheet's own page size.
 *
 *   whole     the answer on the printed page, as written
 *   split     the top on the printed page, the rest part way down extra sheet 1
 *   scrambled the start and the final lines on the printed page with a gap
 *             between them, the middle part way down extra sheet 1
 *
 * Each is marked with the rule on how to read work across pages and without it
 * (`workAcrossPages: false`), through the single-question marker a student gets.
 * A marker that reads the pages as one answer gives a cut answer the mark it
 * gives the whole one.
 *
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs \
 *     scripts/eval/split-working-run.ts --limit=16 --dry
 *   ... --confirm
 */

const CORPUS = resolve("artifacts/corpus/qualifications-scotland.json");
const REPORT = resolve("artifacts/evaluation");

type Layout = "whole" | "split" | "scrambled";
type Arm = { layout: Layout; rule: boolean };
const ARMS: Arm[] = [
  { layout: "whole", rule: true },
  { layout: "whole", rule: false },
  { layout: "split", rule: true },
  { layout: "split", rule: false },
  { layout: "scrambled", rule: true },
  { layout: "scrambled", rule: false },
];
const armName = (arm: Arm) => `${arm.layout}/${arm.rule ? "rule" : "no-rule"}`;

/** The sheet's own proportions and the snapshot's, from `exam-working-snapshot`. */
const PAGE = { width: EXAM_SHEET_PAGE_WIDTH, height: EXAM_SHEET_A4_PAGE_HEIGHT };
const SNAPSHOT_PAGE_GAP = 28;
const SNAPSHOT_CAPTION_HEIGHT = 48;
const SNAPSHOT_CAPTION_FONT = 26;
/** Writing sits inside a margin, as it does on a ruled page. */
const MARGIN = 40;

type Band = { top: number; bottom: number };
type Placed = { band: Band; y: number };
type SheetPage = { caption: string; placed: Placed[] };

/** Rows with no writing on them, as runs, from the image's own pixels. */
function blankRuns(image: Image): Band[] {
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, image.width, image.height);
  const isDark = (x: number, y: number) => {
    const offset = (y * image.width + x) * 4;
    return (data[offset] + data[offset + 1] + data[offset + 2]) / 3 < 150;
  };
  // The booklet's margin rules run the height of the page, so every row would
  // read as written on. A column dark on most rows is a rule, not writing.
  const rules = new Set<number>();
  for (let x = 0; x < image.width; x += 1) {
    let dark = 0;
    for (let y = 0; y < image.height; y += 1) if (isDark(x, y)) dark += 1;
    if (dark > image.height * 0.4) {
      for (let near = Math.max(0, x - 2); near <= Math.min(image.width - 1, x + 2); near += 1) rules.add(near);
    }
  }
  const runs: Band[] = [];
  let start = -1;
  for (let y = 0; y < image.height; y += 1) {
    let dark = 0;
    for (let x = 0; x < image.width; x += 1) {
      if (!rules.has(x) && isDark(x, y)) dark += 1;
    }
    const blank = dark <= Math.max(1, image.width * 0.002);
    if (blank && start < 0) start = y;
    if (!blank && start >= 0) {
      runs.push({ top: start, bottom: y });
      start = -1;
    }
  }
  if (start >= 0) runs.push({ top: start, bottom: image.height });
  return runs;
}

/**
 * Where to cut: the middle of the blank run between two lines of writing
 * nearest each wanted fraction of the height. Only runs tall enough to be the
 * space between lines count, so a cut never goes through a word.
 */
function cutRows(image: Image, fractions: readonly number[]): number[] | null {
  const runs = blankRuns(image).filter(
    (run) => run.top > 0 && run.bottom < image.height && run.bottom - run.top >= 4
  );
  const cuts: number[] = [];
  for (const fraction of fractions) {
    const wanted = image.height * fraction;
    const best = runs
      .map((run) => ({ row: Math.round((run.top + run.bottom) / 2), run }))
      .filter((entry) => !cuts.some((cut) => Math.abs(cut - entry.row) < image.height * 0.12))
      .sort((left, right) => Math.abs(left.row - wanted) - Math.abs(right.row - wanted))[0];
    if (!best || Math.abs(best.row - wanted) > image.height * 0.22) return null;
    cuts.push(best.row);
  }
  return cuts.sort((left, right) => left - right);
}

/** The sheet's pages for one layout, or null where the writing cannot be cut. */
function sheetFor(layout: Layout, image: Image, scale: number): SheetPage[] | null {
  const heightOf = (band: Band) => (band.bottom - band.top) * scale;
  const whole = { top: 0, bottom: image.height };
  if (layout === "whole") {
    return [{ caption: "Question 1 — written on the printed page", placed: [{ band: whole, y: MARGIN * 4 }] }];
  }
  if (layout === "split") {
    const cuts = cutRows(image, [0.5]);
    if (!cuts) return null;
    const top = { top: 0, bottom: cuts[0] };
    const rest = { top: cuts[0], bottom: image.height };
    return [
      { caption: "Question 1 — written on the printed page", placed: [{ band: top, y: PAGE.height - MARGIN - heightOf(top) }] },
      { caption: "Question 1 — extra answer sheet 1", placed: [{ band: rest, y: PAGE.height * 0.3 }] },
    ];
  }
  const cuts = cutRows(image, [0.4, 0.8]);
  if (!cuts) return null;
  const start = { top: 0, bottom: cuts[0] };
  const middle = { top: cuts[0], bottom: cuts[1] };
  const end = { top: cuts[1], bottom: image.height };
  return [
    {
      caption: "Question 1 — written on the printed page",
      placed: [
        { band: start, y: MARGIN * 4 },
        // The final lines on the printed answer line, well below where the working stopped.
        { band: end, y: PAGE.height - MARGIN - heightOf(end) },
      ],
    },
    { caption: "Question 1 — extra answer sheet 1", placed: [{ band: middle, y: PAGE.height * 0.35 }] },
  ];
}

/** The submission image, drawn the way `pagesToPng` draws a student's. */
function render(image: Image, pages: SheetPage[], scale: number) {
  const layout = examWorkingSheetLayout({
    pages: pages.map((page) => ({ ...PAGE, caption: page.caption })),
    gap: SNAPSHOT_PAGE_GAP,
    captionHeight: SNAPSHOT_CAPTION_HEIGHT,
  });
  const canvas = createCanvas(layout.width, layout.height);
  const context = canvas.getContext("2d") as SKRSContext2D;
  context.fillStyle = "#e5e7eb";
  context.fillRect(0, 0, layout.width, layout.height);
  context.textBaseline = "middle";
  context.font = `600 ${Math.round(SNAPSHOT_CAPTION_FONT * layout.scale)}px sans-serif`;
  pages.forEach((page, index) => {
    const slot = layout.slots[index];
    context.fillStyle = "#334155";
    context.fillText(page.caption, slot.left, slot.captionTop + slot.captionHeight / 2);
    context.fillStyle = "#ffffff";
    context.fillRect(slot.left, slot.top, slot.width, slot.height);
    const toSlot = slot.width / PAGE.width;
    for (const { band, y } of page.placed) {
      const height = (band.bottom - band.top) * scale;
      context.drawImage(
        image,
        0, band.top, image.width, band.bottom - band.top,
        slot.left + MARGIN * toSlot, slot.top + y * toSlot,
        image.width * scale * toSlot, height * toSlot
      );
    }
  });
  return canvas.toBuffer("image/png");
}

export default async function main(args: string[]) {
  const flag = (name: string) => args.find((value) => value.startsWith(`--${name}=`))?.split("=")[1];
  const limit = Number(flag("limit") ?? 16);
  const concurrency = Number(flag("concurrency") ?? 4);
  const minMarks = Number(flag("min-marks") ?? 3);
  const name = flag("out") ?? "split-working-run";
  const dry = args.includes("--dry");
  const confirm = args.includes("--confirm");

  const all = JSON.parse(readFileSync(CORPUS, "utf8")) as MarkingCorpusRecord[] | { records: MarkingCorpusRecord[] };
  const records = (Array.isArray(all) ? all : all.records)
    .filter((record) => record.answer.kind === "image" && record.maxMarks >= minMarks && record.criteria?.length)
    // Spread over papers and questions rather than the first sixteen of one.
    .sort((left, right) => (hash(left.id) - hash(right.id)));

  mkdirSync(REPORT, { recursive: true });
  const shots = join(REPORT, `${name}-images`);
  mkdirSync(shots, { recursive: true });
  const journal = join(REPORT, `${name}.jsonl`);
  const done = new Set(
    existsSync(journal)
      ? readFileSync(journal, "utf8").split("\n").filter(Boolean).map((line) => {
          const entry = JSON.parse(line) as { record: string; arm: string };
          return `${entry.record}|${entry.arm}`;
        })
      : []
  );

  /** Every arm's image for a record, or nothing if any layout cannot be made. */
  type Prepared = { record: MarkingCorpusRecord; images: Map<string, Buffer> };
  const prepared: Prepared[] = [];
  for (const record of records) {
    if (prepared.length >= limit) break;
    if (record.answer.kind !== "image") continue;
    const candidate = /:c(\d+)$/.exec(record.id)?.[1];
    const parts = await loadScannedPages(record.answer.paths[0] ?? "", {
      downscaleBy: 2,
      maxImages: 1,
      ...(candidate ? { belowLabel: `Candidate ${candidate}` } : {}),
    });
    const first = parts.find((part): part is Extract<AiContentPart, { inlineData: unknown }> => "inlineData" in part);
    if (!first) continue;
    const image = await loadImage(Buffer.from(first.inlineData.data, "base64"));
    // As wide as a line of writing on the sheet, and never taller than a page.
    const scale = Math.min(
      (PAGE.width - MARGIN * 2) / image.width,
      (PAGE.height - MARGIN * 5) / image.height
    );
    const images = new Map<string, Buffer>();
    let usable = true;
    for (const layout of ["whole", "split", "scrambled"] as const) {
      const pages = sheetFor(layout, image, scale);
      if (!pages) {
        usable = false;
        break;
      }
      images.set(layout, render(image, pages, scale));
    }
    if (!usable) continue;
    prepared.push({ record, images });
    for (const [layout, png] of images) {
      writeFileSync(join(shots, `${record.id.replace(/[^a-z0-9]+/gi, "_")}-${layout}.png`), png);
    }
  }
  process.stdout.write(`Prepared ${prepared.length} answers; images in ${shots}\n`);
  if (dry) return;
  if (!confirm) {
    process.stdout.write(`Would mark ${prepared.length * ARMS.length} answers. Re-run with --confirm.\n`);
    return;
  }

  const jobs = prepared.flatMap(({ record, images }) =>
    ARMS.filter((arm) => !done.has(`${record.id}|${armName(arm)}`)).map((arm) => ({ record, arm, png: images.get(arm.layout)! }))
  );
  process.stdout.write(`Marking ${jobs.length} (${done.size} already in the journal)\n`);

  let next = 0;
  let finished = 0;
  // An account out of credit refuses every call; one refusal says so for all of them.
  let outOfCredit = false;
  const worker = async () => {
    for (;;) {
      const job = jobs[next];
      next += 1;
      if (!job || outOfCredit) return;
      const adapted = adaptRecordToPaper(job.record, {
        answerImages: [{ inlineData: { mimeType: "image/png", data: job.png.toString("base64") } }],
      });
      if (!adapted.ok) continue;
      const paper = adapted.adapted.paper;
      const answerParts = buildSingleQuestionAnswerParts({
        questionId: paper.questions[0].id,
        workingImage: { inlineData: { mimeType: "image/png", data: job.png.toString("base64") } },
      });
      try {
        const marked = await markSingleQuestionAdaptively({
          paper,
          answerParts,
          examinerPracticeRules: await loadQuestionTypeRules(paper.assessmentProfile, paper.title),
          deadlineAt: Date.now() + 600_000,
          maxOutputTokens: getAiTokenCap("examQuestionMarking"),
          inputTokenCap: getAiInputTokenCap("examQuestionMarking"),
          forceVerification: true,
          ...(job.arm.rule ? {} : { variant: { workAcrossPages: false } }),
        });
        const question = marked.result.questionResults[0];
        const outcome = scoreMark({
          record: job.record,
          candidate: question.awardedMarks,
          criteria: question.criterionResults,
        });
        appendFileSync(journal, `${JSON.stringify({
          record: job.record.id,
          arm: armName(job.arm),
          awarded: question.awardedMarks,
          human: job.record.humanMarks[0],
          maxMarks: job.record.maxMarks,
          criterion: outcome.criterion ?? null,
          transcriptionNote: question.transcriptionNote ?? null,
          adjudicated: marked.audit.adjudicated,
          costUsd: marked.estimatedCostUsd,
        })}\n`);
        finished += 1;
        process.stdout.write(`  [${finished}/${jobs.length}] ${job.record.id.padEnd(40)} ${armName(job.arm).padEnd(18)} ${question.awardedMarks}/${job.record.maxMarks} (examiner ${job.record.humanMarks[0]})\n`);
      } catch (error) {
        finished += 1;
        const message = error instanceof Error ? error.message : String(error);
        if (/\b402\b/.test(message)) outOfCredit = true;
        process.stdout.write(`  [${finished}/${jobs.length}] ${job.record.id} ${armName(job.arm)} FAILED ${message.slice(0, 80)}\n`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()));
  if (outOfCredit) {
    process.stdout.write("\nStopped: the provider account is out of credit (402). Top it up and re-run; the journal resumes.\n");
  }
  if (existsSync(journal)) summarise(journal);
}

function hash(value: string) {
  let result = 0;
  for (const character of value) result = (result * 31 + character.charCodeAt(0)) >>> 0;
  return result;
}

/** Per arm: how far from the examiner, and how far from the same answer uncut. */
function summarise(journal: string) {
  type Entry = { record: string; arm: string; awarded: number; human: number; costUsd: number; criterion: { compared: number; agreed: number } | null };
  const entries = readFileSync(journal, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Entry);
  const byRecord = new Map<string, Map<string, Entry>>();
  for (const entry of entries) {
    const arms = byRecord.get(entry.record) ?? new Map<string, Entry>();
    arms.set(entry.arm, entry);
    byRecord.set(entry.record, arms);
  }
  // Only records every arm marked, so the arms are compared on the same answers.
  const complete = [...byRecord.values()].filter((arms) => ARMS.every((arm) => arms.has(armName(arm))));
  const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
  process.stdout.write(`\n${complete.length} answers marked in every arm, $${mean(entries.map((entry) => entry.costUsd)).toFixed(4)} a marking\n\n`);
  process.stdout.write(`${"arm".padEnd(20)}${"exact".padStart(8)}${"MAE".padStart(8)}${"bias".padStart(8)}${"criteria".padStart(10)}${"vs whole".padStart(10)}${"moved".padStart(8)}\n`);
  for (const arm of ARMS) {
    const rows = complete.map((arms) => ({
      entry: arms.get(armName(arm))!,
      whole: arms.get(armName({ layout: "whole", rule: arm.rule }))!,
    }));
    const exact = rows.filter(({ entry }) => entry.awarded === entry.human).length / Math.max(1, rows.length);
    const mae = mean(rows.map(({ entry }) => Math.abs(entry.awarded - entry.human)));
    const bias = mean(rows.map(({ entry }) => entry.awarded - entry.human));
    const compared = rows.reduce((sum, { entry }) => sum + (entry.criterion?.compared ?? 0), 0);
    const agreed = rows.reduce((sum, { entry }) => sum + (entry.criterion?.agreed ?? 0), 0);
    const versusWhole = mean(rows.map(({ entry, whole }) => entry.awarded - whole.awarded));
    const moved = rows.filter(({ entry, whole }) => entry.awarded !== whole.awarded).length;
    process.stdout.write(
      `${armName(arm).padEnd(20)}${`${(exact * 100).toFixed(0)}%`.padStart(8)}${mae.toFixed(2).padStart(8)}${(bias >= 0 ? "+" : "") + bias.toFixed(2).padStart(7)}${`${compared ? ((agreed / compared) * 100).toFixed(0) : "-"}%`.padStart(10)}${(versusWhole >= 0 ? "+" : "") + versusWhole.toFixed(2).padStart(9)}${String(moved).padStart(8)}\n`
    );
  }
}
