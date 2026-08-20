import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  countDirection,
  countDiscordant,
  mcnemarExact,
  pairCriterionCalls,
} from "@/lib/evaluation/paired-comparison";
import { humanBenchmark } from "@/lib/evaluation/agreement";
import { summariseOutcomes, type MarkOutcome } from "@/lib/evaluation/scoring";

/**
 * Two criterion runs, compared mark against mark.
 *
 * Subtracting two headline percentages would answer a different question than
 * the one asked. Both runs marked the same responses, so the comparison is
 * paired: only the marks that changed their mind between the runs say anything
 * about the change, and everything both runs already agreed on is noise in a
 * difference of averages.
 *
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs \
 *     scripts/eval/compare-runs.ts --before=... --after=...
 */

const percent = (value: number | null | undefined) =>
  value === null || value === undefined ? "    -" : `${(value * 100).toFixed(1)}%`;
const signed = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;

/**
 * One side of the comparison, which may be spread over several files.
 *
 * A run that lost records to a provider outage is completed by a recovery pass
 * rather than repeated, so its outcomes live in more than one file. Later
 * files win on a repeated record: a recovery pass marked it because the first
 * attempt did not produce a usable result.
 */
const load = (paths: string): MarkOutcome[] => {
  const byRecord = new Map<string, MarkOutcome>();
  for (const path of paths.split(",")) {
    const outcomes: MarkOutcome[] = JSON.parse(
      readFileSync(resolve(path.trim()), "utf8")
    ).outcomes;
    for (const outcome of outcomes) byRecord.set(outcome.recordId, outcome);
  }
  return [...byRecord.values()];
};

