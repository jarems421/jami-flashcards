import { getPaperGenerationBenchmarkRun } from "@/services/ai/paper-generation-benchmark.server";
import {
  paperReviewerId,
  reviewPaperBenchmarkRunWithAi,
} from "@/services/ai/paper-benchmark-ai-review.server";

/**
 * Review a paper-generation benchmark run's papers with the AI reviewer.
 *
 * The same review a person gives in /dashboard/internal/paper-quality, written
 * by Gemini and signed `ai:<model>`. Papers a person has reviewed are left
 * alone. Choose the reviewer model for the run rather than for the app: the
 * default document model is a light one, and a paper deserves a stronger read.
 *
 *   GEMINI_DOCUMENT_MODEL=gemini-3.8-flash \
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs \
 *     scripts/eval/paper-auto-review.ts --run=<runId> [--limit=12] [--redo-ai] [--confirm]
 *
 * Without --confirm it only says what it would review.
 */

function flag(args: string[], name: string) {
  const match = args.find((arg) => arg.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : undefined;
}

export default async function main(args: string[] = []) {
  const runId = flag(args, "run");
  if (!runId) throw new Error("Pass --run=<runId>.");
  const limit = Number(flag(args, "limit") ?? 0) || undefined;
  const redoAi = args.includes("--redo-ai");

  const detail = await getPaperGenerationBenchmarkRun(runId);
  if (!detail) throw new Error(`Benchmark run ${runId} not found.`);
  const ready = detail.cases.filter((item) => item.status === "ready");
  const unreviewed = ready.filter((item) => !item.review);
  console.log(
    `${runId}: ${detail.cases.length} cases, ${ready.length} ready, ${unreviewed.length} unreviewed` +
      ` · reviewer ${paperReviewerId()}${redoAi ? " · re-reviewing earlier AI reviews" : ""}`
  );
  if (!args.includes("--confirm")) {
    console.log("\nDry listing only. Re-run with --confirm to review (one reviewer call per paper).");
    return;
  }

  const { pending, outcomes } = await reviewPaperBenchmarkRunWithAi({
    runId,
    ...(limit ? { limit } : {}),
    redoAi,
    onOutcome: (outcome) =>
      console.log(
        `  ${outcome.caseId}  ` +
          (outcome.status === "reviewed"
            ? `${outcome.usable ? "usable" : "NOT USABLE"}${outcome.blockers.length ? `  blockers: ${outcome.blockers.join(", ")}` : ""}`
            : `${outcome.status}: ${outcome.reason}`)
      ),
  });
  const reviewed = outcomes.filter((outcome) => outcome.status === "reviewed");
  const usable = reviewed.filter((outcome) => outcome.status === "reviewed" && outcome.usable).length;
  console.log(
    `\n${reviewed.length} reviewed of ${pending} pending: ${usable} usable, ${reviewed.length - usable} not usable, ` +
      `${outcomes.length - reviewed.length} not reviewed.`
  );
}
