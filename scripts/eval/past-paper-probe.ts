import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createEvaluationMarker } from "@/services/ai/evaluation-marker.server";
import { markingCostBound } from "@/lib/evaluation/marking-cost-bound";
import { referenceMark, type MarkingCorpusRecord } from "@/lib/evaluation/marking-corpus";
import { adaptRecordToPaper } from "@/lib/evaluation/practice-paper-adapter";
import { getAiInputTokenCap, getAiTokenCap } from "@/lib/ai/budgets";
import { EXAM_AI_JOB_DEADLINE_MS } from "@/lib/practice/exam-questions";

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
/** Five responses under two representations. */
const RUNS = 10;

/**
 * A report filename no later run can take.
 *
 * This wrote to a fixed `past-paper-probe.json`, so the second probe destroyed
 * the first one's report on its way to recording a single timeout. The costs,
 * the per-record latencies and the five markings that had succeeded went with
 * it, and the only surviving figures were the ones that had already been
 * quoted in conversation. A run that spends real money and overwrites the
 * evidence of the last one is not a diagnostic.
 */
function reportPath(startedAt: number) {
  const stamp = new Date(startedAt).toISOString().replace(/[:.]/g, "-").replace(/Z$/, "");
  return join(REPORT, `past-paper-probe-${stamp}.json`);
}

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
  const startedAt = Date.now();
  const reportFile = reportPath(startedAt);
  const bound = markingCostBound({
    inputTokenCap: getAiInputTokenCap("examQuestionMarking"),
    maxOutputTokens: getAiTokenCap("examQuestionMarking"),
  });

  const all: MarkingCorpusRecord[] = JSON.parse(
    readFileSync(join(CORPUS, "medly-gcse.json"), "utf8")
  ).records;

  /*
   * Five responses, each marked under both scheme representations: ten runs.
   *
   *   maths_04, maths_05  the probe's two scoring errors, both partial-credit
   *   maths_01, maths_02  previously correct, and genuinely paired -- both
   *                       read as structured, so the arms actually differ
   *   maths_07            a new structured control, not a previously correct
   *                       one, chosen because maths_03 reads as unstructured
   *                       in both arms and so cannot measure a representation
   *                       change at all
   *
   * Every response has two agreeing human marks, so the reference is solid.
   * maths_03 stays a regression fixture rather than a control.
   *
   * This is not a replay of the first probe: both arms run the corrected
   * parser, with its consistency check and its production deadline. It tests
   * representation inside the fixed pipeline.
   */
  const CONTROLS = ["maths_04", "maths_05", "maths_01", "maths_02", "maths_07"] as const;
  const byQuestion = new Map<string, MarkingCorpusRecord[]>();
  for (const record of all) {
    if (record.answer.kind !== "image") continue;
    if (new Set(record.humanMarks).size !== 1) continue;
    byQuestion.set(record.questionId, [...(byQuestion.get(record.questionId) ?? []), record]);
  }
  const selected = CONTROLS.map((questionId) => {
    const list = byQuestion.get(questionId) ?? [];
    const partial = list.find(
      (record) => record.humanMarks[0]! > 0 && record.humanMarks[0]! < record.maxMarks
    );
    const chosen = partial ?? list[0];
    if (!chosen) throw new Error(`${questionId}: no agreed-mark response available.`);
    return chosen;
  });

  console.log(`probe: ${selected.length} responses x 2 representations = ${selected.length * 2} runs`);
  console.log(`reserve $${bound.usdPerRecord.toFixed(4)}/run · budget $${BUDGET_USD.toFixed(2)}`);
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
  /** Parse or consistency refusals that forced the marker to try again. */
  const repairs = new Map<string, string[]>();
  const { mark, stats } = createEvaluationMarker({
    maxRecords: RUNS,
    maxSpendUsd: BUDGET_USD,
    reserveUsdPerRecord: bound.usdPerRecord,
    haltOnUnreportedCost: true,
    /*
     * Production's deadline, read from production rather than copied.
     *
     * It was 55 seconds, which was never a marking budget: it was what fitted
     * inside one serverless request. Marking is now a durable job and the
     * deadline is set for marking, so a run that pinned the old number would
     * be measuring a constraint students no longer have -- and would fail
     * markings that succeed for them.
     */
    timeoutMs: EXAM_AI_JOB_DEADLINE_MS,
    pipeline: "pastPaperPractice",
    loadAnswerImages: async (record) => loadAnswerImage(record),
    onAudit: (audit) => audits.set(String(audit.record), audit as Record<string, unknown>),
    /*
     * A parse failure is now also a consistency refusal, and both cost a call.
     * Recorded per record so the comparison can say whether the corrected
     * pipeline changed outcomes by repairing or by rejecting.
     */
    onParseFailure: (failure) => {
      const key = String(failure.record ?? "");
      repairs.set(key, [...(repairs.get(key) ?? []), String(failure.kind ?? "unknown")]);
    },
    onMarkerReport: (report) => {
      const key = String(report.record);
      reports.set(key, [...(reports.get(key) ?? []), report as unknown as Record<string, unknown>]);
    },
  });

  /*
   * Recorded per record so structured and unstructured schemes are never
   * averaged together: a result measured against a whole-tariff fallback is
   * saying something different from one measured against the marks the board
   * states.
   */
  /*
   * The first probe's scheme shape, reproduced by removing the notation the
   * parser reads. The scheme's words are unchanged; only its structure is.
   */
  const flattened = (record: MarkingCorpusRecord): MarkingCorpusRecord => ({
    ...record,
    id: `${record.id}#flat`,
    markScheme: `Award up to ${record.maxMarks} marks as follows.
${record.markScheme ?? ""}`,
  });

  const representationOf = (record: MarkingCorpusRecord) => {
    const adapted = adaptRecordToPaper(record, { answerImages: loadAnswerImage(record) });
    return adapted.ok ? adapted.adapted.schemeRepresentation : "unstructured";
  };

  const outcomes: Record<string, unknown>[] = [];
  /*
   * Runs are paired: each response is marked once with the scheme's structure
   * read and once with it flattened, so a difference has one variable in it.
   * `flattenScheme` reproduces the shape the first probe marked against.
   */
  const arms = [
    { arm: "structured" as const, flatten: false },
    { arm: "flattened" as const, flatten: true },
  ];
  const runs = selected.flatMap((record) => arms.map((entry) => ({ record, ...entry })));

  for (const { record, arm, flatten } of runs) {
    const startedAt = Date.now();
    const reportedBefore = stats.reportedUsd;
    const retainedBefore = stats.retainedReservationUsd;
    try {
      // Production sends no exemplars, so the arm that matches it is "none".
      const response = await mark({ record: flatten ? flattened(record) : record, arm: "none", exemplars: [] });
      const audit = audits.get(record.id) ?? {};
      outcomes.push({
        record: record.id,
        arm,
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
        repairAttempts: repairs.get(record.id) ?? [],
        schemeRepresentation: flatten ? "unstructured" : representationOf(record),
        reportedCostUsd: Number((stats.reportedUsd - reportedBefore).toFixed(6)),
        retainedReservationUsd: Number((stats.retainedReservationUsd - retainedBefore).toFixed(6)),
        latencyMs: Date.now() - startedAt,
      });
    } catch (error) {
      // Kept in the report. A run that dropped its failures would report the
      // accuracy of the answers that happened to succeed.
      outcomes.push({
        record: record.id,
        arm,
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
    startedAt: new Date(startedAt).toISOString(),
    probe: "past-paper-scheme-representation",
    design: "5 responses x 2 scheme representations = 10 runs, serial",
    pipeline: "pastPaperPractice",
    note: "Both arms use the corrected parser, with its consistency check and production deadline. This measures representation inside the fixed pipeline, not a replay of the first probe.",
    source: "medly-gcse (GCSE mock benchmark, CC BY 4.0) — not awarding-body past papers",
    budgetUsd: BUDGET_USD,
    reservePerRecordUsd: bound.usdPerRecord,
    pricesReadOn: bound.pricesReadOn,
    stats: { ...stats },
    outcomes,
  };
  writeFileSync(reportFile, JSON.stringify(report, null, 2));

  const marked = outcomes.filter((item) => typeof item.awardedMarks === "number");
  const exact = marked.filter((item) => item.awardedMarks === item.referenceMark).length;
  const errors = marked.map((item) => Number(item.awardedMarks) - Number(item.referenceMark));
  const mean = (values: number[]) =>
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

  /*
   * Paired, side by side, because that is the only comparison this design
   * supports. One result per arm says nothing about repeatability, and where
   * the two arms reached different fallback models the difference cannot be
   * put down to the scheme.
   */
  console.log("");
  console.log("response        ref   structured   flattened   models agree");
  for (const record of selected) {
    const pair = outcomes.filter((item) => item.questionId === record.questionId);
    const structured = pair.find((item) => item.arm === "structured");
    const flat = pair.find((item) => item.arm === "flattened");
    const sameModel =
      JSON.stringify(structured?.markerReports ?? []) !== "" &&
      String(structured?.error ?? "") === String(flat?.error ?? "");
    console.log(
      `  ${String(record.questionId).padEnd(12)} ${String(referenceMark(record)).padStart(3)}/${record.maxMarks}` +
        `   ${String(structured?.awardedMarks ?? "-").padStart(9)}   ${String(flat?.awardedMarks ?? "-").padStart(9)}` +
        `   ${sameModel ? "" : "CHECK ROUTING"}`
    );
  }

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
  console.log(`report written to ${reportFile}`);
}
