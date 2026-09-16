/**
 * Ingest past papers, one course at a time, with the bill visible.
 *
 * The HTTP route needs a signed-in reviewer, which a terminal does not have.
 * This drives the same job machine the route drives -- same manifest, same
 * stages, same gates -- so nothing here is a shortcut past a check. What it
 * adds is a per-paper account of what was extracted and what it cost, because
 * the alternative is ingesting twenty-four papers and finding out afterwards.
 *
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs \
 *     scripts/eval/ingest-maths.ts [--board=aqa|pearson_edexcel] [--spec=8300]
 *     [--components=1H,2H] [--years=2023] [--series=June,November] [--limit=1]
 *     [--list] [--seed] [--dry]
 *
 * `--list` finds the papers and stops: no model call and no write, so what a
 * run would ingest is known before any of it is paid for. `--seed` writes this
 * course's catalogue entries from the checked-in rollout plan first, which is
 * what ingestion and the setup screen both check a paper against.
 */
import { getAdminDb } from "@/services/firebase/admin";
import { EXAM_BOARD_LABELS, isExamBoardId, isExamQualification, type ExamBoardId } from "@/lib/practice/exam-formats";
import { EXAM_CORPUS_TARGETS } from "@/lib/practice/exam-corpus-plan";
import { getExamQuestionRights } from "@/lib/practice/exam-question-rights";
import type { ExamSeries } from "@/lib/practice/exam-source-patterns";
import {
  buildExamPaperManifest,
  type ExamCatalogueCourse,
} from "@/lib/practice/exam-ingestion-manifest";
import { findExamPapersByPattern } from "@/services/practice/exam-source-discovery.server";
import { seedExamFormatCatalogue } from "@/services/practice/exam-corpus-rollout.server";
import { isExamIngestionFinished } from "@/lib/practice/exam-ingestion-job";
import {
  advanceExamIngestionJob,
  startExamIngestionJob,
} from "@/services/practice/exam-ingestion-job.server";

const DEFAULT_SPECIFICATION: Partial<Record<ExamBoardId, string>> = {
  aqa: "8300",
  pearson_edexcel: "1MA1",
};

function flag(args: string[], name: string) {
  const match = args.find((arg) => arg.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : undefined;
}

function list(value: string | undefined, fallback: string) {
  return (value ?? fallback).split(",").map((item) => item.trim()).filter(Boolean);
}

export default async function main(args: string[] = []) {
  const board = flag(args, "board") ?? "aqa";
  if (!isExamBoardId(board)) throw new Error(`Unknown board "${board}".`);
  const specificationId = flag(args, "spec") ?? DEFAULT_SPECIFICATION[board];
  if (!specificationId) throw new Error(`Pass --spec for ${board}.`);
  const target = EXAM_CORPUS_TARGETS.find(
    (item) => item.board === board && item.specificationId === specificationId
  );
  const components = list(flag(args, "components"), "1H");
  const years = list(flag(args, "years"), "2023").map(Number);
  const series = list(flag(args, "series"), "June,November") as ExamSeries[];
  const limit = Number(flag(args, "limit") ?? "1");
  const listOnly = args.includes("--list");
  const dryRun = args.includes("--dry");

  const rights = getExamQuestionRights(`${board}-2026`, 1);
  if (!rights) throw new Error(`No rights record for ${board}; nothing may be ingested.`);

  if (args.includes("--seed")) {
    if (!target) throw new Error(`${board}/${specificationId} is not in the rollout plan.`);
    const { seeded } = await seedExamFormatCatalogue([target]);
    console.log(`seeded ${seeded} catalogue entr${seeded === 1 ? "y" : "ies"} for ${board}/${specificationId}`);
  }

  const db = getAdminDb();
  const catalogue = await db.collection("examFormatCatalogue").where("board", "==", board).limit(300).get();

  let ingested = 0;
  for (const component of components) {
    if (ingested >= limit) break;
    // The plan writes Pearson's codes in full ("1MA1/1H"); either spelling is accepted here.
    const codes = new Set([component, `${specificationId}/${component}`]);
    const entry = catalogue.docs
      .map((doc) => doc.data())
      .find((data) =>
        data.status === "current" &&
        data.specificationCode === specificationId &&
        codes.has(String(data.componentCode))
      );
    if (!entry || !isExamQualification(entry.qualification)) {
      console.log(`! no current catalogue entry for ${specificationId}/${component} (try --seed)`);
      continue;
    }
    const course: ExamCatalogueCourse = {
      board,
      boardLabel: String(entry.boardLabel ?? EXAM_BOARD_LABELS[board]),
      qualification: entry.qualification,
      subject: String(entry.subject ?? "Mathematics"),
      specificationCode: String(entry.specificationCode),
      specificationTitle: String(entry.specificationTitle ?? entry.subject ?? "Mathematics"),
      componentCode: String(entry.componentCode),
      componentTitle: String(entry.componentTitle ?? ""),
    };

    const candidates = await findExamPapersByPattern({
      board,
      specificationId,
      componentCode: course.componentCode,
      years,
      series,
    });
    if (candidates.length === 0) console.log(`- ${specificationId}/${component}: no papers found for ${years.join(", ")}`);

    for (const candidate of candidates) {
      if (listOnly) {
        console.log(`+ ${candidate.label}\n    ${candidate.questionPaperUrl}\n    ${candidate.markSchemeUrl}`);
        continue;
      }
      if (ingested >= limit) break;
      const manifest = buildExamPaperManifest({
        candidate,
        course,
        rightsKey: rights.key,
        rightsVersion: rights.version,
      });
      if (!manifest) {
        console.log(`! could not build a manifest from "${candidate.label}"`);
        continue;
      }

      console.log(`\n=== ${manifest.specificationId}/${manifest.componentCode} ${manifest.series} ${manifest.year}${dryRun ? " (dry run)" : ""}`);
      console.log(`    ${manifest.questionPaperUrl}`);
      const started = Date.now();
      let job = await startExamIngestionJob({ manifest, dryRun });
      let guard = 0;
      while (!isExamIngestionFinished(job) && guard < 200) {
        guard += 1;
        const before = job.stage;
        job = await advanceExamIngestionJob(job.id);
        if (job.stage !== before) console.log(`    -> ${job.stage}`);
        if (job.error) console.log(`    ! ${job.error} (attempt ${job.attempts})`);
      }
      const seconds = Math.round((Date.now() - started) / 1000);
      console.log(`    extracted=${job.extracted ?? 0} published=${job.published ?? 0} needsReview=${job.needsReview ?? 0} rejected=${job.rejected?.length ?? 0} in ${seconds}s`);
      if (job.issueSummary?.length) console.log(`    issues: ${job.issueSummary.map((issue) => JSON.stringify(issue)).join("; ")}`);
      if (job.error) console.log(`    ended with: ${job.error}`);
      ingested += 1;
    }
  }
  console.log(listOnly ? "\nListed only; nothing was ingested." : `\n${ingested} paper(s) processed.`);
}
