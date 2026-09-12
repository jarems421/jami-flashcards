import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createEvaluationMarker } from "@/services/ai/evaluation-marker.server";
import { markingCostBound } from "@/lib/evaluation/marking-cost-bound";
import { humanBenchmark } from "@/lib/evaluation/agreement";
import { referenceMark, type MarkingCorpusRecord } from "@/lib/evaluation/marking-corpus";
import { scoreMark, summariseOutcomes, type MarkOutcome } from "@/lib/evaluation/scoring";
import { stratifiedSlice } from "@/lib/evaluation/sampling";
import { corpusSource } from "@/lib/evaluation/marking-corpus";
import { selectExemplars, type ExemplarArm } from "@/lib/evaluation/exemplar-arms";
import { adaptRecordToPaper } from "@/lib/evaluation/practice-paper-adapter";
import { getAiInputTokenCap, getAiTokenCap } from "@/lib/ai/budgets";
import { EXAM_AI_JOB_DEADLINE_MS } from "@/lib/practice/exam-questions";

/**
 * How well Past Paper Practice marks, measured well enough to gate a release.
 *
 * Distinct from `past-paper-probe.ts`, which is a five-response A/B on scheme
 * representation and was never a quality measurement. This is the benchmark the
 * repository has never had: a stratified sample, scored with the machinery in
 * `lib/evaluation`, written out as content-free aggregates that
 * `check-marking-benchmark.mjs` can block on.
 *
 * What a pass here does and does not say is written into the report itself.
 * `medly-gcse` is a GCSE *mock* benchmark and no question file in it names a
 * board, so this measures whether the marker applies a scheme correctly -- not
 * whether it is ready on awarding-body past-paper wording, which is what the
 * feature actually serves.
 *
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs \
 *     scripts/eval/past-paper-quality.ts --confirm [--records=30] [--budget=12]
 */
const CORPUS = resolve("artifacts/corpus");
const REPORT = resolve("artifacts/evaluation");
const COMPONENT = "past-paper-practice-gcse-maths";

