import "server-only";

import { getAiInputTokenCap, getAiTokenCap } from "@/lib/ai/budgets";
import {
  adaptRecordToPaper,
  exemplarsToParts,
} from "@/lib/evaluation/practice-paper-adapter";
import type { AiContentPart } from "@/lib/ai/content-parts";
import type { PracticePaper } from "@/lib/practice/practice-papers";
import type { MarkingCorpusRecord } from "@/lib/evaluation/marking-corpus";
import type { Marker, MarkRequest, MarkResponse } from "@/lib/evaluation/experiment";
import {
  markPracticePaperWithAudit,
  markSingleQuestionAdaptively,
} from "@/services/ai/practice-paper-marking.server";
import { examMarkingNeedsVerification } from "@/lib/practice/exam-marking-policy";

/**
 * The evaluation's marker: Jami's real marking path, nothing simulated.
 *
 * Each response goes through `markPracticePaperWithAudit`, which is what a
 * student's submission goes through — two blind markers on different models,
 * adjudication by the supervisor where they disagree, and a juror third view on
 * the questions that survive that. Measuring only the supervisor would be a
 * model experiment; this is a Jami experiment, and the two can differ precisely
 * because the ensemble exists to catch what one model gets wrong.
 *
 * It costs what it costs: roughly two calls per response, three when the
 * markers disagree, and disagreement is not rare. That is the price of
 * measuring the product rather than a component of it.
 *
 * Budget discipline is deliberate rather than inherited. The production budget
 * gate is per student and Firestore-backed, and an evaluation is not a student:
 * charging a run against somebody's daily allowance would either exhaust it or
 * silently stop half way. So the run carries its own ceiling, enforced here and
 * reported, while the *output* cap is taken from the shipped configuration so
 * responses are shaped exactly as they are in production.
 */

/**
 * How long to wait before retrying a marking the provider rate-limited.
 *
 * An evaluation asks for work at a rate no student ever would: the supervisor
 * is called two or three times per marking, so a handful of concurrent
 * markings puts twenty of its calls in flight and the provider refuses some.
 * Production has no such problem and should not be changed to accommodate one,
 * so the *evaluation* backs off instead.
 *
 * This matters beyond tidiness. A rate-limited marking is recorded as a
 * refusal, and refusals are not random — they cluster wherever the run happened
 * to be busiest. Left alone they would quietly thin one arm more than another
 * and the comparison would be between different sample sizes.
 */
const RATE_LIMIT_BACKOFF_MS = [4_000, 12_000, 30_000];

/**
 * What one marking is assumed to cost until it says otherwise.
 *
 * Sized for the most expensive shape this evaluator runs -- a handwritten,
 * high-tariff response that buys a second marker, disagrees with it, and is
 * adjudicated, carrying page images on every call. Deliberately generous: an
 * over-estimate ends a run early, an under-estimate lets it overshoot the
 * ceiling it was given, and only one of those is recoverable.
 */
const DEFAULT_RESERVE_USD = 0.15;

const isRateLimited = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return /\b429\b|rate.?limit/i.test(message);
};

/**
 * Which marker a run is measuring.
 *
 * `wholePaper` is the paper surface: two blind markers on every question, then
 * adjudication, then a juror. `pastPaperPractice` is what a student answering
 * one past-paper question actually gets: one marker, a second bought only
 * where the shipped rule asks for it, adjudication only on a real dispute, and
 * no juror -- on the shipped single-question output and input caps.
 *
 * They are not interchangeable. Reporting a whole-paper figure as Past Paper
 * Practice readiness flatters the product by an ensemble the student never
 * receives, and that is precisely what this evaluator did while describing
 * itself as "Jami's real marking path".
 */
export type EvaluationPipeline = "wholePaper" | "pastPaperPractice";

/**
 * The single-question marker, called exactly as the answers route calls it.
 *
 * The shipped output and input caps, the shipped verification trigger, and a
 * deadline of the same shape -- so a run measures the marker a student is
 * given rather than a more expensive one that happens to share a prompt.
 */
