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

/**
 * How long a role's report may take, and why it is a token budget not a clock.
 *
 * A report either fits in the time or is cut off mid-JSON and thrown away, so
 * the only honest way to choose the number is to divide what the role writes
 * by how fast the slowest endpoint writes it. Both halves are measured.
 *
/** Output tokens a role's report reaches, p99 over every logged marking call. */
const ROLE_OUTPUT_CEILING: Record<string, number> = {
  worker: 1_636,
  supervisor: 7_600,
  juror: 9_598,
  default: 7_600,
};

/**
 * The slowest sustained generation observed, p5 over 3,880 calls.
 *
 * Deliberately the slow tail rather than the median. A timeout sized on the
 * median is wrong half the time by construction, and being wrong here does not
 * mean waiting longer -- it means discarding a finished piece of work.
 */
const FLOOR_TOKENS_PER_SECOND = 23.3;

/** Room for a report longer than any yet seen, without licensing a stuck call. */
const TIMEOUT_SAFETY = 1.25;

export function markerTimeoutMs(modelRole: string) {
  const tokens = ROLE_OUTPUT_CEILING[modelRole] ?? ROLE_OUTPUT_CEILING.default;
  return Math.ceil((tokens / FLOOR_TOKENS_PER_SECOND) * TIMEOUT_SAFETY) * 1_000;
}

/**
 * The same number for a fallback endpoint, because the floor rate already is
 * the fallback on a bad day. Two constants existed to say that the second
 * endpoint is slower; measuring the slow one directly says it better, and the
 * whole marking's deadline still bounds every attempt.
 */

/** Which model writes each stage's report, and therefore how long it may take. */
const STAGE_ROLE: Record<PracticePaperMarkerStage, string> = {
  primary: "supervisor",
  verifier: "worker",
  adjudication: "supervisor",
  juror: "juror",
  final_reconciliation: "supervisor",
};

/** Stages that run together, so the pair costs the slower one and not both. */
const CONCURRENT_STAGES: ReadonlyArray<readonly PracticePaperMarkerStage[]> = [
  ["primary", "verifier"],
];

/** A marking: two blind markers together, then an adjudicator if they disagree. */
export const EXAM_MARKING_STAGES: readonly PracticePaperMarkerStage[] = [
  "primary",
  "verifier",
  "adjudication",
];

/** A student-requested check: an independent view, then reconciliation. */
export const EXAM_REVIEW_STAGES: readonly PracticePaperMarkerStage[] = [
  "juror",
  "final_reconciliation",
];

/**
 * How long the stages still to run actually need.
 *
 * The deadline used to be one chosen number for every job -- ten minutes --
 * against paths that need more: a marking then an adjudication is 408 seconds
 * of supervisor twice over, and an independent review then its reconciliation
 * is 515 plus 408. Both exceed the budget they were given, and they are
 * exactly the paths a disagreement takes, so the expensive recovery had least
 * room precisely when it was needed.
 *
 * Sizing it from the stages fixes that without licensing a half-hour wait,
 * because a stage already checkpointed costs nothing. A resumed marking that
 * has its two reports needs only the adjudicator, and asks for only that.
 */
export function markerStageBudgetMs(
  stages: readonly PracticePaperMarkerStage[],
  completed: PracticePaperMarkerCheckpoints = {}
) {
  const pending = stages.filter((stage) => !completed[stage]);
  const counted = new Set<PracticePaperMarkerStage>();
  let total = 0;
  for (const stage of pending) {
    if (counted.has(stage)) continue;
    const group = CONCURRENT_STAGES.find((members) => members.includes(stage));
    const together = group ? group.filter((member) => pending.includes(member)) : [stage];
    total += Math.max(...together.map((member) => markerTimeoutMs(STAGE_ROLE[member])));
    for (const member of together) counted.add(member);
  }
  return total;
}