function flag(args: string[], name: string, fallback: number) {
  const raw = args.find((item) => item.startsWith(`--${name}=`))?.split("=")[1];
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function loadAnswerImage(record: MarkingCorpusRecord) {
  if (record.answer.kind !== "image") return [];
  return record.answer.paths.map((path) => ({
    inlineData: { mimeType: "image/png" as const, data: readFileSync(path).toString("base64") },
  }));
}

export default async function main(args: string[]) {
  const startedAt = Date.now();
  const wanted = Math.round(flag(args, "records", 30));
  /*
   * Which exemplars the marker is shown, if any.
   *
   * `none` is the control and is what production does today. The rest were
   * built in `exemplar-arms.ts` and never run: anchoring a grader with
   * already-marked work is reported to improve agreement *and* cut severity
   * bias, which are this marker's two failing measures. `matched` is the
   * widest contrast with the control, so it is tried first.
   */
  const arm = (args.find((item) => item.startsWith("--arm="))?.split("=")[1] ?? "none") as ExemplarArm;
  const bound = markingCostBound({
    inputTokenCap: getAiInputTokenCap("examQuestionMarking"),
    maxOutputTokens: getAiTokenCap("examQuestionMarking"),
  });
  const budgetUsd = flag(args, "budget", Math.ceil(wanted * bound.usdPerRecord * 100) / 100);

  const all: MarkingCorpusRecord[] = JSON.parse(
    readFileSync(join(CORPUS, "medly-gcse.json"), "utf8")
  ).records;

  /*
   * Handwritten GCSE maths with two human marks. Double-marked is not a nicety
   * here: every threshold in the gate is a ratio to what the examiners did on
   * the same answer, and a single-marked record has no such thing to compare
   * against.
   */
  const doubleMarked = all.filter(
    (record) =>
      record.subject === "maths" &&
      record.level === "gcse" &&
      record.answer.kind === "image" &&
      record.humanMarks.length > 1
  );

  /*
   * Schemes the adapter can read as points, decided here rather than mid-run.
   *
   * This used to be a skip inside the loop, which quietly halved the sample:
   * exactly half of these records carry a scheme the parser cannot structure,
   * so asking for thirty produced fifteen marks and a report the gate would
   * refuse for being under its floor -- after paying for the run.
   *
   * Deciding it up front costs nothing (the adapter makes no provider call) and
   * makes the number asked for the number measured. It does narrow what the
   * result covers, which the report says in as many words: this measures the
   * marker on questions whose scheme states its own marks, not on the whole
   * corpus. Marking the others against a whole-tariff fallback would measure
   * the adapter instead, which is worse than measuring less.
   */
  const eligible = doubleMarked.filter((record) => {
    const adapted = adaptRecordToPaper(record, { answerImages: loadAnswerImage(record) });
    return adapted.ok && adapted.adapted.schemeRepresentation === "structured";
  });

  /*
   * Stratified by mark share, not taken from the top. Agreement falls sharply
   * with tariff and with how much of the tariff was earned, so a sample drawn
   * in corpus order measures whichever band happens to sit at the front.
   */
  /*
   * Exemplar questions are spent, not split off.
   *
   * `splitCorpus` sends every double-marked group to the benchmark side --
   * correctly, since two human marks are the only thing any threshold here is
   * measured against. But every maths record in this corpus is double-marked
   * across just six structured questions, so that rule yields an empty exemplar
   * pool and the arm silently becomes the control.
   *
   * So two whole questions are given up as anchors and removed from
   * measurement. It costs a third of the question variety, which is why both
   * arms run on the same reduced pool: the comparison between them stays
   * honest, and neither is comparable to a run that sampled all six.
   *
   * Whole questions rather than individual answers, so no answer to a question
   * under test can be shown as an example of how to mark it.
   */
  const questionIds = [...new Set(eligible.map((record) => record.questionId))].sort();
  /*
   * Only spend questions when something is going to use them. The control arm
   * needs no anchors, and reserving two questions for a pool it never reads
   * would narrow the measurement for nothing -- worse here than elsewhere,
   * since the first two happen to be the pair an earlier probe flagged as the
   * marker's scoring errors.
   */
  const exemplarQuestions = new Set(arm === "none" ? [] : questionIds.slice(0, 2));
  const benchmarkPool = eligible.filter((record) => !exemplarQuestions.has(record.questionId));
  const exemplarPool = eligible.filter((record) => exemplarQuestions.has(record.questionId));

  /*
   * The licence is checked rather than assumed: an exemplar is shipped into a
   * provider prompt, which is a different permission from being allowed to
   * measure against it.
   */
  const licence = corpusSource("medly-gcse")?.licence;
  const shippable = Boolean(licence?.verified && licence?.redistributable);

  const sampled = stratifiedSlice({
    records: benchmarkPool,
    size: wanted,
    seed: "past-paper-quality",
  });
  /*
   * Narrow to named questions *after* sampling, never before.
   *
   * Filtering the pool first would re-draw a different set under the same seed
   * and break the pairing with an earlier run. Filtering the sample keeps
   * exactly the records a full run already marked, so a fix aimed at two
   * questions can be measured against what those same answers scored before it
   * -- twelve markings and about ten cents, rather than forty and half an hour.
   */
  const onlyQuestions = args.find((item) => item.startsWith("--questions="))?.split("=")[1];
  const selected = onlyQuestions
    ? sampled.filter((record) => onlyQuestions.split(",").includes(record.questionId))
    : sampled;
  const human = humanBenchmark(selected);
  const exemplarsFor = (record: MarkingCorpusRecord) =>
    arm === "none" || !shippable
      ? { exemplars: [], shortfall: null }
      : selectExemplars({
          arm,
          target: record,
          pool: exemplarPool,
          benchmark: benchmarkPool,
          seed: "past-paper-quality",
        });

  console.log(
    `corpus: ${doubleMarked.length} double-marked, ${eligible.length} with a structured scheme, ` +
      `sampling ${selected.length} of ${benchmarkPool.length} across ` +
      `${questionIds.length - exemplarQuestions.size} questions`
  );
  console.log(
    `arm: ${arm} · exemplar pool ${exemplarPool.length} from ` +
      `${[...exemplarQuestions].join(", ")} · licence shippable: ${shippable}`
  );
  if (arm !== "none" && !shippable) {
    throw new Error("Refusing to ship exemplars from a source whose licence is not cleared.");
  }
  if (arm !== "none") {
    /*
     * The two biases the literature names for few-shot grading: how many
     * exemplars sit at each score point, and what the last one scored. Both
     * pull a judgement, and both are invisible unless reported.
     */
    const drawn = selected.flatMap((record) => exemplarsFor(record).exemplars);
    const shortfalls = selected.filter((record) => exemplarsFor(record).shortfall).length;
    const shares = drawn.map((record) =>
      record.maxMarks > 0 ? Math.round((referenceMark(record) / record.maxMarks) * 4) / 4 : 0
    );
    const tally = new Map<number, number>();
    for (const share of shares) tally.set(share, (tally.get(share) ?? 0) + 1);
    console.log(
      `exemplars: ${drawn.length} drawn · score mix ` +
        [...tally.entries()].sort().map(([k, v]) => `${k}:${v}`).join(" ") +
        (shortfalls ? ` · ${shortfalls} records short of a full draw` : "")
    );
  }
  console.log(`reserve $${bound.usdPerRecord.toFixed(4)}/record · budget $${budgetUsd.toFixed(2)}`);
  console.log(`prices read ${bound.pricesReadOn} · caps enforced: ${bound.capsEnforced}`);
  if (human) {
    console.log(
      `human ceiling on this sample: ${(human.exact * 100).toFixed(1)}% exact · ` +
        `gap ${human.meanGap.toFixed(2)} marks · bias ${human.bias.toFixed(2)} · ` +
        `mean tariff ${human.meanMaxMarks.toFixed(1)}`
    );
  } else {
    console.log("human ceiling: NONE — no double-marked records in the sample.");
  }
  if (!args.includes("--confirm")) {
    console.log("\nDry listing only. Re-run with --confirm to make paid calls.");
    return;
  }
  if (!human) throw new Error("Refusing to run: nothing to measure against.");

  const parseFailures: string[] = [];
  /*
   * What each marker said on its own, before the ensemble combined them.
   *
   * Both markers see identical evidence, so scoring each against the same human
   * reference is what separates "this model marks badly" from "this task marks
   * badly whoever does it" -- and the ensemble's own figure cannot tell those
   * apart. The calls are made either way; three runs paid for them and threw
   * the comparison away.
   */
  const audits = new Map<string, { primary?: number; verifier?: number; adjudicated: boolean }>();
  const { mark, stats } = createEvaluationMarker({
    maxRecords: selected.length,
    maxSpendUsd: budgetUsd,
    reserveUsdPerRecord: bound.usdPerRecord,
    haltOnUnreportedCost: true,
    // Production's own deadline, read from production.
    timeoutMs: EXAM_AI_JOB_DEADLINE_MS,
    pipeline: "pastPaperPractice",
    loadAnswerImages: async (record) => loadAnswerImage(record),
    onParseFailure: (failure) => parseFailures.push(String(failure.kind ?? "unknown")),
    onAudit: (audit) =>
      audits.set(audit.record, {
        primary: audit.primary,
        verifier: audit.verifier,
        adjudicated: audit.adjudicated,
      }),
    onProgress: (progress) =>
      console.log(
        `  ${String(progress.done).padStart(3)}/${selected.length} ${progress.record} ` +
          `${progress.awarded ?? "-"}${progress.error ? ` · ${progress.error}` : ""}`
      ),
  });

  const outcomes: MarkOutcome[] = [];
  const skipped: { record: string; reason: string }[] = [];
  for (const record of selected) {
    try {
      const response = await mark({ record, arm, exemplars: exemplarsFor(record).exemplars });
      // A refusal is recorded, never coerced into a mark of zero -- which would
      // read as the marker being harsh rather than absent.
      if (!response) {
        skipped.push({ record: record.id, reason: "refused" });
        continue;
      }
      outcomes.push(
        scoreMark({ record, candidate: response.awardedMarks, criteria: response.criteria })
      );
    } catch (error) {
      skipped.push({ record: record.id, reason: error instanceof Error ? error.message : "failed" });
    }
  }

  const summary = summariseOutcomes(outcomes);

  /*
   * Which questions the marker is wrong on, rather than how wrong it is overall.
   *
   * Two things make the aggregate misleading here. The marker is
   * near-deterministic -- temperature 0.05, and two runs of one configuration
   * have been measured 96.7% identical mark for mark -- and its two model
   * families produce the same distance and the same bias while disagreeing on
   * 2 records in 25. That is not variance around a correct answer; it is the
   * same answer, reliably, on the same items.
   *
   * So "2.33x the examiners' spread" may be six questions each slightly off, or
   * one question badly misread twenty times. Those need completely different
   * fixes and the headline figure cannot tell them apart. Ids and marks only --
   * no answers, no scheme text, nothing that would make this unshippable.
   */
  const byQuestion = new Map<string, { n: number; error: number; absError: number; exact: number; tariff: number }>();
  for (const outcome of outcomes) {
    const id = outcome.questionId;
    const row = byQuestion.get(id) ?? { n: 0, error: 0, absError: 0, exact: 0, tariff: outcome.maxMarks };
    const consensus = outcome.humanMarks.reduce((a, b) => a + b, 0) / outcome.humanMarks.length;
    const signed = outcome.candidate - consensus;
    row.n += 1;
    row.error += signed;
    row.absError += Math.abs(signed);
    row.exact += outcome.exactAgainstAny ? 1 : 0;
    byQuestion.set(id, row);
  }
  const questions = [...byQuestion.entries()]
    .map(([questionId, row]) => ({
      questionId,
      tariff: row.tariff,
      records: row.n,
      exactShare: row.exact / row.n,
      meanBias: row.error / row.n,
      meanAbsoluteError: row.absError / row.n,
    }))
    .sort((left, right) => right.meanAbsoluteError - left.meanAbsoluteError);

  /*
   * The same scoring, applied to each marker alone. `scoreMark` is the only
   * thing that knows how to compare a mark to a set of human marks, so the
   * per-marker figures are produced the same way the ensemble's are rather
   * than by a second, subtly different calculation.
   */
  const soloOutcomes = (pick: (a: { primary?: number; verifier?: number }) => number | undefined) =>
    selected.flatMap((record) => {
      const mark = pick(audits.get(record.id) ?? {});
      return typeof mark === "number" ? [scoreMark({ record, candidate: mark })] : [];
    });
  const primaryAlone = summariseOutcomes(soloOutcomes((a) => a.primary));
  const verifierAlone = summariseOutcomes(soloOutcomes((a) => a.verifier));
  const adjudicatedCount = [...audits.values()].filter((a) => a.adjudicated).length;

  /*
   * Aggregates only. The corpora these come from are third-party and gitignored
   * for licence reasons, so a report a gate reads -- and which therefore wants
   * committing -- must carry no record ids, no answers, no schemes and no
   * marker text. What it carries is countable.
   */
  const report = {
    schemaVersion: 1 as const,
    startedAt: new Date(startedAt).toISOString(),
    completedAt: new Date().toISOString(),
    components: {
      [COMPONENT]: {
        pipeline: "pastPaperPractice",
        corpus: "medly-gcse",
        subject: "maths",
        level: "gcse",
        answerKind: "image",
        arm,
        requested: selected.length,
        records: summary.count,
        skipped: skipped.length,
        /*
         * Already shares. `summariseOutcomes` divides by the outcome count on
         * the way out, and dividing again here turned 81.8% exact agreement
         * into 3.7% -- a number that reads as a broken marker rather than a
         * broken report, and which sat beside a 0.36-mark mean error that
         * flatly contradicted it.
         */
        exactShare: summary.exact,
        withinOneShare: summary.withinOne,
        withinHumanVariationShare: summary.withinHumanVariation,
        insideHumanIntervalShare: summary.insideHumanInterval,
        meanAbsoluteError: summary.meanAbsoluteError,
        normalisedError: summary.normalisedError,
        meanBias: summary.bias,
        candidateDisagreement: summary.candidateDisagreement,
        humanDisagreement: summary.humanDisagreement,
        criterionAgreement: summary.criterionAgreement,
        rightForTheRightReasons: summary.rightForTheRightReasons,
        human: {
          exactShare: human.exact,
          meanGap: human.meanGap,
          bias: human.bias,
          meanMaxMarks: human.meanMaxMarks,
        },
        /*
         * Each marker judged alone, against the same humans. `distance` is the
         * mean gap to the examiners' consensus, which is the figure the gate
         * compares -- so a primary and a verifier can be read against each
         * other and against the ensemble on one scale.
         */
        markers: {
          adjudicated: adjudicatedCount,
          primary: {
            model: "supervisor",
            records: primaryAlone.count,
            exactShare: primaryAlone.exact,
            distance: primaryAlone.candidateDisagreement,
            bias: primaryAlone.bias,
          },
          verifier: {
            model: "worker",
            records: verifierAlone.count,
            exactShare: verifierAlone.exact,
            distance: verifierAlone.candidateDisagreement,
            bias: verifierAlone.bias,
          },
        },
        /*
         * Which models produced these numbers.
         *
         * The baseline commits a measured figure and the staleness window
         * catches an old one, but nothing recorded the marker it described --
         * so a provider updating a model underneath us moves severity and
         * leaves the gate comparing against a number for a marker that no
         * longer exists. Routing can move mid-run too: a failover has already
         * reached a different model family once in this project.
         */
        questions,
        models: stats.models,
        reportedUsd: stats.reportedUsd,
        retainedReservationUsd: stats.retainedReservationUsd,
        unaccountedMarkings: stats.unaccountedMarkings,
        parseFailures: parseFailures.length,
        structuredSchemesOnly: true,
        doubleMarkedPool: doubleMarked.length,
        structuredPool: eligible.length,
        limits:
          "medly-gcse is a GCSE mock benchmark, not awarding-body past papers. A pass says the " +
          "marker applies a scheme correctly on mock GCSE maths; it does not say the marker is " +
          "ready on real past-paper wording. The sample is further restricted to schemes the " +
          "parser can read as points -- about half the double-marked pool -- so it says nothing " +
          "about questions whose scheme states only a total.",
      },
    },
  };

  mkdirSync(REPORT, { recursive: true });
  const stamp = new Date(startedAt).toISOString().replace(/[:.]/g, "-").replace(/Z$/, "");
  const file = join(REPORT, `past-paper-quality-${stamp}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));

  console.log("");
  console.log(`marked ${summary.count} of ${selected.length} · skipped ${skipped.length}`);
  console.log(`exact ${(summary.exact * 100).toFixed(1)}% · human ${(human.exact * 100).toFixed(1)}%`);
  console.log(
    `inside the examiners' spread ${((summary.withinHumanVariation ?? 0) * 100).toFixed(1)}% · ` +
      `bias ${summary.bias.toFixed(2)} marks`
  );
  console.log(
    `distance to consensus: Jami ${(summary.candidateDisagreement ?? 0).toFixed(2)} · ` +
      `each examiner ${((summary.humanDisagreement ?? 0) / 2).toFixed(2)}`
  );
  const solo = (name: string, v: ReturnType<typeof summariseOutcomes>) =>
    console.log(
      `  ${name.padEnd(10)} n=${String(v.count).padStart(3)} exact ${(v.exact * 100).toFixed(1)}% ` +
        `· distance ${(v.candidateDisagreement ?? 0).toFixed(2)} · bias ${v.bias.toFixed(2)}`
    );
  console.log("");
  console.log("by question, worst first:");
  for (const row of questions) {
    console.log(
      `  ${row.questionId.padEnd(12)} ${String(row.tariff)}mk n=${String(row.records).padStart(2)} ` +
        `exact ${(row.exactShare * 100).toFixed(0).padStart(3)}% · ` +
        `error ${row.meanAbsoluteError.toFixed(2)} · bias ${row.meanBias >= 0 ? "+" : ""}${row.meanBias.toFixed(2)}`
    );
  }
  console.log("");
  console.log("each marker alone, against the same examiners:");
  solo("primary", primaryAlone);
  solo("verifier", verifierAlone);
  console.log(`  ensemble   n=${String(summary.count).padStart(3)} exact ${(summary.exact * 100).toFixed(1)}% ` +
    `· distance ${(summary.candidateDisagreement ?? 0).toFixed(2)} · bias ${summary.bias.toFixed(2)}`);
  console.log(`  adjudicated ${adjudicatedCount} of ${summary.count}`);
  console.log("");
  console.log(`known reported cost $${stats.reportedUsd.toFixed(4)} of $${budgetUsd.toFixed(2)}`);
  if (stats.retainedReservationUsd > 0) {
    console.log(
      `reservation retained for unaccounted markings $${stats.retainedReservationUsd.toFixed(4)}`
    );
    console.log("actual total cost: NOT ESTABLISHED — a marking reported no cost for at least one call");
  }
  console.log(`report written to ${file}`);
  console.log("");
  console.log("This measures the marker. It does not approve it: to make it a gate, copy these");
  console.log(`aggregates into benchmarks/marking-quality-baselines.json and set approved: true.`);
}
