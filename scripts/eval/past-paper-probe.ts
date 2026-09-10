import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createEvaluationMarker } from "@/services/ai/evaluation-marker.server";
import { markingCostBound } from "@/lib/evaluation/marking-cost-bound";
import { referenceMark, type MarkingCorpusRecord } from "@/lib/evaluation/marking-corpus";
import { getAiInputTokenCap, getAiTokenCap } from "@/lib/ai/budgets";

/**
 * Ten handwritten GCSE maths responses, marked by the path a student gets.
 *
 * Strictly diagnostic. Ten answers on ten questions is a cost measurement with
 * an error breakdown attached, and it is not evidence about a subject, a
 * regime or a board -- the source is a GCSE *mock* benchmark rather than an
 * awarding-body past paper, which is a different claim again.
 *
 * Serial on purpose: with one marking in flight at a time, the reservation
 * taken before its first call is the only money committed, so the run cannot
 * discover several markings' costs at once.
 *
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs \
 *     scripts/eval/past-paper-probe.ts --confirm
 */
const CORPUS = resolve("artifacts/corpus");
const REPORT = resolve("artifacts/evaluation");
const BUDGET_USD = 3.51;
const RECORDS = 10;

function loadAnswerImage(record: MarkingCorpusRecord) {
  if (record.answer.kind !== "image") return [];
  return record.answer.paths.map((path) => ({
    inlineData: {
      mimeType: "image/png" as const,
      data: readFileSync(path).toString("base64"),
    },
  }));
}

