import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { MarkingCorpusRecord } from "@/lib/evaluation/marking-corpus";
import { compareCriteria } from "@/lib/evaluation/scoring";

/**
 * What the ensemble would have marked under a different rule.
 *
 * Jami marks half a mark generous, and has through every configuration tried:
 * with and without the question and mark scheme, with and without a prompt
 * telling it to check the working. Neither more information nor better
 * instruction moved it. What the recorded runs do show is that Jami awards
 * marks at a roughly fixed rate near 75% whatever the examiner does, while the
 * examiner's rate falls with difficulty -- so the gap is widest exactly where a
 * mark is hardest to earn. That is calibration, not reasoning.
 *
 * Which raises a question this can answer without spending anything: was the
 * excess yes already there in both blind markers, or did the way their reports
 * are combined let it through? Each marker's own criterion decisions are now
 * recorded, so a rule can be scored against the examiner by arithmetic.
 *
 * Nothing here changes marking. It reports what would have happened.
 *
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs \
 *     scripts/eval/combination-rules.ts --run=criterion-markers
 */

const CORPUS = resolve("artifacts/corpus");
const REPORT = resolve("artifacts/evaluation");

type MarkerReport = {
  record: string;
  role: string;
  questions: {
    questionId: string;
    awardedMarks: number;
    criteria: { criterionId: string; awarded: boolean }[];
  }[];
};

/** One marker's verdict on one record, as criterion id to awarded. */
type Verdict = Map<string, boolean>;

/**
 * The markers that actually produced a record's final result.
 *
 * A role can appear more than once and only the last one counts. The
 * adjudicator runs twice whenever a juror is called -- once to settle the
 * dispute, once to fold the third view into a final report -- and a marking
 * the provider rate-limited replays the whole blind pair, leaving an abandoned
 * attempt in the journal ahead of the one that counted.
 */
export function lastVerdictPerRole(reports: readonly MarkerReport[]) {
  const byRole = new Map<string, Verdict>();
  for (const report of reports) {
    const verdict: Verdict = new Map();
    for (const question of report.questions) {
      for (const criterion of question.criteria) {
        verdict.set(criterion.criterionId, criterion.awarded);
      }
    }
    if (verdict.size > 0) byRole.set(report.role, verdict);
  }
  return byRole;
}

/**
 * The rules worth asking about, each a way of turning what the markers said
 * into what the student is told.
 *
 * `both must agree` is the one with a fix attached: if the excess yes survives
 * because one generous marker is enough to carry a mark, then requiring two
 * costs nothing extra to run.
 */
const RULES: {
  name: string;
  note: string;
  decide: (roles: Map<string, Verdict>) => Verdict | null;
}[] = [
  {
    name: "as shipped",
    note: "the adjudicated result, or the primary where nothing was disputed",
    decide: (r) => r.get("adjudicator") ?? r.get("primary") ?? null,
  },
  {
    name: "both must agree",
    note: "award only where both blind markers awarded; disagreement withholds",
    decide: (r) => {
      const primary = r.get("primary");
      const verifier = r.get("verifier");
      if (!primary || !verifier) return null;
      const out: Verdict = new Map();
      for (const [id, awarded] of primary) {
        if (verifier.has(id)) out.set(id, awarded && verifier.get(id)!);
      }
      return out.size > 0 ? out : null;
    },
  },
  {
    name: "either may award",
    note: "the opposite bound, to show which side of it the shipped rule sits",
    decide: (r) => {
      const primary = r.get("primary");
      const verifier = r.get("verifier");
      if (!primary || !verifier) return null;
      const out: Verdict = new Map();
      for (const [id, awarded] of primary) {
        if (verifier.has(id)) out.set(id, awarded || verifier.get(id)!);
      }
      return out.size > 0 ? out : null;
    },
  },
  {
    name: "primary alone",
    note: "the supervisor model marking unaided",
    decide: (r) => r.get("primary") ?? null,
  },
  {
    name: "verifier alone",
    note: "the worker model marking unaided",
    decide: (r) => r.get("verifier") ?? null,
  },
];

export default async function main(args: string[]) {
  const flag = (name: string) => args.find((v) => v.startsWith(`--${name}=`))?.split("=")[1];
  const run = flag("run") ?? "criterion-markers";

  const records = new Map<string, MarkingCorpusRecord>();
  for (const file of ["qualifications-scotland.json"]) {
    for (const record of JSON.parse(readFileSync(join(CORPUS, file), "utf8")).records) {
      records.set(record.id, record);
    }
  }

  const byRecord = new Map<string, MarkerReport[]>();
  for (const line of readFileSync(join(REPORT, `${run}-markers.jsonl`), "utf8").split("\n")) {
    if (!line.trim()) continue;
    const report = JSON.parse(line) as MarkerReport;
    const existing = byRecord.get(report.record);
    if (existing) existing.push(report);
    else byRecord.set(report.record, [report]);
  }

  process.stdout.write(
    `\n${"=".repeat(74)}\nCOMBINATION RULES\n${"=".repeat(74)}\n` +
      `  ${byRecord.size} records, from ${run}-markers.jsonl\n\n` +
      `  rule                 marks   agreed   generous   harsh   award rate\n` +
      `  ${"-".repeat(66)}\n`
  );

  // The examiner's own rate, as the thing every rule is trying to match.
  let examinerMarks = 0;
  let examinerAwarded = 0;
  for (const id of byRecord.keys()) {
    const record = records.get(id);
    for (const criterion of record?.criteria ?? []) {
      examinerMarks += 1;
      if (criterion.awarded > 0) examinerAwarded += 1;
    }
  }

  for (const rule of RULES) {
    let compared = 0;
    let agreed = 0;
    let generous = 0;
    let harsh = 0;
    let awarded = 0;

    for (const [id, reports] of byRecord) {
      const record = records.get(id);
      if (!record?.criteria?.length) continue;
      const verdict = rule.decide(lastVerdictPerRole(reports));
      if (!verdict) continue;

      const criteria = [...verdict.entries()].map(([criterionId, isAwarded]) => ({
        criterionId,
        criterion: criterionId,
        awarded: isAwarded,
      }));
      const outcome = compareCriteria(record.criteria, criteria, false);
      compared += outcome.compared;
      agreed += outcome.agreed;
      for (const call of outcome.calls) {
        if (call.jami === null) continue;
        if (call.jami) awarded += 1;
        if (call.jami !== call.human) call.jami ? (generous += 1) : (harsh += 1);
      }
    }

    const percent = (part: number, whole: number) =>
      whole > 0 ? `${((100 * part) / whole).toFixed(1)}%` : "    -";
    process.stdout.write(
      `  ${rule.name.padEnd(20)}${String(compared).padStart(5)}${percent(agreed, compared).padStart(9)}` +
        `${String(generous).padStart(11)}${String(harsh).padStart(8)}${percent(awarded, compared).padStart(13)}\n`
    );
  }

  process.stdout.write(
    `  ${"-".repeat(66)}\n` +
      `  ${"the examiner".padEnd(20)}${String(examinerMarks).padStart(5)}${"     -".padStart(9)}` +
      `${"-".padStart(11)}${"-".padStart(8)}` +
      `${`${((100 * examinerAwarded) / examinerMarks).toFixed(1)}%`.padStart(13)}\n\n`
  );
  for (const rule of RULES) {
    process.stdout.write(`  ${rule.name.padEnd(20)} ${rule.note}\n`);
  }
  process.stdout.write(
    `\nNothing here changed any marking. Each row is what the recorded markers\n` +
      `would have produced under that rule, scored against the same examiner.\n`
  );
}