async function markPastPaperPracticeQuestion(
  adapted: { paper: PracticePaper; answerParts: AiContentPart[] },
  deadlineAt: number
) {
  const question = adapted.paper.questions[0];
  const scheme = adapted.paper.markScheme?.items?.find(
    (item: { questionId: string }) => item.questionId === question?.id
  );
  if (!question || adapted.paper.questions.length !== 1 || !scheme) {
    throw new Error("single_question_required");
  }
  const hasWorking = adapted.answerParts.some((part) => "inlineData" in part);
  const marked = await markSingleQuestionAdaptively({
    paper: adapted.paper,
    answerParts: adapted.answerParts,
    deadlineAt,
    maxOutputTokens: getAiTokenCap("examQuestionMarking"),
    inputTokenCap: getAiInputTokenCap("examQuestionMarking"),
    forceVerification: examMarkingNeedsVerification(scheme, question.marks, hasWorking),
  });
  /*
   * Reported in the whole-paper audit's shape so one set of statistics covers
   * both runs. `thirdViewQuestionIds` is empty rather than omitted because
   * this path genuinely has no juror -- a reader comparing the two runs should
   * see that as a zero, not as a missing field.
   */
  const disputed = marked.audit.adjudicated ? [question.id] : [];
  return {
    result: marked.result,
    estimatedCostUsd: marked.estimatedCostUsd,
    costAccounting: marked.costAccounting,
    audit: {
      version: 1 as const,
      primaryScores: { [question.id]: marked.audit.primaryScore },
      verifierScores:
        marked.audit.verifierScore === undefined ? {} : { [question.id]: marked.audit.verifierScore },
      disputedQuestionIds: disputed,
      adjudicatedQuestionIds: disputed,
      thirdViewQuestionIds: [] as string[],
      createdAt: Date.now(),
    },
  };
}

export type EvaluationMarkerOptions = {
  /** Hard ceiling on marking calls. The run stops rather than exceeding it. */
  maxRecords: number;
  /** Which student-facing marker to measure. Defaults to the paper surface. */
  pipeline?: EvaluationPipeline;
  /**
   * Stop the whole run the first time a marking's cost comes back unreported.
   *
   * Without a figure the reservation is all that is known, and every further
   * marking widens a gap between what was committed and what is actually being
   * charged. Continuing would be spending blind, so a run that has been given a
   * budget it must not exceed stops instead and says why.
   */
  haltOnUnreportedCost?: boolean;
  /**
   * A hard ceiling in dollars, checked against what the providers actually
   * reported rather than against an estimate made beforehand.
   *
   * A record ceiling bounds the number of markings, not their price: a run of
   * handwritten high-tariff responses buys a second marker and an adjudication
   * on most of them and costs several times what the same count of short typed
   * answers would. This stops the run rather than discovering the difference on
   * a bill.
   */
  maxSpendUsd?: number;
  /**
   * What one marking is assumed to cost until it reports otherwise.
   *
   * The ceiling is only a ceiling if the money is committed before the call,
   * not counted after it. Checking the running total on the way in bounds
   * nothing under concurrency -- eight markings pass the check together and
   * then all eight spend -- and it ignores that one marking is several calls:
   * a second marker where the rule asks for one, an adjudication where they
   * disagree, and a retry for every rate-limited attempt.
   *
   * So each marking reserves this much up front and reconciles to its real
   * cost afterwards. It must be at least as large as the most expensive single
   * marking, or the reservation understates the commitment and the bound
   * leaks. Too large only ends a run early, which is the safe direction.
   */
  reserveUsdPerRecord?: number;
  /** Per-response wall-clock budget, matching the production deadline shape. */
  timeoutMs?: number;
  /**
   * Load the pages of a scanned answer, for sources whose work is photographed.
   *
   * Supplied by the caller because opening a PDF is I/O the adapter does not
   * do, and because a run over typed answers should not pay to have a loader
   * it never calls.
   */
  loadAnswerImages?: (record: MarkingCorpusRecord) => Promise<readonly AiContentPart[]>;
  onProgress?: (progress: {
    done: number;
    record: string;
    arm: string;
    awarded: number | null;
    error?: string;
  }) => void;
  onFallback?: (fields: Record<string, unknown>) => void;
  /**
   * What each marker in the ensemble said, before it was combined.
   *
   * The bias this exists to explain is stubborn: Jami has marked +0.5 marks
   * generous through every configuration tried -- with and without the
   * question and scheme, with and without a prompt telling it to check the
   * working. Recording each marker separately is what allows a combination
   * rule to be tested by arithmetic instead of by another paid run.
   */
  onMarkerReport?: (report: {
    record: string;
    arm: string;
    role: string;
    modelRole: string;
    questions: {
      questionId: string;
      awardedMarks: number;
      confidence: string;
      criteria: {
        criterionId: string;
        awarded: boolean;
        schemeValue?: string;
        candidateValue?: string;
        evidence?: string;
      }[];
    }[];
  }) => void;
  /** Raw output of a report that could not be read, for diagnosis. */
  onParseFailure?: (failure: {
    record: string;
    arm: string;
    role: string;
    kind: string;
    detail: string;
    length: number;
    raw: string;
  }) => void;
  /**
   * The marking audit, for diagnosing the ensemble itself.
   *
   * The audit already records what each blind marker awarded and which
   * questions were disputed, which is enough to separate a real disagreement
   * about marks from one triggered by something else — without changing a line
   * of the marking path to find out.
   */
  onAudit?: (audit: {
    record: string;
    arm: string;
    primary: number | undefined;
    verifier: number | undefined;
    final: number | undefined;
    disputed: boolean;
    adjudicated: boolean;
    thirdView: boolean;
  }) => void;
};

