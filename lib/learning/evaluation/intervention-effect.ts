import { weightedAccuracy } from "@/lib/learning/scoring/mastery-score";
import { groupObservationsByTopic } from "@/lib/learning/profile/observations";
import type { StudyActionEvent } from "@/lib/learning/events/study-action-event";
import type { LearningObservation } from "@/lib/learning/types";

/**
 * Does acting on Jami's advice actually help?
 *
 * The calibration evaluation next door asks whether the model *predicts* well.
 * That is a different question from whether the engine is *useful*, and a
 * perfectly calibrated model can recommend nothing but wasted effort while
 * scoring beautifully. This asks the useful question: when a student took a
 * recommendation, did the topic it pointed at improve more than a comparable
 * topic they were not sent to?
 *
 * The comparison is observational and the method is deliberately blunt:
 *
 * - For each acted-on action, take the topic's answers in a window before the
 *   action and in a window after it. The difference in weighted accuracy is
 *   that action's observed change.
 * - Do the same, over the same calendar window, for every topic that was *not*
 *   acted on. That is the comparison group.
 * - Report both, and their difference, with the counts behind them.
 *
 * What this is not: a causal estimate. A student who takes advice is not a
 * random student, and topics recommended are chosen precisely because they
 * were weak, so regression to the mean flatters the treated group. The number
 * is a monitor -- if it goes negative or to zero, the engine is not earning
 * its place on Today. It is not evidence that the engine caused anything, and
 * `sufficient` guards against reading noise as either.
 */

export const INTERVENTION_EVALUATION_VERSION = "intervention-effect-v1-2026-09-21";
/** Below this many acted-on actions with usable windows, the numbers are noise. */
export const MIN_INTERVENTION_SAMPLES = 12;
/** How long after acting the result is measured, in days. */
export const OUTCOME_WINDOW_DAYS = 21;
/** How much history before the action counts as the baseline, in days. */
export const BASELINE_WINDOW_DAYS = 45;

const DAY_MS = 24 * 60 * 60 * 1000;

export type InterventionOutcome = {
  actionId: string;
  topicKey: string;
  actedAt: number;
  /**
   * Answers that carry this intervention's own id.
   *
   * The difference between "evidence that arrived after they acted" and
   * "evidence that arrived because they acted". Zero means the student opened
   * the session and produced nothing in it, which is a real outcome and not
   * the same as never having started.
   */
  attributedAnswers: number;
  baselineAccuracy: number;
  outcomeAccuracy: number;
  /** Positive means the topic improved after the student acted. */
  change: number;
  baselineAnswers: number;
  outcomeAnswers: number;
};

export type InterventionEffect = {
  version: string;
  sufficient: boolean;
  acted: {
    samples: number;
    meanChange: number | null;
    improved: number;
    /**
     * Of those, how many produced answers carrying the intervention's own id.
     *
     * Until sessions started stamping evidence this is zero, and the mean
     * change above is then a before-and-after over a window rather than over
     * the work itself. Worth reporting rather than hiding: the two are not the
     * same claim.
     */
    withAttributedEvidence: number;
  };
  /** Topics over the same period that no recommendation was taken on. */
  untouched: {
    samples: number;
    meanChange: number | null;
  };
  /** Acted mean minus untouched mean. Positive means advice is associated with more gain. */
  difference: number | null;
  outcomes: InterventionOutcome[];
};

/**
 * The scoring module's own weighted accuracy, or null for an empty window.
 *
 * Deliberately the same function the profile uses rather than a local copy:
 * it caps repeated answers to one item and splits an answer across the
 * concepts it tests, and a measurement that skipped either would report a
 * change that the mastery estimate it is being compared against never saw.
 */
function windowAccuracy(observations: readonly LearningObservation[]) {
  return observations.length > 0 ? weightedAccuracy(observations) : null;
}

function topicKeyOfTarget(targetKey: string) {
  return targetKey.startsWith("error:") ? null : targetKey;
}

