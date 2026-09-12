import type { AiResponseDiagnostics } from "@/lib/ai/provider-router";
import type { PracticePaperResult } from "@/lib/practice/practice-papers";

/**
 * The named points a marking can be resumed from.
 *
 * Each one is a provider call that has been paid for. A marking that throws
 * after two markers have reported used to lose both of them: the route caught
 * the error, wrote `marking_failed`, refunded the student's daily allowance --
 * which is not the money that was spent -- and the retry started again from an
 * empty page and bought the same two reports a second time.
 *
 * These live in `lib/` rather than beside the marker because the attempt
 * document stores them, and a domain type read by a durable job must not drag
 * the marking service in behind it.
 */
export type PracticePaperMarkerStage =
  | "primary"
  | "verifier"
  | "adjudication"
  | "juror"
  | "final_reconciliation";

export type PracticePaperMarkerStageResult = {
  result: PracticePaperResult;
  diagnostics: AiResponseDiagnostics[];
  /**
   * Whether this report took more than one attempt to come back readable.
   *
   * Stored with the report because it decides something later: a primary that
   * needed repairing buys a second marker. Recomputing it on resume is
   * impossible -- the trouble was in the calls, not in the result -- so a
   * resumed marking that did not carry it would quietly skip a post-check the
   * original ran, and mark more cheaply than the student was promised.
   */
  neededParseRetry?: boolean;
};

export type PracticePaperMarkerCheckpoints = Partial<
  Record<PracticePaperMarkerStage, PracticePaperMarkerStageResult>
>;

/**
 * What a marking cost, and how much of that is actually known.
 *
 * Summing reported costs treats a call the provider said nothing about as
 * free, which is indistinguishable from one that genuinely was. A caller
 * holding money against a ceiling has to tell those apart: releasing a
 * reservation because the bill has not arrived is how a bounded run spends
 * without noticing.
 */
export type MarkingCostAccounting = {
  /** The sum of the costs providers actually reported. */
  usd: number;
  /** Calls that reported nothing, so `usd` is a floor and not a total. */
  unreportedCalls: number;
};

/**
 * A marking that gave up, carrying what it had already paid for.
 *
 * A thrown marking used to arrive at its caller with nothing but a message, so
 * an evaluation holding money against a ceiling had to treat it as unbounded
 * spend -- and one unreadable report could halt a thirty-record run that had
 * cost three tenths of a penny.
 *
 * `billingKnown` is the part that has to be earned rather than assumed. It is
 * true only when every attempt this marking made came back with a response that
 * reported its cost. A call that was aborted, or that failed over to another
 * endpoint, may have been billed for work this side never saw -- a client abort
 * does not stop a provider -- and in that case the cost genuinely is unknown
 * and the caller should still refuse to release the reservation.
 *
 * It lives here rather than beside the marker for the same reason `AiAbortError`
 * does: callers test it with `instanceof`, and half the suite replaces the
 * marking module with a mock that would not carry the class.
 */
export class PracticePaperMarkingFailedError extends Error {
  constructor(
    message: string,
    readonly costAccounting: MarkingCostAccounting,
    readonly billingKnown: boolean
  ) {
    super(message);
    this.name = "PracticePaperMarkingFailedError";
  }
}