export default async function main(args: string[]) {
  const bound = markingCostBound({
    inputTokenCap: getAiInputTokenCap("examQuestionMarking"),
    maxOutputTokens: getAiTokenCap("examQuestionMarking"),
  });

  const all: MarkingCorpusRecord[] = JSON.parse(
    readFileSync(join(CORPUS, "medly-gcse.json"), "utf8")
  ).records;

  /*
   * One response per question, agreed by both examiners, and preferring a
   * partial mark so the reference is solid and the marking is not trivial.
   * Agreed-only is a smoke test's choice: disputed marks, wrong answers,
   * higher tariffs and the other regimes all belong in the real evaluation.
   */
  const byQuestion = new Map<string, MarkingCorpusRecord[]>();
  for (const record of all) {
    if (record.answer.kind !== "image") continue;
    if (new Set(record.humanMarks).size !== 1) continue;
    byQuestion.set(record.questionId, [...(byQuestion.get(record.questionId) ?? []), record]);
  }
  const selected = [...byQuestion.keys()]
    .sort()
    .slice(0, RECORDS)
    .map((questionId) => {
      const list = byQuestion.get(questionId)!;
      const partial = list.find(
        (record) => record.humanMarks[0]! > 0 && record.humanMarks[0]! < record.maxMarks
      );
      return partial ?? list[0]!;
    });

  console.log(`probe: ${selected.length} records across ${selected.length} questions`);
  console.log(`reserve $${bound.usdPerRecord.toFixed(4)}/record · budget $${BUDGET_USD.toFixed(2)}`);
  console.log(`prices read ${bound.pricesReadOn} · caps enforced: ${bound.capsEnforced}`);
  for (const record of selected) {
    console.log(`  ${record.id.padEnd(20)} ${record.questionId.padEnd(10)} ${referenceMark(record)}/${record.maxMarks}`);
  }
  if (!args.includes("--confirm")) {
    console.log("\nDry listing only. Re-run with --confirm to make paid calls.");
    return;
  }

  const audits = new Map<string, Record<string, unknown>>();
  /*
   * What each marker actually decided, kept per record.
   *
   * The first probe recorded only the final score, so its two scoring errors
   * could be seen and not explained: there was no criterion decision and no
   * quoted evidence to inspect, and the diagnosis had to come from re-reading
   * the scheme the harness had built. A report that cannot say why a mark was
   * given cannot rank interventions.
   */
  const reports = new Map<string, Record<string, unknown>[]>();
  const { mark, stats } = createEvaluationMarker({
    maxRecords: RECORDS,
    maxSpendUsd: BUDGET_USD,
    reserveUsdPerRecord: bound.usdPerRecord,
    haltOnUnreportedCost: true,
    /*
     * Production's deadline, not the evaluator's 420-second default. The first
     * probe left the default in place, so one dead route burned two minutes on
     * four thirty-second attempts -- where a student's request would have given
     * up at 55 seconds. A run that does not share the deadline is not measuring
     * the same marker.
     */
    timeoutMs: 55_000,
    pipeline: "pastPaperPractice",
    loadAnswerImages: async (record) => loadAnswerImage(record),
    onAudit: (audit) => audits.set(String(audit.record), audit as Record<string, unknown>),
    onMarkerReport: (report) => {
      const key = String(report.record);
      reports.set(key, [...(reports.get(key) ?? []), report as unknown as Record<string, unknown>]);
    },
  });

  const outcomes: Record<string, unknown>[] = [];
  for (const record of selected) {
    const startedAt = Date.now();
    const reportedBefore = stats.reportedUsd;
    const retainedBefore = stats.retainedReservationUsd;
    try {
      // Production sends no exemplars, so the arm that matches it is "none".
      const response = await mark({ record, arm: "none", exemplars: [] });
      const audit = audits.get(record.id) ?? {};
      outcomes.push({
        record: record.id,
        questionId: record.questionId,
        maxMarks: record.maxMarks,
        humanMarks: record.humanMarks,
        referenceMark: referenceMark(record),
        awardedMarks: response?.awardedMarks ?? null,
        error: response ? null : "no_question_result",
        primary: audit.primary ?? null,
        verifier: audit.verifier ?? null,
        verified: audit.verifier !== undefined && audit.verifier !== null,
        disputed: audit.disputed ?? false,
        adjudicated: audit.adjudicated ?? false,
        markerReports: reports.get(record.id) ?? [],
        reportedCostUsd: Number((stats.reportedUsd - reportedBefore).toFixed(6)),
        retainedReservationUsd: Number((stats.retainedReservationUsd - retainedBefore).toFixed(6)),
        latencyMs: Date.now() - startedAt,
      });
    } catch (error) {
      // Kept in the report. A run that dropped its failures would report the
      // accuracy of the answers that happened to succeed.
      outcomes.push({
        record: record.id,
        questionId: record.questionId,
        maxMarks: record.maxMarks,
        humanMarks: record.humanMarks,
        referenceMark: referenceMark(record),
        awardedMarks: null,
        error: error instanceof Error ? error.message : String(error),
        reportedCostUsd: Number((stats.reportedUsd - reportedBefore).toFixed(6)),
        retainedReservationUsd: Number((stats.retainedReservationUsd - retainedBefore).toFixed(6)),
        latencyMs: Date.now() - startedAt,
      });
      if (/Evaluation (stopped|spend ceiling)/.test(String(error))) {
        console.log("\nrun halted:", String(error));
        break;
      }
    }
    const last = outcomes.at(-1)!;
    console.log(
      `  ${String(last.record).padEnd(20)} ref ${last.referenceMark}/${last.maxMarks}  ` +
        `got ${last.awardedMarks ?? "-"}  $${Number(last.reportedCostUsd).toFixed(4)}  ` +
        `${last.latencyMs}ms  ${last.error ? `ERROR ${String(last.error).slice(0, 60)}` : last.adjudicated ? "adjudicated" : last.verified ? "verified" : "single"}`
    );
  }

  mkdirSync(REPORT, { recursive: true });
  const report = {
    probe: "past-paper-practice-10",
    pipeline: "pastPaperPractice",
    source: "medly-gcse (GCSE mock benchmark, CC BY 4.0) — not awarding-body past papers",
    budgetUsd: BUDGET_USD,
    reservePerRecordUsd: bound.usdPerRecord,
    pricesReadOn: bound.pricesReadOn,
    stats: { ...stats },
    outcomes,
  };
  writeFileSync(join(REPORT, "past-paper-probe.json"), JSON.stringify(report, null, 2));

  const marked = outcomes.filter((item) => typeof item.awardedMarks === "number");
  const exact = marked.filter((item) => item.awardedMarks === item.referenceMark).length;
  const errors = marked.map((item) => Number(item.awardedMarks) - Number(item.referenceMark));
  const mean = (values: number[]) =>
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

  console.log(`\nattempted ${stats.attempted} · marked ${marked.length} · failed ${stats.failed}`);
  console.log(`known reported cost $${stats.reportedUsd.toFixed(4)} of $${BUDGET_USD.toFixed(2)}`);
  console.log(`reservation retained for unaccounted markings $${stats.retainedReservationUsd.toFixed(4)}`);
  if (stats.retainedReservationUsd > 0) {
    console.log("actual total cost: NOT ESTABLISHED — a marking reported no cost for at least one call");
  }
  console.log(`markings with an unreported call: ${stats.unaccountedMarkings}`);
  if (marked.length) {
    console.log(`exact agreement ${exact}/${marked.length}`);
    console.log(`signed bias ${mean(errors).toFixed(2)} marks · absolute ${mean(errors.map(Math.abs)).toFixed(2)}`);
  }
  console.log(`report written to ${join(REPORT, "past-paper-probe.json")}`);
}
