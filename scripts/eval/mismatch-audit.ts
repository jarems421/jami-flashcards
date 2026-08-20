import { readFileSync } from "node:fs";
import { compareValues } from "@/lib/evaluation/value-comparison";

/**
 * How often does Jami record a mismatch and award the mark regardless?
 *
 * Criterion results now carry what the guide wanted beside what the candidate
 * produced, which makes the question askable for the first time. It matters
 * because it separates two very different failures: a marker that does not
 * notice the candidate wrote the wrong thing, and one that notices and awards
 * anyway. Only the first is fixable by making it look harder.
 *
 * Read the count as a floor and the rows as candidates for reading, not as a
 * statistic. Comparing mathematics by string abstains on anything long or
 * ambiguous, so real mismatches are missed, and roughly half of what survives
 * is still notation -- `-6x^(1/2)` against `-6x^½`. What it does reliably is
 * surface rows worth a human eye, and among them are genuine sign errors
 * awarded: `-2(x + 3)^2` against `-2(x - 3)^2`.
 *
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs  *     scripts/eval/mismatch-audit.ts criterion-structured
 */
export default async function main(args: string[]) {
  const run = args[0] ?? "criterion-structured";
  const rows = readFileSync(`artifacts/evaluation/${run}-markers.jsonl`, "utf8")
    .trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  let match = 0, differ = 0, unknown = 0, differAwarded = 0, matchWithheld = 0;
  const cases: string[] = [];
  for (const r of rows) for (const q of r.questions) for (const c of q.criteria) {
    if (!c.schemeValue || !c.candidateValue) continue;
    const verdict = compareValues(c.schemeValue, c.candidateValue);
    if (verdict === "unknown") { unknown += 1; continue; }
    if (verdict === "match") { match += 1; if (!c.awarded) matchWithheld += 1; continue; }
    differ += 1;
    if (c.awarded) {
      differAwarded += 1;
      if (cases.length < 6) cases.push(`  ${c.schemeValue.slice(0,28).padEnd(30)}| ${c.candidateValue.slice(0,28).padEnd(30)}| AWARDED`);
    }
  }
  const comparable = match + differ;
  console.log(`comparable value pairs : ${comparable}  (${unknown} not comparable, skipped)`);
  console.log(`  values agree         : ${match}`);
  console.log(`  values differ        : ${differ}`);
  console.log(`  ...awarded anyway    : ${differAwarded}` + (differ ? `  (${((100*differAwarded)/differ).toFixed(0)}% of real mismatches)` : ""));
  console.log(`  agree but withheld   : ${matchWithheld}`);
  if (cases.length) {
    console.log("");
    console.log(`  ${"SCHEME WANTS".padEnd(30)}| ${"CANDIDATE PRODUCED".padEnd(30)}|`);
    for (const c of cases) console.log(c);
  }
}
