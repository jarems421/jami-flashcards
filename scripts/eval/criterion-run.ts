import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { MarkingCorpusRecord } from "@/lib/evaluation/marking-corpus";
import { humanBenchmark } from "@/lib/evaluation/agreement";
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
  /**
   * Mark only what an earlier run did not, so a lost record can be recovered
   * without paying to re-mark the ones that succeeded.
   *
   * Losses are not random, which is why this exists rather than a note to run
   * it again. A run pushed to concurrency 9 during the provider outage kept 37
   * records averaging 3.59 marks and lost 52 averaging 4.38: the longer a
   * question, the longer its marking, and the likelier it exceeded the
   * deadline. Reporting the survivors would have measured Jami on the short
   * questions and called it a benchmark.
   */
  const missingFrom = flag("missing");
  /**
   * Mark only what an earlier run did mark, for the other side of a comparison.
   *
   * A paired test can only use records both runs hold, so marking the ones the
   * first run lost buys nothing and costs the same as the ones that count.
   */
  const matching = flag("matching");
  /** Mark only records from one source, so a new one can be measured alone. */
  const onlySource = flag("source");
  /**
   * How far to shrink a scanned page.
   *
   * Two suits the Qualifications Scotland scripts, whose pages arrive around
   * 30 KB. The assignment scans are a different animal -- up to 4.8 MB of
   * base64 for three pages -- and sending those at the same factor spends most
   * of a marking prompt on resolution no marker needs to read print.
   */
  const downscaleBy = Number(flag("downscale") ?? 2);

  const all: MarkingCorpusRecord[] = [];
  for (const file of readdirSync(CORPUS).filter((name) => name.endsWith(".json"))) {
    all.push(...JSON.parse(readFileSync(join(CORPUS, file), "utf8")).records);
  }
  let withCriteria = all.filter((record) => (record.criteria?.length ?? 0) > 0);
  /**
   * Every record a run holds, over the files it is spread across.
   *
   * A run that lost records to an outage is completed by a recovery pass, so
   * one side of a comparison can live in more than one file and both halves
   * have to count.
   */
  const recordedBy = (names: string) =>
    new Set<string>(
      names.split(",").flatMap((name) =>
        JSON.parse(readFileSync(join(REPORT, `${name.trim()}.json`), "utf8")).outcomes.map(
          (outcome: { recordId: string }) => outcome.recordId
        )
      )
    );
  if (missingFrom) {
    const done = recordedBy(missingFrom);
    withCriteria = withCriteria.filter((record) => !done.has(record.id));
    process.stdout.write(`
Recovering ${withCriteria.length} records ${missingFrom} did not mark.
`);
  }
  if (onlySource) {
    withCriteria = withCriteria.filter((record) => record.sourceId === onlySource);
    process.stdout.write(`\nRestricted to ${withCriteria.length} records from ${onlySource}.\n`);
  }
  if (matching) {
    const done = recordedBy(matching);
    withCriteria = withCriteria.filter((record) => done.has(record.id));
    process.stdout.write(`
Matching the ${withCriteria.length} records ${matching} marked.
`);
  }
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
   * What each marker in the ensemble said, kept separately from the outcome.
   *
   * The outcome records what Jami finally decided. This records how it got
   * there, which is what a combination rule has to be simulated against: award
   * only where both blind markers agreed, or let the verifier decide alone,
   * and score each against the examiner without paying for another run.
   */
  const markerJournal = join(REPORT, `${name}-markers.jsonl`);
  writeFileSync(markerJournal, "");

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
    /**
     * Only where a page actually carries more than one candidate.
     *
     * The Qualifications Scotland scripts share pages, and the label printed
     * above each piece of work is what says whose it is. The assignment sources
     * give each candidate their own file, and their pages carry no such label --
     * the furniture reads "Candidate evidence 1", which is not a label above
     * anybody's work. Asking for one there makes the loader fail closed and
     * refuse every record, which is what it did: 12 of 12 unreadable, no calls
     * made. Correct behaviour, wrong question.
     */
    if (!record.sourceId.startsWith("qualifications-scotland")) return undefined;
    const number = record.id.split(":c")[1];
    return number ? `Candidate ${number}` : undefined;
  };

  const { mark, stats } = createEvaluationMarker({
    maxRecords: chosen.length + 8,
    ...(deadlineMs > 0 ? { timeoutMs: deadlineMs } : {}),
    loadAnswerImages: (record) =>
      loadScannedPages(record.answer.kind === "image" ? record.answer.paths[0] : "", {
        downscaleBy,
        maxImages: 3,
        belowLabel: candidateLabel(record),
      }),
    onMarkerReport: (report) => appendFileSync(markerJournal, `${JSON.stringify(report)}
`),
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
      `concurrency ${concurrency}, deadline ${(deadlineMs || 420_000) / 1000}s, downscale ${downscaleBy}
` +
      `marked ${outcomes.length} of ${chosen.length} in ${minutes} min` +
      ` (${stats.failed} failed, ${stats.unsupported} unreadable,` +
      ` ${stats.adjudicated} adjudicated, ${stats.thirdView} juror)\n\n`
  );

  /**
   * The ceiling, before the run's own figures, because a percentage without one
   * is unreadable. 53% exact agreement read as catastrophic for a week until
   * the corpus was asked what two humans manage on the same work.
   */
  const humans = humanBenchmark(all, { subject: "maths" });
  const matched = humanBenchmark(all, { subject: "maths", minMaxMarks: 3, maxMaxMarks: 5 });
  if (humans) {
    process.stdout.write(
      `TWO HUMANS ON THE SAME ANSWER — the bar, which is not 100%\n` +
        `  exact agreement       ${percent(humans.exact)}` +
        ` over ${humans.count} double-marked answers at ${number(humans.meanMaxMarks, 1)} marks\n` +
        `  at a matching tariff  ${percent(matched?.exact)}\n` +
        `  mean gap              ${number(humans.meanGap)}\n` +
        `  direction             ${humans.bias >= 0 ? "+" : ""}${number(humans.bias, 3)}` +
        `  (near zero means noisy about each other, not skewed)\n\n`
    );
  }

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
    `  right total by the right route        ${percent(summary.rightForTheRightReasons)}\n`
  );

  /**
   * Where criteria carry more than one mark, the verdict above says almost
   * nothing: a section scored six against the examiner's nine agrees with it,
   * and so does one scored two. This is the figure that means anything there.
   */
  const graded = scored.flatMap((outcome) =>
    (outcome.criterion?.calls ?? []).filter((call) => call.available > 1 && call.jamiMarks !== null)
  );
  if (graded.length > 0) {
    const gap =
      graded.reduce((total, call) => total + Math.abs((call.jamiMarks ?? 0) - call.humanMarks), 0) /
      graded.length;
    const exact = graded.filter((call) => call.jamiMarks === call.humanMarks).length;
    process.stdout.write(
      `  criteria worth more than one mark     ${graded.length}\n` +
        `  ...mean distance in marks             ${number(gap)}\n` +
        `  ...scored exactly right               ${percent(exact / graded.length)}\n`
    );
  }
  process.stdout.write(`\n`);

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
