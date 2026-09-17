/**
 * How much of the bank the sheet backfill would actually be able to prove.
 *
 * The backfill writes to a question only when it can reproduce that question's
 * stored `contentVersion` from regions it re-derived itself, because that is
 * what proves it is about to render the right piece of paper. This runs
 * exactly that check and renders nothing, writes nothing and calls no model —
 * so the answer to "will this work on the real corpus" can be had before
 * anything is touched.
 *
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs scripts/eval/sheet-backfill-dry-run.ts
 */
import {
  answerSpacePagesAfter,
  findQuestionStarts,
  mergeAdjacentRegions,
} from "@/lib/practice/exam-page-regions";
import { recoverExamQuestionRegions } from "@/lib/practice/exam-sheet-recovery";
import type { ExamPaper, ExamQuestion, ExamQuestionSecret } from "@/lib/practice/exam-questions";
import { getAdminDb, getAdminStorageBucket } from "@/services/firebase/admin";
import { readPageText } from "@/services/practice/exam-question-ingestion.server";

export default async function main() {
  const db = getAdminDb();
  const bucket = getAdminStorageBucket();
  const [papers, questions, secrets] = await Promise.all([
    db.collection("examPapers").get(),
    db.collection("examQuestions").get(),
    db.collection("examQuestionSecrets").get(),
  ]);

  const schemes = new Map(
    secrets.docs.map((doc) => [doc.id, doc.data() as ExamQuestionSecret])
  );
  const byPaper = new Map<string, ExamQuestion[]>();
  for (const doc of questions.docs) {
    const question = { ...doc.data(), id: doc.id } as ExamQuestion;
    byPaper.set(question.paperId, [...(byPaper.get(question.paperId) ?? []), question]);
  }

  let proved = 0;
  let reused = 0;
  let unusable = 0;
  let unprovable = 0;
  let noScheme = 0;
  let noCrop = 0;
  let pagesTotal = 0;
  let withAnswerSpace = 0;
  let answerSpaceTotal = 0;
  const multiPage = new Map<number, number>();
  const failures: string[] = [];

  for (const [index, doc] of papers.docs.entries()) {
    const paper = { ...doc.data(), id: doc.id } as ExamPaper;
    const mine = byPaper.get(doc.id) ?? [];
    if (mine.length === 0) continue;
    process.stdout.write(
      `[${index + 1}/${papers.size}] ${paper.board} ${paper.paperReference} ${paper.series} ${paper.year} (${mine.length})\n`
    );
    let pages;
    try {
      const [bytes] = await bucket.file(paper.questionPaperStoragePath).download();
      pages = await readPageText(bytes);
    } catch (error) {
      failures.push(`${doc.id}: ${error instanceof Error ? error.message : "source unreadable"}`);
      unprovable += mine.length;
      continue;
    }
    const starts = findQuestionStarts(pages);

    for (const question of mine) {
      const crop = question.assets?.find((asset) => asset.id === "question-extract");
      if (!crop) {
        noCrop += 1;
        continue;
      }
      const secret = schemes.get(question.id);
      if (!secret || secret.contentVersion !== question.contentVersion) {
        noScheme += 1;
        continue;
      }
      const recovered = recoverExamQuestionRegions({
        contentVersion: question.contentVersion,
        prompt: question.prompt,
        marks: question.marks,
        markSchemeItem: secret.markSchemeItem,
        paperSha256: paper.questionPaperSha256,
        label: question.label,
        questionNumber: question.provenance.questionNumber,
        starts,
        pages,
        pageCount: pages.length,
      });
      if (!recovered) {
        unprovable += 1;
        /*
         * These are not dropped. The crop they already carry becomes the
         * sheet's one page, which asserts nothing new about the question --
         * see `reuseStitchedCrop`. All they need for that is a recorded size.
         */
        if (crop.width && crop.height) reused += 1;
        else unusable += 1;
        if (failures.length < 25) {
          failures.push(`${paper.paperReference} ${question.label} (${question.id})`);
        }
        continue;
      }
      proved += 1;
      // Contiguous slices of one page are rendered as one page, so this is the
      // number of images the backfill would actually write.
      const sheetPages = mergeAdjacentRegions(recovered.regions).length;
      pagesTotal += sheetPages;
      multiPage.set(sheetPages, (multiPage.get(sheetPages) ?? 0) + 1);
      const room = answerSpacePagesAfter({
        label: recovered.startLabel,
        starts,
        pages,
      });
      if (room > 0) {
        withAnswerSpace += 1;
        answerSpaceTotal += room;
      }
    }
  }

  const total = proved + unprovable + noScheme + noCrop;
  console.log("\nSheet backfill dry run\n");
  console.log(`  questions checked     ${total}`);
  console.log(`  regions proved        ${proved}  (repaginated)`);
  console.log(`  regions unprovable    ${unprovable}`);
  console.log(`    of those, reusable  ${reused}  (kept as one page)`);
  console.log(`    of those, unusable  ${unusable}`);
  console.log(`  questions on a sheet  ${proved + reused} of ${total}`);
  console.log(`  scheme missing        ${noScheme}`);
  console.log(`  no printed crop       ${noCrop}`);
  console.log(`  page images to write  ${pagesTotal}`);
  console.log(
    `  questions given room  ${withAnswerSpace} (${answerSpaceTotal} extra sheets in all)`
  );
  console.log("\n  pages per question:");
  for (const [pages, count] of [...multiPage].sort((left, right) => left[0] - right[0])) {
    console.log(`    ${pages} page${pages === 1 ? " " : "s"}  ${count}`);
  }
  if (failures.length) {
    console.log("\nKept as a single page rather than repaginated:");
    for (const entry of failures) console.log(`  ${entry}`);
  }
}
