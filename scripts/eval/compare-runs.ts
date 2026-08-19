import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  countDirection,
  countDiscordant,
  mcnemarExact,
  pairCriterionCalls,
} from "@/lib/evaluation/paired-comparison";
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

const load = (path: string): MarkOutcome[] =>
  JSON.parse(readFileSync(resolve(path), "utf8")).outcomes;

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
