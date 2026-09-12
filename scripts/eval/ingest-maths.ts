/**
 * Ingest AQA GCSE Mathematics papers, one at a time, with the bill visible.
 *
 * The HTTP route needs a signed-in reviewer, which a terminal does not have.
 * This drives the same job machine the route drives -- same manifest, same
 * stages, same gates -- so nothing here is a shortcut past a check. What it
 * adds is a per-paper account of what was extracted and what it cost, because
 * the alternative is ingesting twenty-four papers and finding out afterwards.
 *
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs \
 *     scripts/eval/ingest-maths.ts [--components=1H,2H] [--years=2023] [--limit=1] [--dry]
 */
import { getAdminDb } from "@/services/firebase/admin";
import { isExamQualification } from "@/lib/practice/exam-formats";
import {
  buildExamPaperManifest,
  type ExamCatalogueCourse,
} from "@/lib/practice/exam-ingestion-manifest";
import { findExamPapersByPattern } from "@/services/practice/exam-source-discovery.server";
import { isExamIngestionFinished } from "@/lib/practice/exam-ingestion-job";
import {
  advanceExamIngestionJob,
  startExamIngestionJob,
} from "@/services/practice/exam-ingestion-job.server";

function flag(args: string[], name: string) {
  const match = args.find((arg) => arg.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : undefined;
}

export default async function main(args: string[] = []) {
  const components = (flag(args, "components") ?? "1H").split(",").map((item) => item.trim());
  const years = (flag(args, "years") ?? "2023").split(",").map((item) => Number(item.trim()));
  const limit = Number(flag(args, "limit") ?? "1");
  const dryRun = args.includes("--dry");

  const db = getAdminDb();
  const catalogue = await db.collection("examFormatCatalogue").where("board", "==", "aqa").limit(300).get();

  let ingested = 0;
  for (const componentCode of components) {
    if (ingested >= limit) break;
    const entry = catalogue.docs
      .map((doc) => doc.data())
      .find((data) =>
        data.status === "current" &&
        data.specificationCode === "8300" &&
        data.componentCode === componentCode
      );
    if (!entry || !isExamQualification(entry.qualification)) {
      console.log(`! no current catalogue entry for 8300/${componentCode}`);
      continue;
    }
    const course: ExamCatalogueCourse = {
      board: "aqa",
      boardLabel: String(entry.boardLabel ?? "AQA"),
      qualification: entry.qualification,
      subject: String(entry.subject ?? "Mathematics"),
      specificationCode: String(entry.specificationCode),
      specificationTitle: String(entry.specificationTitle ?? entry.subject ?? "Mathematics"),
      componentCode: String(entry.componentCode),
      componentTitle: String(entry.componentTitle ?? ""),
    };

    const candidates = await findExamPapersByPattern({
      board: "aqa",
      specificationId: "8300",
      componentCode,
      years,
      series: ["June", "November"],
    });

    for (const candidate of candidates) {
      if (ingested >= limit) break;
      const manifest = buildExamPaperManifest({
        candidate,
        course,
        rightsKey: "aqa-2026",
        rightsVersion: 1,
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
  console.log(`\n${ingested} paper(s) processed.`);
}
