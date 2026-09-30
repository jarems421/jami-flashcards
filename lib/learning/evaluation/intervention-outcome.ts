import { MIN_SIGNAL_CONFIDENCE } from "@/lib/learning/profile/thresholds";
import type { LearningTopicDecision } from "@/lib/learning/types";

/**
 * What became of one piece of advice, in the dimensions that are actually
 * separate.
 *
 * "Did it work" is the wrong question because it has at least three answers
 * that do not move together:
 *
 *   before: mastery 0.55, confidence 0.31, decision diagnose
 *   after:  mastery 0.48, confidence 0.82, decision retrieve
 *
 * Mastery fell. The intervention was a success: Jami went from not knowing
 * whether this was weak to knowing, with evidence, that it is a retrieval
 * problem. A single `successful` boolean cannot represent that, and whichever
 * way it was defined it would be wrong for half the cases.
 *
 * So resolution and improvement are recorded apart, and a third possibility is
 * recorded too: that nothing came back and neither question can be answered.
 * That last one is the failure mode worth designing against, because an
 * absence of evidence quietly averaged in as a zero would make a dashboard say
 * "no improvement" about work nobody did.
 */

export type LearnerSnapshot = {
  mastery: number;
  confidence: number;
  decision?: LearningTopicDecision;
};

/**
 * Whether the intervention settled what it was asking.
 *
 * `unresolved` is an honest answer: evidence arrived and the engine still
 * cannot say. `not_evaluable` is a different honest answer: nothing arrived,
 * so there is nothing to judge.
 */
export type InterventionResolution =
  /** Enough evidence arrived to reach the confidence the engine needs. */
  | "resolved"
  /** Evidence arrived and the estimate is still too thin to act on. */
  | "unresolved"
  /** No attributable evidence arrived. Neither resolution nor improvement applies. */
  | "not_evaluable";

/**
 * Which kind of before-and-after this is.
 *
 * A window comparison and an attributed one are not the same claim, and a
 * consumer that cannot tell them apart will over-read the weaker one.
 */
export type InterventionEvidenceBasis = "attributed" | "window_only" | "none";

export type InterventionOutcome = {
  interventionId: string;
  targetKey: string;
  action?: LearningTopicDecision["action"];
  before: LearnerSnapshot;
  after: LearnerSnapshot;
  resolution: InterventionResolution;
  /**
   * Whether mastery rose, fell or held. Null when nothing came back: an
   * unanswered intervention has no improvement, which is not the same as no
   * change.
   */
  masteryChange: number | null;
  confidenceChange: number | null;
  /** Whether the engine now wants something different from this concept. */
  decisionChanged: boolean;
  attributedAnswers: number;
  basis: InterventionEvidenceBasis;
};

export type BuildInterventionOutcomeInput = {
  interventionId: string;
  targetKey: string;
  action?: LearningTopicDecision["action"];
  before: LearnerSnapshot;
  after: LearnerSnapshot;
  attributedAnswers: number;
  /** Answers on the target after the student acted, attributed or not. */
  windowAnswers?: number;
};

function decisionKey(decision: LearningTopicDecision | undefined) {
  return decision ? `${decision.action}:${decision.reason}` : "none";
}

/**
 * One intervention's outcome, with every dimension reported separately.
 *
 * Deliberately pure and deliberately unopinionated about what counts as good:
 * it reports what changed and how well the change is evidenced, and leaves
 * "was that worth doing" to a consumer that can see many of them at once.
 */
export function buildInterventionOutcome(
  input: BuildInterventionOutcomeInput
): InterventionOutcome {
  const attributed = Math.max(0, input.attributedAnswers);
  const windowAnswers = Math.max(0, input.windowAnswers ?? 0);

  const basis: InterventionEvidenceBasis =
    attributed > 0 ? "attributed" : windowAnswers > 0 ? "window_only" : "none";

  /*
   * Nothing came back, so there is nothing to judge.
   *
   * Reported as its own state rather than as a zero change. A student who
   * never opened the work and a student who did it and got no better must not
   * read alike, and a mean taken over both would say the intervention had no
   * effect when half of it never happened.
   */
  if (basis === "none") {
    return {
      interventionId: input.interventionId,
      targetKey: input.targetKey,
      ...(input.action ? { action: input.action } : {}),
      before: input.before,
      after: input.after,
      resolution: "not_evaluable",
      masteryChange: null,
      confidenceChange: null,
      decisionChanged: decisionKey(input.before.decision) !== decisionKey(input.after.decision),
      attributedAnswers: attributed,
      basis,
    };
  }

  /*
   * Resolution is about certainty, not correctness.
   *
   * The engine's own floor decides it: below `MIN_SIGNAL_CONFIDENCE` it will
   * not call a concept weak or strong, so an intervention that carries the
   * estimate over that line has settled the question it was asking -- whatever
   * the answer turned out to be.
   */
  const resolution: InterventionResolution =
    input.after.confidence >= MIN_SIGNAL_CONFIDENCE ? "resolved" : "unresolved";

  return {
    interventionId: input.interventionId,
    targetKey: input.targetKey,
    ...(input.action ? { action: input.action } : {}),
    before: input.before,
    after: input.after,
    resolution,
    masteryChange: input.after.mastery - input.before.mastery,
    confidenceChange: input.after.confidence - input.before.confidence,
    decisionChanged: decisionKey(input.before.decision) !== decisionKey(input.after.decision),
    attributedAnswers: attributed,
    basis,
  };
}

export type InterventionOutcomeSummary = {
  total: number;
  /** Outcomes with evidence behind them; the only ones any rate should divide by. */
  evaluable: number;
  notEvaluable: number;
  resolved: number;
  improved: number;
  decisionChanged: number;
  /** Of the evaluable ones, how many rest on the intervention's own answers. */
  attributed: number;
  meanMasteryChange: number | null;
};

/**
 * Counts, with the denominator stated.
 *
 * `evaluable` is separated from `total` on purpose: every rate here divides by
 * the first, because dividing by the second would let interventions nobody
 * acted on drag every number towards zero and read as failure.
 */
export function summarizeInterventionOutcomes(
  outcomes: readonly InterventionOutcome[]
): InterventionOutcomeSummary {
  const evaluable = outcomes.filter((outcome) => outcome.resolution !== "not_evaluable");
  const changes = evaluable
    .map((outcome) => outcome.masteryChange)
    .filter((change): change is number => change !== null);

  return {
    total: outcomes.length,
    evaluable: evaluable.length,
    notEvaluable: outcomes.length - evaluable.length,
    resolved: evaluable.filter((outcome) => outcome.resolution === "resolved").length,
    improved: changes.filter((change) => change > 0).length,
    decisionChanged: evaluable.filter((outcome) => outcome.decisionChanged).length,
    attributed: evaluable.filter((outcome) => outcome.basis === "attributed").length,
    meanMasteryChange:
      changes.length > 0
        ? changes.reduce((total, change) => total + change, 0) / changes.length
        : null,
  };
}
