import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { MarkingCorpusRecord } from "@/lib/evaluation/marking-corpus";
import { scoreMark, summariseOutcomes, type MarkOutcome } from "@/lib/evaluation/scoring";
import { createEvaluationMarker } from "@/services/ai/evaluation-marker.server";
import { loadScannedPages } from "@/services/ai/scanned-page-loader.server";

/**
 * Does Jami award the right marks for the right reasons?
 *
 * Every other measurement in this project compares one number against another:
 * Jami said 4, the human said 5. That cannot distinguish a marker that read the
 * work from one that guessed a plausible total, and the product does not sell a
 * total — it tells a student which mark they lost and why. If that attribution
 * is wrong while the total is right, the feature is confidently misleading and
 * nothing measured so far would notice.
 *
 * Qualifications Scotland is the only source in the corpus that can answer
 * this. Its commentaries name each mark, say whether it was awarded, and give
 * the examiner's reason, against a scheme that says what the mark was for. 89
 * records, 361 individual marks, and all of it handwritten A-level maths.
 *
 * Which is also the limit, and it should be read with the result rather than
 * after it: a poor score here does not separate "cannot mark criteria" from
 * "cannot read handwriting". Telling those apart needs a criterion source with
 * typed answers, and no such source exists in this corpus.
 *
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs \
 *     scripts/eval/criterion-run.ts --limit=10
 *   ... --confirm
 */

const CORPUS = resolve("artifacts/corpus");
const REPORT = resolve("artifacts/evaluation");

const percent = (value: number | null | undefined) =>
  value === null || value === undefined ? "    -" : `${(value * 100).toFixed(1)}%`;
const number = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined ? "    -" : value.toFixed(digits);