export type EvaluationMarkerStats = {
  attempted: number;
  marked: number;
  unsupported: number;
  failed: number;
  /** Responses where the two blind markers disagreed and were adjudicated. */
  adjudicated: number;
  /** Responses that additionally went to the juror. */
  thirdView: number;
  /** Markings the provider rate-limited and the run waited out. */
  rateLimited: number;
  /**
   * What providers actually reported. This is the only measured expenditure.
   */
  reportedUsd: number;
  /**
   * Reservations still held for markings whose cost never came back.
   *
   * Kept apart from `reportedUsd` on purpose. Adding them gives a number that
   * is neither: it overstates what is known to have been spent and understates
   * nothing usefully, and the first probe was reported as "$0.3725 spent" when
   * $0.0218 was measured and the rest was accounting protection for one failed
   * marking. A total is not established while this is above zero.
   */
  retainedReservationUsd: number;
  /**
   * Markings where at least one call reported no cost, so its reservation is
   * still held. A run with any of these has not been fully accounted for.
   */
  unaccountedMarkings: number;
  /** Unreadable reports by cause, so a failure rate can be acted on. */
  parseFailures: Record<string, number>;
  reasons: string[];
};

export function createEvaluationMarker(options: EvaluationMarkerOptions): {
  mark: Marker;
  stats: EvaluationMarkerStats;
} {
  /**
   * Money promised, which is what a ceiling has to be checked against.
   *
   * A default sized for the most expensive shape this evaluator runs: a
   * handwritten high-tariff response that buys a second marker, disagrees, and
   * is adjudicated, with page images on every call.
   */
  let committedUsd = 0;
  /** Set once the run must launch no further calls, with the reason. */
  let halted = "";
  const stats: EvaluationMarkerStats = {
    attempted: 0,
    marked: 0,
    unsupported: 0,
    failed: 0,
    adjudicated: 0,
    thirdView: 0,
    rateLimited: 0,
    reportedUsd: 0,
    retainedReservationUsd: 0,
    unaccountedMarkings: 0,
    parseFailures: {},
    reasons: [],
  };

  const mark: Marker = async (request: MarkRequest): Promise<MarkResponse | null> => {
    if (stats.attempted >= options.maxRecords) {
      // Refuses rather than truncating quietly: a run that silently stopped
      // half way would report an arm's score over fewer responses than the
      // others and the comparison would be meaningless.
      throw new Error(
        `Evaluation call ceiling of ${options.maxRecords} reached. Raise it deliberately or narrow the run.`
      );
    }
    /*
     * Committed, not spent. The reservation is taken before the first call of
     * this marking and released to the real figure afterwards, so concurrent
     * markings cannot each see room that only one of them can have.
     */
    if (halted) {
      throw new Error(`Evaluation stopped before this marking: ${halted}.`);
    }
    const reserve = options.reserveUsdPerRecord ?? DEFAULT_RESERVE_USD;
    if (options.maxSpendUsd !== undefined && committedUsd + reserve > options.maxSpendUsd) {
      halted = `the $${options.maxSpendUsd.toFixed(2)} budget is committed`;
      throw new Error(
        `Evaluation spend ceiling of $${options.maxSpendUsd.toFixed(2)} reached: ` +
          `$${committedUsd.toFixed(2)} committed across ${stats.marked} markings, and the next ` +
          `reserves $${reserve.toFixed(2)}. Raise it deliberately or narrow the run.`
      );
    }
    committedUsd += reserve;
    let reconciled = false;
    /*
     * A reservation is released only against a figure that is actually known.
     *
     * A provider that reports no cost sums to zero, which is the same number a
     * free call produces, and releasing the reservation on that basis is how a
     * bounded run spends without noticing. Where any call in the marking went
     * unaccounted the reservation stands in full, and the run says so.
     */
    const settle = (accounting: { usd: number; unreportedCalls: number } | undefined) => {
      if (reconciled) return;
      reconciled = true;
      if (!accounting || accounting.unreportedCalls > 0) {
        stats.unaccountedMarkings += 1;
        // Whatever it did report is measured; the rest of the reservation is
        // held, and stays visible as a reservation rather than as spending.
        stats.reportedUsd += accounting?.usd ?? 0;
        stats.retainedReservationUsd += Math.max(0, reserve - (accounting?.usd ?? 0));
        if (options.haltOnUnreportedCost) halted = "a marking reported no cost for at least one of its calls";
        return;
      }
      committedUsd += accounting.usd - reserve;
      stats.reportedUsd += accounting.usd;
    };
    stats.attempted += 1;

    let answerImages: readonly AiContentPart[] = [];
    if (request.record.answer.kind === "image" && options.loadAnswerImages) {
      try {
        answerImages = await options.loadAnswerImages(request.record);
      } catch (error) {
        // A page that cannot be read is a refusal, never a marking of a blank.
        stats.unsupported += 1;
        stats.reasons.push(
          `${request.record.id}: could not load its pages (${
            error instanceof Error ? error.message.slice(0, 80) : "unknown"
          }).`
        );
        return null;
      }
    }

    const adapted = adaptRecordToPaper(request.record, { answerImages });
    if (!adapted.ok) {
      stats.unsupported += 1;
      stats.reasons.push(adapted.reason);
      options.onProgress?.({
        done: stats.attempted,
        record: request.record.id,
        arm: request.arm,
        awarded: null,
        error: adapted.reason,
      });
      return null;
    }

    /**
     * The whole marking's budget, which has to accommodate its slowest part.
     *
     * Four minutes was enough while the juror gave up at one. Now that it is
     * allowed the three minutes it actually needs, a marking that goes pair,
     * adjudication and third view can reach roughly two hundred seconds, and a
     * four-minute ceiling leaves almost no margin — two of the last run's four
     * failures were this deadline expiring rather than anything going wrong.
     * A timeout recorded as a refusal thins the paired set for no reason.
     */
    const timeoutMs = options.timeoutMs ?? 420_000;
    /*
     * One deadline for the whole marking, fixed before the first attempt.
     *
     * It used to be computed inside the retry loop, so every rate-limit retry
     * minted a fresh one and a marking could run for four times the budget it
     * was given -- which is not the shape production has, where the deadline is
     * set once at route entry and every attempt is clamped to what is left of
     * it. The router already honours a deadline across failover and standby;
     * the bug was handing it a new one.
     */
    const deadlineAt = Date.now() + timeoutMs;
    try {
      const attempt = async () => {
        let lastError: unknown;
        for (let index = 0; index <= RATE_LIMIT_BACKOFF_MS.length; index += 1) {
          try {
            if ((options.pipeline ?? "wholePaper") === "pastPaperPractice") {
              return await markPastPaperPracticeQuestion(adapted.adapted, deadlineAt);
            }
            return await markPracticePaperWithAudit({
              paper: adapted.adapted.paper,
              answerParts: adapted.adapted.answerParts,
              exemplarParts: exemplarsToParts(request.exemplars),
              deadlineAt,
              maxOutputTokens: getAiTokenCap("practicePaperMarking"),
              logFallback: options.onFallback,
              ...(options.onMarkerReport
                ? {
                    onMarkerReport: (report: {
                      role: string;
                      modelRole: string;
                      questions: {
                        questionId: string;
                        awardedMarks: number;
                        confidence: string;
                        criteria: {
                          criterionId: string;
                          awarded: boolean;
                          schemeValue?: string;
                          candidateValue?: string;
                          evidence?: string;
                        }[];
                      }[];
                    }) =>
                      options.onMarkerReport?.({
                        record: request.record.id,
                        arm: request.arm,
                        ...report,
                      }),
                  }
                : {}),
              onParseFailure: (failure) => {
                stats.parseFailures[failure.kind] = (stats.parseFailures[failure.kind] ?? 0) + 1;
                options.onParseFailure?.({
                  record: request.record.id,
                  arm: request.arm,
                  ...failure,
                });
              },
            });
          } catch (error) {
            lastError = error;
            const wait = RATE_LIMIT_BACKOFF_MS[index];
            if (!isRateLimited(error) || wait === undefined) throw error;
            stats.rateLimited += 1;
            options.onFallback?.({
              role: "evaluation",
              error: "rate_limited",
              waitingMs: wait,
              record: request.record.id,
            });
            await new Promise((resolve) => setTimeout(resolve, wait));
          }
        }
        throw lastError;
      };
      const { result, audit, costAccounting } = await attempt();
      settle(costAccounting);

      if (audit.adjudicatedQuestionIds.length > 0) stats.adjudicated += 1;
      if (audit.thirdViewQuestionIds.length > 0) stats.thirdView += 1;

      const question = result.questionResults[0];
      options.onAudit?.({
        record: request.record.id,
        arm: request.arm,
        primary: Object.values(audit.primaryScores)[0],
        verifier: Object.values(audit.verifierScores)[0],
        final: question?.awardedMarks,
        disputed: audit.disputedQuestionIds.length > 0,
        adjudicated: audit.adjudicatedQuestionIds.length > 0,
        thirdView: audit.thirdViewQuestionIds.length > 0,
      });
      if (!question) {
        stats.failed += 1;
        stats.reasons.push(`${request.record.id}: marking returned no question result.`);
        return null;
      }

      stats.marked += 1;
      options.onProgress?.({
        done: stats.attempted,
        record: request.record.id,
        arm: request.arm,
        awarded: question.awardedMarks,
      });

      return {
        awardedMarks: question.awardedMarks,
        criteria: question.criterionResults?.map((criterion) => ({
          ...(criterion.criterionId ? { criterionId: criterion.criterionId } : {}),
          criterion: criterion.criterion,
          awarded: criterion.awarded,
          /**
           * Carried through, because dropping it here made the marker look like
           * it was refusing to answer.
           *
           * A ten-mark section says nothing useful through a boolean, so the
           * marking output was given a per-criterion mark and the prompt was
           * rewritten twice to insist on it. Both runs came back with none of
           * sixty, and the reading was that the models would not comply. They
           * were never asked: the shape mapped here is what scoring sees, and
           * it had no room for the field.
           */
          ...(criterion.awardedMarks === undefined
            ? {}
            : { awardedMarks: criterion.awardedMarks }),
        })),
      };
    } catch (error) {
      /*
       * A marking that threw may still have paid for the calls it made before
       * it did, and there is no figure for them. The reservation stands rather
       * than being released, so a run of failures cannot spend past the
       * ceiling while reporting that it spent nothing.
       */
      settle(undefined);
      stats.failed += 1;
      const reason = error instanceof Error ? error.message : String(error);
      stats.reasons.push(`${request.record.id} (${request.arm}): ${reason}`);
      options.onProgress?.({
        done: stats.attempted,
        record: request.record.id,
        arm: request.arm,
        awarded: null,
        error: reason,
      });
      // A failure is recorded as a refusal, never as a mark of zero: a marker
      // that crashed did not judge the work poorly, and scoring it as if it had
      // would make an outage look like inaccuracy.
      return null;
    }
  };

  return { mark, stats };
}