export default async function main(args: string[]) {
  const flag = (name: string) => args.find((value) => value.startsWith(`--${name}=`))?.split("=")[1];
  const beforePath = flag("before");
  const afterPath = flag("after");
  if (!beforePath || !afterPath) {
    process.stdout.write("\nUsage: --before=<run.json> --after=<run.json>\n");
    return;
  }

  const before = load(beforePath);
  const after = load(afterPath);
  const paired = pairCriterionCalls(before, after);
  const counts = countDiscordant(paired);
  const { discordant, pValue } = mcnemarExact(counts.onlyBefore, counts.onlyAfter);

  const beforeAgreed = counts.agreedBoth + counts.onlyBefore;
  const afterAgreed = counts.agreedBoth + counts.onlyAfter;
  const total = paired.length;

  // Restricted to the records both runs marked, so the totals below describe
  // the same responses the paired test does.
  const shared = new Set(before.map((outcome) => outcome.recordId));
  const beforeShared = before.filter((outcome) =>
    after.some((other) => other.recordId === outcome.recordId)
  );
  const afterShared = after.filter((outcome) => shared.has(outcome.recordId));
  const beforeSummary = summariseOutcomes(beforeShared);
  const afterSummary = summariseOutcomes(afterShared);
  const beforeDirection = countDirection(beforeShared);
  const afterDirection = countDirection(afterShared);

  process.stdout.write(
    `\n${"=".repeat(72)}\nPAIRED COMPARISON\n${"=".repeat(72)}\n` +
      `  before  ${beforePath}  (${before.length} records)\n` +
      `  after   ${afterPath}  (${after.length} records)\n` +
      `  ${beforeShared.length} records and ${total} individual marks in both\n\n`
  );

  /**
   * How much of each run this comparison could actually use.
   *
   * The benchmark's noise is not the model. Two runs of one configuration were
   * 96.7% identical, mark for mark -- but they completed different records,
   * because a marking that times out is a marking lost, and the losses skew
   * long. Comparing "whatever both runs managed" once turned that attrition
   * into a significant result: the same change measured p = 0.036 against a run
   * with 64 records and p = 0.65 against one with 58, and on the records both
   * held it was p = 0.61. The effect was the fifteen extra records, not the
   * change.
   *
   * So coverage is stated, and a lopsided pair says so plainly.
   */
  const coverage = (side: readonly MarkOutcome[]) =>
    side.length > 0 ? beforeShared.length / side.length : 1;
  const worst = Math.min(coverage(before), coverage(after));
  if (worst < 0.9) {
    process.stdout.write(
      `  ! only ${percent(worst)} of the smaller run is paired here. Attrition is not\n` +
        `    random -- lost records skew toward longer questions -- so a difference\n` +
        `    this comparison finds may be which records survived.\n\n`
    );
  }


  process.stdout.write(`THE INDIVIDUAL MARKS\n`);
  process.stdout.write(
    `  agreed before         ${String(beforeAgreed).padStart(4)} of ${total}  ${percent(beforeAgreed / total)}\n`
  );
  process.stdout.write(
    `  agreed after          ${String(afterAgreed).padStart(4)} of ${total}  ${percent(afterAgreed / total)}\n\n`
  );

  process.stdout.write(`WHAT CHANGED ITS MIND — the only marks that carry information\n`);
  process.stdout.write(`  fixed by the change   ${String(counts.onlyAfter).padStart(4)}\n`);
  process.stdout.write(`  broken by the change  ${String(counts.onlyBefore).padStart(4)}\n`);
  process.stdout.write(`  unchanged             ${String(counts.agreedBoth + counts.agreedNeither).padStart(4)}\n`);
  process.stdout.write(
    `  McNemar exact, two-sided, over ${discordant} discordant marks:  p = ${pValue < 0.0001 ? "<0.0001" : pValue.toFixed(4)}\n\n`
  );

  process.stdout.write(`WHICH WAY IT ERRS\n`);
  process.stdout.write(
    `  generous (awarded where the examiner withheld)  ${String(beforeDirection.generous).padStart(4)} -> ${afterDirection.generous}\n`
  );
  process.stdout.write(
    `  harsh    (withheld where the examiner awarded)  ${String(beforeDirection.harsh).padStart(4)} -> ${afterDirection.harsh}\n\n`
  );

  /**
   * What a second human manages, so a bias figure has something to be judged
   * against. Two markers on the same GCSE maths answer sit at -0.025: noisy
   * about each other rather than skewed.
   */
  const humans = humanBenchmark(
    JSON.parse(readFileSync(resolve("artifacts/corpus/medly-gcse.json"), "utf8")).records,
    { subject: "maths", minMaxMarks: 3, maxMaxMarks: 5 }
  );
  if (humans) {
    process.stdout.write(
      `TWO HUMANS ON THE SAME ANSWER, AT A MATCHING TARIFF\n` +
        `  exact agreement       ${percent(humans.exact)} over ${humans.count} answers\n` +
        `  mean gap              ${humans.meanGap.toFixed(2)}\n` +
        `  direction             ${signed(humans.bias)}\n\n`
    );
  }

  process.stdout.write(`THE TOTAL MARK\n`);
  process.stdout.write(
    `  exact agreement       ${percent(beforeSummary.exact)} -> ${percent(afterSummary.exact)}\n`
  );
  process.stdout.write(
    `  within one mark       ${percent(beforeSummary.withinOne)} -> ${percent(afterSummary.withinOne)}\n`
  );
  process.stdout.write(
    `  mean absolute error   ${beforeSummary.meanAbsoluteError.toFixed(2)} -> ${afterSummary.meanAbsoluteError.toFixed(2)}\n`
  );
  process.stdout.write(
    `  bias                  ${signed(beforeSummary.bias)} -> ${signed(afterSummary.bias)}\n`
  );
  process.stdout.write(
    `  right total, right route  ${percent(beforeSummary.rightForTheRightReasons)} -> ${percent(afterSummary.rightForTheRightReasons)}\n\n`
  );

  /**
   * Stated before the run rather than after it, so a marginal result cannot be
   * argued into a success once the number is known.
   */
  const improved = counts.onlyAfter > counts.onlyBefore;
  const lessGenerous = afterDirection.generous < beforeDirection.generous;
  process.stdout.write(
    `VERDICT against the pre-registered bar (p < 0.05 and fewer generous calls)\n` +
      `  agreement improved    ${improved && pValue < 0.05 ? "yes" : "no"}\n` +
      `  less generous         ${lessGenerous ? "yes" : "no"}\n` +
      `  ${improved && pValue < 0.05 && lessGenerous ? "PASSES" : "DOES NOT PASS"}\n`
  );
}