export default async function main(args: string[]) {
  const flag = (name: string) => args.find((value) => value.startsWith(`--${name}=`))?.split("=")[1];
  const limit = Number(flag("limit") ?? 0);
  const concurrency = Number(flag("concurrency") ?? 4);
  /**
   * How long one response may take, which depends on where its models are.
   *
   * The default suits the supervisor's own endpoint. When that endpoint is
   * unavailable the same model answers from the failover, measured on real
   * marking prompts at p50 62s and p90 98s against a trivial probe's 3s, and
   * three supervisor calls at that rate plus a juror overrun a seven-minute
   * ceiling. A timeout is recorded as a refusal, so leaving it there would
   * thin the run for reasons that have nothing to do with marking.
   */
  const deadlineMs = Number(flag("deadline") ?? 0) * 1000;
  /**
   * What this run is called, because runs are compared against each other.
   *
   * Every run used to write over the last one. The 58-record measurement this
   * work set out to improve on was destroyed by a six-record smoke, and only
   * its console log survived to say what it had found. A comparison needs both
   * sides to still exist.
   */
  const name = flag("out") ?? "criterion-run";

  const all: MarkingCorpusRecord[] = [];
  for (const file of readdirSync(CORPUS).filter((name) => name.endsWith(".json"))) {
    all.push(...JSON.parse(readFileSync(join(CORPUS, file), "utf8")).records);
  }
  const withCriteria = all.filter((record) => (record.criteria?.length ?? 0) > 0);
  const chosen = limit > 0 ? withCriteria.slice(0, limit) : withCriteria;

  const criteria = chosen.reduce((total, record) => total + (record.criteria?.length ?? 0), 0);
  const described = chosen.reduce(
    (total, record) => total + (record.criteria?.filter((entry) => entry.description).length ?? 0),
    0
  );
  const reasoned = chosen.reduce(
    (total, record) => total + (record.criteria?.filter((entry) => entry.reason).length ?? 0),
    0
  );

  process.stdout.write(
    `\nCriterion benchmark: ${chosen.length} records carrying ${criteria} individual marks.\n` +
      `  ${described} say what the mark was for, ${reasoned} carry the examiner's reason.\n` +
      `  Sources: ${[...new Set(chosen.map((r) => r.sourceId))].join(", ")}\n` +
      `  Subjects: ${[...new Set(chosen.map((r) => `${r.subject}/${r.level}`))].join(", ")}\n`
  );

  if (!args.includes("--confirm")) {
    process.stdout.write(
      `\nThis would mark ${chosen.length} scanned responses through the production path.\n` +
        `Nothing has been called. Re-run with --confirm to start.\n`
    );
    return;
  }

  mkdirSync(REPORT, { recursive: true });
  const journal = join(REPORT, `${name}.jsonl`);
  writeFileSync(journal, "");

  /**
   * Each candidate is shown their own work and nobody else's.
   *
   * A quarter of these scripts share a page, and the evidence reference is to
   * the page, so the first run marked seventeen records while showing them a
   * stranger's answer to the same question. The label printed above each piece
   * of work is what says whose it is, so the record's own candidate number
   * selects the band of the page beneath it.
   *
   * It fails closed: a label that is not on the page yields no images, and the
   * record is refused rather than marked against whatever else was there.
   */
  const candidateLabel = (record: MarkingCorpusRecord) => {
    const number = record.id.split(":c")[1];
    return number ? `Candidate ${number}` : undefined;
  };

  const { mark, stats } = createEvaluationMarker({
    maxRecords: chosen.length + 8,
    ...(deadlineMs > 0 ? { timeoutMs: deadlineMs } : {}),
    loadAnswerImages: (record) =>
      loadScannedPages(record.answer.kind === "image" ? record.answer.paths[0] : "", {
        downscaleBy: 2,
        maxImages: 3,
        belowLabel: candidateLabel(record),
      }),
    onProgress: ({ done, record, awarded, error }) =>
      process.stdout.write(
        `  [${String(done).padStart(3)}/${chosen.length}] ${record.padEnd(38)} ${
          error ? `FAILED ${error.slice(0, 50)}` : `awarded ${awarded}`
        }\n`
      ),
    onFallback: () => {},
  });

  const outcomes: MarkOutcome[] = [];
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= chosen.length) return;
      const record = chosen[index];
      const response = await mark({ record, arm: "none", exemplars: [] });
      if (!response) continue;
      const outcome = scoreMark({
        record,
        candidate: response.awardedMarks,
        criteria: response.criteria,
      });
      outcomes.push(outcome);
      appendFileSync(journal, `${JSON.stringify(outcome)}\n`);
    }
  };

  const started = Date.now();
  await Promise.all(Array.from({ length: Math.min(concurrency, chosen.length) }, () => worker()));
  const minutes = ((Date.now() - started) / 60_000).toFixed(1);

  const summary = summariseOutcomes(outcomes);
  const scored = outcomes.filter((outcome) => (outcome.criterion?.compared ?? 0) > 0);
  const totalCriteria = scored.reduce((total, o) => total + (o.criterion?.compared ?? 0), 0);
  const agreedCriteria = scored.reduce((total, o) => total + (o.criterion?.agreed ?? 0), 0);
  const missed = scored.reduce((total, o) => total + (o.criterion?.missed ?? 0), 0);
  const extra = scored.reduce((total, o) => total + (o.criterion?.extra ?? 0), 0);

  process.stdout.write(
    `\n${"=".repeat(72)}\nCRITERION BENCHMARK\n${"=".repeat(72)}\n` +
      `concurrency ${concurrency}, deadline ${(deadlineMs || 420_000) / 1000}s
` +
      `marked ${outcomes.length} of ${chosen.length} in ${minutes} min` +
      ` (${stats.failed} failed, ${stats.unsupported} unreadable,` +
      ` ${stats.adjudicated} adjudicated, ${stats.thirdView} juror)\n\n`
  );

  process.stdout.write(`THE TOTAL MARK\n`);
  process.stdout.write(`  exact agreement       ${percent(summary.exact)}\n`);
  process.stdout.write(`  within one mark       ${percent(summary.withinOne)}\n`);
  process.stdout.write(`  mean absolute error   ${number(summary.meanAbsoluteError)}\n`);
  process.stdout.write(`  bias                  ${number(summary.bias)}\n\n`);

  process.stdout.write(`THE INDIVIDUAL MARKS — what this benchmark exists for\n`);
  process.stdout.write(`  criteria compared     ${totalCriteria} of ${criteria} published\n`);
  process.stdout.write(
    `  agreed with examiner  ${agreedCriteria} (${percent(totalCriteria > 0 ? agreedCriteria / totalCriteria : null)})\n`
  );
  process.stdout.write(`  examiner's marks Jami never addressed  ${missed}\n`);
  process.stdout.write(`  marks Jami invented                   ${extra}\n`);
  process.stdout.write(
    `  right total by the right route        ${percent(summary.rightForTheRightReasons)}\n\n`
  );

  /**
   * The comparison the headline number cannot make. A marker landing on the
   * right total while disagreeing about which marks earned it is the failure
   * this whole benchmark was built to expose, and it is invisible in every
   * other measurement in this project.
   */
  const rightTotal = scored.filter((outcome) => outcome.exactAgainstAny);
  const rightTotalWrongMarks = rightTotal.filter(
    (outcome) => (outcome.criterion?.agreed ?? 0) < (outcome.criterion?.compared ?? 0)
  );
  process.stdout.write(`WHERE THE TOTAL HIDES THE REASONING\n`);
  process.stdout.write(`  responses with the right total        ${rightTotal.length}\n`);
  process.stdout.write(
    `  of those, disagreeing on which marks  ${rightTotalWrongMarks.length}` +
      ` (${percent(rightTotal.length > 0 ? rightTotalWrongMarks.length / rightTotal.length : null)})\n`
  );

  const target = join(REPORT, `${name}.json`);
  writeFileSync(
    target,
    JSON.stringify(
      {
        markedAt: new Date().toISOString(),
        records: chosen.length,
        publishedCriteria: criteria,
        markerStats: stats,
        summary,
        criterionAgreement: totalCriteria > 0 ? agreedCriteria / totalCriteria : null,
        missed,
        extra,
        outcomes,
      },
      null,
      2
    )
  );
  process.stdout.write(`\nwritten to ${target}\n`);
}
