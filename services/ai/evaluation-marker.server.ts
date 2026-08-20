import "server-only";

import { getAiTokenCap } from "@/lib/ai/budgets";
import {
  adaptRecordToPaper,
  exemplarsToParts,
} from "@/lib/evaluation/practice-paper-adapter";
import type { AiContentPart } from "@/lib/ai/content-parts";
import type { MarkingCorpusRecord } from "@/lib/evaluation/marking-corpus";
import type { Marker, MarkRequest, MarkResponse } from "@/lib/evaluation/experiment";
import { markPracticePaperWithAudit } from "@/services/ai/practice-paper-marking.server";

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

const isRateLimited = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return /\b429\b|rate.?limit/i.test(message);
};

export type EvaluationMarkerOptions = {
  /** Hard ceiling on marking calls. The run stops rather than exceeding it. */
  maxRecords: number;
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
  /** Unreadable reports by cause, so a failure rate can be acted on. */
  parseFailures: Record<string, number>;
  reasons: string[];
};

export function createEvaluationMarker(options: EvaluationMarkerOptions): {
  mark: Marker;
  stats: EvaluationMarkerStats;
} {
  const stats: EvaluationMarkerStats = {
    attempted: 0,
    marked: 0,
    unsupported: 0,
    failed: 0,
    adjudicated: 0,
    thirdView: 0,
    rateLimited: 0,
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
    try {
      const attempt = async () => {
        let lastError: unknown;
        for (let index = 0; index <= RATE_LIMIT_BACKOFF_MS.length; index += 1) {
          try {
            return await markPracticePaperWithAudit({
              paper: adapted.adapted.paper,
              answerParts: adapted.adapted.answerParts,
              exemplarParts: exemplarsToParts(request.exemplars),
              deadlineAt: Date.now() + timeoutMs,
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
      const { result, audit } = await attempt();

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
        })),
      };
    } catch (error) {
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
