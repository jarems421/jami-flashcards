/**
 * Run the sheet backfill over one paper, or over all of them.
 *
 * The same work the corpus workspace's button does, from a terminal, so a
 * single paper can be done first and looked at before the rest of the bank is
 * touched. Calls no model.
 *
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs scripts/eval/sheet-backfill-run.ts            # list
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs scripts/eval/sheet-backfill-run.ts <paperId>
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs scripts/eval/sheet-backfill-run.ts --all
 */
import process from "node:process";
import {
  backfillPaperSheets,
  listExamSheetBackfillPapers,
} from "@/services/practice/exam-sheet-backfill.server";

export default async function main() {
  // The runner passes its own script path through, so that is not an argument.
  const target = process.argv
    .slice(2)
    .find((argument) => !argument.startsWith("--") && !argument.endsWith(".ts"));
  const all = process.argv.includes("--all");
  const force = process.argv.includes("--force");
  const papers = await listExamSheetBackfillPapers();

  if (!target && !all) {
    console.log("Papers in the bank\n");
    for (const paper of papers) {
      const left = paper.questions - paper.withPages;
      console.log(
        `  ${paper.paperId}  ${String(paper.questions).padStart(3)} questions  ` +
          `${left === 0 ? "done" : `${left} to do`}   ${paper.title}`
      );
    }
    console.log("\nPass a paper id to do one, or --all for the lot.");
    return;
  }

  const chosen = all ? papers : papers.filter((paper) => paper.paperId === target);
  if (chosen.length === 0) {
    console.log(`No paper with id ${target}.`);
    return;
  }

  let rendered = 0;
  let reused = 0;
  let skipped = 0;
  for (const paper of chosen) {
    process.stdout.write(`${paper.title}\n`);
    let from = 0;
    for (let step = 0; step < 500; step += 1) {
      const result = await backfillPaperSheets({ paperId: paper.paperId, from, limit: 4, force });
      rendered += result.rendered;
      reused += result.reused;
      skipped += result.skipped.length;
      for (const entry of result.skipped) {
        console.log(`    left alone: ${entry.label} — ${entry.reason} ${entry.detail ?? ""}`);
      }
      process.stdout.write(
        `  ${Math.min(from + 4, result.total)}/${result.total}  ` +
          `${rendered} repaginated, ${reused} kept whole\r`
      );
      if (result.next === null) break;
      from = result.next;
    }
    process.stdout.write("\n");
  }

  console.log(`\nDone. ${rendered} repaginated, ${reused} kept as one page, ${skipped} left alone.`);
}