function windowed(
  observations: readonly LearningObservation[],
  from: number,
  to: number
) {
  return observations.filter((observation) => observation.at >= from && observation.at < to);
}

function changeFor(
  observations: readonly LearningObservation[],
  at: number,
  now: number
) {
  const baseline = windowed(observations, at - BASELINE_WINDOW_DAYS * DAY_MS, at);
  const outcomeEnd = Math.min(now, at + OUTCOME_WINDOW_DAYS * DAY_MS);
  const outcome = windowed(observations, at, outcomeEnd);
  const baselineAccuracy = windowAccuracy(baseline);
  const outcomeAccuracy = windowAccuracy(outcome);
  if (baselineAccuracy === null || outcomeAccuracy === null) return null;
  return {
    baselineAccuracy,
    outcomeAccuracy,
    change: outcomeAccuracy - baselineAccuracy,
    baselineAnswers: baseline.length,
    outcomeAnswers: outcome.length,
  };
}

function mean(values: readonly number[]) {
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

/**
 * Measure the effect of taken advice against topics that took none.
 *
 * `events` and `observations` must be the same student's, over the same
 * period. Only `started` and `completed` count as acting; a recommendation
 * merely shown is not an intervention.
 */
export function measureInterventionEffect(
  events: readonly StudyActionEvent[],
  observations: readonly LearningObservation[],
  now: number
): InterventionEffect {
  const byTopic = groupObservationsByTopic(observations);

  /* One intervention per topic: the first time the student acted on it. */
  const firstActed = new Map<string, StudyActionEvent>();
  for (const event of events) {
    if (event.outcome !== "started" && event.outcome !== "completed") continue;
    const topicKey = topicKeyOfTarget(event.targetKey);
    if (!topicKey) continue;
    const existing = firstActed.get(topicKey);
    if (!existing || event.at < existing.at) firstActed.set(topicKey, event);
  }

  const outcomes: InterventionOutcome[] = [];
  for (const topicKey of Array.from(firstActed.keys()).sort()) {
    const event = firstActed.get(topicKey);
    const topicObservations = byTopic.get(topicKey);
    if (!event || !topicObservations) continue;
    const measured = changeFor(topicObservations, event.at, now);
    if (!measured) continue;
    const attributedAnswers = topicObservations.filter(
      (observation) => observation.interventionId === event.actionId
    ).length;
    outcomes.push({
      actionId: event.actionId,
      topicKey,
      actedAt: event.at,
      attributedAnswers,
      ...measured,
    });
  }

  /*
   * The comparison group, measured at the same moments.
   *
   * Each untouched topic is measured at the median time the student acted, so
   * both groups span the same calendar period and the same amount of the
   * student's term. Measuring untouched topics "from now" instead would
   * compare a window of revision against a window of the summer.
   */
  const actedTimes = outcomes.map((outcome) => outcome.actedAt).sort((a, b) => a - b);
  const pivot = actedTimes.length > 0 ? actedTimes[Math.floor(actedTimes.length / 2)] : now;
  const untouchedChanges: number[] = [];
  for (const [topicKey, topicObservations] of byTopic) {
    if (firstActed.has(topicKey)) continue;
    const measured = changeFor(topicObservations, pivot, now);
    if (measured) untouchedChanges.push(measured.change);
  }

  const actedChanges = outcomes.map((outcome) => outcome.change);
  const actedMean = mean(actedChanges);
  const untouchedMean = mean(untouchedChanges);

  return {
    version: INTERVENTION_EVALUATION_VERSION,
    sufficient: outcomes.length >= MIN_INTERVENTION_SAMPLES,
    acted: {
      samples: outcomes.length,
      meanChange: actedMean,
      improved: actedChanges.filter((change) => change > 0).length,
      withAttributedEvidence: outcomes.filter((outcome) => outcome.attributedAnswers > 0).length,
    },
    untouched: {
      samples: untouchedChanges.length,
      meanChange: untouchedMean,
    },
    difference: actedMean !== null && untouchedMean !== null ? actedMean - untouchedMean : null,
    outcomes,
  };
}
