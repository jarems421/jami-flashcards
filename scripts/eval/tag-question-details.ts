/**
 * Tag a course's stored past-paper questions with concepts and command words,
 * a batch at a time, with the bill visible.
 *
 * The HTTP route needs a signed-in reviewer, which a terminal does not have.
 * This drives the same service, so nothing here skips a check: only checked
 * catalogues are offered, invented ids are dropped, and nothing already tagged
 * is overwritten.
 *
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs \
 *     scripts/eval/tag-question-details.ts --spec=8300 [--batch=10] [--batches=1]
 *     [--paper=<paperId>] [--cursor=<questionId>]
 *
 * Each question tagged costs one provider request, so a run stops after
 * --batches batches and prints the cursor to continue from.
 */
import { tagExamQuestionDetails } from "@/services/practice/exam-question-details-tagging.server";

function flag(args: string[], name: string) {
  const match = args.find((arg) => arg.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : undefined;
}

export default async function main(args: string[] = []) {
  const specificationId = flag(args, "spec");
  if (!specificationId) throw new Error("Pass --spec, for example --spec=8300.");
  const batch = Number(flag(args, "batch") ?? 10);
  const batches = Math.max(1, Number(flag(args, "batches") ?? 1));
  const paperId = flag(args, "paper");
  let cursor = flag(args, "cursor");
  const total = { considered: 0, updated: 0, failed: 0 };

  for (let run = 1; run <= batches; run += 1) {
    const result = await tagExamQuestionDetails({
      specificationId,
      limit: batch,
      ...(paperId ? { paperId } : {}),
      ...(cursor ? { cursor } : {}),
    });
    total.considered += result.considered;
    total.updated += result.updated;
    total.failed += result.failed;
    console.log(
      `Batch ${run}: sent ${result.considered}, updated ${result.updated}, failed ${result.failed}` +
        (result.rejected.length ? `; invented ids dropped: ${result.rejected.join(", ")}` : "")
    );
    cursor = result.nextCursor ?? undefined;
    if (!cursor) {
      console.log("Read to the end of this course's questions.");
      break;
    }
  }

  console.log(`\nTotal: sent ${total.considered}, updated ${total.updated}, failed ${total.failed}.`);
  if (cursor) console.log(`Continue with --cursor=${cursor}`);
}
