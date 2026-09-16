/**
 * Run the AI reviewer over pending questions, with the bill visible.
 *
 * The HTTP route needs a signed-in reviewer, which a terminal does not have.
 * This drives the same service that route drives -- same gate, same
 * transaction, same refusal to overwrite a person's verdict -- so nothing here
 * is a shortcut past a check.
 *
 * Each question costs one vision request against its rendered page, so batches
 * are bounded and each one prints what it decided and what is left. A run that
 * quietly walks a whole corpus is a bill nobody chose.
 *
 * Approval here is enough to serve a question, but not enough to serve a
 * paper: `isExamQuestionServable` still refuses anything whose paper no person
 * has spot-checked. See `scripts/eval/spot-check-sheet.ts`.
 *
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs \
 *     scripts/eval/auto-review.ts [--paper=<id>] [--batch=10] [--batches=1]
 */
import { reviewPendingExamQuestionsWithAi } from "@/services/practice/exam-corpus-review.server";

function flag(args: string[], name: string) {
  const match = args.find((arg) => arg.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : undefined;
}

export default async function main(args: string[] = []) {
  const paperId = flag(args, "paper");
  const batch = Math.max(1, Math.min(25, Number(flag(args, "batch") ?? "10") || 10));
  const batches = Math.max(1, Number(flag(args, "batches") ?? "1") || 1);

  let reviewed = 0;
  let approved = 0;
  let rejected = 0;
  let failed = 0;
  for (let round = 1; round <= batches; round += 1) {
    const result = await reviewPendingExamQuestionsWithAi({ limit: batch, ...(paperId ? { paperId } : {}) });
    reviewed += result.reviewed;
    approved += result.approved;
    rejected += result.rejected;
    failed += result.failed;
    console.log(
      `batch ${round}: reviewed=${result.reviewed} approved=${result.approved} ` +
        `rejected=${result.rejected} failed=${result.failed} remaining=${result.remaining}`
    );
    // Nothing left to review, so another round would only cost a count query.
    if (result.reviewed === 0 || result.remaining === 0) break;
  }
  console.log(
    `\n${reviewed} reviewed: ${approved} approved, ${rejected} rejected, ${failed} could not be reviewed.`
  );
  console.log("A paper still serves nothing until a person spot-checks it.");
}
