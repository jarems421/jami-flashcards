/**
 * Record a paper's spot-check: the one step no model may take for the owner.
 *
 * A model's approval is enough to serve one question. It is not enough to
 * serve a paper, because a per-question reviewer is the wrong shape to notice
 * a fault running through a whole extraction -- a scheme paired one question
 * out, a tariff read off the next line. A person samples the paper instead,
 * and `isExamQuestionServable` refuses every official question until they have.
 *
 * This records what that person decided. It does not decide anything: the
 * sample is read in the sheet `spot-check-sheet.ts` writes, and what comes
 * back here is their verdict, under their own account.
 *
 * The HTTP route needs a signed-in reviewer, which a terminal does not have.
 * This drives the same two service calls in the same order -- revoke what the
 * sample rejected, then record the check -- so a failure between them leaves
 * the paper unservable rather than leaving rejected questions live.
 *
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs \
 *     scripts/eval/spot-check.ts --paper=<id> --reviewer=<email or uid> \
 *     --size=<how many you read> [--reject=<questionId,...>] [--notes="..."] [--dry]
 *
 * Keeping anything at all stamps the paper and lets its questions serve.
 * Rejecting everything drawn records the attempt and stamps nothing, so the
 * paper stays unservable -- which is the honest outcome, not a failure.
 */
import { EXAM_ID_PATTERN } from "@/lib/practice/exam-questions";
import { getAdminAuth } from "@/services/firebase/admin";
import {
  recordExamPaperSpotCheck,
  revokeExamQuestionBatch,
} from "@/services/practice/exam-corpus-review.server";

function flag(args: string[], name: string) {
  const match = args.find((arg) => arg.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : undefined;
}

/** The reviewer's own account, because the record says who checked it. */
async function reviewerUidFor(reviewer: string) {
  if (!reviewer.includes("@")) return reviewer;
  const user = await getAdminAuth().getUserByEmail(reviewer);
  return user.uid;
}

export default async function main(args: string[] = []) {
  const paperId = flag(args, "paper")?.trim() ?? "";
  const reviewer = flag(args, "reviewer")?.trim() ?? "";
  const size = Math.round(Number(flag(args, "size") ?? "0"));
  const notes = flag(args, "notes")?.trim();
  const dryRun = args.includes("--dry");
  const rejected = (flag(args, "reject") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (!EXAM_ID_PATTERN.test(paperId)) throw new Error("Pass --paper=<paper id>, as printed on its spot-check sheet.");
  if (!reviewer) throw new Error("Pass --reviewer=<your email or uid>: the record says who checked the paper.");
  if (!Number.isFinite(size) || size < 1) throw new Error("Pass --size=<how many questions you actually read>.");
  const invalid = rejected.filter((id) => !EXAM_ID_PATTERN.test(id));
  if (invalid.length > 0) throw new Error(`Not question ids: ${invalid.join(", ")}`);
  if (rejected.length > size) throw new Error("More questions rejected than were sampled.");

  const reviewerUid = await reviewerUidFor(reviewer);
  const reason = notes || "Rejected during a spot-check of this paper.";
  console.log(
    `paper ${paperId}\nreviewer ${reviewerUid}\nsampled ${size}, rejecting ${rejected.length}` +
      (rejected.length ? `: ${rejected.join(", ")}` : "")
  );
  if (dryRun) {
    console.log("\nDry run: nothing was written.");
    return;
  }

  // Revocation first: a failure after it leaves the paper unstamped, which is
  // the safe direction. The other order would serve what the sample threw back.
  if (rejected.length > 0) {
    await revokeExamQuestionBatch({ questionIds: rejected, reviewerUid, reason });
    console.log(`withdrew ${rejected.length} question(s)`);
  }
  const result = await recordExamPaperSpotCheck({
    paperId,
    reviewerUid,
    size,
    rejected: rejected.length,
    ...(notes ? { notes } : {}),
  });
  console.log(`\n${JSON.stringify(result)}`);
  console.log(
    rejected.length >= size
      ? "Nothing was kept, so the paper is recorded as checked and stays unservable."
      : "Paper stamped: its approved questions may now be served."
  );
}
